/** Client-safe consent constants. The hosted consent form must never import the DB-backed module. */

export const DURATION_OPTIONS = ["session", "30d", "until_revoked"] as const;
export type ConsentDuration = (typeof DURATION_OPTIONS)[number];
export const DURATION_LABELS: Record<ConsentDuration, string> = {
  session: "Just this session (24 hours)",
  "30d": "30 days",
  until_revoked: "Until the user revokes it",
};

export function isConsentDuration(value: unknown): value is ConsentDuration {
  return typeof value === "string" && (DURATION_OPTIONS as readonly string[]).includes(value);
}
