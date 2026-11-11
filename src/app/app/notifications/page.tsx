import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { getContext } from "@/lib/session";
import { markNotificationsReadAction } from "@/app/app/actions";
import { PageHeader, Panel, EmptyState, relativeTime } from "@/components/app/ui";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Notifications" };

const TYPE_LABEL: Record<string, string> = {
  approval: "Approval",
  system: "System",
  security: "Security",
  billing: "Billing",
  usage: "Usage",
};

export default async function NotificationsPage() {
  const ctx = await getContext();

  const notifications = await db.notification.findMany({
    where: { orgId: ctx.org.id, OR: [{ userId: ctx.user.id }, { userId: null }] },
    orderBy: { createdAt: "desc" },
    take: 60,
  });

  const unread = notifications.filter((notification) => !notification.readAt).length;

  return (
    <div>
      <PageHeader
        eyebrow="Inbox · notifications"
        title="What needs your eyes."
        description="Approval requests, launch changes and security signals. Everything here also exists in the audit trail."
        actions={
          unread ? (
            <form action={markNotificationsReadAction}>
              <input type="hidden" name="back" value="/app/notifications" />
              <button className="border border-black bg-black px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-white hover:bg-[#eca8d6] hover:text-black">
                Mark all read
              </button>
            </form>
          ) : (
            <Link href="/app/approvals" className="border border-black/45 bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] hover:border-black dark:border-white/40 dark:bg-card">
              Approvals
            </Link>
          )
        }
      />

      {notifications.length ? (
        <Panel bodyClassName="p-0">
          <div className="divide-y divide-black/10 dark:divide-border">
            {notifications.map((notification) => (
              <Link
                key={notification.id}
                href={notification.href ?? "/app"}
                className={`flex items-start gap-3 px-4 py-3 transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.02] ${
                  notification.readAt ? "" : "bg-[#eca8d6]/[0.06]"
                }`}
              >
                <span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${notification.readAt ? "bg-black/15 dark:bg-white/20" : "bg-[#eca8d6]"}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="border border-black/10 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.1em] text-black/60 dark:border-border dark:text-muted-foreground">
                      {TYPE_LABEL[notification.type] ?? notification.type}
                    </span>
                    <p className="text-[12px] font-medium">{notification.title}</p>
                  </div>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-black/65 dark:text-muted-foreground">{notification.body}</p>
                </div>
                <span className="shrink-0 font-mono text-[9px] text-black/60 dark:text-muted-foreground">
                  {relativeTime(notification.createdAt)}
                </span>
              </Link>
            ))}
          </div>
        </Panel>
      ) : (
        <Panel bodyClassName="p-0">
          <EmptyState
            title="Nothing new"
            description="Approval requests and launch events will land here. You can also read the raw trail in Activity."
            action={
              <Link href="/app/activity" className="border border-black bg-black px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-white">
                Open activity
              </Link>
            }
          />
        </Panel>
      )}
    </div>
  );
}
