"use client";

import { useActionState, useState } from "react";
import { createScimTokenAction, type ScimTokenState } from "@/app/app/security/sso/actions";

export function ScimTokenCreator() {
  const [state, action, pending] = useActionState<ScimTokenState, FormData>(createScimTokenAction, {});
  const [copied, setCopied] = useState(false);

  return (
    <div>
      <form action={action} className="flex gap-2">
        <input
          name="name"
          maxLength={60}
          placeholder="Token name — e.g. Okta SCIM"
          className="min-w-0 flex-1 border border-black/45 bg-[#faf9f6] px-2.5 py-1.5 text-[12px] outline-none focus:border-black dark:border-white/40 dark:bg-background"
        />
        <button
          type="submit"
          disabled={pending}
          className="border border-black bg-black px-3 py-1.5 font-mono text-[9px] uppercase tracking-[0.14em] text-white hover:bg-[#eca8d6] hover:text-black disabled:opacity-50"
        >
          {pending ? "Generating…" : "Create token"}
        </button>
      </form>

      {state?.error ? <p className="mt-2 text-[12px] text-[#8c3225] dark:text-[#f0a396]">{state.error}</p> : null}
      {state?.token ? (
        <div className="mt-3 border border-[#2f7d5c]/30 bg-[#2f7d5c]/[0.06] p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-[#245f47]">
              {state.prefix} — shown once
            </p>
            <button
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(state.token ?? "");
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              className="font-mono text-[9px] uppercase tracking-[0.14em] underline"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <pre className="mt-1.5 break-all border border-black/10 bg-[#0b0b0b] p-2.5 font-mono text-[10px] text-[#e8e6e1]">{state.token}</pre>
          <p className="mt-2 text-[10px] leading-relaxed text-black/65 dark:text-muted-foreground">
            Paste this into your identity provider&apos;s SCIM configuration as a bearer token. It cannot be shown again.
          </p>
        </div>
      ) : null}
    </div>
  );
}
