import { NextResponse } from "next/server";
import { db } from "./db";
import { sha256 } from "./crypto";
import { verifyAgentToken } from "./jwt";
import type { Agent, Environment, Organization, Project } from "@prisma/client";

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function requestId() {
  return `req_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function apiOk(data: unknown, init?: ResponseInit & { requestId?: string }) {
  return NextResponse.json(data, {
    ...init,
    headers: { "x-request-id": init?.requestId ?? requestId(), ...(init?.headers ?? {}) },
  });
}

export function apiError(
  status: number,
  code: string,
  message: string,
  details?: unknown,
  id = requestId(),
) {
  return NextResponse.json(
    { error: { code, message, details, requestId: id } },
    { status, headers: { "x-request-id": id } },
  );
}

export function handleApiError(error: unknown) {
  if (error instanceof ApiError) {
    return apiError(error.status, error.code, error.message, error.details);
  }
  if (error instanceof SyntaxError) {
    return apiError(400, "invalid_json", "The request body is not valid JSON.");
  }
  console.error("[keel:api]", error);
  return apiError(500, "internal_error", "An unexpected error occurred. Contact support with the request ID.");
}

export type ApiKeyContext = {
  kind: "api_key";
  apiKeyId: string;
  keyType: string;
  environment: Environment;
  project: Project;
  organization: Organization;
};

export type AgentAuthContext = {
  kind: "agent_token";
  agent: Agent;
  environment: Environment & { project: Project & { org: Organization } };
  claims: Record<string, unknown>;
  tokenId: string;
};

function bearer(req: Request) {
  const header = req.headers.get("authorization") ?? "";
  if (!header.toLowerCase().startsWith("bearer ")) return null;
  return header.slice(7).trim();
}

export async function authenticateApiKey(req: Request): Promise<ApiKeyContext> {
  const token = bearer(req);
  if (!token) throw new ApiError(401, "missing_api_key", "Provide a secret key as a Bearer token.");
  const apiKey = await db.apiKey.findUnique({
    where: { keyHash: sha256(token) },
    include: { environment: { include: { project: { include: { org: true } } } } },
  });
  if (!apiKey || apiKey.revokedAt) {
    throw new ApiError(401, "invalid_api_key", "This API key is invalid or has been revoked.");
  }
  if (apiKey.environment.project.org.deletedAt) {
    throw new ApiError(403, "organization_suspended", "This organization is suspended.");
  }
  if (!apiKey.lastUsedAt || Date.now() - apiKey.lastUsedAt.getTime() > 60_000) {
    await db.apiKey.update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } }).catch(() => null);
  }
  return {
    kind: "api_key",
    apiKeyId: apiKey.id,
    keyType: apiKey.type,
    environment: apiKey.environment,
    project: apiKey.environment.project,
    organization: apiKey.environment.project.org,
  };
}

export async function authenticateAgent(req: Request): Promise<AgentAuthContext> {
  const token = bearer(req);
  if (!token) throw new ApiError(401, "missing_agent_token", "Provide an agent token as a Bearer token.");
  let payload: Record<string, unknown>;
  try {
    payload = (await verifyAgentToken(token)) as Record<string, unknown>;
  } catch {
    throw new ApiError(401, "invalid_agent_token", "The agent token is invalid, expired or not yet valid.");
  }
  const tokenId = String(payload.jti ?? "");
  const agentId = String(payload.sub ?? "");
  if (!tokenId || !agentId) throw new ApiError(401, "invalid_agent_token", "Token is missing required claims.");

  const blocked = await db.tokenBlocklist.findUnique({ where: { id: tokenId } });
  if (blocked) throw new ApiError(401, "token_revoked", "This agent token has been revoked.");

  const agent = await db.agent.findUnique({
    where: { id: agentId },
    include: { environment: { include: { project: { include: { org: true } } } } },
  });
  if (!agent) throw new ApiError(401, "unknown_agent", "The agent no longer exists.");
  if (agent.status !== "active") {
    throw new ApiError(403, "agent_inactive", `Agent is ${agent.status}. Resume it to issue new calls.`);
  }
  if (agent.environmentId !== String(payload.env)) {
    throw new ApiError(401, "environment_mismatch", "Token environment does not match the agent.");
  }

  const tokenType = String(payload.token_use ?? "");
  if (tokenType && tokenType !== "access") {
    throw new ApiError(401, "wrong_token_type", "This endpoint requires an access token.");
  }

  await db.agent.update({ where: { id: agent.id }, data: { lastActiveAt: new Date() } }).catch(() => null);

  return {
    kind: "agent_token",
    agent,
    environment: agent.environment,
    claims: payload,
    tokenId,
  };
}

export function requireSecretKey(ctx: ApiKeyContext) {
  if (ctx.keyType !== "secret") {
    throw new ApiError(403, "publishable_key_not_allowed", "This action requires a secret API key.");
  }
}

export async function parseJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new ApiError(400, "invalid_json", "The request body is not valid JSON.");
  }
}

export function clientIp(req: Request) {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    null
  );
}
