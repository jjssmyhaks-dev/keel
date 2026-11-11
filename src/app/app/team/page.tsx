import type { Metadata } from "next";
import { db } from "@/lib/db";
import { getContext, ROLE_META, ROLES, GRANTABLE_CAPABILITIES, parseGrants } from "@/lib/session";
import { inviteMemberAction, changeRoleAction, changePermissionsAction, removeMemberAction, cancelInvitationAction } from "@/app/app/actions";
import { ConfirmButton } from "@/components/app/confirm-button";
import { PageHeader, Panel, Stat, Notice, EmptyState, relativeTime, formatDate } from "@/components/app/ui";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Team" };

export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await getContext();
  const query = await searchParams;

  const [memberships, invitations] = await Promise.all([
    db.membership.findMany({
      where: { orgId: ctx.org.id },
      include: { user: { select: { id: true, name: true, email: true, emailVerifiedAt: true } } },
      orderBy: { createdAt: "asc" },
    }),
    db.invitation.findMany({
      where: { orgId: ctx.org.id, acceptedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const canManage = ctx.capabilities.manageTeam;
  const owners = memberships.filter((membership) => membership.role === "owner").length;
  const pendingInvites = invitations.length;

  return (
    <div>
      <PageHeader
        eyebrow="Team · organization"
        title="People, with narrow keys."
        description="Roles decide what a person can do before environment rules apply. Production writes stay with owners and admins."
        actions={
          canManage ? (
            <a href="#invite" className="border border-black bg-black px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-white hover:bg-[#eca8d6] hover:text-black">
              Invite member
            </a>
          ) : undefined
        }
      />

      {query.error ? (
        <Notice kind="error">
          {query.error === "permission"
            ? "Only owners and admins can manage the team."
            : query.error === "email"
              ? "Enter a valid email address."
              : query.error === "already_member"
                ? "That person is already in this organization."
                : query.error === "limit"
                  ? "This plan's member limit is reached. Upgrade the workspace in Billing to invite more people."
                  : query.error === "self"
                  ? "You cannot remove yourself."
                  : query.error === "owner"
                    ? "Owners cannot be removed. Transfer ownership first."
                    : query.error === "last_owner"
                      ? "An organization needs at least one owner. Promote someone else first."
                      : "That change could not be saved."}
        </Notice>
      ) : null}
      {query.invited ? (
        query.delivery ? (
          <Notice kind="error">
            Invitation recorded for {query.invited}, but email delivery is not configured. Share this link directly:{" "}
            <a href={query.link} className="underline underline-offset-2">
              {query.link}
            </a>{" "}
            — it expires in 7 days.
          </Notice>
        ) : (
          <Notice kind="ok">Invitation sent to {query.invited}. The link expires in 7 days.</Notice>
        )
      ) : null}
      {query.saved ? <Notice kind="ok">Role updated.</Notice> : null}
      {query.permissions_saved ? <Notice kind="ok">Permissions updated. They apply on the member&apos;s next request.</Notice> : null}
      {query.removed ? <Notice kind="ok">Member removed from the organization.</Notice> : null}
      {query.cancelled ? <Notice kind="ok">Invitation cancelled.</Notice> : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Members" value={memberships.length} detail={`${owners} owner${owners === 1 ? "" : "s"}`} accent />
        <Stat label="Pending invites" value={pendingInvites} detail={pendingInvites ? "Waiting to accept" : "None outstanding"} />
        <Stat label="Roles in use" value={new Set(memberships.map((membership) => membership.role)).size} detail="Owner, admin, developer…" />
        <Stat label="Your role" value={ctx.role} detail={ROLE_META[ctx.role].label} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-6">
          <Panel title="Members" hint={`${ctx.org.name}`} bodyClassName="p-0">
            <div className="divide-y divide-black/10 dark:divide-border">
              {memberships.map((membership) => (
                <div key={membership.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <span className="flex size-8 items-center justify-center rounded-full bg-black font-mono text-[10px] text-white dark:bg-foreground dark:text-background">
                    {membership.user.name
                      .split(/\s+/)
                      .map((part) => part[0])
                      .slice(0, 2)
                      .join("")
                      .toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-medium">
                      {membership.user.name}
                      {membership.user.id === ctx.user.id ? <span className="ml-1.5 font-mono text-[9px] text-black/60 dark:text-muted-foreground">(you)</span> : null}
                    </p>
                    <p className="truncate font-mono text-[9px] text-black/60 dark:text-muted-foreground">{membership.user.email}</p>
                  </div>
                  {membership.user.emailVerifiedAt ? (
                    <span className="font-mono text-[8px] uppercase tracking-[0.1em] text-[#276a4e] dark:text-[#7fd1ab]">verified</span>
                  ) : (
                    <span className="font-mono text-[8px] uppercase tracking-[0.1em] text-[#8c5a12] dark:text-[#e8b26a]">unverified</span>
                  )}
                  {membership.status !== "active" ? (
                    <span className="border border-[#8c5a12]/30 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.1em] text-[#8c5a12] dark:text-[#e8b26a]">
                      suspended
                    </span>
                  ) : null}
                  <span className="hidden font-mono text-[9px] text-black/60 dark:text-muted-foreground sm:block">
                    joined {formatDate(membership.createdAt)}
                  </span>
                  {canManage ? (
                    <div className="flex items-center gap-1.5">
                      <form action={changeRoleAction} className="flex items-center gap-1">
                        <input type="hidden" name="userId" value={membership.user.id} />
                        <select
                          name="role"
                          defaultValue={membership.role}
                          disabled={membership.role === "owner" && ctx.role !== "owner"}
                          className="border border-black/45 bg-white px-1.5 py-1 font-mono text-[9px] uppercase tracking-[0.08em] outline-none dark:border-white/40 dark:bg-card"
                        >
                          {ROLES.map((role) => (
                            <option key={role} value={role}>
                              {role}
                            </option>
                          ))}
                        </select>
                        <button className="border border-black/45 px-1.5 py-1 font-mono text-[9px] uppercase tracking-[0.08em] hover:border-black dark:border-white/40">
                          Save
                        </button>
                      </form>
                      {membership.role !== "owner" && membership.user.id !== ctx.user.id ? (
                        <form action={removeMemberAction}>
                          <input type="hidden" name="userId" value={membership.user.id} />
                          <ConfirmButton
                            message={`Remove ${membership.user.name} from ${ctx.org.name}? Their sessions stay valid for other organizations.`}
                            className="px-1 font-mono text-[9px] text-[#8c3225] dark:text-[#f0a396] underline-offset-2 hover:underline"
                          >
                            Remove
                          </ConfirmButton>
                        </form>
                      ) : null}
                    </div>
                  ) : (
                    <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-black/60 dark:text-muted-foreground">{membership.role}</span>
                  )}
                  {canManage && membership.role !== "owner" ? (
                    <details className="w-full">
                      <summary className="cursor-pointer font-mono text-[9px] uppercase tracking-[0.1em] text-black/60 hover:text-black dark:text-muted-foreground dark:hover:text-foreground">
                        Extra permissions ({parseGrants(membership.permissionsJson).length})
                      </summary>
                      <form
                        action={changePermissionsAction}
                        className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 border border-black/10 bg-[#faf9f6] p-2.5 dark:border-border dark:bg-background"
                      >
                        <input type="hidden" name="userId" value={membership.user.id} />
                        {GRANTABLE_CAPABILITIES.map((capability) => (
                          <label
                            key={capability}
                            className="flex items-center gap-1.5 font-mono text-[9px] text-black/60 dark:text-muted-foreground"
                          >
                            <input
                              type="checkbox"
                              name="permissions"
                              value={capability}
                              defaultChecked={parseGrants(membership.permissionsJson).includes(capability)}
                              className="size-3.5 accent-black"
                            />
                            {capability.replace(/_/g, " ")}
                          </label>
                        ))}
                        <button className="border border-black/45 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.08em] hover:border-black dark:border-white/40">
                          Save permissions
                        </button>
                      </form>
                    </details>
                  ) : null}
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Pending invitations" hint="Expire after 7 days" bodyClassName="p-0">
            {invitations.length ? (
              <div className="divide-y divide-black/10 dark:divide-border">
                {invitations.map((invitation) => (
                  <div key={invitation.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12px]">{invitation.email}</p>
                      <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-black/60 dark:text-muted-foreground">
                        {invitation.role} · sent {relativeTime(invitation.createdAt)} · expires {formatDate(invitation.expiresAt)}
                      </p>
                    </div>
                    {canManage ? (
                      <form action={cancelInvitationAction}>
                        <input type="hidden" name="invitationId" value={invitation.id} />
                        <button className="font-mono text-[9px] uppercase tracking-[0.1em] text-[#8c3225] dark:text-[#f0a396] underline-offset-2 hover:underline">
                          Cancel
                        </button>
                      </form>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <p className="px-4 py-5 text-[11px] text-black/60 dark:text-muted-foreground">No open invitations.</p>
            )}
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel title="Invite" hint="Email link, 7-day expiry" bodyClassName="p-4">
            {canManage ? (
              <form action={inviteMemberAction} className="space-y-3" id="invite">
                <div>
                  <label htmlFor="email" className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/60 dark:text-muted-foreground">
                    Email
                  </label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    required
                    placeholder="teammate@company.com"
                    className="mt-1 w-full border border-black/45 bg-[#faf9f6] px-2.5 py-2 text-[12px] outline-none focus:border-black dark:border-white/40 dark:bg-background"
                  />
                </div>
                <div>
                  <label htmlFor="role" className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/60 dark:text-muted-foreground">
                    Role
                  </label>
                  <select
                    id="role"
                    name="role"
                    defaultValue="developer"
                    className="mt-1 w-full border border-black/45 bg-[#faf9f6] px-2.5 py-2 text-[12px] outline-none focus:border-black dark:border-white/40 dark:bg-background"
                  >
                    {["admin", "developer", "approver", "auditor", "billing", "viewer"].map((role) => (
                      <option key={role} value={role}>
                        {ROLE_META[role as keyof typeof ROLE_META].label} — {ROLE_META[role as keyof typeof ROLE_META].description}
                      </option>
                    ))}
                  </select>
                </div>
                <button className="w-full border border-black bg-black px-2 py-2 font-mono text-[9px] uppercase tracking-[0.14em] text-white hover:bg-[#eca8d6] hover:text-black">
                  Send invitation
                </button>
              </form>
            ) : (
              <p className="text-[12px] leading-relaxed text-black/60 dark:text-muted-foreground">
                Only owners and admins can invite people. Ask an admin if you need access for someone.
              </p>
            )}
          </Panel>

          <Panel title="Roles" hint="Capabilities before environment rules" bodyClassName="p-0">
            <div className="divide-y divide-black/10 dark:divide-border">
              {ROLES.map((role) => (
                <div key={role} className="px-4 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[12px] font-medium">{ROLE_META[role].label}</p>
                    {role === ctx.role ? (
                      <span className="border border-black/10 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.1em] text-black/60 dark:border-border dark:text-muted-foreground">
                        you
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-black/60 dark:text-muted-foreground">{ROLE_META[role].description}</p>
                </div>
              ))}
            </div>
          </Panel>

          {memberships.length === 1 ? (
            <Panel title="Bus factor" hint="One more owner, please" bodyClassName="p-4">
              <EmptyState
                title="You are the only member"
                description="Add a second owner or admin so production access survives a busy week."
              />
            </Panel>
          ) : null}
        </div>
      </div>
    </div>
  );
}
