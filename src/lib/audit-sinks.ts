import { createHmac, randomBytes, randomUUID } from "node:crypto";
import type { AuditEvent, AuditSink } from "@prisma/client";
import { db } from "./db";
import { open, seal, wrapKey, unwrapKey } from "./crypto";
import { assertSafeOutboundUrl } from "./outbound";

export type SinkKind = "webhook" | "splunk";

export const SINK_KINDS: SinkKind[] = ["webhook", "splunk"];

export function isSinkKind(value: string): value is SinkKind {
  return value === "webhook" || value === "splunk";
}

export function packSinkSecret(secret: string, sinkId: string) {
  const dataKey = randomBytes(32);
  return {
    secretEncrypted: seal(dataKey, secret, `authab:audit-sink:${sinkId}`),
    secretDataKey: wrapKey(dataKey),
  };
}

export function unpackSinkSecret(sink: Pick<AuditSink, "id" | "secretEncrypted" | "secretDataKey">) {
  if (!sink.secretEncrypted || !sink.secretDataKey) return null;
  const key = unwrapKey(sink.secretDataKey);
  return open(key, sink.secretEncrypted, `authab:audit-sink:${sink.id}`);
}

export function sinkSignature(secret: string, timestamp: number, body: string) {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

type EventWithScope = AuditEvent & {
  environment: {
    id: string;
    type: string;
    project: { id: string; name: string; orgId: string };
  };
};

export function auditEnvelope(event: EventWithScope) {
  return {
    source: "authab",
    organizationId: event.environment.project.orgId,
    environment: {
      id: event.environment.id,
      type: event.environment.type,
      projectId: event.environment.project.id,
      projectName: event.environment.project.name,
    },
    event: {
      id: event.id,
      seq: event.seq,
      timestamp: event.timestamp.toISOString(),
      actorType: event.actorType,
      actorId: event.actorId,
      actorName: event.actorName,
      action: event.action,
      resourceType: event.resourceType,
      resourceId: event.resourceId,
      outcome: event.outcome,
      requestId: event.requestId,
      ip: event.ip,
      agentId: event.agentId,
      payloadSummary: JSON.parse(event.payloadSummary || "{}"),
      chain: JSON.parse(event.chainJson || "[]"),
      prevHash: event.prevHash,
      hash: event.hash,
    },
  };
}

async function postToSink(sink: AuditSink, envelope: object, deliveryId: string) {
  const url = await assertSafeOutboundUrl(sink.url, "Audit sink URL");
  const secret = unpackSinkSecret(sink);
  if (!secret) throw new Error("The sink secret could not be decrypted.");

  let body: string;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (sink.type === "splunk") {
    headers.authorization = `Splunk ${secret}`;
    headers["x-authab-delivery"] = deliveryId;
    body = JSON.stringify({
      time: Math.floor(Date.now() / 1000),
      host: "authab",
      source: "authab:audit",
      sourcetype: "authab:audit",
      event: envelope,
    });
  } else {
    const timestamp = Math.floor(Date.now() / 1000);
    body = JSON.stringify(envelope);
    headers["x-authab-timestamp"] = String(timestamp);
    headers["x-authab-delivery"] = deliveryId;
    headers["x-authab-signature"] = `t=${timestamp},v1=${sinkSignature(secret, timestamp, body)}`;
  }

  const res = await fetch(url, {
    method: "POST",
    headers,
    body,
    redirect: "manual",
    signal: AbortSignal.timeout(10_000),
  });
  return { ok: res.ok, status: res.status };
}

type DeliveryResult = { delivered: number; failed: number; queued: number };

const MAX_ATTEMPTS = 8;

function backoffMs(attempt: number) {
  return Math.min(15_000 * 2 ** Math.max(0, attempt - 1), 60 * 60_000);
}

async function recordFailure(sinkId: string, deliveryId: string, attempt: number, error: string) {
  const nextAttempt = attempt + 1;
  await db.auditSinkDelivery.update({
    where: { id: deliveryId },
    data: {
      attempt: nextAttempt,
      error: error.slice(0, 500),
      nextRetryAt: nextAttempt >= MAX_ATTEMPTS ? null : new Date(Date.now() + backoffMs(nextAttempt)),
    },
  });
  await db.auditSink.update({ where: { id: sinkId }, data: { failureCount: { increment: 1 } } }).catch(() => null);
}

export async function processAuditSinks(options?: { limit?: number; onlySinkId?: string }): Promise<DeliveryResult> {
  const limit = options?.limit ?? 100;
  const sinks = await db.auditSink.findMany({
    where: {
      enabled: true,
      ...(options?.onlySinkId ? { id: options.onlySinkId } : {}),
      org: { deletedAt: null },
    },
    include: {
      org: {
        select: {
          projects: { select: { environments: { select: { id: true } } } },
        },
      },
    },
  });

  const result: DeliveryResult = { delivered: 0, failed: 0, queued: 0 };

  for (const sink of sinks) {
    const environmentIds = sink.org.projects.flatMap((project) =>
      project.environments.map((environment) => environment.id),
    );

    for (const environmentId of environmentIds) {
      const last = await db.auditSinkDelivery.findFirst({
        where: { sinkId: sink.id, environmentId },
        orderBy: { seq: "desc" },
        select: { seq: true },
      });
      const events = await db.auditEvent.findMany({
        where: { environmentId, seq: { gt: last?.seq ?? 0 } },
        orderBy: { seq: "asc" },
        take: limit,
        select: { id: true, seq: true },
      });
      if (!events.length) continue;
      const created = await db.auditSinkDelivery.createMany({
        data: events.map((event) => ({
          id: randomUUID(),
          sinkId: sink.id,
          eventId: event.id,
          environmentId,
          seq: event.seq,
          nextRetryAt: new Date(),
        })),
        skipDuplicates: true,
      });
      result.queued += created.count;
    }

    const due = await db.auditSinkDelivery.findMany({
      where: {
        sinkId: sink.id,
        deliveredAt: null,
        NOT: { attempt: { gte: MAX_ATTEMPTS } },
        OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: new Date() } }],
      },
      orderBy: { createdAt: "asc" },
      take: limit,
    });

    for (const delivery of due) {
      const event = await db.auditEvent.findUnique({
        where: { id: delivery.eventId },
        include: { environment: { include: { project: true } } },
      });
      if (!event) {
        await db.auditSinkDelivery.update({
          where: { id: delivery.id },
          data: { deliveredAt: new Date(), error: "Event aged out of retention before delivery." },
        });
        continue;
      }
      try {
        const response = await postToSink(sink, auditEnvelope(event), delivery.id);
        if (!response.ok) throw new Error(`Sink responded with HTTP ${response.status}.`);
        await db.auditSinkDelivery.update({
          where: { id: delivery.id },
          data: { deliveredAt: new Date(), statusCode: response.status, error: null, nextRetryAt: null },
        });
        await db.auditSink.update({
          where: { id: sink.id },
          data: { lastDeliveryAt: new Date(), failureCount: 0 },
        });
        result.delivered += 1;
      } catch (error) {
        result.failed += 1;
        await recordFailure(sink.id, delivery.id, delivery.attempt, error instanceof Error ? error.message : "Delivery failed.");
      }
    }
  }

  return result;
}

