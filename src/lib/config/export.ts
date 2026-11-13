import { db } from "../db";
import { CONFIG_VERSION, type ConfigV1 } from "./types";

export async function exportConfig(environmentId: string, environmentType: string): Promise<ConfigV1> {
  const [agents, credentials, grants, policies, endpoints] = await Promise.all([
    db.agent.findMany({
      where: { environmentId, status: { not: "revoked" } },
      orderBy: { name: "asc" },
    }),
    db.credential.findMany({
      where: { environmentId, endUserId: null, revokedAt: null, status: { not: "revoked" } },
      orderBy: [{ connectorSlug: "asc" }, { name: "asc" }],
    }),
    db.grant.findMany({
      where: { environmentId, endUserId: null },
      include: {
        agent: { select: { name: true, status: true } },
        credential: { select: { name: true, connectorSlug: true, revokedAt: true, status: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    db.approvalPolicy.findMany({
      where: { environmentId },
      include: { agent: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
    }),
    db.webhookEndpoint.findMany({ where: { environmentId }, orderBy: { createdAt: "asc" } }),
  ]);

  return {
    version: CONFIG_VERSION,
    environment: environmentType,
    agents: agents.map((agent) => ({
      name: agent.name,
      type: agent.agentType,
      description: agent.description,
      tags: JSON.parse(agent.tagsJson || "[]") as string[],
      autonomousMode: agent.autonomousMode,
    })),
    connections: credentials.map((credential) => ({
      name: credential.name,
      connector: credential.connectorSlug,
      type: credential.type,
      metadata: JSON.parse(credential.metadataJson || "{}") as Record<string, unknown>,
    })),
    grants: grants
      .filter(
        (grant) =>
          grant.agent.status !== "revoked" &&
          grant.credential.status !== "revoked" &&
          !grant.credential.revokedAt,
      )
      .map((grant) => ({
        agent: grant.agent.name,
        connection: grant.credential.name,
        actions: JSON.parse(grant.actionsJson || "[]") as string[],
        resource: grant.resourcePattern,
        approvalMode: grant.approvalMode,
        conditions: JSON.parse(grant.conditionsJson || "{}") as Record<string, unknown>,
        expiresAt: grant.expiresAt?.toISOString() ?? null,
      })),
    approvalPolicies: policies.map((policy) => ({
      agent: policy.agent?.name ?? null,
      actionPattern: policy.actionPattern,
      mode: policy.mode,
      slaMinutes: policy.slaMinutes,
      escalateToRole: policy.escalateToRole,
    })),
    webhooks: endpoints.map((endpoint) => ({
      url: endpoint.url,
      events: JSON.parse(endpoint.eventsJson || "[]") as string[],
    })),
  };
}
