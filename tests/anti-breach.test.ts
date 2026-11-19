import "./helpers/test-env";
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { isPrivateAddress, isPrivateHost, assertPublicHost } from "../src/lib/outbound";
import { redact, redactDeep, redactedFieldNames, secretValues } from "../src/lib/redaction";
import { can, canWithGrants, parseGrants, type Capability } from "../src/lib/session";
import { jwkThumbprint, verifyDpopProof, DpopError } from "../src/lib/dpop";
import { canonical } from "../src/lib/audit";
import { verifyPassword, hashPassword, constantTimeEqual, signedLinkToken, verifySignedLinkToken } from "../src/lib/crypto";

test("Anti-SSRF: rejects all private, loopback, link-local and cloud metadata addresses", async () => {
  const privateIps = [
    "127.0.0.1",
    "127.0.0.2",
    "127.255.255.255",
    "10.0.0.1",
    "10.254.254.254",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.0.1",
    "192.168.254.254",
    "169.254.169.254", // AWS/GCP/Azure instance metadata
    "169.254.1.1",
    "100.64.0.1",     // CGNAT (RFC 6598)
    "100.127.255.255",
    "198.18.0.1",     // Benchmarking (RFC 2544)
    "198.51.100.1",   // Documentation (RFC 5737)
    "203.0.113.1",
    "224.0.0.1",      // Multicast
    "240.0.0.1",      // Reserved
    "0.0.0.0",
    "::1",            // IPv6 localhost
    "::",
    "::ffff:127.0.0.1", // IPv4-mapped loopback
    "::ffff:169.254.169.254", // IPv4-mapped metadata
    "::ffff:7f00:1",
    "2002:7f00:0001::", // 6to4 loopback
    "2002:a9fe:a9fe::", // 6to4 metadata (169.254.169.254)
    "fe80::1",          // IPv6 link-local
    "fc00::1",          // IPv6 unique local
    "fd00::1",
  ];

  for (const ip of privateIps) {
    assert.equal(
      isPrivateAddress(ip),
      true,
      `Expected ${ip} to be recognized as private/loopback address`
    );
  }

  // Verify public IP addresses are not blocked
  const publicIps = ["8.8.8.8", "1.1.1.1", "140.82.121.4", "2606:4700:4700::1111"];
  for (const ip of publicIps) {
    assert.equal(isPrivateAddress(ip), false, `Expected ${ip} to be recognized as public address`);
  }
});

test("Anti-SSRF: rejects private hostnames, search-domain hostnames, and malformed inputs", async () => {
  const privateHosts = [
    "localhost",
    "sub.localhost",
    "service.local",
    "database.internal",
    "router.home.arpa",
    "singlelabelhostname",
    "2130706433", // Decimal notation for 127.0.0.1
    "0x7f000001", // Hex notation for 127.0.0.1
  ];

  for (const host of privateHosts) {
    assert.equal(isPrivateHost(host), true, `Expected host ${host} to be marked private/blocked`);
  }

  // Verify assertPublicHost rejects private hostnames with errors
  for (const host of ["localhost", "127.0.0.1", "169.254.169.254", "internal.service"]) {
    await assert.rejects(
      async () => assertPublicHost(host, "Test"),
      /cannot target private|must be publicly reachable|Could not resolve/
    );
  }
});

test("Anti-Tamper Audit Chain: verifies that payload or hash mutations break chain verification", () => {
  function hashEntry(prevHash: string, payload: Record<string, unknown>) {
    return createHash("sha256").update(`${prevHash}:${canonical(payload)}`).digest("hex");
  }

  const GENESIS = "0".repeat(64);

  const event1 = {
    seq: 1,
    timestamp: "2026-11-18T10:00:00.000Z",
    actorType: "human",
    actorId: "usr_alice",
    actorName: "Alice",
    action: "credential.create",
    resourceType: "credential",
    resourceId: "crd_1",
    outcome: "allowed",
    requestId: "req_001",
    ip: "198.51.100.42",
    agentId: null,
    payloadSummary: { name: "Stripe Key" },
    chain: [],
  };
  const hash1 = hashEntry(GENESIS, event1);

  const event2 = {
    seq: 2,
    timestamp: "2026-11-18T10:05:00.000Z",
    actorType: "agent",
    actorId: "agt_bob",
    actorName: "Bob",
    action: "proxy.call",
    resourceType: "connector",
    resourceId: "stripe",
    outcome: "allowed",
    requestId: "req_002",
    ip: "198.51.100.42",
    agentId: "agt_bob",
    payloadSummary: { action: "charges.list" },
    chain: [],
  };
  const hash2 = hashEntry(hash1, event2);

  // Validate uncorrupted chain
  const chain = [
    { seq: 1, prevHash: GENESIS, hash: hash1, body: event1 },
    { seq: 2, prevHash: hash1, hash: hash2, body: event2 },
  ];

  function verify(items: typeof chain, fromSeq?: number) {
    if (!items.length) return { valid: true, brokenAt: null };
    // Hardened check: sequence 1 MUST point to GENESIS
    if (!fromSeq || fromSeq === 1) {
      if (items[0].seq !== 1 || items[0].prevHash !== GENESIS) {
        return { valid: false, brokenAt: items[0].seq };
      }
    }
    let prev = items[0].prevHash;
    for (const item of items) {
      const computed = hashEntry(item.prevHash, item.body);
      if (item.prevHash !== prev || item.hash !== computed) {
        return { valid: false, brokenAt: item.seq };
      }
      prev = item.hash;
    }
    return { valid: true, brokenAt: null };
  }

  // 1. Valid chain passes
  assert.deepEqual(verify(chain), { valid: true, brokenAt: null });

  // 2. Modifying an actor name in event 1 breaks verification at seq 1
  const tamperedPayload = [
    { seq: 1, prevHash: GENESIS, hash: hash1, body: { ...event1, actorName: "Eve" } },
    { seq: 2, prevHash: hash1, hash: hash2, body: event2 },
  ];
  assert.deepEqual(verify(tamperedPayload), { valid: false, brokenAt: 1 });

  // 3. Forging a fake genesis prevHash is detected by the hardened anchor
  const tamperedGenesis = [
    { seq: 1, prevHash: "1".repeat(64), hash: hashEntry("1".repeat(64), event1), body: event1 },
    { seq: 2, prevHash: hashEntry("1".repeat(64), event1), hash: hash2, body: event2 },
  ];
  assert.deepEqual(verify(tamperedGenesis), { valid: false, brokenAt: 1 });

  // 4. Truncating event 1 so chain starts at seq 2 without fromSeq is detected
  const truncatedChain = [{ seq: 2, prevHash: hash1, hash: hash2, body: event2 }];
  assert.deepEqual(verify(truncatedChain), { valid: false, brokenAt: 2 });
});

