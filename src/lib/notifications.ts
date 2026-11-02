import { db } from "./db";

export async function notify(opts: {
  orgId: string;
  userId?: string | null;
  type: string;
  title: string;
  body: string;
  href?: string;
}) {
  const base = {
    orgId: opts.orgId,
    type: opts.type,
    title: opts.title,
    body: opts.body,
    href: opts.href,
  };
  if (opts.userId) {
    await db.notification.create({ data: { ...base, userId: opts.userId } });
    return;
  }
  const members = await db.membership.findMany({
    where: { orgId: opts.orgId },
    select: { userId: true },
  });
  if (!members.length) {
    await db.notification.create({ data: { ...base, userId: null } });
    return;
  }
  await db.notification.createMany({
    data: members.map((member) => ({ ...base, userId: member.userId })),
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
