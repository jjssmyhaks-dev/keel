"use client";

import { useActionState, useState } from "react";
import { createApiKeyAction } from "@/app/app/actions";

export function ApiKeyCreator({ isProduction }: { isProduction: boolean }) {
  const [state, action, pending] = useActionState(createApiKeyAction, {});
  const [copied, setCopied] = useState(false);

  return (
    <div>
      <form action={action} className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-[1fr_150px_auto]">
          <input
            name="name"
            maxLength={60}
            placeholder="Key name — e.g. billing-service"
            className="border border-black/15 bg-[#faf9f6] px-2.5 py-1.5 text-[12px] outline-none focus:border-black dark:border-border dark:bg-background"
          />
          <select
            name="type"
            className="border border-black/15 bg-[#faf9f6] px-2.5 py-1.5 text-[12px] outline-none focus:border-black dark:border-border dark:bg-background"
          >
            <option value="secret">Secret key</option>
            <option value="publishable">Publishable key</option>
          </select>
          <button
            type="submit"
            disabled={pending}
            className="border border-black bg-black px-3 py-1.5 font-mono text-[9px] uppercase tracking-[0.14em] text-white hover:bg-[#eca8d6] hover:text-black disabled:opacity-50"
          >
            {pending ? "Generating…" : "Create key"}
          </button>
        </div>
        <p className="text-[10px] leading-relaxed text-black/40 dark:text-muted-foreground">
          {isProduction
            ? "Production secret keys can read and change live traffic. Owners and admins only."
            : "Development keys only work against this environment. They cannot touch production resources."}
        </p>
      </form>

      {state?.error ? <p className="mt-2 text-[12px] text-[#8c3225]">{state.error}</p> : null}
      {state?.key ? (
        <div className="mt-3 border border-[#2f7d5c]/30 bg-[#2f7d5c]/[0.06] p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-[#245f47]">
              {state.prefix} — shown once
            </p>
            <button
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(state.key ?? "");
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              className="font-mono text-[9px] uppercase tracking-[0.14em] underline"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <pre className="mt-1.5 break-all border border-black/10 bg-[#0b0b0b] p-2.5 font-mono text-[10px] text-[#e8e6e1]">{state.key}</pre>
        </div>
      ) : null}
    </div>
  );
}
