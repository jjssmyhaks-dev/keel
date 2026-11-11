import type { Metadata } from "next";
import { db } from "@/lib/db";
import { getContext } from "@/lib/session";
import { AppShell } from "@/components/app/app-shell";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "Dashboard", template: "%s · Authab" },
  robots: { index: false, follow: false },
};

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getContext();
  const now = new Date();
  const [pendingApprovals, unreadNotifications, agents, credentials, approvals] = await Promise.all([
    db.approvalRequest.count({
      where: { environmentId: ctx.environment.id, status: "pending", expiresAt: { gt: now } },
    }),
    db.notification.count({
      where: { orgId: ctx.org.id, readAt: null, OR: [{ userId: ctx.user.id }, { userId: null }] },
    }),
    db.agent.findMany({
      where: { environmentId: ctx.environment.id },
      orderBy: { name: "asc" },
      take: 100,
      select: { id: true, name: true, status: true },
    }),
    db.credential.findMany({
      where: { environmentId: ctx.environment.id },
      orderBy: { name: "asc" },
      take: 100,
      select: { id: true, name: true, connectorSlug: true },
    }),
    db.approvalRequest.findMany({
      where: { environmentId: ctx.environment.id, status: "pending", expiresAt: { gt: now } },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, action: true, agent: { select: { name: true } } },
    }),
  ]);

  return (
    <AppShell
      user={{ name: ctx.user.name, email: ctx.user.email }}
      org={{ name: ctx.org.name, slug: ctx.org.slug, plan: ctx.org.plan }}
      role={ctx.role}
      project={{ name: ctx.project.name }}
      environments={ctx.environments.map((env) => ({ id: env.id, type: env.type }))}
      activeEnvironment={{ id: ctx.environment.id, type: ctx.environment.type }}
      pendingApprovals={pendingApprovals}
      unreadNotifications={unreadNotifications}
      search={{
        agents,
        credentials: credentials.map((credential) => ({
          id: credential.id,
          name: credential.name,
          connector: credential.connectorSlug,
        })),
        approvals: approvals.map((approval) => ({
          id: approval.id,
          label: `${approval.agent.name} · ${approval.action}`,
        })),
      }}
    >
      {children}
    </AppShell>
  );
}
