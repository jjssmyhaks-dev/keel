"use client";

import { useActionState, useState } from "react";
import { issueTokenAction } from "@/app/app/actions";

export function TokenIssuer({ agentId, keyMode }: { agentId: string; keyMode: string }) {
  const [state, action, pending] = useActionState(issueTokenAction, {});
  const [copied, setCopied] = useState(false);

  if (keyMode === "client") {
    return (
      <p className="text-[12px] leading-relaxed text-black/50 dark:text-muted-foreground">
        This agent holds its own private key. Issue tokens from your backend with a signed challenge, or rotate to a
        Authab-managed key from the identity panel.
      </p>
    );
  }

  return (
    <div>
      <form action={action}>
        <input type="hidden" name="agentId" value={agentId} />
        <button
          type="submit"
          disabled={pending}
          className="border border-black bg-black px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-white transition-colors hover:bg-[#eca8d6] hover:text-black disabled:opacity-50"
        >
          {pending ? "Signing…" : "Issue 5-minute token"}
        </button>
      </form>
      {state?.error ? <p className="mt-2 text-[12px] text-[#8c3225]">{state.error}</p> : null}
      {state?.token ? (
        <div className="mt-3">
          <div className="flex items-center justify-between">
            <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/40 dark:text-muted-foreground">
              Expires {state.expiresAt ? new Date(state.expiresAt).toLocaleTimeString("en-IN") : ""}
            </p>
            <button
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(state.token ?? "");
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              className="font-mono text-[9px] uppercase tracking-[0.16em] underline"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <pre className="mt-1 max-h-32 overflow-auto border border-black/10 bg-[#0b0b0b] p-3 text-[10px] leading-relaxed break-all text-[#e8e6e1]">
            {state.token}
          </pre>
        </div>
      ) : null}
    </div>
  );
}
