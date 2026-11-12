"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type DocsNavGroup = {
  label: string;
  links: { name: string; href: string }[];
};

export const DOCS_NAV: DocsNavGroup[] = [
  {
    label: "Getting started",
    links: [
      { name: "Overview", href: "/docs" },
      { name: "Quickstart", href: "/docs/quickstart" },
    ],
  },
  {
    label: "Concepts",
    links: [
      { name: "Agent identity", href: "/docs/concepts/identity" },
      { name: "Identity and revocation", href: "/docs/concepts/agent-identity-and-revocation" },
      { name: "Credential vault", href: "/docs/concepts/vault" },
      { name: "Grants", href: "/docs/concepts/grants" },
      { name: "Policy engine", href: "/docs/concepts/policy" },
      { name: "Approvals", href: "/docs/concepts/approvals" },
      { name: "Audit trail", href: "/docs/concepts/audit" },
      { name: "Agent events", href: "/docs/concepts/agent-events" },
      { name: "Environments", href: "/docs/concepts/environments" },
    ],
  },
  {
    label: "Build",
    links: [
      { name: "API reference", href: "/docs/api" },
      { name: "SDKs and integrations", href: "/docs/sdk" },
      { name: "CLI", href: "/docs/cli" },
      { name: "MCP server and gateway", href: "/docs/mcp" },
    ],
  },
  {
    label: "Integrations",
    links: [{ name: "Connectors", href: "/docs/connectors" }],
  },
];

export function DocsSidebar() {
  const pathname = usePathname();
  return (
    <nav aria-label="Docs" className="space-y-8">
      {DOCS_NAV.map((group) => (
        <div key={group.label}>
          <p className="mono-label text-foreground/60 mb-3">{group.label}</p>
          <ul className="space-y-0.5 border-l border-foreground/10">
            {group.links.map((link) => {
              const active =
                link.href === "/docs"
                  ? pathname === "/docs"
                  : pathname === link.href || pathname.startsWith(`${link.href}/`);
              return (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    aria-current={active ? "page" : undefined}
                    className={`block -ml-px border-l py-1.5 pl-4 text-[13px] transition-colors ${
                      active
                        ? "border-foreground text-foreground font-medium"
                        : "border-transparent text-foreground/65 hover:text-foreground hover:border-foreground/30"
                    }`}
                  >
                    {link.name}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function DocsMobileNav() {
  const pathname = usePathname();
  const active = DOCS_NAV.flatMap((group) => group.links).find((link) =>
    link.href === "/docs" ? pathname === "/docs" : pathname.startsWith(link.href),
  );
  return (
    <details className="lg:hidden mb-10 border border-foreground/12 bg-foreground/[0.02]">
      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3">
        <span className="mono-label text-foreground/60">Docs menu</span>
        <span className="text-[12px]">{active?.name ?? "Overview"}</span>
      </summary>
      <div className="grid gap-6 border-t border-foreground/10 p-4 sm:grid-cols-2">
        {DOCS_NAV.map((group) => (
          <div key={group.label}>
            <p className="mono-label text-foreground/60 mb-2">{group.label}</p>
            <ul className="space-y-1.5">
              {group.links.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    aria-current={active?.href === link.href ? "page" : undefined}
                    className="text-[13px] text-foreground/65 hover:text-foreground"
                  >
                    {link.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </details>
  );
}
