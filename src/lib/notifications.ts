import { db } from "./db";

export async function notify(opts: {
  orgId: string;
  userId?: string | null;
  type: string;
  title: string;
  body: string;
  href?: string;
}) {
  await db.notification.create({
    data: {
      orgId: opts.orgId,
      userId: opts.userId ?? null,
      type: opts.type,
      title: opts.title,
      body: opts.body,
      href: opts.href,
    },
  });
}

export async function notifyApprovers(opts: {
  orgId: string;
  title: string;
  body: string;
  href: string;
  excludeUserId?: string;
}) {
  const approvers = await db.membership.findMany({
    where: { orgId: opts.orgId, role: { in: ["owner", "admin", "approver"] } },
  });
  await db.notification.createMany({
    data: approvers
      .filter((m) => m.userId !== opts.excludeUserId)
      .map((m) => ({
        orgId: opts.orgId,
        userId: m.userId,
        type: "approval",
        title: opts.title,
        body: opts.body,
        href: opts.href,
      })),
  });
}