export async function testAuditSink(sink: AuditSink) {
  const now = new Date();
  const delivery = await db.auditSinkDelivery.create({
    data: {
      id: randomUUID(),
      sinkId: sink.id,
      eventId: `test_${randomUUID()}`,
      environmentId: "",
      seq: -1,
      nextRetryAt: now,
    },
  });
  const envelope = {
    source: "authab",
    test: true,
    event: {
      id: delivery.eventId,
      seq: -1,
      timestamp: now.toISOString(),
      actorType: "system",
      actorId: null,
      actorName: "Authab",
      action: "sink.test",
      resourceType: "audit_sink",
      resourceId: sink.id,
      outcome: "recorded",
      requestId: delivery.eventId,
      ip: null,
      agentId: null,
      payloadSummary: { message: "Test delivery from Authab audit streaming." },
      chain: [],
      prevHash: null,
      hash: null,
    },
  };
  try {
    const response = await postToSink(sink, envelope, delivery.id);
    await db.auditSinkDelivery.update({
      where: { id: delivery.id },
      data: {
        deliveredAt: response.ok ? new Date() : null,
        statusCode: response.status,
        error: response.ok ? null : `Sink responded with HTTP ${response.status}.`,
      },
    });
    if (response.ok) {
      await db.auditSink.update({ where: { id: sink.id }, data: { lastDeliveryAt: new Date(), failureCount: 0 } });
    }
    return { ok: response.ok, status: response.status };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Delivery failed.";
    await db.auditSinkDelivery.update({
      where: { id: delivery.id },
      data: { error: message.slice(0, 500), nextRetryAt: null, attempt: MAX_ATTEMPTS },
    });
    await db.auditSink.update({ where: { id: sink.id }, data: { failureCount: { increment: 1 } } }).catch(() => null);
    return { ok: false, status: 0, error: message };
  }
}
