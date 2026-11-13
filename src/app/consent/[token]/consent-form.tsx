"use client";

import { useMemo, useState } from "react";
import { DURATION_LABELS, type ConsentDuration } from "@/lib/consent-shared";
import { RISK_META } from "@/lib/connectors";
import type { Risk } from "@/lib/connectors";

type Group = {
  risk: string;
  defaultOn: boolean;
  actions: { name: string; label: string; description: string; connector: string; connectorName: string }[];
};

export function ConsentForm({
  token,
  csrf,
  groups,
  connectors,
  durationOptions,
  primaryColor,
}: {
  token: string;
  csrf: string;
  groups: Group[];
  connectors: { slug: string; name: string; connected: boolean; account: string | null }[];
  durationOptions: ConsentDuration[];
  primaryColor: string;
}) {
  const [selected, setSelected] = useState<string[]>(groups.filter((group) => group.defaultOn).map((group) => group.risk));
  const [duration, setDuration] = useState<ConsentDuration>(durationOptions[0] ?? "session");
  const missing = connectors.filter((entry) => !entry.connected);
  const ready = selected.length > 0 && missing.length === 0;

  const toggle = (risk: string) => {
    setSelected((current) => (current.includes(risk) ? current.filter((entry) => entry !== risk) : [...current, risk]));
  };

  const selectedActions = useMemo(
    () =>
      groups
        .filter((group) => selected.includes(group.risk))
        .flatMap((group) => group.actions.map((action) => `${action.connectorName}: ${action.label}`)),
    [groups, selected],
  );

  return (
    <form method="POST" action={`/consent/${encodeURIComponent(token)}/decision`} className="mt-10 grid gap-8">
      <input type="hidden" name="csrf" value={csrf} />
      <input type="hidden" name="token" value={token} />

      {connectors.length ? (
        <section className="border border-black/15 bg-white p-6">
          <h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">1 · Connect your accounts</h2>
          <ul className="mt-4 divide-y divide-black/10">
            {connectors.map((entry) => (
              <li key={entry.slug} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="text-sm font-medium">{entry.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {entry.connected ? `Connected${entry.account ? ` · ${entry.account}` : ""}` : "Not connected yet"}
                  </p>
                </div>
                {entry.connected ? (
                  <span className="border border-black/15 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                    Connected
                  </span>
                ) : (
                  <a
                    href={`/consent/${encodeURIComponent(token)}/connect/${encodeURIComponent(entry.slug)}`}
                    className="border border-black bg-black px-4 py-2 text-xs font-mono uppercase tracking-[0.18em] text-white"
                  >
                    Connect
                  </a>
                )}
              </li>
            ))}
          </ul>
          {missing.length ? (
            <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
              Connect every account above before approving. Connecting only authorizes the account with its provider — nothing is
              shared with the product until you approve below.
            </p>
          ) : null}
        </section>
      ) : null}

      <section className="border border-black/15 bg-white p-6">
        <h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          {connectors.length ? "2 · Choose what the product may do" : "Choose what the product may do"}
        </h2>
        <ul className="mt-4 space-y-3">
          {groups.map((group) => {
            const meta = RISK_META[group.risk as Risk] ?? RISK_META.write;
            const checked = selected.includes(group.risk);
            return (
              <li key={group.risk} className="border border-black/10 p-4" style={checked ? { borderColor: `${meta.color}66` } : undefined}>
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    name="risks"
                    value={group.risk}
                    checked={checked}
                    onChange={() => toggle(group.risk)}
                    className="mt-1 size-3.5 shrink-0 accent-black"
                  />
                  <span>
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{meta.label} actions</span>
                      <span
                        className="px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.18em]"
                        style={{ color: meta.color, border: `1px solid ${meta.color}55` }}
                      >
                        {group.actions.length} {group.actions.length === 1 ? "action" : "actions"}
                      </span>
                    </span>
                    <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{meta.description}</span>
                    <span className="mt-2 block text-xs text-muted-foreground">
                      {group.actions.map((action) => action.label).join(", ")}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
        {selected.length ? (
          <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
            You are allowing: {selectedActions.join(" · ")}
          </p>
        ) : (
          <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">Keep at least one group to approve.</p>
        )}
      </section>

      <section className="border border-black/15 bg-white p-6">
        <h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          {connectors.length ? "3 · Choose how long" : "Choose how long"}
        </h2>
        <div className="mt-4 space-y-2">
          {durationOptions.map((option) => (
            <label key={option} className="flex items-center gap-3 border border-black/10 px-4 py-3 text-sm">
              <input
                type="radio"
                name="durationChoice"
                value={option}
                checked={duration === option}
                onChange={() => setDuration(option)}
                className="size-3.5 accent-black"
              />
              {DURATION_LABELS[option]}
            </label>
          ))}
        </div>
        <input type="hidden" name="duration" value={duration} />
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          name="decision"
          value="approve"
          disabled={!ready}
          className="border border-black px-6 py-3 text-xs font-mono uppercase tracking-[0.18em] text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
          style={{ backgroundColor: primaryColor }}
        >
          Approve &amp; continue
        </button>
        <button
          type="submit"
          name="decision"
          value="decline"
          className="border border-black/25 px-6 py-3 text-xs font-mono uppercase tracking-[0.18em] transition-colors hover:border-black"
        >
          Decline
        </button>
        {!ready ? (
          <span className="text-[11px] text-muted-foreground">
            {missing.length ? "Connect every account to continue." : "Choose at least one permission group."}
          </span>
        ) : null}
      </div>
    </form>
  );
}
