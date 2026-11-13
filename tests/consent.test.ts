import "./helpers/test-env";
import assert from "node:assert/strict";
import test from "node:test";
import {
  DURATION_OPTIONS,
  assertAllowedRedirect,
  consentExpiry,
  consentIsActive,
  credentialOwnershipError,
  durationOptionsFor,
  isConsentDuration,
  parseStringArray,
  riskRank,
  scopeActionPattern,
  scopeConnectorSlug,
} from "../src/lib/consent";
import {
  LOGO_MAX_BYTES,
  ConsentBrandingError,
  contrastRatio,
  normalizeDomain,
  normalizeHex,
  readLogoDataUri,
} from "../src/lib/consent-branding";
import { externalAgentRequiresApproval } from "../src/lib/policy";

test("consent durations are a closed set", () => {
  for (const option of DURATION_OPTIONS) assert.equal(isConsentDuration(option), true);
  assert.equal(isConsentDuration("forever"), false);
  assert.equal(isConsentDuration(null), false);
  assert.equal(isConsentDuration(30), false);
});

test("risk ranking is ordered and unknown risks sort last", () => {
  assert.equal(riskRank("read") < riskRank("write"), true);
  assert.equal(riskRank("write") < riskRank("destructive"), true);
  assert.equal(riskRank("destructive") < riskRank("financial"), true);
  assert.equal(riskRank("financial") < riskRank("admin"), true);
  assert.equal(riskRank("nonsense"), 5);
});

test("parseStringArray never throws", () => {
  assert.deepEqual(parseStringArray('["a"," b ",1,null]'), ["a", "b"]);
  assert.deepEqual(parseStringArray("not json"), []);
  assert.deepEqual(parseStringArray(null), []);
  assert.deepEqual(parseStringArray('{"a":1}'), []);
});

test("scopes split into connector and action patterns", () => {
  assert.equal(scopeConnectorSlug("gmail.messages.send"), "gmail");
  assert.equal(scopeConnectorSlug("messages.send"), "messages");
  assert.equal(scopeActionPattern("gmail.messages.send", "gmail"), "messages.send");
  assert.equal(scopeActionPattern("messages.send", "gmail"), "messages.send");
});

test("an end-user token may only use its own connection", () => {
  assert.equal(credentialOwnershipError("eu_1", "eu_1"), null);
  assert.deepEqual(credentialOwnershipError("eu_2", "eu_1"), { status: 403, code: "credential_not_owned" });
});

test("an organization token never learns an end-user connection exists", () => {
  assert.equal(credentialOwnershipError(null, null), null);
  assert.deepEqual(credentialOwnershipError("eu_1", null), { status: 404, code: "credential_not_found" });
});

test("consent activity follows expiry and revocation", () => {
  const now = new Date("2026-11-13T10:00:00Z");
  const base = {
    id: "consent_1",
    endUserId: "eu_1",
    projectId: "proj_1",
    environmentId: "env_1",
    agentId: "agt_1",
    scopesJson: "[]",
    consentTextVersion: "1",
    consentRequestId: null,
    grantIdsJson: "[]",
    grantedAt: now,
    expiresAt: null,
    revokedAt: null,
    lastUsedAt: null,
    ip: null,
    userAgent: null,
  };
  assert.equal(consentIsActive(base, now), true);
  assert.equal(consentIsActive({ ...base, expiresAt: new Date("2026-11-13T09:59:59Z") }, now), false);
  assert.equal(consentIsActive({ ...base, revokedAt: now }, now), false);
});

test("session consents last 24 hours, long consents stop at the ceiling", () => {
  const now = new Date("2026-11-13T00:00:00Z");
  const hours = (date: Date) => (date.getTime() - now.getTime()) / 3_600_000;
  assert.equal(hours(consentExpiry("session", 90, now)), 24);
  assert.equal(hours(consentExpiry("session", 1, now)) / 24, 1);
  assert.equal(hours(consentExpiry("30d", 90, now)) / 24, 30);
  assert.equal(hours(consentExpiry("30d", 10, now)) / 24, 10);
  assert.equal(hours(consentExpiry("until_revoked", 45, now)) / 24, 45);
});

