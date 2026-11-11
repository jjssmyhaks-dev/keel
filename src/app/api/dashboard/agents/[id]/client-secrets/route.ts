import { db } from "@/lib/db";
import { getContext } from "@/lib/session";
import { agentGrantScopes, issueClientSecret } from "@/lib/agent-secrets";
import { scopeList, scopesAllowed } from "@/lib/token-http";
import { auditEvent } from "@/lib/audit";
import { serializeClientSecret } from "@/lib/serializers";

function sameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin) return req.headers.get("sec-fetch-site") !== "cross-site";
  try {
    const source = new URL(origin);
    const target = new URL(req.url);
    const app = process.env.APP_URL ? new URL(process.env.APP_URL) : null;
    return source.host === target.host || (app ? source.host === app.host : false);
  } catch {
    return false;
  }
}

function json(data: unknown, status = 200) {
  return Response.json(data, { status });
}

async function context() {
  const ctx = await getContext().catch(() => null);
  if (!ctx) return null;
  if (!ctx.capabilities.manageAgents) return null;
  return ctx;
}

export async function GET(_req: Request, route: { params: Promise<{ id: string }> }) {
  const ctx = await context();
  if (!ctx) return json({ error: { code: "forbidden", message: "You cannot manage agent credentials here." } }, 403);
  const { id } = await route.params;
  const agent = await db.agent.findFirst({ where: { id, environmentId: ctx.environment.id } });
  if (!agent) return json({ error: { code: "agent_not_found", message: "That agent no longer exists." } }, 404);
  const secrets = await db.agentClientSecret.findMany({ where: { agentId: agent.id }, orderBy: { createdAt: "desc" } });
  return json({ object: "list", data: secrets.map(serializeClientSecret) });
}

export async function POST(req: Request, route: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req)) return json({ error: { code: "invalid_origin", message: "Cross-origin request rejected." } }, 403);
  const ctx = await context();
  if (!ctx) return json({ error: { code: "forbidden", message: "You cannot manage agent credentials here." } }, 403);
  const { id } = await route.params;
  const agent = await db.agent.findFirst({ where: { id, environmentId: ctx.environment.id } });
  if (!agent) return json({ error: { code: "agent_not_found", message: "That agent no longer exists." } }, 404);
  if (agent.status === "revoked") {
    return json({ error: { code: "agent_revoked", message: "Revoked agents cannot receive new secrets." } }, 409);
  }

  const body = (await req.json().catch(() => null)) as
    | { label?: unknown; scopes?: unknown; expiresInDays?: unknown }
    | null;
  if (!body) return json({ error: { code: "invalid_body", message: "Send a JSON body." } }, 400);

  const scopes = scopeList(body.scopes);
  if (scopes.length) {
    const available = await agentGrantScopes(agent.id);
    if (!scopesAllowed(available, scopes)) {
      return json(
        { error: { code: "invalid_scope", message: "Scopes must be covered by this agent's active grants.", details: { available } } },
        422,
      );
    }
  }

  let expiresAt: Date | null = null;
  if (body.expiresInDays !== undefined && body.expiresInDays !== null && body.expiresInDays !== "") {
    const days = Number(body.expiresInDays);
    if (!Number.isFinite(days) || days < 1 || days > 365) {
      return json({ error: { code: "invalid_expiry", message: "Expiry must be between 1 and 365 days." } }, 422);
    }
    expiresAt = new Date(Date.now() + Math.floor(days) * 86_400_000);
  }

  const { secret, raw } = await issueClientSecret({
    agentId: agent.id,
    label: typeof body.label === "string" ? body.label : undefined,
    scopes,
    expiresAt,
  });

  await auditEvent({
    environmentId: ctx.environment.id,
    actorType: "human",
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    agentId: agent.id,
    action: "agent.client_secret.created",
    resourceType: "client_secret",
    resourceId: secret.id,
    outcome: "recorded",
    payloadSummary: { agent: agent.name, label: secret.label, prefix: secret.prefix, scopes },
  }).catch(() => null);

  return json(
    {
      clientSecret: serializeClientSecret(secret),
      secret: raw,
      warning: "This secret is shown once. Store it in the agent's secret manager now.",
    },
    201,
  );
}

export async function DELETE(req: Request, route: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req)) return json({ error: { code: "invalid_origin", message: "Cross-origin request rejected." } }, 403);
  const ctx = await context();
  if (!ctx) return json({ error: { code: "forbidden", message: "You cannot manage agent credentials here." } }, 403);
  const { id } = await route.params;
  const agent = await db.agent.findFirst({ where: { id, environmentId: ctx.environment.id } });
  if (!agent) return json({ error: { code: "agent_not_found", message: "That agent no longer exists." } }, 404);

  const body = (await req.json().catch(() => null)) as { secretId?: string } | null;
  const secret = body?.secretId
    ? await db.agentClientSecret.findFirst({ where: { id: body.secretId, agentId: agent.id } })
    : null;
  if (!secret) return json({ error: { code: "client_secret_not_found", message: "That secret does not belong to this agent." } }, 404);

  const updated = secret.revokedAt
    ? secret
    : await db.agentClientSecret.update({ where: { id: secret.id }, data: { revokedAt: new Date() } });

  await auditEvent({
    environmentId: ctx.environment.id,
    actorType: "human",
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    agentId: agent.id,
    action: "agent.client_secret.revoked",
    resourceType: "client_secret",
    resourceId: secret.id,
    outcome: "recorded",
    payloadSummary: { agent: agent.name, prefix: secret.prefix },
  }).catch(() => null);

  return json({ clientSecret: serializeClientSecret(updated) });
}
