import { auditEvent } from "./audit";
import { db } from "./db";

export async function auditHuman(input: {
  userId: string;
  actorName: string;
  action: string;
  outcome?: "allowed" | "approved" | "denied" | "error" | "recorded";
  payload?: Record<string, unknown>;
  ip?: string | null;
}) {
  const membership = await db.membership.findFirst({
    where: { userId: input.userId, status: "active" },
    include: { org: { include: { projects: { include: { environments: true } } } } },
    orderBy: { createdAt: "asc" },
  });
  const environments = membership?.org.projects.flatMap((project) => project.environments) ?? [];
  const environment =
    environments.find((candidate) => candidate.type === "development") ?? environments[0];
  if (!environment) return;
  await auditEvent({
    environmentId: environment.id,
    actorType: "human",
    actorId: input.userId,
    actorName: input.actorName,
    action: input.action,
    resourceType: "user",
    resourceId: input.userId,
    outcome: input.outcome ?? "recorded",
    ip: input.ip,
    payloadSummary: input.payload ?? {},
  });
}
