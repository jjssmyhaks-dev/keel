import "./helpers/test-env";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CONNECTORS } from "../src/lib/connectors";
import {
  CREDENTIAL_GROUPS,
  SECRET_PATTERNS,
  SECRET_PATTERN_VERSION,
  classifyEntry,
  detectEnv,
  groupFindings,
  isHighEntropy,
  isObviousPlaceholder,
  isPlaceholder,
  maskedPreview,
  parseEnv,
  shannonEntropy,
  unmappedSecret,
} from "../shared/scan-core";
import { assertCleanGitTree, findingsToGroups, rewriteSources, scanPaths } from "../cli/src/scan";
import { readSource } from "./helpers/source";

const IMPORT_ACTION = readSource("src/app/app/vault/import/actions.ts");
const CLI_INDEX = readSource("cli/src/index.ts");

/** One synthetic value per value-matching pattern. These are fake and shaped like the real providers. */
// Assembled at runtime so push-protection scanners do not treat the fixtures as real credentials.
const SHOPIFY_TOKEN = ["shpat", "0123456789abcdef0123456789abcdef"].join("_");

const VALUE_SAMPLES: Record<string, string> = {
  "slack-app-token": ["xapp", "1", "A0B1C2D3E4F5", "1234567890"].join("-"),
  "slack-bot-token": ["xoxb", "1234567890", "abcdefghij"].join("-"),
  "github-pat": ["ghp", "abcdefghijklmnopqrstuvwxyz012345"].join("_"),
  "stripe-live-secret": ["sk", "live", "abcdefghijklmnop1234"].join("_"),
  "stripe-test-secret": ["sk", "test", "abcdefghijklmnop1234"].join("_"),
  "openai-key": ["sk", "proj", "abcdefghijklmnopqrstuvwxyz0123456789"].join("-"),
  "anthropic-key": ["sk", "ant", "api03", "abcdefghijklmnopqrstuvwxyz"].join("-"),
  "notion-token": ["ntn", "abcdefghijklmnopqrstuvwxyz"].join("_"),
  "linear-key": ["lin", "api", "abcdefghijklmnopqrstuvwxyz"].join("_"),
  "hubspot-token": ["pat", "na1", "1234abcd-5678-90ef-1234-567890abcdef"].join("-"),
  "resend-key": ["re", "abcdefghijklmnopqrstuvwxyz"].join("_"),
  "huggingface-token": ["hf", "abcdefghijklmnopqrstuvwxyz"].join("_"),
  "figma-token": ["figd", "abcdefghijklmnopqrstuvwxyz", "0123"].join("_"),
  "airtable-token": ["patABCDEFGHIJKLMN", "abcdefghijklmnopqrst"].join("."),
  "shopify-shop-domain": "acme.myshopify.com",
  "shopify-token": SHOPIFY_TOKEN,
  "sentry-base-url": "https://sentry.io",
  "sentry-token": ["sntrys", "abcdefghijklmnopqrstuvwxyz"].join("_"),
  "pinecone-key": ["pcsk", "abcdefghijklmnopqrstuvwxyz", "1234"].join("_"),
  "razorpay-live-key": ["rzp", "live", "abcdefghijklmnop1234"].join("_"),
  "razorpay-test-key": ["rzp", "test", "abcdefghijklmnop1234"].join("_"),
  "twilio-account-sid": "AC" + "0123456789abcdef0123456789abcdef",
  "twilio-api-key-sid": "SK" + "0123456789abcdef0123456789abcdef",
  "discord-application-id": "123456789012345678",
  "discord-bot-token": ["MTA1NjA4NzY1NDMyMTA5ODc2", "Ga4BcD", "abcdefghijklmnopqrstuvwxyz012345"].join("."),
};

