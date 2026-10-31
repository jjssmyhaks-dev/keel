import { db } from "@/lib/db";
import {
  ApiError,
  apiOk,
  authenticateApiKey,
  clientIp,
  handleApiError,
  parseJson,
  requireSecretKey,
} from "@/lib/api";
import { generateAgentIdentity, sha256, verifyAgentSignature } from "@/lib/crypto";
import { signAgentToken } from "@/lib/jwt";
import { auditEvent } from "@/lib/audit";
import { dispatchEvent } from "@/lib/webhooks";
import { consumeRateLimit } from "@/lib/rate-limit";
import { serializeAgent } from "@/lib/serializers";
import { promoteAgent, previewPromotion } from "@/lib/promotion";

const STATUS_ACTIONS: Record<string, { status: string; action: string; label: string }> = {
  pause: { status: "paused", action: "agent.paused", label: "paused" },
  resume: { status: "active", action: "agent.resumed", label: "resumed" },
  suspend: { status: "suspended", action: "agent.suspended", label: "suspended" },
  revoke: { status: "revoked", action: "agent.revoked", label: "revoked" },
};

export async function POST(req: Request, ctx: { params: Promise<{ id: string; action: string }> }) {
  try {
    const auth = await authenticateApiKey(req);
    requireSecretKey(auth);
    const { id, action } = await ctx.params;
    const agent = await db.agent.findFirst({
      where: { id, environmentId: auth.environment.id },
      include: { keys: true },
    });
    if (!agent) throw new ApiError(404, "agent_not_found", "No agent with that ID exists in this environment.");

    const body = await parseJson<{
      challenge?: string;
      signature?: string;
      keyId?: string;
      ttl?: number;
      email?: string;
      preview?: boolean;
    }>(req);

    if (action === "token") {
      if (agent.status !== "active") {
        throw new ApiError(403, "agent_inactive", `Agent is ${agent.status} and cannot receive tokens.`);
      }
      const limit = await consumeRateLimit(`token:${agent.id}`, 120);
      if (!limit.allowed) throw new ApiError(429, "rate_limited", "Too many token requests for this agent.");

      const key = body.keyId
        ? agent.keys.find((k) => k.id === body.keyId)
        : agent.keys.find((k) => k.status === "active") ?? agent.keys[0];

      const platformAllowed = agent.keyMode === "platform";

      if (body.signature) {
        if (!key || key.status === "retired") {
          throw new ApiError(401, "key_retired", "This agent key has been retired.");
        }
        if (!body.challenge) throw new ApiError(422, "challenge_required", "Provide the signed challenge.");
        const stamp = Number(body.challenge.split(".")[0]);
        if (!Number.isFinite(stamp) || Math.abs(Date.now() / 1000 - stamp) > 300) {
          throw new ApiError(401, "challenge_expired", "The challenge must embed the current Unix timestamp and be used within 5 minutes.");
        }
        const message = `${agent.id}.${body.challenge}`;
        if (!verifyAgentSignature(key.publicKey, message, body.signature)) {
          throw new ApiError(401, "invalid_signature", "The signature does not match this agent's key.");
        }
        try {
          await db.challengeUse.create({
            data: { key: sha256(`${agent.id}:${body.challenge}`), agentId: agent.id },
          });
        } catch (error) {
          if ((error as { code?: string }).code === "P2002") {
            throw new ApiError(401, "challenge_replayed", "This challenge has already been used. Sign a fresh challenge.");
          }
          throw error;
        }
      } else if (!platformAllowed) {
        throw new ApiError(
          401,
          "signature_required",
          "Sign the challenge with the agent's private key, or use platform-managed key mode.",
        );
      }

      const grants = await db.grant.findMany({
        where: { agentId: agent.id, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
        include: { credential: true },
      });
      const scopes = [...new Set(grants.flatMap((g) => JSON.parse(g.actionsJson || "[]") as string[]))];
      const ttl = Math.min(Math.max(Number(body.ttl || 300), 60), 3600);

      const issued = await signAgentToken(
        {
          agentId: agent.id,
          environmentId: auth.environment.id,
          projectId: auth.project.id,
          organizationId: auth.organization.id,
          principalId: agent.ownerUserId,
          scopes,
        },
        ttl,
      );

      await auditEvent({
        environmentId: auth.environment.id,
        actorType: "agent",
        actorId: agent.id,
        actorName: agent.name,
        agentId: agent.id,
        action: "token.issued",
        resourceType: "token",
        resourceId: issued.tokenId,
        outcome: "recorded",
        ip: clientIp(req),
        payloadSummary: { ttl, scopes, keyId: key?.id ?? null, method: body.signature ? "signature" : "platform" },
      });

      return apiOk({
        accessToken: issued.token,
        tokenType: "Bearer",
        expiresIn: issued.expiresIn,
        expiresAt: issued.expiresAt,
        tokenId: issued.tokenId,
        scopes,
      });
    }

    if (action === "kill") {
      const updated = await db.agent.update({ where: { id: agent.id }, data: { status: "revoked" } });
      await db.grant.deleteMany({ where: { agentId: agent.id } });
      await db.agentKey.updateMany({ where: { agentId: agent.id }, data: { status: "retired", retireAt: new Date() } });
      await auditEvent({
        environmentId: auth.environment.id,
        actorType: "human",
        actorId: auth.apiKeyId,
        actorName: "API key",
        agentId: agent.id,
        action: "agent.kill_switch",
        resourceType: "agent",
        resourceId: agent.id,
        outcome: "recorded",
        ip: clientIp(req),
        payloadSummary: { name: agent.name, grantsRevoked: true, keysRetired: true },
      });
      await dispatchEvent(auth.environment.id, "agent.status_changed", {
        agentId: agent.id,
        name: agent.name,
        status: "revoked",
        killSwitch: true,
      });
      return apiOk({ ...serializeAgent(updated), killSwitch: true });
    }

    if (STATUS_ACTIONS[action]) {
      const target = STATUS_ACTIONS[action];
      if (agent.status === "revoked" && target.status !== "revoked") {
        throw new ApiError(409, "agent_revoked", "Revocation is permanent. Create a new agent instead.");
      }
      const updated = await db.agent.update({ where: { id: agent.id }, data: { status: target.status } });
      await auditEvent({
        environmentId: auth.environment.id,
        actorType: "human",
        actorId: auth.apiKeyId,
        actorName: "API key",
        agentId: agent.id,
        action: target.action,
        resourceType: "agent",
        resourceId: agent.id,
        outcome: "recorded",
        ip: clientIp(req),
        payloadSummary: { name: agent.name, from: agent.status, to: target.status },
      });
      await dispatchEvent(auth.environment.id, "agent.status_changed", {
        agentId: agent.id,
        name: agent.name,
        status: target.status,
      });
      return apiOk(serializeAgent(updated));
    }

    if (action === "rotate-key") {
      const identity = generateAgentIdentity();
      const newKey = await db.agentKey.create({
        data: { agentId: agent.id, publicKey: identity.publicKey },
      });
      await db.agentKey.updateMany({
        where: { agentId: agent.id, id: { not: newKey.id } },
        data: { status: "rotating", retireAt: new Date(Date.now() + 7 * 86400_000) },
      });
      const updated = await db.agent.update({
        where: { id: agent.id },
        data: { publicKey: identity.publicKey, fingerprint: identity.fingerprint },
      });
      await auditEvent({
        environmentId: auth.environment.id,
        actorType: "human",
        actorId: auth.apiKeyId,
        actorName: "API key",
        agentId: agent.id,
        action: "agent.key_rotated",
        resourceType: "agent",
        resourceId: agent.id,
        outcome: "recorded",
        ip: clientIp(req),
        payloadSummary: { oldFingerprint: agent.fingerprint, newFingerprint: identity.fingerprint, graceDays: 7 },
      });
      return apiOk({
        ...serializeAgent(updated),
        keyId: newKey.id,
        privateKey: identity.privateKey,
        warning: "Store this private key securely. The previous key remains valid for 7 days.",
      });
    }

    if (action === "transfer") {
      if (!body.email) throw new ApiError(422, "owner_required", "Provide the new owner's email address.");
      const owner = await db.user.findUnique({ where: { email: body.email.toLowerCase() } });
      const membership = owner
        ? await db.membership.findUnique({
            where: { orgId_userId: { orgId: auth.organization.id, userId: owner.id } },
          })
        : null;
      if (!owner || !membership) {
        throw new ApiError(422, "invalid_owner", "The new owner must be a member of this organization.");
      }
      const updated = await db.agent.update({ where: { id: agent.id }, data: { ownerUserId: owner.id } });
      await auditEvent({
        environmentId: auth.environment.id,
        actorType: "human",
        actorId: auth.apiKeyId,
        actorName: "API key",
        agentId: agent.id,
        action: "agent.transferred",
        resourceType: "agent",
        resourceId: agent.id,
        outcome: "recorded",
        ip: clientIp(req),
        payloadSummary: { from: agent.ownerUserId, to: owner.id, email: owner.email },
      });
      return apiOk(serializeAgent(updated));
    }

    if (action === "promote") {
      if (body.preview) {
        const preview = await previewPromotion(agent.id);
        if (!preview.ok) throw new ApiError(422, "promotion_blocked", preview.error);
        return apiOk({
          preview: true,
          agentId: agent.id,
          readiness: preview.readiness,
          diff: preview.diff,
          plan: preview.orgPlan,
          alreadyInProduction: Boolean(preview.existing),
        });
      }
      const email = (body.email || "").toLowerCase();
      if (!email) throw new ApiError(422, "email_required", "Provide the email of an Owner or Admin approving the promotion.");
      const user = await db.user.findUnique({ where: { email } });
      const membership = user
        ? await db.membership.findUnique({ where: { orgId_userId: { orgId: auth.organization.id, userId: user.id } } })
        : null;
      if (!user || !membership || !["owner", "admin"].includes(membership.role)) {
        throw new ApiError(403, "approver_required", "Promotion must be confirmed by an Owner or Admin.");
      }
      const result = await promoteAgent({
        devAgentId: agent.id,
        userId: user.id,
        userName: user.name,
        userEmailVerified: Boolean(user.emailVerifiedAt),
        ip: clientIp(req),
      });
      if (!result.ok) throw new ApiError(422, "promotion_blocked", result.error);
      return apiOk({
        promotionId: result.promotion.id,
        agent: serializeAgent(result.agent),
        privateKey: result.identity.privateKey,
        readiness: result.readiness,
        diff: result.diff,
        safeLaunchUntil: result.safeLaunchUntil.toISOString(),
      });
    }

    throw new ApiError(404, "unknown_action", `Unknown agent action “${action}”.`);
  } catch (error) {
    return handleApiError(error);
  }
}
