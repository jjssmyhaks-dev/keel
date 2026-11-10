import {
  Activity,
  Bot,
  Code2,
  CreditCard,
  Inbox,
  KeyRound,
  LayoutDashboard,
  Lock,
  Settings,
  ShieldCheck,
  Users,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
  badge?: string;
};

export type NavGroup = {
  label: string;
  items: NavItem[];
};

export const NAV: NavGroup[] = [
  {
    label: "Workspace",
    items: [
      { href: "/app", label: "Overview", icon: LayoutDashboard, exact: true },
      { href: "/app/agents", label: "Agents", icon: Bot },
      { href: "/app/vault", label: "Vault", icon: KeyRound },
      { href: "/app/permissions", label: "Permissions", icon: ShieldCheck },
      { href: "/app/approvals", label: "Approvals", icon: Inbox, badge: "approvals" },
      { href: "/app/activity", label: "Activity", icon: Activity },
    ],
  },
  {
    label: "Build",
    items: [{ href: "/app/developers", label: "Developers", icon: Code2 }],
  },
  {
    label: "Manage",
    items: [
      { href: "/app/team", label: "Team", icon: Users },
      { href: "/app/billing", label: "Billing", icon: CreditCard },
      { href: "/app/security", label: "Security", icon: Lock },
      { href: "/app/settings", label: "Settings", icon: Settings },
    ],
  },
];
