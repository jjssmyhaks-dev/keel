"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, BookOpen, ChevronsUpDown, LogOut, Menu, X } from "lucide-react";
import { Logo } from "@/components/logo";
import { NAV } from "@/components/app/nav";
import { CommandMenu, type CommandSearch } from "@/components/app/command-menu";
import { switchEnvironmentAction, signOutAction } from "@/app/app/actions";

export function AppShell({
  user,
  org,
  role,
  project,
  environments,
  activeEnvironment,
  pendingApprovals,
  unreadNotifications,
  search,
  children,
}: {
  user: { name: string; email: string };
  org: { name: string; slug: string; plan: string };
  role: string;
  project: { name: string };
  environments: { id: string; type: string }[];
  activeEnvironment: { id: string; type: string };
  pendingApprovals: number;
  unreadNotifications: number;
  search: CommandSearch;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const initials = user.name
    .split(/\s+/)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div className="app-theme min-h-screen bg-[#f7f6f3] text-black dark:bg-background dark:text-foreground">
      {open && (
        <button
          aria-label="Close navigation"
          className="fixed inset-0 z-40 bg-black/30 lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[264px] flex-col border-r border-black/10 bg-[#faf9f6] transition-transform dark:border-border dark:bg-card lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-16 items-center justify-between border-b border-black/10 px-5 dark:border-border">
          <Link href="/app" aria-label="Authab dashboard">
            <Logo tone="dark" />
          </Link>
          <button className="lg:hidden" aria-label="Close menu" onClick={() => setOpen(false)}>
            <X className="size-4" />
          </button>
        </div>

        <div className="border-b border-black/10 px-4 py-4 dark:border-border">
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <p className="truncate text-[13px] font-medium">{org.name}</p>
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-black/45 dark:text-muted-foreground">
                {org.plan} plan · {role}
              </p>
            </div>
            <ChevronsUpDown className="size-3.5 shrink-0 text-black/35" />
          </div>
          <div className="mt-3 flex items-center justify-between border border-black/10 bg-white px-2.5 py-2 dark:border-border dark:bg-background">
            <div className="min-w-0">
              <p className="truncate text-[12px]">{project.name}</p>
              <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-black/40 dark:text-muted-foreground">
                {activeEnvironment.type === "production" ? "Production" : "Development"}
              </p>
            </div>
            <form action={switchEnvironmentAction}>
              <select
                name="environmentId"
                defaultValue={activeEnvironment.id}
                onChange={(event) => event.currentTarget.form?.requestSubmit()}
                aria-label="Switch environment"
                className="max-w-[92px] cursor-pointer bg-transparent font-mono text-[9px] uppercase tracking-[0.12em] outline-none"
              >
                {environments.map((env) => (
                  <option key={env.id} value={env.id}>
                    {env.type === "production" ? "prod" : "dev"}
                  </option>
                ))}
              </select>
              <noscript>
                <button type="submit" className="text-[10px] underline">
                  Switch
                </button>
              </noscript>
            </form>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {NAV.map((group) => (
            <div key={group.label} className="mb-5">
              <p className="px-2 pb-1.5 font-mono text-[9px] uppercase tracking-[0.2em] text-black/35 dark:text-muted-foreground">
                {group.label}
              </p>
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const active = isActive(item.href, item.exact);
                  const Icon = item.icon;
                  const badge = item.badge === "approvals" ? pendingApprovals : 0;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setOpen(false)}
                      className={`group flex items-center gap-2.5 border border-transparent px-2 py-[7px] text-[13px] transition-colors ${
                        active
                          ? "border-black/10 bg-white text-black shadow-[0_1px_0_rgba(0,0,0,0.03)] dark:border-border dark:bg-background dark:text-foreground"
                          : "text-black/60 hover:bg-black/[0.04] hover:text-black dark:text-muted-foreground dark:hover:text-foreground"
                      }`}
                    >
                      <Icon className="size-[15px] shrink-0" strokeWidth={1.7} />
                      <span className="flex-1">{item.label}</span>
                      {badge > 0 && (
                        <span className="min-w-5 bg-[#eca8d6] px-1.5 py-0.5 text-center font-mono text-[9px] font-medium text-black">
                          {badge}
                        </span>
                      )}
                      {active && <span className="size-1.5 bg-[#eca8d6]" />}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}

          <Link
            href="/docs"
            className="flex items-center gap-2.5 px-2 py-[7px] text-[13px] text-black/55 hover:text-black dark:text-muted-foreground dark:hover:text-foreground"
          >
            <BookOpen className="size-[15px]" strokeWidth={1.7} />
            Documentation
          </Link>
        </nav>

        <div className="border-t border-black/10 p-3 dark:border-border">
          <div className="flex items-center gap-2.5 px-2 py-2">
            <span className="flex size-7 items-center justify-center rounded-full bg-black text-[10px] font-medium text-white dark:bg-foreground dark:text-background">
              {initials}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12px]">{user.name}</p>
              <p className="truncate font-mono text-[9px] text-black/40 dark:text-muted-foreground">{user.email}</p>
            </div>
            <form action={signOutAction}>
              <button
                type="submit"
                aria-label="Sign out"
                className="p-1 text-black/40 transition-colors hover:text-black dark:text-muted-foreground dark:hover:text-foreground"
              >
                <LogOut className="size-3.5" />
              </button>
            </form>
          </div>
        </div>
      </aside>

      <div className="lg:pl-[264px]">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-black/10 bg-[#f7f6f3]/85 px-4 backdrop-blur-md dark:border-border dark:bg-background/85 lg:px-8">
          <button
            className="lg:hidden"
            aria-label="Open navigation"
            onClick={() => setOpen(true)}
          >
            <Menu className="size-4" />
          </button>
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-black/45 dark:text-muted-foreground">
            <span className="hidden sm:inline">{org.name}</span>
            <span className="hidden sm:inline">/</span>
            <span>{activeEnvironment.type === "production" ? "Production" : "Development"}</span>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <CommandMenu search={search} />
            <Link
              href="/app/notifications"
              className="relative flex items-center gap-1.5 border border-black/10 bg-white px-2.5 py-1.5 text-[11px] transition-colors hover:border-black/25 dark:border-border dark:bg-card"
            >
              <Bell className="size-3.5" strokeWidth={1.7} />
              <span className="hidden sm:inline">Inbox</span>
              {unreadNotifications > 0 && (
                <span className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-[#eca8d6] font-mono text-[9px] text-black">
                  {unreadNotifications}
                </span>
              )}
            </Link>
            <Link
              href="/app/agents/new"
              className="border border-black bg-black px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-white transition-colors hover:bg-[#eca8d6] hover:text-black"
            >
              New agent
            </Link>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1280px] px-4 py-8 lg:px-8 lg:py-10">{children}</main>
      </div>
    </div>
  );
}