const LOOKALIKES: Record<string, string> = {
  "slack-app-token": "xappX-1-abc",
  "slack-bot-token": "xoxz-1234567890abc",
  "github-pat": "ghx_abcdefghijklmnopqrstuvwxyz",
  "stripe-live-secret": "pk_live_abcdefghijklmnop",
  "stripe-test-secret": "pk_test_abcdefghijklmnop",
  "openai-key": "sk-123",
  "anthropic-key": "sk-ant-abc",
  "notion-token": "ntn-abcdefghijklmnop",
  "linear-key": "lin_apiX-abcdefghijklmnop",
  "hubspot-token": "pat-na2-abcdef1234",
  "resend-key": "re-abcdefghijklmnopqrstuvwxyz",
  "huggingface-token": "hf-abcdefghijklmnopqrstuvwxyz",
  "figma-token": "figd-abcdefghijklmnop",
  "airtable-token": "patABCDEFGHIJKLMN:abcdefghijklmnopqrst",
  "shopify-shop-domain": "acme.myshopify.example",
  "shopify-token": "shpatX0123456789abcdef0123456789abcdef",
  "sentry-base-url": "http://sentry.io",
  "sentry-token": "sntryX_abcdefghijklmnop",
  "pinecone-key": "pcsk-abcdefghijklmnop-1234",
  "razorpay-live-key": "rzp_liveXabcdefghijklmnop",
  "razorpay-test-key": "rzp_testXabcdefghijklmnop",
  "twilio-account-sid": "AC0123456789abcdef0123456789abcdeZ",
  "twilio-api-key-sid": "SK0123456789abcdef0123456789abcdeZ",
  "discord-application-id": "12345678901234567a",
  "discord-bot-token": "abcdefghijklmnopqrstuvwxyz.abcdef",
};

/** Name-only patterns: evidence comes from the variable name, not the value. */
const NAME_ONLY: Record<string, { name: string; value: string }> = {
  "razorpay-key-secret": { name: "RAZORPAY_KEY_SECRET", value: "k3Y9zP2mQ7tR4vW8xN5b" },
  "twilio-api-key-secret": { name: "TWILIO_API_KEY_SECRET", value: "a7B2c9D4e1F8g5H3j6K0" },
  "vercel-token": { name: "VERCEL_TOKEN", value: "Zx8Qw2Er9Ty4Ui7Op1As" },
  "cloudflare-token": { name: "CLOUDFLARE_API_TOKEN", value: "Zx8Qw2Er9Ty4Ui7Op1As" },
};

function fixture(): string {
  return mkdtempSync(join(tmpdir(), "authab-scan-"));
}

test("pattern file is versioned and every value pattern matches its sample", () => {
  assert.equal(SECRET_PATTERN_VERSION, 1);
  assert.equal(SECRET_PATTERNS.length, 29);
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.valuePattern) {
      const sample = VALUE_SAMPLES[pattern.id];
      assert.ok(sample, `missing synthetic sample for ${pattern.id}`);
      const match = classifyEntry("", sample);
      assert.ok(match, `${pattern.id} must match its own value sample`);
      assert.equal(match.patternId, pattern.id, `${pattern.id} sample classified as ${match.patternId}`);
      assert.equal(match.confidence, "high");
      assert.equal(match.connector, pattern.connector);
      assert.equal(match.field, pattern.field);
      assert.equal(match.environmentHint, pattern.environmentHint);
    } else {
      const sample = NAME_ONLY[pattern.id];
      assert.ok(sample, `missing name sample for ${pattern.id}`);
      const match = classifyEntry(sample.name, sample.value);
      assert.ok(match, `${pattern.id} must match its name sample`);
      assert.equal(match.patternId, pattern.id);
      assert.equal(match.confidence, pattern.confidence);
    }
  }
});

test("value look-alikes do not classify as credentials", () => {
  for (const [id, lookalike] of Object.entries(LOOKALIKES)) {
    assert.equal(classifyEntry("", lookalike), null, `${id} must not match ${lookalike}`);
  }
});

test("patterns reference real connectors and grouped fields exist in manifests", () => {
  const bySlug = new Map(CONNECTORS.map((connector) => [connector.slug, connector]));
  for (const pattern of SECRET_PATTERNS) {
    assert.ok(bySlug.has(pattern.connector), `${pattern.id} references unknown connector ${pattern.connector}`);
  }
  for (const [slug, fields] of Object.entries(CREDENTIAL_GROUPS)) {
    const connector = bySlug.get(slug);
    assert.ok(connector, `group for unknown connector ${slug}`);
    for (const field of fields) {
      assert.ok(
        connector.credentialFields?.some((entry) => entry.key === field),
        `${slug}.${field} is grouped but not declared in the manifest`,
      );
    }
  }
});

test("dotenv parser handles export, quotes, multiline values and comments", () => {
  const text = [
    "\uFEFF# leading comment",
    `export GITHUB_TOKEN="${VALUE_SAMPLES["github-pat"]}"`,
    `SLACK_BOT_TOKEN=${VALUE_SAMPLES["slack-bot-token"]} # inline comment`,
    'CERT="line one',
    'line two"',
    "SINGLE='a\\nb'",
    "NOVALUE",
    "EMPTY=",
  ].join("\n");

  const entries = parseEnv(text);
  assert.deepEqual(entries.map((entry) => entry.key), ["GITHUB_TOKEN", "SLACK_BOT_TOKEN", "CERT", "SINGLE", "EMPTY"]);
  assert.equal(entries[0].value, VALUE_SAMPLES["github-pat"]);
  assert.equal(entries[1].value, VALUE_SAMPLES["slack-bot-token"]);
  assert.equal(entries[2].value, "line one\nline two");
  assert.equal(entries[2].line, 4);
  assert.equal(entries[2].endLine, 5);
  assert.equal(entries[3].value, "a\\nb");
  assert.equal(entries[4].value, "");
});

