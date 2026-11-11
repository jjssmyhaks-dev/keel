#!/usr/bin/env node
// Restore an Authab logical backup produced by scripts/backup-db.mjs.
// The target schema must already exist (run prisma migrate deploy first).
// This tool truncates the backed-up tables in the target database and reloads
// every row inside a single transaction, then verifies row counts and audit heads.

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { createGunzip } from "node:zlib";
import { parseArgs } from "node:util";
import pg from "pg";

const FORMAT = "authab-logical-backup";
const VERSION = 1;
const INSERT_BATCH = 300;

const { values: args } = parseArgs({
  options: {
    file: { type: "string" },
    target: { type: "string" },
    "dry-run": { type: "boolean", default: false },
    "skip-checksum": { type: "boolean", default: false },
    force: { type: "boolean", default: false },
    help: { type: "boolean", short: "h" },
  },
});

if (args.help) {
  console.log(`Usage: node scripts/restore-db.mjs --file <backup.jsonl.gz> --target <direct-postgres-url> [--dry-run] [--skip-checksum] [--force]

--target is mandatory: this tool never falls back to DATABASE_URL. It truncates
and reloads the tables present in the backup inside one transaction. --force is
required when the target host and database match the backup source.`);
  process.exit(0);
}

if (!args.file) {
  console.error("Missing --file <backup.jsonl.gz>");
  process.exit(1);
}
if (!args.target) {
  console.error("Missing --target <direct-postgres-url>. This tool never falls back to DATABASE_URL.");
  process.exit(1);
}

