"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bell,
  BookOpen,
  Bot,
  Code2,
  Inbox,
  KeyRound,
  Plus,
  Search,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { NAV } from "@/components/app/nav";

export type CommandSearch = {
  agents: { id: string; name: string; status: string }[];
  credentials: { id: string; name: string; connector: string }[];
  approvals: { id: string; label: string }[];
};

const PAGES: { href: string; label: string; icon: LucideIcon }[] = [
  ...NAV.flatMap((group) => group.items.map((item) => ({ href: item.href, label: item.label, icon: item.icon }))),
  { href: "/app/notifications", label: "Notifications", icon: Bell },
  { href: "/docs", label: "Documentation", icon: BookOpen },
];

const ACTIONS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/app/agents/new", label: "New agent", icon: Plus },
  { href: "/app/vault/new", label: "New connection", icon: KeyRound },
  { href: "/app/team", label: "Invite teammate", icon: UserPlus },
  { href: "/app/developers", label: "API keys and tokens", icon: Code2 },
];

const ITEM = "rounded-none px-2 py-2 text-[13px] data-[selected=true]:bg-black/[0.06] dark:data-[selected=true]:bg-white/10";

function filterItems(value: string, search: string) {
  const needle = search.trim().toLowerCase();
  if (!needle) return 1;
  const haystack = value.toLowerCase();
  if (haystack.includes(needle)) return 1;
  return needle.split(/\s+/).every((token) => haystack.includes(token)) ? 0.5 : 0;
}

export function CommandMenu({ search }: { search: CommandSearch }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [shortcut, setShortcut] = useState("Ctrl K");

  useEffect(() => {
    if (/Mac|iPhone|iPad|iPod/.test(navigator.platform)) setShortcut("⌘ K");
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Search (Control K)"
        aria-keyshortcuts="Control+K Meta+K"
        className="flex items-center gap-2 border border-black/10 bg-white px-2.5 py-1.5 text-[11px] text-black/55 transition-colors hover:border-black/25 hover:text-black dark:border-border dark:bg-card dark:text-muted-foreground dark:hover:text-foreground"
      >
        <Search className="size-3.5" strokeWidth={1.7} />
        <span className="hidden sm:inline">Search</span>
        <Kbd className="hidden border border-black/10 bg-[#f0efeb] font-mono text-[9px] text-black/45 sm:inline-flex dark:border-border dark:bg-background dark:text-muted-foreground">
          {shortcut}
        </Kbd>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          showCloseButton={false}
          className="top-[12%] translate-y-0 gap-0 rounded-none border-black/15 bg-[#faf9f6] p-0 shadow-[0_24px_80px_rgba(0,0,0,0.18)] sm:top-[16%] sm:max-w-[560px] dark:border-border dark:bg-card"
        >
          <DialogHeader className="sr-only">
            <DialogTitle>Search Keel</DialogTitle>
            <DialogDescription>Jump to a page, agent, connection or approval.</DialogDescription>
          </DialogHeader>
          <Command filter={filterItems} className="bg-transparent [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-[9px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.18em] [&_[cmdk-group-heading]]:text-black/40 dark:[&_[cmdk-group-heading]]:text-muted-foreground [&_[data-slot=command-input-wrapper]]:h-12 [&_[data-slot=command-input-wrapper]]:border-black/10 dark:[&_[data-slot=command-input-wrapper]]:border-border">
          <CommandInput placeholder="Search pages, agents, connections…" className="h-12 text-[14px]" />
          <CommandList className="max-h-[min(380px,calc(100dvh-260px))] px-2 py-2">
            <CommandEmpty className="py-8 text-[13px] text-black/50 dark:text-muted-foreground">
              No matches. Try an agent, connection or page name.
            </CommandEmpty>

            <CommandGroup heading="Pages">
              {PAGES.map((page) => (
                <CommandItem
                  key={page.href}
                  value={page.label}
                  onSelect={() => go(page.href)}
                  className={ITEM}
                >
                  <page.icon className="size-[15px]" strokeWidth={1.7} />
                  <span>{page.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>

            <CommandGroup heading="Actions">
              {ACTIONS.map((action) => (
                <CommandItem
                  key={action.href}
                  value={action.label}
                  onSelect={() => go(action.href)}
                  className={ITEM}
                >
                  <action.icon className="size-[15px]" strokeWidth={1.7} />
                  <span>{action.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>

            {search.agents.length > 0 && (
              <CommandGroup heading="Agents">
                {search.agents.map((agent) => (
                  <CommandItem
                    key={agent.id}
                    value={`${agent.name} agent ${agent.id}`}
                    onSelect={() => go(`/app/agents/${agent.id}`)}
                    className={ITEM}
                  >
                    <Bot className="size-[15px]" strokeWidth={1.7} />
                    <span className="truncate">{agent.name}</span>
                    <CommandShortcut className="font-mono text-[9px] uppercase tracking-[0.12em]">
                      {agent.status}
                    </CommandShortcut>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {search.credentials.length > 0 && (
              <CommandGroup heading="Connections">
                {search.credentials.map((credential) => (
                  <CommandItem
                    key={credential.id}
                    value={`${credential.name} connection ${credential.connector} ${credential.id}`}
                    onSelect={() => go(`/app/vault/${credential.id}`)}
                    className={ITEM}
                  >
                    <KeyRound className="size-[15px]" strokeWidth={1.7} />
                    <span className="truncate">{credential.name}</span>
                    <CommandShortcut className="font-mono text-[9px] uppercase tracking-[0.12em]">
                      {credential.connector}
                    </CommandShortcut>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {search.approvals.length > 0 && (
              <CommandGroup heading="Pending approvals">
                {search.approvals.map((approval) => (
                  <CommandItem
                    key={approval.id}
                    value={`${approval.label} approval ${approval.id}`}
                    onSelect={() => go(`/app/approvals/${approval.id}`)}
                    className={ITEM}
                  >
                    <Inbox className="size-[15px]" strokeWidth={1.7} />
                    <span className="truncate">{approval.label}</span>
                    <CommandShortcut className="font-mono text-[9px] uppercase tracking-[0.12em]">
                      Review
                    </CommandShortcut>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>

          <div className="flex items-center justify-between border-t border-black/10 px-3 py-2 font-mono text-[9px] uppercase tracking-[0.14em] text-black/35 dark:border-border dark:text-muted-foreground">
            <span>↑↓ navigate · ↵ open</span>
            <span>esc close</span>
          </div>
        </Command>
        </DialogContent>
      </Dialog>
    </>
  );
}
