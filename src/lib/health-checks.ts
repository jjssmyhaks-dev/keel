export type HealthProbe = {
  method: "GET" | "POST";
  path: string;
  host?: string;
  body?: Record<string, unknown>;
  expect?: number[];
};

/**
 * Read-only probes that prove a stored credential still works. Each one is a
 * real provider endpoint. Connectors without a safe probe are reported as
 * "no probe" instead of being marked healthy.
 */
export const HEALTH_PROBES: Record<string, HealthProbe> = {
  slack: { method: "POST", path: "/api/auth.test" },
  github: { method: "GET", path: "/user" },
  google: { method: "GET", path: "/oauth2/v3/userinfo", host: "www.googleapis.com" },
  notion: { method: "GET", path: "/v1/users/me" },
  hubspot: { method: "GET", path: "/crm/v3/objects/contacts?limit=1" },
  linear: { method: "POST", path: "/graphql", body: { query: "{ viewer { id name } }" } },
  atlassian: { method: "GET", path: "/oauth/token/accessible-resources" },
  "microsoft-365": { method: "GET", path: "/v1.0/me", host: "graph.microsoft.com" },
  salesforce: { method: "GET", path: "/services/data/v62.0/" },
  airtable: { method: "GET", path: "/v0/meta/whoami" },
  figma: { method: "GET", path: "/v1/me" },
  dropbox: { method: "POST", path: "/2/users/get_current_account", body: {} },
  stripe: { method: "GET", path: "/v1/balance" },
  openai: { method: "GET", path: "/v1/models?limit=1" },
  anthropic: { method: "GET", path: "/v1/models?limit=1" },
  resend: { method: "GET", path: "/domains" },
  vercel: { method: "GET", path: "/v2/user" },
  cloudflare: { method: "GET", path: "/client/v4/user/tokens/verify" },
  huggingface: { method: "GET", path: "/api/whoami-v2", host: "huggingface.co" },
  discord: { method: "GET", path: "/api/v10/users/@me", host: "discord.com" },
  twilio: { method: "GET", path: "/2010-04-01/Accounts.json" },
  razorpay: { method: "GET", path: "/v1/orders?count=1" },
  supabase: { method: "GET", path: "/v1/projects" },
};

export function healthProbeFor(connectorSlug: string) {
  return HEALTH_PROBES[connectorSlug] ?? null;
}
