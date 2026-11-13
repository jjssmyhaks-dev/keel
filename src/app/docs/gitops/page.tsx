import type { Metadata } from "next";
import Link from "next/link";
import { Callout, DocsAside, DocsShell } from "@/components/docs/docs-shell";

export const metadata: Metadata = {
  title: "Configuration, import and GitOps",
  description: "Find hard-coded secrets, move them into the vault, and keep agents, grants and policies in a reviewed configuration file.",
};

export default function GitOpsPage() {
  return (
    <DocsShell
      eyebrow="Build"
      title="Configuration as code"
      intro="Three workflows that share one scanner: find credentials already in your repository, import them into the vault without pasting them twice, and keep agent permissions in a versioned file that CI can dry-run on every pull request."
      updated="13 November 2026"
      aside={
        <DocsAside
          links={[
            { href: "#scan", name: "Scan a repository" },
            { href: "#scan-output", name: "Reading findings" },
            { href: "#import", name: "Import into the vault" },
            { href: "#rewrite", name: "Rewrite the source" },
            { href: "#export", name: "Export configuration" },
            { href: "#apply", name: "Apply semantics" },
            { href: "#gitops", name: "GitOps with GitHub Actions" },
            { href: "#rules", name: "Rules and limits" },
          ]}
        />
      }
    >
      <h2 id="scan">Scan a repository</h2>
      <p>
        <code>authab scan</code> walks the paths you give it, reads dotenv files, JavaScript/TypeScript and Python
        assignments, and reports literal credentials it recognises. It never sends anything to the API unless you pass{" "}
        <code>--import</code>.
      </p>
      <pre>{`authab scan                     # current directory
authab scan .env app/ scripts/  # specific paths
authab scan --json              # machine-readable, values stripped
authab scan --exclude "fixtures/**" --max-size 500000`}</pre>
      <p>
        The scanner skips <code>node_modules</code>, <code>.git</code>, build output, lockfiles and <code>.authab</code>{" "}
        by default, and reads at most 1 MB per file. High-confidence findings set exit code 1, so the same command works
        as a CI gate.
      </p>
      <p>
        The pattern catalogue is shared between the CLI and the server (<code>shared/secret-patterns.json</code>, 29
        patterns across 12 providers). It covers well-known key shapes — OpenAI, Anthropic, Stripe, GitHub, Slack,
        Shopify, Twilio and others — plus grouped credentials such as a Shopify shop domain plus access token.
      </p>

      <h2 id="scan-output">Reading findings</h2>
      <pre>{`file            line  connector  confidence  preview
.env            3     openai     high        OPENAI_API_KEY · sk-p… (51 chars)
app/config.ts   12    github     high        GITHUB_TOKEN · ghp_… (40 chars)
worker.py       8     unmapped   medium      — · Zx8Q… (20 chars)`}</pre>
      <p>
        Each finding carries a confidence. <strong>High</strong> means the value itself matched a provider pattern;{" "}
        <strong>medium</strong> means only the variable name looked like a credential, or a value matched no known
        provider. Placeholders such as <code>your-key-here</code>, <code>changeme</code> and repeated characters are
        skipped. Values are never printed in full, and <code>--json</code> removes them entirely.
      </p>

      <h2 id="import">Import into the vault</h2>
      <p>
        <code>--import</code> creates vault connections from the findings. Multi-field providers are grouped first: a
        Shopify shop domain and access token in the same file become one connection, not two rows. You are asked to
        confirm each group; incomplete groups are reported and skipped.
      </p>
      <pre>{`authab scan . --import`}</pre>
      <p>
        The same flow exists in the dashboard at <Link href="/app/vault/import">Vault → Import from .env</Link>. Paste a
        file, review the detected connections and fields, and import up to 20 at once. The server re-classifies every
        value rather than trusting the browser, and refuses a live key in a development environment with a clear
        message: switch to production first.
      </p>
      <Callout title="Development never receives live keys">
        Importing a live Stripe, Shopify or similar key into a development environment is blocked. This is the same rule
        the vault applies to manual creation, enforced again at import.
      </Callout>

      <h2 id="rewrite">Rewrite the source</h2>
      <p>
        After a successful import, <code>--write</code> replaces the literal in your files with an environment-variable
        reference, so the repository stops carrying the secret:
      </p>
      <pre>{`authab scan . --import --write`}</pre>
      <table>
        <thead>
          <tr>
            <th>Before</th>
            <th>After</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>const GITHUB_TOKEN = "ghp_…";</code></td>
            <td><code>const GITHUB_TOKEN = process.env.GITHUB_TOKEN;</code></td>
          </tr>
          <tr>
            <td><code>OPENAI_API_KEY = "sk-…"</code></td>
            <td><code>OPENAI_API_KEY = os.environ["OPENAI_API_KEY"]</code></td>
          </tr>
          <tr>
            <td><code>SHOPIFY_ACCESS_TOKEN=shpat_…</code></td>
            <td><code># moved to the Authab vault</code></td>
          </tr>
        </tbody>
      </table>
      <p>
        Rewriting refuses to run outside a git repository or with a dirty working tree, so the diff is reviewable and
        reversible. <code>--force</code> overrides the check; use it only when you understand what will be overwritten.
      </p>

      <h2 id="export">Export configuration</h2>
      <p>
        <code>authab config export</code> writes a version 1 document describing the environment: agents, connections
        (metadata only), grants, approval policies and webhook URLs. It contains no secrets, no credential payloads and
        no end-user consent data.
      </p>
      <pre>{`authab config export --format yaml --out authab.yaml`}</pre>
      <pre>{`version: 1
environment: development
agents:
  - name: Atlas Research
    type: research
    tags: [research, slack]
connections:
  - name: Northwind Slack
    connector: slack
grants:
  - agent: Atlas Research
    connection: Northwind Slack
    actions: [slack.post_message]
    resource: "research-*"
    approvalMode: require_approval
approvalPolicies:
  - agent: null
    actionPattern: "stripe.*"
    mode: deny
webhooks: []`}</pre>
      <p>
        Connections are referenced by name but never created by <code>apply</code>. Create them once in the vault (or
        with <code>authab vault add</code>); configuration manages who can use them, not the secret material itself.
      </p>

      <h2 id="apply">Apply semantics</h2>
      <pre>{`authab config apply authab.yaml --dry-run   # plan only
authab config apply authab.yaml             # write
authab config apply authab.yaml --prune     # also delete extras`}</pre>
      <ul>
        <li><strong>Natural keys.</strong> Agents match by name within the environment; grants by agent plus connection; approval policies by agent plus action pattern; webhooks by URL.</li>
        <li><strong>Idempotent.</strong> Re-applying an unchanged file reports no changes and writes nothing. Action order and duplicates do not create diffs.</li>
        <li><strong>One transaction.</strong> Validation runs first; every create, update and delete then commits together. A failure leaves the environment untouched.</li>
        <li><strong>Unknown references fail.</strong> A grant that names a missing agent or connection returns <code>422</code> before any write. An ambiguous name returns <code>409 ambiguous_name</code>.</li>
        <li><strong>Prune is narrow.</strong> It deletes only grants, approval policies and webhooks absent from the file — never agents, connections or end-user data.</li>
        <li><strong>Production is explicit.</strong> Pruning a production environment additionally requires the <code>x-authab-confirm: prune</code> header (the SDK sends it via <code>confirmPrune</code>).</li>
        <li><strong>Secrets are returned once.</strong> New platform-keyed agents and new webhooks produce a private key or signing secret in <code>results</code>; capture them from that response.</li>
      </ul>
      <p>
        The API equivalent is <code>POST /v1/config/apply</code> with <code>{"{ config }"}</code> or{" "}
        <code>{"{ yaml }"}</code>. Every successful apply writes one <code>config.applied</code> audit event with the
        plan summary.
      </p>

      <h2 id="gitops">GitOps with GitHub Actions</h2>
      <p>
        Commit <code>authab.yaml</code> next to your infrastructure. On a pull request, run a dry run and post the plan;
        on merge to main, apply it. Store a secret key in repository secrets — a development key for the workflow below,
        or a separate production workflow with required reviewers.
      </p>
      <pre>{`.github/workflows/authab.yml
name: authab-config

on:
  pull_request:
    paths: ["authab.yaml"]
  push:
    branches: [main]
    paths: ["authab.yaml"]

jobs:
  plan:
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - name: Install the Authab CLI
        run: |
          git clone --depth 1 https://github.com/jjssmyhaks-dev/keel.git /tmp/authab
          cd /tmp/authab && npm ci && npm run sdk:build && npm run cli:build && npm install -g ./cli
      - name: Dry-run the plan
        env:
          AUTHAB_API_KEY: \${{ secrets.AUTHAB_DEV_KEY }}
        run: authab config apply authab.yaml --dry-run

  apply:
    if: github.event_name == 'push'
    runs-on: ubuntu-latest
    environment: development
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - name: Install the Authab CLI
        run: |
          git clone --depth 1 https://github.com/jjssmyhaks-dev/keel.git /tmp/authab
          cd /tmp/authab && npm ci && npm run sdk:build && npm run cli:build && npm install -g ./cli
      - name: Apply
        env:
          AUTHAB_API_KEY: \${{ secrets.AUTHAB_DEV_KEY }}
        run: authab config apply authab.yaml`}</pre>
      <p>
        The dry run exits non-zero on validation errors, so a bad reference blocks the pull request. The apply job runs
        only after merge, and the <code>development</code> GitHub environment can require a reviewer before it starts.
      </p>
      <p>
        For a promotion flow, keep two files — <code>authab.development.yaml</code> and{" "}
        <code>authab.production.yaml</code> — and two secrets. Promotion previews already exist per agent via{" "}
        <Link href="/docs/concepts/environments">environments</Link>; config files describe the steady state of each
        environment.
      </p>

      <h2 id="rules">Rules and limits</h2>
      <ul>
        <li>Configuration files never contain secrets. The importer writes secrets to the vault; the exporter deliberately omits them.</li>
        <li>Applying does not create connections, and pruning never deletes agents or connections.</li>
        <li>Dry runs return the same plan shape as real applies, without the one-time secret results.</li>
        <li>Plan limits still apply: creating agents or connections beyond the plan returns <code>402</code>.</li>
        <li>Audit events record <code>config.applied</code>, plus each create/update/delete through the regular services.</li>
      </ul>
      <p>
        Operator guide: <code>docs/operations/gitops.md</code> in the repository covers key scoping, rollback and
        production promotion in more detail.
      </p>
    </DocsShell>
  );
}
