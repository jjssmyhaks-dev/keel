"use client";

import { useState } from "react";
import { formatDate, relativeTime } from "@/components/app/ui";

export type ClientSecretView = {
  id: string;
  label: string;
  prefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

export function AgentClientSecrets({
  agentId,
  canManage,
  initialSecrets,
}: {
  agentId: string;
  canManage: boolean;
  initialSecrets: ClientSecretView[];
}) {
  const [secrets, setSecrets] = useState(initialSecrets);
  const [label, setLabel] = useState("default");
  const [scopes, setScopes] = useState("");
  const [days, setDays] = useState("");
  const [revealed, setRevealed] = useState<{ id: string; secret: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function createSecret(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setCopied(false);
    try {
      const response = await fetch(`/api/dashboard/agents/${agentId}/client-secrets`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          label,
          scopes: scopes.split(/[\s,]+/).filter(Boolean),
          expiresInDays: days ? Number(days) : undefined,
        }),
      });
      const payload = (await response.json()) as {
        clientSecret?: ClientSecretView;
        secret?: string;
        error?: { message?: string };
      };
      if (!response.ok || !payload.clientSecret || !payload.secret) {
        throw new Error(payload.error?.message ?? "Could not issue the client secret.");
      }
      setSecrets((current) => [payload.clientSecret!, ...current]);
      setRevealed({ id: payload.clientSecret.id, secret: payload.secret });
      setScopes("");
      setDays("");
    } catch (issueError) {
      setError((issueError as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function revokeSecret(secretId: string) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/dashboard/agents/${agentId}/client-secrets`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ secretId }),
      });
      const payload = (await response.json()) as {
        clientSecret?: ClientSecretView;
        error?: { message?: string };
      };
      if (!response.ok || !payload.clientSecret) {
        throw new Error(payload.error?.message ?? "Could not revoke the client secret.");
      }
      setSecrets((current) =>
        current.map((secret) => (secret.id === secretId ? payload.clientSecret! : secret)),
      );
      if (revealed?.id === secretId) setRevealed(null);
    } catch (revokeError) {
      setError((revokeError as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function copySecret() {
    if (!revealed) return;
    try {
      await navigator.clipboard.writeText(revealed.secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="space-y-4">
      {canManage ? (
        <form onSubmit={createSecret} className="space-y-3 border border-black/10 bg-[#faf9f6] p-3 dark:border-border dark:bg-background">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="secret_label" className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/45 dark:text-muted-foreground">
                Label
              </label>
              <input
                id="secret_label"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                maxLength={60}
                className="mt-1 w-full border border-black/15 bg-white px-2.5 py-2 font-mono text-[11px] outline-none focus:border-black dark:border-border dark:bg-card"
              />
            </div>
            <div>
              <label htmlFor="secret_days" className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/45 dark:text-muted-foreground">
                Expires
              </label>
              <select
                id="secret_days"
                value={days}
                onChange={(event) => setDays(event.target.value)}
                className="mt-1 w-full border border-black/15 bg-white px-2.5 py-2 font-mono text-[11px] outline-none focus:border-black dark:border-border dark:bg-card"
              >
                <option value="">Never</option>
                <option value="30">In 30 days</option>
                <option value="90">In 90 days</option>
                <option value="365">In 1 year</option>
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="secret_scopes" className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/45 dark:text-muted-foreground">
              Scopes (optional)
            </label>
            <input
              id="secret_scopes"
              value={scopes}
              onChange={(event) => setScopes(event.target.value)}
              placeholder="Blank = every granted action. Or: slack.post_message, github.issues.write"
              className="mt-1 w-full border border-black/15 bg-white px-2.5 py-2 font-mono text-[11px] outline-none focus:border-black dark:border-border dark:bg-card"
            />
          </div>
          <button
            disabled={busy}
            className="w-full border border-black bg-black px-2 py-2 font-mono text-[9px] uppercase tracking-[0.14em] text-white hover:bg-[#eca8d6] hover:text-black disabled:opacity-40"
          >
            {busy ? "Issuing…" : "Issue client secret"}
          </button>
        </form>
      ) : (
        <p className="text-[11px] text-black/45 dark:text-muted-foreground">
          Your role can view agent credentials but cannot issue or revoke them.
        </p>
      )}

      {error ? (
        <p className="border border-[#b3402f]/30 bg-[#b3402f]/[0.06] px-3 py-2 text-[11px] text-[#8c3225]">{error}</p>
      ) : null}

      {revealed ? (
        <div className="border border-[#2f6b3d]/35 bg-[#2f6b3d]/[0.06] p-3">
          <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[#2f6b3d]">Copy this secret now</p>
          <code className="mt-2 block break-all border border-[#2f6b3d]/30 bg-white px-2.5 py-2 font-mono text-[11px] dark:bg-card">
            {revealed.secret}
          </code>
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={copySecret}
              className="border border-[#2f6b3d]/50 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.12em] text-[#2f6b3d] hover:bg-[#2f6b3d] hover:text-white"
            >
              {copied ? "Copied" : "Copy"}
            </button>
            <p className="text-[10px] text-black/45 dark:text-muted-foreground">
              Only a hash is stored. This value cannot be shown again.
            </p>
          </div>
        </div>
      ) : null}

      {secrets.length ? (
        <div className="divide-y divide-black/10 border border-black/10 dark:divide-border dark:border-border">
          {secrets.map((secret) => (
            <div key={secret.id} className="px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[11px]">{secret.prefix}…</span>
                <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-black/40 dark:text-muted-foreground">{secret.label}</span>
                {secret.revokedAt ? (
                  <span className="border border-[#b3402f]/35 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.1em] text-[#8c3225]">revoked</span>
                ) : null}
                {canManage && !secret.revokedAt ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => revokeSecret(secret.id)}
                    className="ml-auto font-mono text-[9px] uppercase tracking-[0.12em] text-[#8c3225] underline disabled:opacity-40"
                  >
                    Revoke
                  </button>
                ) : null}
              </div>
              <p className="mt-1 font-mono text-[9px] text-black/40 dark:text-muted-foreground">
                {secret.scopes.length ? secret.scopes.join(", ") : "all granted actions"} ·{" "}
                {secret.lastUsedAt ? `used ${relativeTime(secret.lastUsedAt)}` : "never used"} ·{" "}
                {secret.expiresAt ? `expires ${formatDate(secret.expiresAt)}` : "no expiry"}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[11px] leading-relaxed text-black/45 dark:text-muted-foreground">
          No client secret yet. Issue one so this agent can obtain short-lived tokens with{" "}
          <span className="font-mono">POST /api/v1/tokens/client-credentials</span> instead of holding a long-lived API key.
        </p>
      )}
    </div>
  );
}
