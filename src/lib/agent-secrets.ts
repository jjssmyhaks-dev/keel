import type { Agent, AgentClientSecret, Environment, Organization, Project } from "@prisma/client";
import { db } from "./db";
import { randomToken, sha256 } from "./crypto";

export const CLIENT_SECRET_PREFIX = "abcs_";

export function clientSecretPrefix(raw: string) {
  return raw.slice(0, 14);
}

export async function issueClientSecret(opts: {
  agentId: string;
  label?: string;
  scopes?: string[];
  expiresAt?: Date | null;
}) {
  const raw = `${CLIENT_SECRET_PREFIX}${randomToken(32)}`;
  const secret = await db.agentClientSecret.create({
    data: {
      agentId: opts.agentId,
      label: (opts.label || "default").trim().slice(0, 60) || "default",
      secretHash: sha256(raw),
      prefix: clientSecretPrefix(raw),
      scopesJson: JSON.stringify(opts.scopes ?? []),
      expiresAt: opts.expiresAt ?? null,
    },
  });
  return { secret, raw };
}

export type ClientSecretContext = {
  secret: AgentClientSecret;
  agent: Agent;
  environment: Environment & { project: Project & { org: Organization } };
};

export class ClientSecretError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export async function authenticateClientSecret(raw: string): Promise<ClientSecretContext> {
  if (!raw || !raw.startsWith(CLIENT_SECRET_PREFIX)) {
    throw new ClientSecretError("invalid_client", "The client secret is invalid, revoked or expired.");
  }
  const secret = await db.agentClientSecret.findUnique({
    where: { secretHash: sha256(raw) },
    include: {
      agent: { include: { environment: { include: { project: { include: { org: true } } } } } },
    },
  });
  if (!secret || secret.revokedAt) {
    throw new ClientSecretError("invalid_client", "The client secret is invalid, revoked or expired.");
  }
  if (secret.expiresAt && secret.expiresAt < new Date()) {
    throw new ClientSecretError("invalid_client", "The client secret is invalid, revoked or expired.");
  }
  const { agent } = secret;
  if (agent.status !== "active") {
    throw new ClientSecretError("agent_inactive", `Agent is ${agent.status}. Resume it to issue tokens.`);
  }
  if (agent.environment.project.org.deletedAt) {
    throw new ClientSecretError("organization_suspended", "This organization is suspended.");
  }
  if (!secret.lastUsedAt || Date.now() - secret.lastUsedAt.getTime() > 60_000) {
    await db.agentClientSecret.update({ where: { id: secret.id }, data: { lastUsedAt: new Date() } }).catch(() => null);
  }
  return {
    secret,
    agent,
    environment: agent.environment,
  };
}

export async function agentGrantScopes(agentId: string) {
  const grants = await db.grant.findMany({
    where: { agentId, endUserId: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    include: { credential: { select: { revokedAt: true, status: true, expiresAt: true } } },
  });
  const scopes = new Set<string>();
  for (const grant of grants) {
    if (grant.credential.revokedAt || grant.credential.status === "revoked") continue;
    if (grant.credential.expiresAt && grant.credential.expiresAt < new Date()) continue;
    try {
      for (const action of JSON.parse(grant.actionsJson || "[]") as string[]) scopes.add(action);
    } catch {
      // A malformed grant contributes no scopes.
    }
  }
  return [...scopes];
}
