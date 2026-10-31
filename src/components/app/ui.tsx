import Link from "next/link";
import type { Risk } from "@/lib/connectors";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-black/10 pb-6 dark:border-border">
      <div className="max-w-2xl">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-black/40 dark:text-muted-foreground">{eyebrow}</p>
        <h1 className="mt-2 font-display text-[clamp(2rem,3.4vw,2.9rem)] leading-[1.02] tracking-tight">{title}</h1>
        {description ? (
          <p className="mt-2 text-[13px] leading-relaxed text-black/55 dark:text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Stat({
  label,
  value,
  detail,
  accent,
}: {
  label: string;
  value: React.ReactNode;
  detail?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`border border-black/10 p-4 dark:border-border ${
        accent ? "bg-black text-white dark:bg-foreground dark:text-background" : "bg-white dark:bg-card"
      }`}
    >
      <p className={`font-mono text-[9px] uppercase tracking-[0.2em] ${accent ? "text-white/55" : "text-black/40 dark:text-muted-foreground"}`}>
        {label}
      </p>
      <p className="mt-2 font-display text-3xl leading-none tracking-tight">{value}</p>
      {detail ? (
        <p className={`mt-1.5 text-[11px] ${accent ? "text-white/55" : "text-black/45 dark:text-muted-foreground"}`}>{detail}</p>
      ) : null}
    </div>
  );
}

const STATUS_STYLE: Record<string, { dot: string; label: string }> = {
  active: { dot: "bg-[#2f7d5c]", label: "Active" },
  paused: { dot: "bg-[#a56b18]", label: "Paused" },
  suspended: { dot: "bg-[#b3402f]", label: "Suspended" },
  revoked: { dot: "bg-black/30", label: "Revoked" },
  healthy: { dot: "bg-[#2f7d5c]", label: "Healthy" },
  broken: { dot: "bg-[#b3402f]", label: "Broken" },
  expiring: { dot: "bg-[#a56b18]", label: "Expiring" },
  pending: { dot: "bg-[#a56b18]", label: "Pending" },
  approved: { dot: "bg-[#2f7d5c]", label: "Approved" },
  denied: { dot: "bg-[#b3402f]", label: "Denied" },
  expired: { dot: "bg-black/30", label: "Expired" },
  failed: { dot: "bg-[#b3402f]", label: "Failed" },
  allowed: { dot: "bg-[#2f7d5c]", label: "Allowed" },
  error: { dot: "bg-[#b3402f]", label: "Error" },
  recorded: { dot: "bg-black/40", label: "Recorded" },
};

export function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLE[status] ?? { dot: "bg-black/30", label: status };
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-black/60 dark:text-muted-foreground">
      <span className={`size-1.5 rounded-full ${style.dot}`} />
      {style.label}
    </span>
  );
}

const RISK_STYLE: Record<Risk, string> = {
  read: "border-[#2f7d5c]/30 text-[#2f7d5c]",
  write: "border-[#a56b18]/35 text-[#a56b18]",
  destructive: "border-[#b3402f]/35 text-[#b3402f]",
  financial: "border-[#7a3db8]/35 text-[#7a3db8]",
};

export function RiskBadge({ risk }: { risk: string }) {
  const key = (["read", "write", "destructive", "financial"].includes(risk) ? risk : "write") as Risk;
  return (
    <span className={`border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] ${RISK_STYLE[key]}`}>
      {key}
    </span>
  );
}

export function Panel({
  title,
  hint,
  actions,
  children,
  className = "",
  bodyClassName = "p-5",
}: {
  title?: string;
  hint?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={`border border-black/10 bg-white dark:border-border dark:bg-card ${className}`}>
      {title ? (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-black/10 px-4 py-3 dark:border-border">
          <div>
            <h2 className="text-[13px] font-medium">{title}</h2>
            {hint ? <p className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-black/40 dark:text-muted-foreground">{hint}</p> : null}
          </div>
          {actions}
        </header>
      ) : null}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center border border-dashed border-black/15 px-6 py-14 text-center dark:border-border">
      <div className="flex size-9 items-center justify-center border border-black/15 font-mono text-xs text-black/40 dark:border-border">
        ✳
      </div>
      <p className="mt-4 font-display text-xl tracking-tight">{title}</p>
      <p className="mt-1 max-w-sm text-[12px] leading-relaxed text-black/50 dark:text-muted-foreground">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function TabLinks({
  items,
  current,
}: {
  items: { href: string; label: string; count?: number }[];
  current: string;
}) {
  return (
    <div className="flex flex-wrap gap-1 border-b border-black/10 pb-2 dark:border-border">
      {items.map((item) => {
        const active = item.href === current;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`border px-2.5 py-1 text-[11px] transition-colors ${
              active
                ? "border-black bg-black text-white dark:border-foreground dark:bg-foreground dark:text-background"
                : "border-transparent text-black/55 hover:border-black/15 hover:text-black dark:text-muted-foreground dark:hover:text-foreground"
            }`}
          >
            {item.label}
            {typeof item.count === "number" ? <span className="ml-1.5 opacity-60">{item.count}</span> : null}
          </Link>
        );
      })}
    </div>
  );
}

export function Notice({ kind, children }: { kind: "ok" | "error"; children: React.ReactNode }) {
  return (
    <div
      className={`mb-6 border px-3 py-2 text-[12px] ${
        kind === "ok"
          ? "border-[#2f7d5c]/30 bg-[#2f7d5c]/[0.06] text-[#245f47]"
          : "border-[#b3402f]/30 bg-[#b3402f]/[0.06] text-[#8c3225]"
      }`}
    >
      {children}
    </div>
  );
}

export function relativeTime(input: Date | string | null) {
  if (!input) return "—";
  const date = typeof input === "string" ? new Date(input) : input;
  const diff = Date.now() - date.getTime();
  const future = diff < 0;
  const abs = Math.abs(diff);
  const minutes = Math.round(abs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return future ? `in ${minutes}m` : `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return future ? `in ${hours}h` : `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return future ? `in ${days}d` : `${days}d ago`;
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export function formatDate(input: Date | string | null) {
  if (!input) return "—";
  const date = typeof input === "string" ? new Date(input) : input;
  return date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}
