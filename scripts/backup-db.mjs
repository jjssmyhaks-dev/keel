#!/usr/bin/env node
// Logical data backup for Authab on Postgres.
// Schema is owned by Prisma migrations; this tool backs up the rows and writes a
// checksummed manifest so a restore can prove what it restored.

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { createGzip } from "node:zlib";
import { parseArgs } from "node:util";
import pg from "pg";

const FORMAT = "authab-logical-backup";
const VERSION = 1;
const BATCH = 500;
const EXCLUDED = new Set(["_prisma_migrations"]);

const { values: args } = parseArgs({
  options: {
    out: { type: "string", default: ".backups" },
    url: { type: "string" },
    help: { type: "boolean", short: "h" },
  },
});

if (args.help) {
  console.log(`Usage: node --env-file=.env scripts/backup-db.mjs [--out .backups] [--url <direct-postgres-url>]

Defaults to DATABASE_URL_UNPOOLED (then DATABASE_URL). Use a direct, non-pooled
connection. Writes <out>/authab-<database>-<timestamp>.jsonl.gz and a .sha256 sidecar.`);
  process.exit(0);
}

const url = args.url || process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) {
  console.error("No database URL. Set DATABASE_URL_UNPOOLED or DATABASE_URL, or pass --url.");
  process.exit(1);
}

