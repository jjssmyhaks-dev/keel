import "./helpers/test-env";
import assert from "node:assert/strict";
import test from "node:test";
import { db } from "../src/lib/db";
import { ISSUER } from "../src/lib/jwt";
import {
  REVOCATION_REASONS,
  buildRevocationJwsPayload,
  isRevocationReason,
  nextAfter,
  recordRevocation,
  revocationEntry,
  revocationsEtag,
  type RevocationEntry,
} from "../src/lib/revocations";
import { readSource } from "./helpers/source";

const ENTRIES: RevocationEntry[] = [
  { agent_id: "agt_one", revoked_at: "2026-11-01T10:00:00.000Z", reason: "owner_revoked" },
  { agent_id: "agt_two", revoked_at: "2026-11-02T11:00:00.000Z", reason: "compromised" },
];

test("revocation entries carry the reason and ISO timestamp", () => {
  const entry = revocationEntry({
    agentId: "agt_one",
    revokedAt: new Date("2026-11-01T10:00:00.000Z"),
    reasonCode: "abuse",
  });
  assert.deepEqual(entry, {
    agent_id: "agt_one",
    revoked_at: "2026-11-01T10:00:00.000Z",
    reason: "abuse",
  });
  assert.equal(
    revocationEntry({ agentId: "agt_one", revokedAt: new Date(), reasonCode: "unknown" }).reason,
    "owner_revoked",
  );
});

test("only the documented reason codes are accepted", () => {
  for (const reason of REVOCATION_REASONS) assert.equal(isRevocationReason(reason), true);
  assert.equal(isRevocationReason("owner_revoked"), true);
  assert.equal(isRevocationReason("deleted"), false);
  assert.equal(isRevocationReason(undefined), false);
});

test("the signed payload expires ten minutes after issue", () => {
  const now = new Date("2026-11-12T12:00:00.000Z");
  const payload = buildRevocationJwsPayload(ENTRIES, { environmentType: "production", now });
  assert.deepEqual(payload, {
    v: 1,
    iss: ISSUER,
    iat: Math.floor(now.getTime() / 1000),
    exp: Math.floor(now.getTime() / 1000) + 600,
    environment: "production",
    revoked: ENTRIES,
  });

  assert.equal(buildRevocationJwsPayload(ENTRIES, { environmentType: "development" }).environment, "development");
  assert.equal(buildRevocationJwsPayload(ENTRIES, { environmentType: "staging" }).environment, "development");
});

test("the ETag covers the revoked list only and changes with it", () => {
  const etag = revocationsEtag(ENTRIES);
  assert.match(etag, /^[0-9a-f]{64}$/);
  assert.equal(revocationsEtag([...ENTRIES]), etag);

  const changed = revocationsEtag([...ENTRIES, { ...ENTRIES[0], agent_id: "agt_three" }]);
  assert.notEqual(changed, etag);

  const newer: RevocationEntry = { ...ENTRIES[0], revoked_at: "2026-11-03T00:00:00.000Z" };
  assert.notEqual(revocationsEtag([newer, ENTRIES[1]]), etag);
});

test("cursor paging stops only on a full page", () => {
  assert.equal(nextAfter([{ id: "rev_1" }, { id: "rev_2" }], 3), null);
  assert.equal(nextAfter([{ id: "rev_1" }, { id: "rev_2" }, { id: "rev_3" }], 3), "rev_3");
});

test("recording a revocation is one upsert and never throws", async () => {
  const original = db.revocation.upsert;
  const originalError = console.error;
  const calls: unknown[] = [];
  console.error = () => {};
  try {
    (db as unknown as { revocation: { upsert: unknown } }).revocation.upsert = async (args: unknown) => {
      calls.push(args);
      return {};
    };
    assert.equal(await recordRevocation("agt_killed", "env_prod", "owner_revoked"), true);
    assert.deepEqual(calls, [
      {
        where: { agentId: "agt_killed" },
        create: { agentId: "agt_killed", environmentId: "env_prod", reasonCode: "owner_revoked" },
        update: {},
      },
    ]);

    (db as unknown as { revocation: { upsert: unknown } }).revocation.upsert = async () => {
      throw new Error("database down");
    };
    assert.equal(await recordRevocation("agt_other", "env_prod", "compromised"), false);
  } finally {
    (db as unknown as { revocation: { upsert: unknown } }).revocation.upsert = original;
    console.error = originalError;
  }
});

test("kill, revoke and delete record a revocation; pause and resume do not", () => {
  const actionRoute = readSource("src/app/api/v1/agents/[id]/[action]/route.ts");
  const killCalls = actionRoute.match(/recordRevocation\(/g) ?? [];
  assert.equal(killCalls.length, 2);
  assert.match(actionRoute, /action === "kill"[\s\S]*?recordRevocation\(agent\.id, auth\.environment\.id, "owner_revoked"\)/);
  assert.match(actionRoute, /target\.status === "revoked"[\s\S]*?recordRevocation\(agent\.id, auth\.environment\.id, "owner_revoked"\)/);
  assert.match(actionRoute, /STATUS_ACTIONS/);
  assert.doesNotMatch(actionRoute, /pause[\s\S]{0,200}recordRevocation/);

  assert.match(
    readSource("src/app/api/v1/agents/[id]/route.ts"),
    /recordRevocation\(agent\.id, auth\.environment\.id, "owner_revoked"\)/,
  );
  assert.match(
    readSource("src/app/app/actions.ts"),
    /recordRevocation\(agent\.id, ctx\.environment\.id, "owner_revoked"\)/,
  );
});

test("the revocation list is environment-scoped and cache-aware", () => {
  const route = readSource("src/app/api/v1/revocations/route.ts");
  assert.match(route, /requireSecretKey\(auth\)/);
  assert.match(route, /environmentId: auth\.environment\.id/);
  assert.match(route, /revokedAt: \{ gte: since \}/);
  assert.match(route, /anchor\.environmentId !== auth\.environment\.id/);
  assert.match(route, /private, max-age=30/);
  assert.match(route, /status: 304/);
  assert.match(route, /agent-revocations\+jwt/);
  assert.match(route, /nextAfter\(rows, limit\)/);
});

test("the list migration keeps entries after their agent is deleted", () => {
  const migration = readSource("prisma/migrations/20261112100200_add_revocations/migration.sql");
  assert.match(migration, /CREATE TABLE "Revocation"/);
  assert.match(migration, /CREATE UNIQUE INDEX "Revocation_agentId_key"/);
  assert.match(migration, /CREATE INDEX "Revocation_environmentId_revokedAt_idx"/);
  assert.doesNotMatch(migration, /FOREIGN KEY/);
});
