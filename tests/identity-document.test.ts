import "./helpers/test-env";
import assert from "node:assert/strict";
import test from "node:test";
import { createPublicKey, generateKeyPairSync } from "node:crypto";
import { SignJWT, decodeProtectedHeader, importPKCS8, type JWK } from "jose";
import { db } from "../src/lib/db";
import {
  buildIdentityDocumentPayload,
  documentStatus,
  isVerificationVisibility,
  issueIdentityDocumentSafe,
  issueIdentityDocumentWith,
  organizationReference,
  publicJwkFromPem,
  visibilityOf,
  type IdentityDocumentAgent,
  type IdentityDocumentStore,
} from "../src/lib/identity-document";
import { ISSUER, getJwks, getSigningKeyId, verifyPlatformJws } from "../src/lib/jwt";
import { readSource } from "./helpers/source";

function agentPublicKey() {
  const pair = generateKeyPairSync("ed25519");
  return pair.publicKey.export({ type: "spki", format: "pem" }).toString();
}

function jwkFor(publicPem: string): JWK {
  const jwk = createPublicKey(publicPem).export({ format: "jwk" }) as JWK;
  return { kty: "OKP", crv: "Ed25519", x: jwk.x };
}

const PUBLIC_KEY = agentPublicKey();

function fixtureAgent(overrides: Partial<IdentityDocumentAgent> = {}): IdentityDocumentAgent {
  return {
    id: "agt_identity",
    status: "active",
    fingerprint: "fp_identity",
    publicKey: PUBLIC_KEY,
    verificationVisibility: "limited",
    createdAt: new Date("2026-02-03T04:05:06.000Z"),
    environment: { type: "production", project: { orgId: "org_identity" } },
    ...overrides,
  };
}

type Row = {
  id: string;
  agentId: string;
  docSeq: number;
  documentJson: string;
  jws: string;
  issuerKeyId: string;
  issuedAt: Date;
  supersededAt: Date | null;
};

class MemoryDocumentStore implements IdentityDocumentStore {
  rows: Row[] = [];
  supersedeWhere: unknown[] = [];

  readonly agent: IdentityDocumentStore["agent"];
  readonly agentIdentityDocument: IdentityDocumentStore["agentIdentityDocument"];

  constructor(agentRow: IdentityDocumentAgent | null) {
    this.agent = { findUnique: async () => agentRow };
    this.agentIdentityDocument = {
      findFirst: async ({ where }: { where: { agentId: string } }) =>
        this.rows.filter((row) => row.agentId === where.agentId).sort((a, b) => b.docSeq - a.docSeq)[0] ?? null,
      create: async ({ data }: { data: Omit<Row, "id" | "supersededAt"> }) => {
        const row: Row = { id: `doc_${this.rows.length + 1}`, supersededAt: null, ...data };
        this.rows.push(row);
        return row;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { agentId: string; supersededAt: null };
        data: { supersededAt: Date };
      }) => {
        this.supersedeWhere.push(where);
        let count = 0;
        for (const row of this.rows) {
          if (row.agentId === where.agentId && row.supersededAt === null) {
            row.supersededAt = data.supersededAt;
            count += 1;
          }
        }
        return { count };
      },
    };
  }
}

test("status and visibility fall back to the safe value", () => {
  for (const status of ["active", "paused", "suspended", "revoked"] as const) {
    assert.equal(documentStatus(status), status);
  }
  assert.equal(documentStatus("killed"), "revoked");
  assert.equal(documentStatus(""), "revoked");

  assert.equal(isVerificationVisibility("public"), true);
  assert.equal(isVerificationVisibility("private"), true);
  assert.equal(isVerificationVisibility("internal"), false);
  assert.equal(visibilityOf(undefined), "public");
  assert.equal(visibilityOf(null), "public");
  assert.equal(visibilityOf("limited"), "limited");
  assert.equal(visibilityOf("nonsense"), "public");
});