test("duration options shrink with the project ceiling", () => {
  assert.deepEqual(durationOptionsFor(90), ["session", "30d", "until_revoked"]);
  assert.deepEqual(durationOptionsFor(10), ["session", "until_revoked"]);
});

test("redirect URIs must be allow-listed and secure", () => {
  const allowed = ["https://app.example.com/auth/callback"];
  assert.doesNotThrow(() => assertAllowedRedirect(allowed[0], allowed, "production"));
  assert.throws(() => assertAllowedRedirect("https://evil.example.com/cb", allowed, "production"), /not one of/);
  assert.throws(() => assertAllowedRedirect("http://app.example.com/cb", ["http://app.example.com/cb"], "production"), /HTTPS/);
  assert.doesNotThrow(() =>
    assertAllowedRedirect("http://localhost:3000/cb", ["http://localhost:3000/cb"], "development"),
  );
  assert.throws(() => assertAllowedRedirect("http://localhost:3000/cb", ["http://localhost:3000/cb"], "production"), /HTTPS/);
  assert.throws(() => assertAllowedRedirect("not a url", allowed, "production"), /absolute URL/);
});

test("external agents always need a human for non-read actions", () => {
  assert.equal(externalAgentRequiresApproval({ kind: "external" }, "read"), false);
  assert.equal(externalAgentRequiresApproval({ kind: "external" }, "write"), true);
  assert.equal(externalAgentRequiresApproval({ kind: "external" }, "financial"), true);
  assert.equal(externalAgentRequiresApproval({ kind: "internal" }, "write"), false);
  assert.equal(externalAgentRequiresApproval({}, "write"), false);
});

test("contrast arithmetic follows WCAG", () => {
  assert.equal(Math.round(contrastRatio("#000000", "#ffffff")), 21);
  assert.equal(contrastRatio("#ffffff", "#ffffff"), 1);
  assert.equal(contrastRatio("#767676", "#ffffff") >= 4.5, true);
  assert.equal(contrastRatio("#999999", "#ffffff") >= 4.5, false);
  assert.equal(normalizeHex("#abc"), "#aabbcc");
  assert.equal(normalizeHex("nope", "#111111"), "#111111");
});

test("logo uploads are type-checked, signature-checked and bounded", async () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const valid = await readLogoDataUri(new File([png], "logo.png", { type: "image/png" }));
  assert.equal(valid?.startsWith("data:image/png;base64,"), true);

  const spoofed = new File([new Uint8Array([1, 2, 3, 4])], "logo.png", { type: "image/png" });
  await assert.rejects(() => readLogoDataUri(spoofed), (error) => error instanceof ConsentBrandingError && error.code === "logo_type");

  const svg = new File([new TextEncoder().encode("<svg/>")], "logo.svg", { type: "image/svg+xml" });
  await assert.rejects(() => readLogoDataUri(svg), /PNG, JPEG or WebP/);

  const huge = new File([new Uint8Array(LOGO_MAX_BYTES + 1)], "logo.png", { type: "image/png" });
  await assert.rejects(() => readLogoDataUri(huge), /200KB/);

  assert.equal(await readLogoDataUri(new File([], "empty.png", { type: "image/png" })), undefined);
});

test("domains are normalized and public-only", () => {
  assert.equal(normalizeDomain("App.Example.com"), "app.example.com");
  assert.equal(normalizeDomain("https://app.example.com"), "app.example.com");
  assert.throws(() => normalizeDomain("localhost"), /public domain/);
  assert.throws(() => normalizeDomain("https://app.example.com/path"), /without a path/);
  assert.throws(() => normalizeDomain(""), /Enter the domain/);
});
