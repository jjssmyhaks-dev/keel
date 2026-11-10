import assert from "node:assert/strict";
import test from "node:test";
import { assertRuntimeConfig, runtimeConfigIssues } from "../src/lib/runtime-config";

function env(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return { NODE_ENV: "production", ...overrides } as NodeJS.ProcessEnv;
}

const CRON = "cron-secret-at-least-16-chars";

test("checks only run for the production server", () => {
  assert.deepEqual(runtimeConfigIssues(env({ NODE_ENV: "development" })), []);
  assert.deepEqual(runtimeConfigIssues(env({ NEXT_PHASE: "phase-production-build" })), []);
});

test("missing APP_URL and CRON_SECRET are reported", () => {
  const issues = runtimeConfigIssues(env());
  assert.deepEqual(
    issues.map((issue) => issue.key),
    ["APP_URL", "CRON_SECRET"],
  );
});

test("APP_URL must be a public https origin", () => {
  const issues = runtimeConfigIssues(env({ APP_URL: "http://localhost:3000", CRON_SECRET: CRON }));
  const messages = issues.map((issue) => issue.message).join(" ");
  assert.match(messages, /https/);
  assert.match(messages, /localhost/);

  const withPath = runtimeConfigIssues(env({ APP_URL: "https://keel.dev/app", CRON_SECRET: CRON }));
  assert.match(withPath[0]?.message ?? "", /origin only/);
});

test("CRON_SECRET must be at least 16 characters", () => {
  const issues = runtimeConfigIssues(env({ APP_URL: "https://keel.dev", CRON_SECRET: "short" }));
  assert.equal(issues.length, 1);
  assert.equal(issues[0]?.key, "CRON_SECRET");
  assert.match(issues[0]?.message ?? "", /16 characters/);
});

test("valid production configuration passes", () => {
  const issues = runtimeConfigIssues(env({ APP_URL: "https://keel.dev", CRON_SECRET: CRON }));
  assert.deepEqual(issues, []);
  assert.doesNotThrow(() => assertRuntimeConfig(env({ APP_URL: "https://keel.dev", CRON_SECRET: CRON })));
});

test("assertRuntimeConfig names every broken key", () => {
  assert.throws(
    () => assertRuntimeConfig(env({ APP_URL: "http://localhost:3000" })),
    /APP_URL.*CRON_SECRET/s,
  );
});
