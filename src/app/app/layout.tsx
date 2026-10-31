import { db } from "@/lib/db";
import { getContext } from "@/lib/session";
import { AppShell } from "@/components/app/app-shell";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getContext();
  const [pendingApprovals, unreadNotifications] = await Promise.all([
    db.approvalRequest.count({ where: { environmentId: ctx.environment.id, status: "pending", expiresAt: { gt: new Date() } } }),
    db.notification.count({ where: { orgId: ctx.org.id, userId: ctx.user.id, readAt: null } }),
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
    >
      {children}
    </AppShell>
  );
}
