const SLACK_AUTH_ERRORS = new Set([
  "invalid_auth",
  "not_authed",
  "token_revoked",
  "token_expired",
  "account_inactive",
]);

/**
 * Slack reports authentication failures as HTTP 200 with `{ ok: false, error }`.
 * Returns the provider error code when the credential itself was rejected.
 */
export function providerAuthFailure(connector: string, body: unknown): string | null {
  if (connector !== "slack") return null;
  if (!body || typeof body !== "object") return null;
  const payload = body as { ok?: unknown; error?: unknown };
  if (payload.ok !== false || typeof payload.error !== "string") return null;
  return SLACK_AUTH_ERRORS.has(payload.error) ? payload.error : null;
}
