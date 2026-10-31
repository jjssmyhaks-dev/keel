import type { Metadata } from "next";
import Link from "next/link";
import { getContext } from "@/lib/session";
import { createAgentAction } from "@/app/app/actions";
import { PageHeader, Notice } from "@/components/app/ui";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "New agent" };

export default async function NewAgentPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const ctx = await getContext();

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        eyebrow="Agents · register"
        title="Give it a name."
        description="The agent gets an Ed25519 identity. Keel holds the private key, signs five-minute tokens and keeps the audit trail."
        actions={
          <Link href="/app/agents" className="border border-black/15 bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] hover:border-black dark:border-border dark:bg-card">
            Cancel
          </Link>
        }
      />

      {error ? (
        <Notice kind="error">
          {error === "duplicate"
            ? "An agent with that name already exists in this environment."
            : error === "name"
              ? "Give the agent a name of at least two characters."
              : error === "permission"
                ? "Your role cannot register agents in this environment."
                : "The agent could not be registered. Try again."}
        </Notice>
      ) : null}

      <div className="grid gap-6 md:grid-cols-[1.4fr_1fr]">
        <form action={createAgentAction} className="border border-black/10 bg-white p-5 dark:border-border dark:bg-card">
          <div className="space-y-5">
            <div>
              <label htmlFor="name" className="font-mono text-[9px] uppercase tracking-[0.18em] text-black/45 dark:text-muted-foreground">
                Display name
              </label>
              <input
                id="name"
                name="name"
                required
                minLength={2}
                maxLength={60}
                placeholder="Atlas Research"
                className="mt-1.5 w-full border border-black/15 bg-[#faf9f6] px-3 py-2 text-[13px] outline-none focus:border-black dark:border-border dark:bg-background"
              />
            </div>

            <div>
              <label htmlFor="description" className="font-mono text-[9px] uppercase tracking-[0.18em] text-black/45 dark:text-muted-foreground">
                What does it do?
              </label>
              <textarea
                id="description"
                name="description"
                rows={3}
                maxLength={400}
                placeholder="Reads customer conversations and drafts research briefs for the product team."
                className="mt-1.5 w-full resize-none border border-black/15 bg-[#faf9f6] px-3 py-2 text-[13px] leading-relaxed outline-none focus:border-black dark:border-border dark:bg-background"
              />
              <p className="mt-1 text-[10px] text-black/40 dark:text-muted-foreground">
                Reviewers read this before approving production traffic.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="framework" className="font-mono text-[9px] uppercase tracking-[0.18em] text-black/45 dark:text-muted-foreground">
                  Framework
                </label>
                <select
                  id="framework"
                  name="framework"
                  className="mt-1.5 w-full border border-black/15 bg-[#faf9f6] px-3 py-2 text-[13px] outline-none focus:border-black dark:border-border dark:bg-background"
                >
                  <option>LangGraph</option>
                  <option>OpenAI Agents SDK</option>
                  <option>CrewAI</option>
                  <option>Claude Agent SDK</option>
                  <option>AutoGen</option>
                  <option>Custom</option>
                </select>
              </div>
              <div>
                <label htmlFor="tags" className="font-mono text-[9px] uppercase tracking-[0.18em] text-black/45 dark:text-muted-foreground">
                  Tags
                </label>
                <input
                  id="tags"
                  name="tags"
                  placeholder="research, customer-facing"
                  className="mt-1.5 w-full border border-black/15 bg-[#faf9f6] px-3 py-2 text-[13px] outline-none focus:border-black dark:border-border dark:bg-background"
                />
                <p className="mt-1 text-[10px] text-black/40 dark:text-muted-foreground">Comma separated. Used for filtering.</p>
              </div>
            </div>

            <div className="border border-black/10 bg-[#faf9f6] p-3 dark:border-border dark:bg-background">
              <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/45 dark:text-muted-foreground">Key mode</p>
              <p className="mt-1 text-[12px] leading-relaxed">
                <strong>Keel-managed</strong> — the private key is encrypted with this project&apos;s envelope key and never
                leaves the platform. Tokens are minted from the dashboard or API.
              </p>
            </div>

            <button
              type="submit"
              className="w-full border border-black bg-black px-4 py-3 font-mono text-[10px] uppercase tracking-[0.18em] text-white transition-colors hover:bg-[#eca8d6] hover:text-black"
            >
              Register {ctx.environment.type === "production" ? "in production" : "agent"}
            </button>
          </div>
        </form>

        <aside className="space-y-4">
          <div className="border border-black/10 bg-black p-5 text-white dark:border-border">
            <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-white/45">What happens next</p>
            <ol className="mt-3 space-y-3 text-[12px] leading-relaxed text-white/75">
              <li>
                <span className="font-mono text-[10px] text-[#eca8d6]">01</span> Keel generates an Ed25519 key pair and stores
                the private half sealed with AES-256-GCM.
              </li>
              <li>
                <span className="font-mono text-[10px] text-[#eca8d6]">02</span> The agent row gets a fingerprint you can pin in
                your logs.
              </li>
              <li>
                <span className="font-mono text-[10px] text-[#eca8d6]">03</span> Grant access to connections from the permission
                matrix, then issue short-lived tokens.
              </li>
              <li>
                <span className="font-mono text-[10px] text-[#eca8d6]">04</span> Every proxied call is checked, executed and
                written to the hash-chained audit log.
              </li>
            </ol>
          </div>
          <div className="border border-black/10 bg-white p-4 dark:border-border dark:bg-card">
            <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/45 dark:text-muted-foreground">Environment</p>
            <p className="mt-1 text-[13px] capitalize">{ctx.environment.type}</p>
            <p className="mt-1 text-[11px] leading-relaxed text-black/45 dark:text-muted-foreground">
              {ctx.environment.type === "development"
                ? "Development defaults allow reads and writes. Destructive and financial actions still need approval."
                : "Production requires approval for everything except reads. Safe launch adds a second layer for 7 days."}
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