const connection = new URL(url);
const database = decodeURIComponent(connection.pathname.replace(/^\//, "")) || "postgres";
const source = {
  host: connection.hostname,
  database,
  user: decodeURIComponent(connection.username || ""),
  branch: process.env.NEON_BRANCH || null,
};

// Keep timestamp columns as raw session-UTC text so a restore is byte-for-byte
// independent of the machine timezone.
pg.types.setTypeParser(1114, (value) => value);
pg.types.setTypeParser(1184, (value) => value);
pg.types.setTypeParser(1082, (value) => value);
pg.types.setTypeParser(20, (value) => value);

const quote = (identifier) => `"${String(identifier).replaceAll('"', '""')}"`;

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function tableCatalog(client) {
  const { rows } = await client.query(`
    SELECT c.relname AS name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
    ORDER BY c.relname
  `);
  return rows.map((row) => row.name).filter((name) => !name.startsWith("_") && !EXCLUDED.has(name));
}

async function columnCatalog(client, table) {
  const { rows } = await client.query(
    `SELECT column_name AS name, data_type AS type
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY ordinal_position`,
    [table],
  );
  return rows;
}

async function primaryKey(client, table) {
  const { rows } = await client.query(
    `SELECT a.attname AS name
     FROM pg_index i
     JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
     WHERE i.indrelid = $1::regclass AND i.indisprimary
     ORDER BY array_position(i.indkey, a.attnum)`,
    [quote(table)],
  );
  return rows.map((row) => row.name);
}

async function foreignKeys(client) {
  const { rows } = await client.query(`
    SELECT DISTINCT tc.table_name AS child, ccu.table_name AS parent
    FROM information_schema.table_constraints tc
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name AND ccu.constraint_schema = tc.constraint_schema
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
  `);
  return rows;
}

function orderByParentsFirst(tables, edges) {
  const known = new Set(tables);
  const parents = new Map(tables.map((table) => [table, new Set()]));
  for (const { child, parent } of edges) {
    if (child !== parent && known.has(child) && known.has(parent)) parents.get(child).add(parent);
  }
  const ordered = [];
  const state = new Map();
  const stack = [];
  function visit(table) {
    const current = state.get(table) ?? 0;
    if (current === 2) return;
    if (current === 1) {
      throw new Error(`Foreign-key cycle detected: ${[...stack, table].join(" -> ")}`);
    }
    state.set(table, 1);
    stack.push(table);
    for (const parent of parents.get(table)) visit(parent);
    stack.pop();
    state.set(table, 2);
    ordered.push(table);
  }
  for (const table of tables) visit(table);
  return ordered;
}

const client = new pg.Client({ connectionString: url, application_name: "authab-backup" });

function isoStamp() {
  return new Date().toISOString().replaceAll(":", "-").replace(/\.\d+Z$/, "Z");
}

async function main() {
  await mkdir(args.out, { recursive: true });
  const createdAt = new Date().toISOString();
  const target = path.join(args.out, `authab-${database}-${isoStamp()}.jsonl.gz`);
  const output = createWriteStream(target);
  const gzip = createGzip({ level: 9 });
  gzip.pipe(output);

  function writeLine(value) {
    const chunk = Buffer.from(`${JSON.stringify(value)}\n`);
    return new Promise((resolve, reject) => {
      gzip.write(chunk, (error) => (error ? reject(error) : resolve()));
    });
  }

  async function sha256File(file) {
    const fileHash = createHash("sha256");
    for await (const chunk of createReadStream(file)) fileHash.update(chunk);
    return fileHash.digest("hex");
  }

  function finish() {
    return new Promise((resolve, reject) => {
      output.on("finish", resolve);
      output.on("error", reject);
      gzip.end();
    });
  }

  let committed = false;
  try {
    await client.connect();
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL TIME ZONE 'UTC'");

    const allTables = await tableCatalog(client);
    if (!allTables.length) throw new Error("No tables found in schema public");

    const edges = await foreignKeys(client);
    const tables = orderByParentsFirst(allTables, edges);

    const tableMeta = [];
    for (const table of tables) {
      const columns = await columnCatalog(client, table);
      if (!columns.length) throw new Error(`Could not read columns for ${table}`);
      const pk = await primaryKey(client, table);
      tableMeta.push({ name: table, columns: columns.map((column) => column.name), pk });
    }

    await writeLine({
      kind: "header",
      format: FORMAT,
      version: VERSION,
      createdAt,
      source,
      tables: tableMeta.map((table) => ({ name: table.name, columns: table.columns, orderBy: table.pk })),
    });

    const summaryTables = [];
    for (const table of tableMeta) {
      await writeLine({ kind: "table", name: table.name });

      const columnList = table.columns.map(quote).join(", ");
      const orderBy = table.pk.length ? table.pk.map(quote).join(", ") : "ctid";
      let keyset = table.pk.length ? null : 0;
      let rowCount = 0;
      let batch = [];

      for (;;) {
        let where = "";
        const params = [];
        if (table.pk.length && keyset) {
          const placeholders = table.pk.map((_, index) => `$${index + 1}`);
          where = `WHERE (${table.pk.map(quote).join(", ")}) > (${placeholders.join(", ")})`;
          params.push(...keyset);
        }
        const limit = keyset === 0 ? `LIMIT ${BATCH} OFFSET ${rowCount}` : `LIMIT ${BATCH}`;
        const sql = `SELECT ${columnList} FROM ${quote(table.name)} ${where} ORDER BY ${orderBy} ${keyset === 0 ? limit : "LIMIT " + BATCH}`;
        const { rows } = await client.query(sql, params);
        if (!rows.length) break;

        for (const row of rows) {
          batch.push(row);
          rowCount += 1;
          if (batch.length >= BATCH) {
            await writeLine({ kind: "rows", table: table.name, rows: batch });
            batch = [];
          }
        }
        if (rows.length < BATCH) break;
        if (table.pk.length) {
          const last = rows[rows.length - 1];
          keyset = table.pk.map((column) => last[column]);
        } else {
          keyset = 0;
        }
      }
      if (batch.length) await writeLine({ kind: "rows", table: table.name, rows: batch });
      summaryTables.push({ name: table.name, rows: rowCount });
    }

    let audit = null;
    if (allTables.includes("AuditEvent")) {
      const heads = await client.query(`
        SELECT DISTINCT ON ("environmentId") "environmentId", seq, hash
        FROM "AuditEvent"
        ORDER BY "environmentId", seq DESC
      `);
      const totals = await client.query('SELECT COUNT(*)::int AS count FROM "AuditEvent"');
      audit = { rows: totals.rows[0].count, environments: heads.rows };
    }

    await client.query("COMMIT");
    committed = true;

    const completedAt = new Date().toISOString();
    await writeLine({ kind: "summary", completedAt, tables: summaryTables, audit });
    await finish();

    const digest = await sha256File(target);
    await writeFile(`${target}.sha256`, `${digest}  ${path.basename(target)}\n`);

    const { size } = await stat(target);
    console.log(
      JSON.stringify(
        {
          ok: true,
          file: path.resolve(target),
          bytes: size,
          sha256: digest,
          durationMs: Date.now() - Date.parse(createdAt),
          tables: summaryTables.length,
          rows: summaryTables.reduce((total, table) => total + table.rows, 0),
          auditRows: audit?.rows ?? null,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    if (!committed) await client.query("ROLLBACK").catch(() => {});
    gzip.destroy();
    output.destroy();
    await unlink(target).catch(() => {});
    throw error;
  } finally {
    await client.end().catch(() => {});
  }
}

main().catch((error) => fail(`Backup failed: ${error.message}`));
