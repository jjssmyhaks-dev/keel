import { db } from "./db";
import { ApiError } from "./api";
import { assertSafeOutboundUrl, privateOutboundAllowed } from "./outbound";

export type WorkloadIdentityInput = {
  name?: string;
  type?: string;
  issuer?: string;
  audience?: string;
  jwksUrl?: string | null;
  jwksJson?: string | null;
  agentId?: string;
  subjectPattern?: string | null;
  requiredClaims?: Record<string, unknown>;
  tokenTtlSeconds?: number;
  enabled?: boolean;
};

const TYPES = new Set(["spiffe", "kubernetes", "custom"]);

export async function validateWorkloadIdentityInput(
  body: WorkloadIdentityInput,
  environmentId: string,
  opts: { partial?: boolean } = {},
) {
  const data: Record<string, unknown> = {};
  const require = (value: string | undefined, field: string) => {
    if (!opts.partial && !value) throw new ApiError(422, `${field}_required`, `${field} is required.`);
    return value;
  };

  const name = require(body.name, "name");
  if (name !== undefined) {
    if (!name.trim()) throw new ApiError(422, "name_required", "name cannot be blank.");
    data.name = name.trim().slice(0, 80);
  }

  if (body.type !== undefined) {
    if (!TYPES.has(body.type)) {
      throw new ApiError(422, "invalid_type", "type must be spiffe, kubernetes or custom.");
    }
    data.type = body.type;
  } else if (!opts.partial) {
    data.type = "spiffe";
  }

  const issuer = require(body.issuer, "issuer");
  if (issuer !== undefined) {
    let parsed: URL;
    try {
      parsed = new URL(issuer);
    } catch {
      throw new ApiError(422, "invalid_issuer", "issuer must be a valid URL or SPIFFE ID.");
    }
    const schemeOk = parsed.protocol === "https:" || parsed.protocol === "spiffe:" || (parsed.protocol === "http:" && privateOutboundAllowed());
    if (!schemeOk) throw new ApiError(422, "invalid_issuer", "issuer must use https:// or spiffe://.");
    data.issuer = issuer.trim();
  }

  const audience = require(body.audience, "audience");
  if (audience !== undefined) {
    if (!audience.trim()) throw new ApiError(422, "audience_required", "audience cannot be blank.");
    data.audience = audience.trim().slice(0, 256);
  }

  const hasJwksUrl = body.jwksUrl !== undefined && body.jwksUrl !== null && body.jwksUrl !== "";
  const hasJwksJson = body.jwksJson !== undefined && body.jwksJson !== null && body.jwksJson !== "";
  if (!opts.partial && hasJwksUrl === hasJwksJson) {
    throw new ApiError(422, "jwks_required", "Provide exactly one of jwksUrl or jwksJson.");
  }
  if (hasJwksUrl) {
    try {
      data.jwksUrl = await assertSafeOutboundUrl(String(body.jwksUrl), "JWKS URL");
    } catch (error) {
      throw new ApiError(422, "invalid_jwks_url", (error as Error).message);
    }
    data.jwksJson = null;
  } else if (hasJwksJson) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(String(body.jwksJson));
    } catch {
      throw new ApiError(422, "invalid_jwks", "jwksJson must be valid JSON.");
    }
    const keys = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object"
        ? (parsed as { keys?: unknown }).keys
        : null;
    if (!Array.isArray(keys) || !keys.length) {
      throw new ApiError(422, "invalid_jwks", "jwksJson must contain a non-empty keys array.");
    }
    data.jwksJson = JSON.stringify(Array.isArray(parsed) ? { keys: parsed } : parsed);
    data.jwksUrl = null;
  }

  const agentId = require(body.agentId, "agentId");
  if (agentId !== undefined) {
    const agent = await db.agent.findFirst({ where: { id: agentId, environmentId } });
    if (!agent) throw new ApiError(422, "invalid_agent", "agentId must reference an agent in this environment.");
    if (agent.status === "revoked") throw new ApiError(422, "invalid_agent", "Cannot map a workload identity to a revoked agent.");
    if (agent.kind === "external") {
      throw new ApiError(422, "invalid_agent", "Shadow agents cannot hold workload identities. Use trust-exchange.");
    }
    data.agentId = agent.id;
  }

  if (body.subjectPattern !== undefined) {
    if (body.subjectPattern !== null && body.subjectPattern.length > 256) {
      throw new ApiError(422, "invalid_subject_pattern", "subjectPattern must be 256 characters or fewer.");
    }
    data.subjectPattern = body.subjectPattern || null;
  }

  if (body.requiredClaims !== undefined) {
    if (
      body.requiredClaims === null ||
      typeof body.requiredClaims !== "object" ||
      Array.isArray(body.requiredClaims)
    ) {
      throw new ApiError(422, "invalid_required_claims", "requiredClaims must be an object of claim paths to expected values.");
    }
    data.requiredClaimsJson = JSON.stringify(body.requiredClaims);
  }

  if (body.tokenTtlSeconds !== undefined) {
    const ttl = Number(body.tokenTtlSeconds);
    if (!Number.isFinite(ttl) || ttl < 60 || ttl > 3600) {
      throw new ApiError(422, "invalid_ttl", "tokenTtlSeconds must be between 60 and 3600.");
    }
    data.tokenTtlSeconds = Math.floor(ttl);
  }

  if (body.enabled !== undefined) data.enabled = Boolean(body.enabled);

  return data;
}