test("the organization reference is stable, 24 hex characters and irreversible", () => {
  const reference = organizationReference("org_alpha");
  assert.match(reference, /^[0-9a-f]{24}$/);
  assert.equal(organizationReference("org_alpha"), reference);
  assert.notEqual(organizationReference("org_beta"), reference);
  assert.equal(reference.includes("org_alpha"), false);
});

test("publicJwkFromPem publishes only Ed25519 key material", () => {
  assert.deepEqual(publicJwkFromPem(PUBLIC_KEY), { kty: "OKP", crv: "Ed25519", x: jwkFor(PUBLIC_KEY).x });
  const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const rsaPem = rsa.publicKey.export({ type: "spki", format: "pem" }).toString();
  assert.throws(() => publicJwkFromPem(rsaPem), /Ed25519/);
});

test("buildIdentityDocumentPayload embeds exactly the published fields", () => {
  const now = new Date("2026-05-06T07:08:09.500Z");
  const agent = fixtureAgent();
  const document = buildIdentityDocumentPayload(agent, { docSeq: 3, now });

  assert.deepEqual(document, {
    v: 1,
    iss: ISSUER,
    iat: Math.floor(now.getTime() / 1000),
    doc_seq: 3,
    agent_id: "agt_identity",
    key_fingerprint: "fp_identity",
    public_jwk: { kty: "OKP", crv: "Ed25519", x: jwkFor(PUBLIC_KEY).x },
    org_ref: organizationReference("org_identity"),
    environment: "production",
    status: "active",
    visibility: "limited",
    created_at: "2026-02-03T04:05:06.000Z",
  });
});

test("documents map environment, status and visibility conservatively", () => {
  const development = buildIdentityDocumentPayload(
    fixtureAgent({
      status: "paused",
      verificationVisibility: "unexpected",
      environment: { type: "development", project: { orgId: "org_identity" } },
    }),
    { docSeq: 1, now: new Date() },
  );
  assert.equal(development.environment, "development");
  assert.equal(development.status, "paused");
  assert.equal(development.visibility, "public");

  const deleted = buildIdentityDocumentPayload(fixtureAgent({ status: "deleted" }), {
    docSeq: 1,
    now: new Date(),
  });
  assert.equal(deleted.status, "revoked");

  assert.throws(
    () => buildIdentityDocumentPayload(fixtureAgent({ publicKey: null }), { docSeq: 1, now: new Date() }),
    /no public key/,
  );
});

test("issuance signs the document, verifies against JWKS and supersedes the prior one", async () => {
  const store = new MemoryDocumentStore(fixtureAgent());
  const first = await issueIdentityDocumentWith(store, "agt_identity");
  assert.ok(first);

  assert.equal(first.docSeq, 1);
  assert.equal(store.rows.length, 1);
  assert.equal(store.rows[0].jws, first.jws);
  assert.equal(store.rows[0].issuerKeyId, await getSigningKeyId());
  assert.deepEqual(JSON.parse(store.rows[0].documentJson), first.document);

  const header = decodeProtectedHeader(first.jws);
  assert.deepEqual(header, { alg: "EdDSA", kid: await getSigningKeyId(), typ: "agent-identity+jwt" });

  const verified = await verifyPlatformJws(first.jws);
  assert.deepEqual(verified.payload, JSON.parse(JSON.stringify(first.document)));
  assert.equal(verified.payload.iss, ISSUER);

  const second = await issueIdentityDocumentWith(store, "agt_identity");
  assert.ok(second);
  assert.equal(second.docSeq, 2);
  assert.equal(store.rows.length, 2);
  assert.ok(store.rows[0].supersededAt instanceof Date);
  assert.equal(store.rows[1].supersededAt, null);
  assert.deepEqual(store.supersedeWhere, [{ agentId: "agt_identity", supersededAt: null }]);
  assert.notEqual(first.jws, second.jws);
});

test("issuance returns null for an unknown agent without writing", async () => {
  const store = new MemoryDocumentStore(null);
  assert.equal(await issueIdentityDocumentWith(store, "agt_missing"), null);
  assert.equal(store.rows.length, 0);
});

