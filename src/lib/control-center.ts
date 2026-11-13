import type { EndUser } from "@prisma/client";
import { cookies } from "next/headers";
import { db } from "./db";
import { auditEvent } from "./audit";
import { dispatchEvent } from "./webhooks";
import { emailLayout, sendEmail } from "./email";
import { constantTimeEqual, randomToken, sha256 } from "./crypto";
import {
  CONTROL_LINK_TTL_MS,
  controlCenterUrl,
  parseStringArray,
} from "./consent";
import { connector } from "./connectors";

export const CSRF_COOKIE = "authab_csrf";

export function csrfCookieOptions() {
  return {
    httpOnly: true as const,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24,
  };
}

export function newCsrfToken() {
  return randomToken(24);
}

export async function csrfMatches(form: FormData) {
  const received = String(form.get("csrf") ?? "");
  if (!received) return false;
  const expected = (await cookies()).get(CSRF_COOKIE)?.value ?? "";
  return Boolean(expected) && constantTimeEqual(received, expected);
}

export function humanizeAction(action: string) {
  const text = action.replace(/[._-]+/g, " ").trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : action;
}

export async function endUserControlData(endUser: EndUser) {
  const now = new Date();
  const [consents, credentials, events, dataRequests] = await Promise.all([
    db.consent.findMany({ where: { endUserId: endUser.id }, orderBy: { grantedAt: "desc" } }),
    db.credential.findMany({
      where: { endUserId: endUser.id, revokedAt: null },
      select: {
        id: true,
        name: true,
        connectorSlug: true,
        status: true,
        createdAt: true,
        lastUsedAt: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    db.agentEvent.findMany({
      where: { endUserId: endUser.id },
      orderBy: { occurredAt: "desc" },
      take: 20,
    }),
    db.dataRequest.findMany({ where: { endUserId: endUser.id }, orderBy: { createdAt: "desc" }, take: 10 }),
  ]);

  const activeConsents = consents.filter((consent) => !consent.revokedAt && (!consent.expiresAt || consent.expiresAt > now));
  const projectIds = [...new Set(consents.map((consent) => consent.projectId))];
  const agentIds = [...new Set([...consents.map((consent) => consent.agentId), ...events.map((event) => event.agentId)])];
  const [brandings, agents] = await Promise.all([
    db.consentBranding.findMany({ where: { projectId: { in: projectIds } } }),
    db.agent.findMany({ where: { id: { in: agentIds } }, select: { id: true, name: true } }),
  ]);
  const brandingsByProject = new Map(brandings.map((branding) => [branding.projectId, branding]));
  const agentNames = new Map(agents.map((agent) => [agent.id, agent.name]));

  const products = new Map<
    string,
    {
      projectId: string;
      productName: string;
      supportUrl: string | null;
      privacyUrl: string | null;
      consents: {
        id: string;
        agentName: string;
        actions: string[];
        grantedAt: Date;
        expiresAt: Date | null;
        lastUsedAt: Date | null;
        active: boolean;
        revokedAt: Date | null;
      }[];
    }
  >();
  for (const consent of activeConsents) {
    const branding = brandingsByProject.get(consent.projectId);
    let product = products.get(consent.projectId);
    if (!product) {
      product = {
        projectId: consent.projectId,
        productName: branding?.productName ?? "Unknown product",
        supportUrl: branding?.supportUrl ?? null,
        privacyUrl: branding?.privacyUrl ?? null,
        consents: [],
      };
      products.set(consent.projectId, product);
    }
    product.consents.push({
      id: consent.id,
      agentName: agentNames.get(consent.agentId) ?? "An agent",
      actions: parseStringArray(consent.scopesJson).map(humanizeAction),
      grantedAt: consent.grantedAt,
      expiresAt: consent.expiresAt,
      lastUsedAt: consent.lastUsedAt,
      active: true,
      revokedAt: null,
    });
  }

  return {
    endUser,
    products: [...products.values()],
    connections: credentials.map((credential) => ({
      id: credential.id,
      name: connector(credential.connectorSlug)?.name ?? credential.connectorSlug,
      account: credential.name,
      status: credential.status,
      createdAt: credential.createdAt,
      lastUsedAt: credential.lastUsedAt,
    })),
    activity: events.map((event) => ({
      id: event.id,
      agentName: agentNames.get(event.agentId) ?? "An agent",
      action: humanizeAction(event.action),
      connector: connector(event.connectorSlug)?.name ?? event.connectorSlug,
      outcome: event.decision === "allow" ? "allowed" : event.decision === "deny" ? "denied" : event.decision,
      at: event.occurredAt,
    })),
    dataRequests: dataRequests.map((request) => ({
      id: request.id,
      kind: request.kind,
      status: request.status,
      createdAt: request.createdAt,
      completedAt: request.completedAt,
    })),
    revokedConsentCount: consents.length - activeConsents.length,
  };
}

async function endUserEnvironments(endUserId: string) {
  const consents = await db.consent.findMany({
    where: { endUserId },
    select: { environmentId: true, projectId: true },
  });
  const environmentIds = [...new Set(consents.map((consent) => consent.environmentId))];
  const environments = await db.environment.findMany({
    where: { id: { in: environmentIds } },
    include: { project: { include: { org: true } } },
  });
  return { consents, environments };
}

/**
 * Records a privacy request once per project (each organization owns its own
 * copy of the end user) and tells each organization what arrived.
 */
export async function createEndUserDataRequest(input: {
  endUser: EndUser;
  kind: "delete" | "export";
  ip?: string | null;
  requestId?: string;
}) {
  const { environments } = await endUserEnvironments(input.endUser.id);
  const byProject = new Map<string, typeof environments>();
  for (const environment of environments) {
    const list = byProject.get(environment.projectId) ?? [];
    list.push(environment);
    byProject.set(environment.projectId, list);
  }
  const created: { id: string; projectId: string }[] = [];

  for (const [projectId, projectEnvironments] of byProject) {
    const status = input.kind === "export" ? "completed" : "open";
    const request = await db.dataRequest.create({
      data: {
        endUserId: input.endUser.id,
        projectId,
        kind: input.kind,
        status,
        completedAt: input.kind === "export" ? new Date() : null,
        completedBy: input.kind === "export" ? "self-service" : null,
      },
    });
    created.push({ id: request.id, projectId });

    const org = projectEnvironments[0]?.project.org;
    for (const environment of projectEnvironments) {
      await auditEvent({
        environmentId: environment.id,
        actorType: "system",
        actorId: `enduser:${input.endUser.id}`,
        actorName: "End user",
        action: "end_user.data_request",
        resourceType: "data_request",
        resourceId: request.id,
        outcome: "recorded",
        requestId: input.requestId,
        ip: input.ip ?? null,
        payloadSummary: {
          kind: input.kind,
          status,
          endUser: { id: input.endUser.id, externalUserId: input.endUser.externalUserId },
        },
      }).catch(() => null);
      await dispatchEvent(environment.id, "end_user.data_request", {
        dataRequestId: request.id,
        kind: input.kind,
        status,
        endUserId: input.endUser.id,
        externalUserId: input.endUser.externalUserId,
        requestedAt: request.createdAt.toISOString(),
      }).catch(() => null);
    }

    if (org) {
      const recipients = await db.membership.findMany({
        where: { orgId: org.id, role: { in: ["owner", "admin"] }, status: "active" },
        include: { user: { select: { email: true } } },
      });
      const subject =
        input.kind === "delete"
          ? `Data deletion request from ${input.endUser.email ?? input.endUser.externalUserId}`
          : `Data export completed for ${input.endUser.email ?? input.endUser.externalUserId}`;
      const body =
        input.kind === "delete"
          ? `<p>An end user asked ${org.name} to delete the personal data connected through Authab.</p>
             <p><strong>External user id:</strong> ${input.endUser.externalUserId}</p>
             <p>Open the end-users page in Authab to review and complete the deletion. The user's agent consents are revoked automatically when you process it.</p>`
          : `<p>An end user downloaded a copy of the data ${org.name} holds through Authab.</p>
             <p><strong>External user id:</strong> ${input.endUser.externalUserId}</p>
             <p>No action is needed. This record exists so every export is traceable.</p>`;
      for (const recipient of recipients.slice(0, 10)) {
        if (!recipient.user.email) continue;
        await sendEmail({
          to: recipient.user.email,
          subject,
          html: emailLayout(input.kind === "delete" ? "Data deletion request" : "Data export completed", body),
          text: `${subject}\n\nExternal user id: ${input.endUser.externalUserId}`,
        }).catch(() => null);
      }
    }
  }

  return created;
}

export async function endUserExport(endUser: EndUser) {
  const data = await endUserControlData(endUser);
  // Only the user's own copy is exported: no org-visible secrets, no resource text.
  const events = await db.agentEvent.findMany({
    where: { endUserId: endUser.id },
    orderBy: { occurredAt: "desc" },
    take: 200,
  });
  return {
    object: "end_user_export",
    exportedAt: new Date().toISOString(),
    endUser: {
      externalUserId: endUser.externalUserId,
      email: endUser.email,
      createdAt: endUser.createdAt.toISOString(),
      lastSeenAt: endUser.lastSeenAt?.toISOString() ?? null,
    },
    consents: data.products.flatMap((product) =>
      product.consents.map((consent) => ({
        product: product.productName,
        agent: consent.agentName,
        actions: consent.actions,
        grantedAt: consent.grantedAt.toISOString(),
        expiresAt: consent.expiresAt?.toISOString() ?? null,
        lastUsedAt: consent.lastUsedAt?.toISOString() ?? null,
      })),
    ),
    connections: data.connections.map((connection) => ({
      service: connection.name,
      account: connection.account,
      createdAt: connection.createdAt.toISOString(),
      lastUsedAt: connection.lastUsedAt?.toISOString() ?? null,
    })),
    activity: events.map((event) => ({
      at: event.occurredAt.toISOString(),
      action: humanizeAction(event.action),
      connector: event.connectorSlug,
      decision: event.decision,
      isSandbox: event.isSandbox,
    })),
    dataRequests: data.dataRequests.map((request) => ({
      kind: request.kind,
      status: request.status,
      createdAt: request.createdAt.toISOString(),
      completedAt: request.completedAt?.toISOString() ?? null,
    })),
  };
}

export async function requestEndUserLoginLinks(email: string) {
  const normalized = email.trim().toLowerCase();
  if (!normalized || !normalized.includes("@") || normalized.length > 320) return 0;
  const endUsers = await db.endUser.findMany({
    where: { email: { equals: normalized, mode: "insensitive" }, deletedAt: null },
    take: 5,
  });
  let sent = 0;
  for (const endUser of endUsers) {
    const token = randomToken(32);
    await db.endUserLink.create({
      data: {
        endUserId: endUser.id,
        tokenHash: sha256(token),
        purpose: "control_center",
        expiresAt: new Date(Date.now() + CONTROL_LINK_TTL_MS),
      },
    });
    await sendEmail({
      to: normalized,
      subject: "Your Authab control center link",
      html: emailLayout(
        "Your control center",
        `<p>Use the link below to see every product that can act for you, disconnect accounts, and revoke permissions.</p>
         <p style="margin:24px 0"><a href="${controlCenterUrl(token)}" style="background:#111;color:#fff;padding:12px 20px;text-decoration:none;display:inline-block">Open the control center</a></p>
         <p style="color:#8b8b8b;font-size:12px">This link expires in 15 minutes and can be used once. If you didn't ask for it, ignore this email.</p>`,
      ),
      text: `Open your Authab control center: ${controlCenterUrl(token)} (expires in 15 minutes, single use)`,
    }).catch(() => null);
    sent += 1;
  }
  return sent;
}

export async function revokeEndUserCredential(input: {
  credentialId: string;
  endUserId: string;
  ip?: string | null;
  actor?: { actorType: "human" | "system"; actorId: string; actorName: string };
}) {
  const credential = await db.credential.findFirst({
    where: { id: input.credentialId, endUserId: input.endUserId },
  });
  if (!credential || credential.revokedAt) return null;
  const now = new Date();
  await db.$transaction(async (tx) => {
    await tx.credential.update({
      where: { id: credential.id },
      data: { revokedAt: now, status: "revoked" },
    });
    await tx.grant.updateMany({
      where: { credentialId: credential.id, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      data: { expiresAt: now },
    });
  });
  const actor = input.actor ?? {
    actorType: "system" as const,
    actorId: `enduser:${input.endUserId}`,
    actorName: "End user",
  };
  await auditEvent({
    environmentId: credential.environmentId,
    actorType: actor.actorType,
    actorId: actor.actorId,
    actorName: actor.actorName,
    action: "credential.revoked",
    resourceType: "credential",
    resourceId: credential.id,
    outcome: "recorded",
    ip: input.ip ?? null,
    payloadSummary: {
      connector: credential.connectorSlug,
      by: input.actor ? "dashboard" : "end_user",
      endUserId: input.endUserId,
    },
  }).catch(() => null);
  return credential;
}
