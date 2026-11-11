import type { Metadata } from "next";
import Link from "next/link";
import { DocsAside, DocsShell } from "@/components/docs/docs-shell";

export const metadata: Metadata = {
  title: "CLI",
  description: "Operate Authab from the terminal: agents, vault, grants, approvals, audit and promotion.",
};

export default function CliPage() {
  return (
    <DocsShell
      eyebrow="Build"
      title="CLI"
      intro="The same operations as the dashboard and the SDK, sized for a terminal. Useful for scaffolding an agent locally, wiring a CI check, or promoting a tested agent without opening a browser."
      updated="31 October 2026"
      aside={
        <DocsAside
          links={[
            { href: "#install", name: "Install" },
            { href: "#auth", name: "Authentication" },
            { href: "#agents", name: "Agents" },
            { href: "#vault", name: "Vault" },
            { href: "#grants", name: "Grants" },
            { href: "#call", name: "Proxy calls" },
            { href: "#approvals", name: "Approvals" },
            { href: "#audit", name: "Audit" },
            { href: "#promote", name: "Promotion" },
            { href: "#ci", name: "CI patterns" },
          ]}
        />
      }
    >
      <h2 id="install">Install</h2>
      <p>The npm package ships in the Authab repository; registry publication is pending the public launch.</p>
      <pre>{`git clone https://github.com/jjssmyhaks-dev/keel.git authab
cd authab && npm ci && npm run cli:build
npm install -g ./cli
authab --version
authab --help`}</pre>
      <p>
        Or run it from the checkout without a global install: <code>node cli/dist/authab.js agents list</code>. Node 20 or
        newer.
      </p>

      <h2 id="auth">Authentication</h2>
      <pre>{`authab login --api-key sk_dev_...          # stored in ~/.authab/config.json (0600)
authab login --env production              # store a second environment key
authab whoami                              # org, project, environment, key type`}</pre>
      <p>
        In CI, skip login and set <code>AUTHAB_API_KEY</code> (optionally <code>AUTHAB_BASE_URL</code>). Environment
        variables take precedence over the config file. Never echo a secret key in shell history — pass it through a
        secret manager or stdin.
      </p>

      <h2 id="agents">Agents</h2>
      <pre>{`authab agents list
authab agents list --status active --tag research --json

authab agents create --name "Atlas Research" \\
  --description "Summarises research threads." \\
  --framework langgraph --tag research

authab agents token agt_atlas --ttl 300 --json      # prints { token, expiresAt }
authab agents pause agt_atlas
authab agents resume agt_atlas
authab agents kill agt_atlas --yes

authab agents rotate-key agt_atlas`}</pre>
      <p>
        <code>--json</code> is available on read commands and makes output stable for scripts. Destructive commands
        (<code>kill</code>, <code>revoke</code>, <code>grant rm</code>) require <code>--yes</code> in non-interactive
        runs.
      </p>

      <h2 id="vault">Vault</h2>
      <pre>{`authab vault list
authab vault add --connector slack --name "Northwind workspace" --type oauth
# reads the token from a hidden prompt, or:
printf "%s" "$SLACK_TOKEN" | authab vault add --connector slack --from-stdin

authab vault rotate cred_slack --from-stdin < new-token.txt
authab vault revoke cred_slack --yes`}</pre>
      <p>
        Secrets are never written to the config file, logs or shell history. The CLI prints only the masked hint after
        writing.
      </p>

      <h2 id="grants">Grants</h2>
      <pre>{`authab grants list --agent agt_atlas

authab grants create \\
  --agent agt_atlas --credential cred_slack \\
  --actions slack.post_message \\
  --resource "research-*" \\
  --mode require_approval \\
  --purpose "Launch briefs"

authab grants update grt_123 --resource "research-*,launch-*" --mode allow
authab grants rm grt_123 --yes`}</pre>

      <h2 id="call">Proxy calls</h2>
      <pre>{`authab call slack.post_message \\
  --agent agt_atlas --credential cred_slack \\
  --resource "#research-launch" \\
  --input '{"channel":"#research-launch","text":"Launch brief v3."}' \\
  --idempotency-key launch-v3

# 200 executed · 202 pending_approval (prints approval id and URL)`}</pre>
      <p>
        The CLI mints a short-lived token for the agent, calls the proxy, and prints the decision source. With{" "}
        <code>--watch</code>, a <code>202</code> is followed by polling the approval until it is decided (Ctrl-C to stop).
      </p>

      <h2 id="approvals">Approvals</h2>
      <pre>{`authab approvals list
authab approvals list --status pending --risk financial

authab approvals show apr_refund_42
authab approvals approve apr_refund_42 --note "Duplicate charge confirmed."
authab approvals deny apr_expired_issue --note "Tracked in ENG-88."`}</pre>

      <h2 id="audit">Audit</h2>
      <pre>{`authab audit verify
authab audit tail --agent agt_atlas
authab audit export --format jsonl --from 2026-10-01 --out authab-audit.jsonl`}</pre>
      <p>
        <code>verify</code> exits non-zero if the hash chain is broken, which makes it safe to run as a CI or cron gate.
      </p>

      <h2 id="promote">Promotion</h2>
      <pre>{`authab promote agt_atlas               # shows readiness and grant diff
authab promote agt_atlas --confirm     # creates the production identity
authab agents list --env production`}</pre>
      <p>
        Promotion needs a development secret key, a verified email on the calling account, and the owner or admin role.
        The CLI refuses to promote a revoked agent or one that already has a production counterpart.
      </p>

      <h2 id="ci">CI patterns</h2>
      <pre>{`# Fail the build if the audit chain is broken
authab audit verify || exit 1

# Export evidence on every release
authab audit export --format jsonl --out artifacts/audit.jsonl

# Smoke-test a promoted agent (reads only)
authab call slack.list_channels --agent agt_atlas_prod --env production`}</pre>
      <p>
        See the <Link href="/docs/sdk">SDK</Link> if you need the same operations inside an application, and the{" "}
        <Link href="/docs/api">API reference</Link> for the underlying requests.
      </p>
    </DocsShell>
  );
}