test("entropy and placeholder rules keep noise out", () => {
  assert.equal(shannonEntropy("aaaa"), 0);
  assert.equal(isHighEntropy("aaaaaaaaaaaaaaaaaaaa"), false);
  assert.equal(isHighEntropy("Zx8Qw2Er9Ty4Ui7Op1As"), true);
  assert.equal(isHighEntropy("short"), false);

  for (const value of ["", "changeme", "your-key-here", "your_token_here", "<token>", "${TOKEN}", "xxxxxx", "...."]) {
    assert.equal(isObviousPlaceholder(value), true, `${value} must be treated as a placeholder`);
  }
  assert.equal(isObviousPlaceholder("Zx8Qw2Er9Ty4Ui7Op1As"), false);
  assert.equal(isPlaceholder("https://example.com/docs"), true);
  assert.equal(isPlaceholder("https://user:pass@example.com"), false);
  assert.equal(isPlaceholder("Zx8Qw2Er9Ty4Ui7Op1As"), false);
});

test("classification prefers value evidence over names", () => {
  const valueBeatsName = classifyEntry("STRIPE_SECRET_KEY", VALUE_SAMPLES["github-pat"]);
  assert.equal(valueBeatsName?.patternId, "github-pat");
  assert.equal(valueBeatsName?.confidence, "high");

  const nameOnlyEvidence = classifyEntry("STRIPE_SECRET_KEY", "this-is-not-a-stripe-key");
  assert.equal(nameOnlyEvidence?.patternId, "stripe-live-secret");
  assert.equal(nameOnlyEvidence?.confidence, "medium");
  assert.match(nameOnlyEvidence?.warning ?? "", /does not look like/i);

  assert.equal(classifyEntry("UNRELATED_SETTING", "true"), null);
  assert.equal(maskedPreview("Zx8Qw2Er9Ty4Ui7Op1As"), "Zx8Q… (20 chars)");
});

test("detectEnv drops placeholders, flags unmapped secrets and keeps environment hints", () => {
  const text = [
    "GITHUB_TOKEN=changeme",
    "OPENAI_API_KEY=your-key-here",
    "STRIPE_SECRET_KEY=" + VALUE_SAMPLES["stripe-live-secret"],
    "STRIPE_TEST_KEY=" + VALUE_SAMPLES["stripe-test-secret"],
    "MY_INTERNAL_API_KEY=Zx8Qw2Er9Ty4Ui7Op1As",
  ].join("\n");

  const findings = detectEnv(text);
  assert.deepEqual(
    findings.map((finding) => finding.key),
    ["STRIPE_SECRET_KEY", "STRIPE_TEST_KEY", "MY_INTERNAL_API_KEY"],
  );
  assert.equal(findings[0].environmentHint, "live");
  assert.equal(findings[1].environmentHint, "test");
  assert.equal(findings[2].kind, "unmapped");
  assert.equal(unmappedSecret("MY_INTERNAL_API_KEY", "Zx8Qw2Er9Ty4Ui7Op1As"), true);
  assert.equal(unmappedSecret("MY_INTERNAL_API_KEY", "short"), false);
});

test("multi-field findings group into one complete connector credential", () => {
  const findings = detectEnv(
    ["SHOPIFY_SHOP_DOMAIN=acme.myshopify.com", `SHOPIFY_ACCESS_TOKEN=${SHOPIFY_TOKEN}`].join("\n"),
  );
  const groups = groupFindings(findings);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].connector, "shopify");
  assert.equal(groups[0].complete, true);
  assert.deepEqual(Object.keys(groups[0].fields).sort(), ["access_token", "shop_domain"]);
  assert.deepEqual(groups[0].missing, []);

  const partial = groupFindings(detectEnv(`SHOPIFY_ACCESS_TOKEN=${SHOPIFY_TOKEN}`));
  assert.equal(partial[0].complete, false);
  assert.deepEqual(partial[0].missing, ["shop_domain"]);
});