const targetUrl = new URL(args.target);
const target = {
  host: targetUrl.hostname,
  database: decodeURIComponent(targetUrl.pathname.replace(/^\//, "")) || "postgres",
  pooled: targetUrl.hostname.includes("-pooler"),
};

pg.types.setTypeParser(20, (value) => value);

const quote = (identifier) => `"${String(identifier).replaceAll('"', '""')}"`;

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function sha256File(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function verifyChecksum(file) {
  if (args["skip-checksum"]) return null;
  let sidecar;
  try {
    sidecar = await readFile(`${file}.sha256`, "utf8");
  } catch {
    fail(`Missing checksum file ${path.basename(file)}.sha256. Refusing to restore unverified data (override with --skip-checksum).`);
  }
  const expected = sidecar.trim().split(/\s+/)[0];
  const actual = await sha256File(file);
  if (expected !== actual) fail(`Checksum mismatch: expected ${expected}, got ${actual}`);
  return actual;
}

async function* backupLines(file) {
  const stream = createReadStream(file).pipe(createGunzip());
  const reader = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of reader) {
    if (!line.trim()) continue;
    yield JSON.parse(line);
  }
}

async function readBackup(file) {
  const header = { tables: [] };
  let summary = null;
  const counts = new Map();
  for await (const line of backupLines(file)) {
    if (line.kind === "header") Object.assign(header, line);
    else if (line.kind === "rows") counts.set(line.table, (counts.get(line.table) ?? 0) + line.rows.length);
    else if (line.kind === "summary") summary = line;
  }
  return { header, summary, counts };
}

function isBytes(value) {
  return value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 1 && typeof value.$bytes === "string";
}

async function main() {
  const file = path.resolve(args.file);
  const info = await stat(file).catch(() => null);
  if (!info) fail(`Backup file not found: ${file}`);

  const checksum = await verifyChecksum(file);
  const { header, summary, counts } = await readBackup(file);
  if (header.format !== FORMAT) fail(`Unrecognised backup format: ${header.format}`);
  if (header.version !== VERSION) fail(`Unsupported backup version: ${header.version}`);
  if (!header.tables?.length) fail("Backup contains no tables");
  if (!summary) fail("Backup is truncated: no summary line");

  for (const table of summary.tables) {
    if ((counts.get(table.name) ?? 0) !== table.rows) {
      fail(`Backup is inconsistent: ${table.name} summary says ${table.rows}, stream contains ${counts.get(table.name) ?? 0}`);
    }
  }

  const source = header.source ?? {};
  const sameDatabase = source.host === target.host && source.database === target.database;
  if (sameDatabase && !args.force) {
    fail("Refusing to restore over the source database. Re-run with --force only if you intend to replace it.");
  }

  const client = new pg.Client({ connectionString: args.target, application_name: "authab-restore" });
  await client.connect();
  let inTransaction = false;
  try {
    await client.query("SET TIME ZONE 'UTC'");
    const present = await client.query(`
      SELECT c.relname AS name
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
    `);
    const presentTables = new Set(present.rows.map((row) => row.name));
    const missing = header.tables.map((table) => table.name).filter((name) => !presentTables.has(name));
    if (missing.length) {
      fail(`Target schema is missing ${missing.length} table(s): ${missing.join(", ")}. Run prisma migrate deploy against the target first.`);
    }

    const edges = await client.query(`
      SELECT DISTINCT tc.table_name AS child, ccu.table_name AS parent
      FROM information_schema.table_constraints tc
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name AND ccu.constraint_schema = tc.constraint_schema
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
    `);
    const position = new Map(header.tables.map((table, index) => [table.name, index]));
    for (const { child, parent } of edges.rows) {
      if (child === parent || !position.has(child) || !position.has(parent)) continue;
      if (position.get(child) < position.get(parent)) {
        fail(`Backup order is not valid for the target schema: ${child} is stored before its parent ${parent}. Was the schema migrated after this backup?`);
      }
    }

    if (args["dry-run"]) {
      console.log(
        JSON.stringify(
          {
            ok: true,
            dryRun: true,
            file,
            checksum,
            target: { host: target.host, database: target.database, pooled: target.pooled },
            createdAt: header.createdAt,
            tables: header.tables.length,
            rows: summary.tables.reduce((total, table) => total + table.rows, 0),
            auditHeads: summary.audit?.environments?.length ?? 0,
          },
          null,
          2,
        ),
      );
      return;
    }

    const startedAt = Date.now();
    await client.query("BEGIN");
    inTransaction = true;
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    await client.query("SET LOCAL app.audit_maintenance = 'on'");

    const tableNames = header.tables.map((table) => quote(table.name)).join(", ");
    await client.query(`TRUNCATE TABLE ${tableNames} CASCADE`);

    const columnsByTable = new Map(header.tables.map((table) => [table.name, table.columns]));
    const inserted = new Map();
    let pendingTable = null;
    let pendingColumns = null;
    let batch = [];

    async function flush() {
      if (!batch.length) return;
      const params = [];
      const tuples = batch.map((row) => {
        const placeholders = pendingColumns.map((column) => {
          const value = row[column];
          if (isBytes(value)) {
            params.push(Buffer.from(value.$bytes, "base64"));
          } else {
            params.push(value);
          }
          return `$${params.length}`;
        });
        return `(${placeholders.join(", ")})`;
      });
      const sql = `INSERT INTO ${quote(pendingTable)} (${pendingColumns.map(quote).join(", ")}) VALUES ${tuples.join(", ")}`;
      await client.query(sql, params);
      inserted.set(pendingTable, (inserted.get(pendingTable) ?? 0) + batch.length);
      batch = [];
    }

    for await (const line of backupLines(file)) {
      if (line.kind === "table") {
        await flush();
        pendingTable = line.name;
        pendingColumns = columnsByTable.get(line.name);
        if (!pendingColumns) fail(`Backup row for unknown table ${line.name}`);
      } else if (line.kind === "rows") {
        if (line.table !== pendingTable) fail(`Backup stream is out of order at ${line.table}`);
        for (const row of line.rows) {
          batch.push(row);
          if (batch.length >= INSERT_BATCH) await flush();
        }
      } else if (line.kind === "summary") {
        await flush();
      }
    }
    await flush();

    const verification = [];
    for (const table of summary.tables) {
      const count = await client.query(`SELECT COUNT(*)::int AS count FROM ${quote(table.name)}`);
      const actual = count.rows[0].count;
      verification.push({ table: table.name, expected: table.rows, actual, ok: actual === table.rows });
    }
    const mismatched = verification.filter((table) => !table.ok);
    if (mismatched.length) {
      await client.query("ROLLBACK");
      inTransaction = false;
      fail(`Row count mismatch after restore: ${mismatched.map((table) => `${table.table} ${table.actual}/${table.expected}`).join(", ")}`);
    }

    let auditOk = null;
    if (summary.audit) {
      const heads = await client.query(`
        SELECT DISTINCT ON ("environmentId") "environmentId", seq, hash
        FROM "AuditEvent"
        ORDER BY "environmentId", seq DESC
      `);
      const expected = new Map((summary.audit.environments ?? []).map((head) => [head.environmentId, `${head.seq}:${head.hash}`]));
      auditOk = heads.rows.length === expected.size && heads.rows.every((head) => expected.get(head.environmentId) === `${head.seq}:${head.hash}`);
      if (!auditOk) {
        await client.query("ROLLBACK");
        inTransaction = false;
        fail("Audit chain heads do not match the backup manifest after restore");
      }
    }

    await client.query("COMMIT");
    inTransaction = false;

    console.log(
      JSON.stringify(
        {
          ok: true,
          file,
          checksum,
          target: { host: target.host, database: target.database, pooled: target.pooled },
          durationMs: Date.now() - startedAt,
          tables: verification.length,
          rows: verification.reduce((total, table) => total + table.actual, 0),
          auditHeadsVerified: auditOk,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    if (inTransaction) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end().catch(() => {});
  }
}

main().catch((error) => fail(`Restore failed: ${error.message}`));