test("verifyPlatformJws accepts documents signed by a retired published key", async () => {
  const retired = generateKeyPairSync("ed25519");
  const retiredJwk = retired.publicKey.export({ format: "jwk" }) as JWK;
  const pem = `-----BEGIN PRIVATE KEY-----\n${Buffer.from(
    retired.privateKey.export({ type: "pkcs8", format: "der" }),
  )
    .toString("base64")
    .match(/.{1,64}/g)!
    .join("\n")}\n-----END PRIVATE KEY-----`;
  const signingKey = await importPKCS8(pem, "EdDSA");
  const token = await new SignJWT({
    v: 1,
    iss: ISSUER,
    iat: Math.floor(Date.now() / 1000),
    doc_seq: 1,
    agent_id: "agt_retired",
    key_fingerprint: "fp_retired",
    org_ref: "0".repeat(24),
  })
    .setProtectedHeader({ alg: "EdDSA", kid: String(retiredJwk.x).slice(0, 16), typ: "agent-identity+jwt" })
    .sign(signingKey);

  process.env.AUTHAB_JWKS_PREVIOUS = JSON.stringify([retiredJwk]);
  delete (globalThis as { authabPreviousJwks?: unknown }).authabPreviousJwks;
  try {
    const published = await getJwks();
    assert.equal(published.keys.length, 2);
    assert.ok(published.keys.some((key) => key.x === retiredJwk.x));

    const verified = await verifyPlatformJws(token);
    assert.equal(verified.payload.agent_id, "agt_retired");
  } finally {
    delete process.env.AUTHAB_JWKS_PREVIOUS;
    delete (globalThis as { authabPreviousJwks?: unknown }).authabPreviousJwks;
  }
});

test("a failed issuance never throws into the user's action", async () => {
  const originalTransaction = db.$transaction;
  const originalFindUnique = db.agent.findUnique;
  const originalError = console.error;
  console.error = () => {};
  (db as unknown as { $transaction: unknown }).$transaction = async () => {
    throw new Error("database down");
  };
  (db as unknown as { agent: { findUnique: unknown } }).agent.findUnique = async () => null;
  try {
    assert.equal(await issueIdentityDocumentSafe("agt_identity"), null);
  } finally {
    (db as unknown as { $transaction: unknown }).$transaction = originalTransaction;
    (db as unknown as { agent: { findUnique: unknown } }).agent.findUnique = originalFindUnique;
    console.error = originalError;
  }
});

test("the endpoint requires a secret key and backfills a missing document", () => {
  const route = readSource("src/app/api/v1/agents/[id]/identity-document/route.ts");
  assert.match(route, /requireSecretKey\(auth\)/);
  assert.match(route, /issueIdentityDocumentSafe\(agent\.id\)/);
  assert.match(route, /ApiError\(404/);
  assert.match(route, /ApiError\(503/);
  assert.match(route, /jws: current\.jws/);
});

test("agent writes and the cron keep documents current", () => {
  assert.match(readSource("src/app/api/v1/agents/route.ts"), /issueIdentityDocumentSafe\(agent\.id\)/);
  assert.match(readSource("src/app/api/v1/agents/[id]/route.ts"), /issueIdentityDocumentSafe\(agent\.id\)/);
  assert.match(readSource("src/app/api/v1/agents/[id]/[action]/route.ts"), /issueIdentityDocumentSafe\(agent\.id\)/);
  assert.match(readSource("src/app/app/actions.ts"), /issueIdentityDocumentSafe\(agent\.id\)/);
  assert.match(readSource("src/lib/promotion.ts"), /issueIdentityDocumentSafe\(prodAgent\.id\)/);

  const cron = readSource("src/app/api/cron/webhooks/route.ts");
  assert.match(cron, /reissueStaleIdentityDocuments\(200\)/);
});

test("the identity document migration enforces one current sequence per agent", () => {
  const migration = readSource("prisma/migrations/20261112100100_add_agent_identity_documents/migration.sql");
  assert.match(migration, /CREATE TABLE "AgentIdentityDocument"/);
  assert.match(migration, /"docSeq"/);
  assert.match(migration, /CREATE UNIQUE INDEX "AgentIdentityDocument_agentId_docSeq_key"/);
});
