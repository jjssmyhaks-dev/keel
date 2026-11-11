# @keel/cli

The `keel` command for [Keel](https://keel.dev/docs/cli): agents, vault, grants, approvals, governed calls and audit from a terminal. Node 20+. The published bundle has no runtime dependencies.

The package ships in the Keel repository; npm publication is pending the public launch.

```bash
git clone https://github.com/jjssmyhaks-dev/keel.git
cd keel && npm ci && npm run cli:build
npm install -g ./cli
keel login --api-key sk_dev_...
keel whoami
```

`login` verifies the key against the API before writing it. Profiles live in `~/.keel/config.json` (owner-only `0600`, override with `KEEL_CONFIG`); `--env` selects a profile for a command. `KEEL_API_KEY` overrides the profile, and `KEEL_BASE_URL` or `--base-url` overrides the origin.

## Commands

```text
keel login --api-key sk_... [--env development] [--base-url URL]
keel whoami

keel agents list [--status active] [--tag research]
keel agents create --name "Atlas" [--description ...] [--framework ...] [--tag ...]
keel agents token <id> [--ttl 300]
keel agents pause|resume <id>
keel agents kill <id> --yes
keel agents rotate-key <id>
keel promote <id> [--confirm --email owner@example.com]

keel vault list
keel vault add --connector slack [--name ...] [--type oauth] [--from-stdin]
keel vault rotate <id> [--from-stdin]
keel vault revoke <id> --yes

keel grants list [--agent <id>]
keel grants create --agent <id> --credential <id> --actions slack.post_message [--resource ...] [--mode ...]
keel grants update <id> [--actions ...] [--resource ...] [--mode ...]
keel grants rm <id> --yes

keel call <connector.action> --agent <id> [--credential <id>] [--resource ...] [--input '{"...":...}'] [--watch]
keel approvals list [--status pending] [--risk financial]
keel approvals show <id>
keel approvals approve <id> [--note ...]
keel approvals deny <id> [--note ...]

keel audit verify
keel audit tail [--agent <id>] [--action proxy] [--limit 20]
keel audit export [--format jsonl|csv] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--out file]
```

Global flags: `--json` for machine-readable output, `--env` to pick a profile, `--base-url` to override the origin, `--help`, `--version`.

## Behaviour worth knowing

- `keel promote` is a dry run by default: it prints every readiness check and the grant diff for the production environment. Add `--confirm` (and the account email) to create the production identity.
- `keel call` mints a short-lived agent token, then calls the proxy. A pending approval is a success with an approval URL, not an error; `--watch` polls until a human decides and prints the executed result or denial.
- Secrets are read from stdin (`--from-stdin`) or a hidden prompt, never from argv, so they stay out of shell history.
- Destructive commands (`agents kill`, `vault revoke`, `grants rm`) require `--yes` or an interactive confirmation.
- `keel audit verify` walks the environment's hash chain and exits non-zero if any link is broken — safe to put in CI or a cron monitor.
- `--json` is intended for read commands; streaming or interactive commands ignore it.
- Errors print the API code and `requestId`. A denial (HTTP 403) exits with status 2; usage mistakes exit with status 1.

## Development

From the repo root:

```bash
npm run sdk:build     # the CLI typechecks against the SDK source
npm --prefix cli run typecheck
npm --prefix cli run build        # bundles dist/keel.js with esbuild
node cli/dist/keel.js --help
```

Set `KEEL_CONFIG=.keel/cli-config.json` to test against a local profile without touching your real config.
