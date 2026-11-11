import {
  Activity,
  Blocks,
  Bot,
  Code2,
  CreditCard,
  FlaskConical,
  Gauge,
  Inbox,
  KeyRound,
  LayoutDashboard,
  Link2,
  Lock,
  Play,
  Settings,
  ShieldCheck,
  Siren,
  Users,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
  badge?: string;
  adminOnly?: boolean;
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
      { href: "/app/policy", label: "Policy lab", icon: FlaskConical },
      { href: "/app/activity", label: "Activity", icon: Activity },
    ],
  },
  {
    label: "Build",
    items: [
      { href: "/app/playground", label: "Playground", icon: Play },
      { href: "/app/developers", label: "Developers", icon: Code2 },
      { href: "/app/connectors", label: "Connectors", icon: Blocks },
    ],
  },
  {
    label: "Manage",
    items: [
      { href: "/app/team", label: "Team", icon: Users },
      { href: "/app/billing", label: "Billing", icon: CreditCard },
      { href: "/app/connect", label: "OAuth apps", icon: Link2 },
      { href: "/app/security", label: "Security", icon: Lock },
      { href: "/app/observability", label: "Observability", icon: Gauge },
      { href: "/app/settings", label: "Settings", icon: Settings },
    ],
  },
  {
    label: "Operate",
    items: [
      { href: "/app/admin/status", label: "Status page", icon: Siren, adminOnly: true },
    ],
  },
];
