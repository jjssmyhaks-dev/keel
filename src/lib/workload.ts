import { createLocalJWKSet, decodeJwt, decodeProtectedHeader, jwtVerify, type JWK } from "jose";
import type { Agent, Environment, Organization, Project, WorkloadIdentity } from "@prisma/client";
import { db } from "./db";
import { assertSafeOutboundUrl } from "./outbound";

export class WorkloadError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 401) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const jwksCache = new Map<string, { keys: JWK[]; fetchedAt: number }>();
const JWKS_TTL_MS = 10 * 60_000;

function parseJwks(value: string): JWK[] {
  const parsed = JSON.parse(value) as JWK[] | { keys?: JWK[] };
  const keys = Array.isArray(parsed) ? parsed : parsed.keys;
  if (!Array.isArray(keys) || !keys.length) throw new Error("The JWKS document has no keys.");
  return keys;
}

async function identityKeys(identity: WorkloadIdentity): Promise<JWK[]> {
  if (identity.jwksJson) {
    try {
      return parseJwks(identity.jwksJson);
    } catch (error) {
      throw new WorkloadError("jwks_invalid", (error as Error).message, 500);
    }
  }
  if (!identity.jwksUrl) {
    throw new WorkloadError("jwks_missing", "This workload identity has no JWKS configured.", 500);
  }
  const cached = jwksCache.get(identity.jwksUrl);
  if (cached && Date.now() - cached.fetchedAt < JWKS_TTL_MS) return cached.keys;

  let url: string;
  try {
    url = await assertSafeOutboundUrl(identity.jwksUrl, "JWKS URL");
  } catch (error) {
    throw new WorkloadError("jwks_unreachable", (error as Error).message, 500);
  }
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);
  if (!response || !response.ok) {
    throw new WorkloadError("jwks_unreachable", "Could not fetch the workload identity JWKS.", 502);
  }
  const body = (await response.json().catch(() => null)) as { keys?: JWK[] } | null;
  if (!body?.keys?.length) {
    throw new WorkloadError("jwks_invalid", "The workload identity JWKS has no keys.", 502);
  }
  jwksCache.set(identity.jwksUrl, { keys: body.keys, fetchedAt: Date.now() });
  return body.keys;
}

function globMatches(pattern: string, value: string) {
  const escaped = pattern
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${escaped}$`).test(value);
}

export function workloadSubjectMatches(pattern: string | null, subject: string) {
  if (!pattern || !pattern.trim()) return true;
  return globMatches(pattern.trim(), subject);
}

function claimAt(payload: Record<string, unknown>, path: string) {
  return path.split(".").reduce<unknown>((value, key) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return (value as Record<string, unknown>)[key];
    }
    return undefined;
  }, payload);
}

function requiredClaimsMatch(identity: WorkloadIdentity, payload: Record<string, unknown>) {
  let required: Record<string, unknown>;
  try {
    required = JSON.parse(identity.requiredClaimsJson || "{}") as Record<string, unknown>;
  } catch {
    return false;
  }
  return Object.entries(required).every(([path, expected]) => {
    const actual = claimAt(payload, path);
    if (expected !== null && typeof expected === "object") {
      return JSON.stringify(actual) === JSON.stringify(expected);
    }
    return actual === expected;
  });
}

export type WorkloadIdentityWithEnvironment = WorkloadIdentity & {
  environment: Environment & { project: Project & { org: Organization } };
};

export type WorkloadVerification = {
  identity: WorkloadIdentityWithEnvironment;
  agent: Agent;
  claims: Record<string, unknown>;
};

export async function verifyWorkloadToken(token: string): Promise<WorkloadVerification> {
  let unverified: Record<string, unknown>;
  let header: ReturnType<typeof decodeProtectedHeader>;
  try {
    header = decodeProtectedHeader(token);
    unverified = decodeJwt(token) as Record<string, unknown>;
  } catch {
    throw new WorkloadError("invalid_workload_token", "The workload token is not a valid JWT.");
  }
  const issuer = typeof unverified.iss === "string" ? unverified.iss : "";
  if (!issuer) {
    throw new WorkloadError("invalid_workload_token", "The workload token has no iss claim.");
  }
  const identities = await db.workloadIdentity.findMany({
    where: { issuer, enabled: true },
    include: { environment: { include: { project: { include: { org: true } } } } },
  });
  if (!identities.length) {
    throw new WorkloadError("unknown_issuer", "No workload identity trusts this token issuer.");
  }

  let lastError: WorkloadError = new WorkloadError(
    "invalid_workload_token",
    "The workload token did not match any trusted identity.",
  );

  for (const identity of identities) {
    try {
      const keys = await identityKeys(identity);
      const { payload } = await jwtVerify(token, createLocalJWKSet({ keys }), {
        issuer: identity.issuer,
        audience: identity.audience,
        clockTolerance: 30,
        algorithms: header.alg ? [header.alg] : undefined,
      });
      const verified = payload as Record<string, unknown>;
      const subject = String(verified.sub ?? "");
      if (!subject) throw new WorkloadError("invalid_workload_token", "The workload token has no sub claim.");
      if (!workloadSubjectMatches(identity.subjectPattern, subject)) {
        throw new WorkloadError("subject_mismatch", `Workload subject ${subject} does not match this identity's pattern.`);
      }
      if (!requiredClaimsMatch(identity, verified)) {
        throw new WorkloadError("claims_mismatch", "The workload token is missing a required claim.");
      }
      if (!identity.agentId) {
        throw new WorkloadError(
          "workload_unmapped",
          "This workload identity is not linked to an agent. Link one before exchanging tokens.",
          403,
        );
      }
      const agent = await db.agent.findFirst({
        where: { id: identity.agentId, environmentId: identity.environmentId },
      });
      if (!agent) {
        throw new WorkloadError("unknown_agent", "The mapped agent no longer exists.", 403);
      }
      if (agent.status !== "active") {
        throw new WorkloadError("agent_inactive", `Agent is ${agent.status}. Resume it to issue tokens.`, 403);
      }
      if (identity.environment.project.org.deletedAt) {
        throw new WorkloadError("organization_suspended", "This organization is suspended.", 403);
      }
      return { identity, agent, claims: verified };
    } catch (error) {
      if (error instanceof WorkloadError) {
        lastError = error;
        continue;
      }
      lastError = new WorkloadError("invalid_workload_token", "The workload token signature or claims are invalid.");
    }
  }

  throw lastError;
}
