export type RuntimeConfigIssue = { key: string; message: string };

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Production-only startup checks for configuration that would otherwise fail
 * silently at request time: public links and the scheduled maintenance job.
 */
export function runtimeConfigIssues(env: NodeJS.ProcessEnv = process.env): RuntimeConfigIssue[] {
  if (env.NODE_ENV !== "production") return [];
  if (env.NEXT_PHASE === "phase-production-build") return [];

  const issues: RuntimeConfigIssue[] = [];
  const rawAppUrl = env.APP_URL?.trim();

  if (!rawAppUrl) {
    issues.push({
      key: "APP_URL",
      message: "Set APP_URL to the public https origin, for example https://authab.dev.",
    });
  } else {
    try {
      const url = new URL(rawAppUrl);
      if (url.protocol !== "https:") {
        issues.push({ key: "APP_URL", message: "APP_URL must use https in production." });
      }
      if (LOCAL_HOSTS.has(url.hostname)) {
        issues.push({ key: "APP_URL", message: "APP_URL must not point at localhost in production." });
      }
      if (url.pathname !== "/" || url.search || url.hash) {
        issues.push({
          key: "APP_URL",
          message: "APP_URL must be an origin only, without a path, query or fragment.",
        });
      }
    } catch {
      issues.push({ key: "APP_URL", message: "APP_URL must be a valid absolute URL." });
    }
  }

  const cronSecret = env.CRON_SECRET?.trim();
  if (!cronSecret) {
    issues.push({
      key: "CRON_SECRET",
      message: "Set CRON_SECRET so scheduled expiry, retry and alert jobs can authenticate.",
    });
  } else if (cronSecret.length < 16) {
    issues.push({ key: "CRON_SECRET", message: "CRON_SECRET must be at least 16 characters." });
  }

  return issues;
}

export function assertRuntimeConfig(env: NodeJS.ProcessEnv = process.env) {
  const issues = runtimeConfigIssues(env);
  if (issues.length === 0) return;
  throw new Error(
    "[authab] Refusing to start in production with broken configuration:\n" +
      issues.map((issue) => `  - ${issue.key}: ${issue.message}`).join("\n"),
  );
}