test("live keys cannot be imported into a development environment", () => {
  assert.match(IMPORT_ACTION, /const live = classifyEntry\("", value\)\?\.environmentHint === "live";/);
  assert.match(IMPORT_ACTION, /if \(live && !ctx\.isProduction\)/);
  assert.match(IMPORT_ACTION, /This looks like a live key\. Switch to the production environment to import it\./);
  assert.match(IMPORT_ACTION, /for \(const value of Object\.values\(row\.fields\)\)/);
  assert.match(IMPORT_ACTION, /action: "credential\.imported"/);
  assert.match(IMPORT_ACTION, /variables: row\.variables/);
  assert.doesNotMatch(IMPORT_ACTION, /console\.(log|info|warn|error)/);
  assert.doesNotMatch(IMPORT_ACTION, /values:/);
  assert.doesNotMatch(IMPORT_ACTION, /JSON\.stringify\(row\.fields\)/);
});

test("CLI scan finds seeded secrets, honors excludes and size limits", async () => {
  const dir = fixture();
  try {
    writeFileSync(
      join(dir, ".env"),
      `SHOPIFY_SHOP_DOMAIN=acme.myshopify.com\nSHOPIFY_ACCESS_TOKEN=${SHOPIFY_TOKEN}\n`,
    );
    writeFileSync(join(dir, "app.js"), `const GITHUB_TOKEN = "${VALUE_SAMPLES["github-pat"]}";\n`);
    writeFileSync(join(dir, "worker.py"), `OPENAI_API_KEY = "${VALUE_SAMPLES["openai-key"]}"\n`);
    mkdirSync(join(dir, "skip"));
    writeFileSync(join(dir, "skip", "secret.env"), `STRIPE_SECRET_KEY=${VALUE_SAMPLES["stripe-live-secret"]}\n`);
    writeFileSync(join(dir, "big.env"), `STRIPE_SECRET_KEY=${VALUE_SAMPLES["stripe-live-secret"]}\n${"#".repeat(400)}\n`);
    writeFileSync(join(dir, "package-lock.json"), `{ "token": "${VALUE_SAMPLES["github-pat"]}" }\n`);

    const findings = await scanPaths({ paths: ["."], excludes: ["skip/**"], maxSize: 256, cwd: dir });
    assert.deepEqual(
      findings.map((finding) => `${finding.file}:${finding.name}`),
      [".env:SHOPIFY_SHOP_DOMAIN", ".env:SHOPIFY_ACCESS_TOKEN", "app.js:GITHUB_TOKEN", "worker.py:OPENAI_API_KEY"],
    );
    assert.ok(findings.every((finding) => !finding.preview.includes("sk_live")));

    const groups = findingsToGroups(findings);
    const shopify = groups.find((group) => group.connector === "shopify");
    assert.equal(shopify?.complete, true);

    assert.match(CLI_INDEX, /findings\.some\(\(finding\) => finding\.confidence === "high"\)\) process\.exitCode = 1/);
    assert.match(CLI_INDEX, /value: _value, \.\.\.rest/);
    assert.match(CLI_INDEX, /Pass --import with --write\. Sources are only rewritten after a successful import\./);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--write refuses a dirty tree and rewrites env, JS and Python files", async () => {
  const dir = fixture();
  try {
    writeFileSync(join(dir, ".env"), `GITHUB_TOKEN=${VALUE_SAMPLES["github-pat"]}\n`);
    writeFileSync(join(dir, "app.js"), `const GITHUB_TOKEN = "${VALUE_SAMPLES["github-pat"]}";\n`);
    writeFileSync(join(dir, "worker.py"), `OPENAI_API_KEY = "${VALUE_SAMPLES["openai-key"]}"\n`);

    assert.throws(() => assertCleanGitTree(dir, false), /git repository/);
    assert.doesNotThrow(() => assertCleanGitTree(dir, true));

    execFileSync("git", ["init", "-q", dir]);
    writeFileSync(join(dir, "untracked.txt"), "dirty\n");
    assert.throws(() => assertCleanGitTree(dir, false), /uncommitted changes/);

    const findings = await scanPaths({ paths: ["."], excludes: [], maxSize: 10_000, cwd: dir });
    const rewritten = await rewriteSources(findings, { cwd: dir, force: true });
    assert.deepEqual(rewritten.sort(), [".env", "app.js", "worker.py"]);

    assert.equal(readFileSync(join(dir, ".env"), "utf8"), "# moved to the Authab vault\n");
    assert.equal(
      readFileSync(join(dir, "app.js"), "utf8"),
      "const GITHUB_TOKEN = process.env.GITHUB_TOKEN;\n",
    );
    assert.equal(
      readFileSync(join(dir, "worker.py"), "utf8"),
      'OPENAI_API_KEY = os.environ["OPENAI_API_KEY"]\n',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