test("Anti-Credential-Leak: redaction engine intercepts secrets in nested payloads and headers", () => {
  const payload = {
    user: "admin",
    headers: {
      Authorization: "Bearer sk_live_supersecrettoken12345",
      "X-Api-Key": "secret_key_value_987654321",
    },
    nested: {
      items: [
        { key: "normal", value: "visible" },
        { key: "secret", password: "VerySecretPassword123" },
      ],
    },
  };

  const redacted = redact(payload, []) as any;
  assert.equal(redacted.user, "admin");
  assert.equal(redacted.headers.Authorization, "[redacted]");
  assert.equal(redacted.headers["X-Api-Key"], "[redacted]");
  assert.equal(redacted.nested.items[0].value, "visible");
  assert.equal(redacted.nested.items[1].password, "[redacted]");

  // Deep redaction against echoed response bodies
  const responseWithEcho = JSON.stringify({
    status: "error",
    message: "Invalid credential for Bearer sk_live_supersecrettoken12345: rejected by provider",
  });
  const cleaned = redactDeep(responseWithEcho, ["sk_live_supersecrettoken12345"]);
  assert.ok(typeof cleaned.value === "string" && !cleaned.value.includes("sk_live_supersecrettoken12345"));
  assert.equal(cleaned.hits, 1);
});

test("Anti-Privilege-Escalation: RBAC matrix prevents non-owners from dangerous operations", () => {
  const roles = ["admin", "developer", "approver", "auditor", "billing", "viewer"] as const;

  // No non-owner role can delete organization
  for (const role of roles) {
    assert.equal(can(role, "delete_org"), false, `Role ${role} must never have delete_org`);
  }

  // Viewer and auditor can never manage credentials, agents, or approve
  const readOnlyRoles = ["auditor", "viewer"] as const;
  const dangerousCapabilities: Capability[] = [
    "manage_credentials",
    "manage_agents",
    "manage_grants",
    "approve",
    "write_production",
    "kill_switch",
  ];

  for (const role of readOnlyRoles) {
    for (const cap of dangerousCapabilities) {
      assert.equal(can(role, cap), false, `Role ${role} must not possess ${cap}`);
    }
  }

  // Grant parsing must reject ungrantable capabilities like delete_org
  const forgedGrants = JSON.stringify(["delete_org", "view", "manage_agents", "invalid_cap"]);
  const safeGrants = parseGrants(forgedGrants);
  assert.ok(!safeGrants.includes("delete_org" as any));
  assert.ok(!safeGrants.includes("view" as any));
  assert.deepEqual(safeGrants, ["manage_agents"]);
});

test("Anti-Timing-Attack: password verification and tokens use constant-time comparisons", () => {
  const pwd = "SecurePassword#2026";
  const stored = hashPassword(pwd);

  assert.equal(verifyPassword(pwd, stored), true);
  assert.equal(verifyPassword("WrongPassword#2026", stored), false);
  assert.equal(verifyPassword(pwd, null), false);
  assert.equal(verifyPassword(pwd, "invalid$format"), false);

  assert.equal(constantTimeEqual("token_abc_12345", "token_abc_12345"), true);
  assert.equal(constantTimeEqual("token_abc_12345", "token_abc_12346"), false);
  assert.equal(constantTimeEqual("short", "longer_token"), false);
});

test("Anti-Tamper Signed Links: HMAC-SHA256 signature roundtrip and tamper rejection", () => {
  const parts = ["oauth_state", "user_123", "env_prod"];
  const signed = signedLinkToken(parts);
  assert.ok(signed.startsWith("oauth_state.user_123.env_prod."));

  // Verifies correctly
  const verified = verifySignedLinkToken(signed);
  assert.equal(verified, "oauth_state.user_123.env_prod");

  // Rejects tampered payload
  const tamperedPayload = signed.replace("user_123", "user_attacker");
  assert.equal(verifySignedLinkToken(tamperedPayload), null);

  // Rejects tampered signature
  const segments = signed.split(".");
  const sig = segments.pop()!;
  const badSig = sig.slice(0, -1) + (sig.endsWith("a") ? "b" : "a");
  assert.equal(verifySignedLinkToken([...segments, badSig].join(".")), null);
});

