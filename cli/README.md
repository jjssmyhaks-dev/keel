# @authab/cli

The `authab` command for [Authab](https://authab.dev/docs/cli): agents, vault, grants, approvals, governed calls and audit from a terminal. Node 20+. The published bundle has no runtime dependencies.

The package ships in the Authab repository; npm publication is pending the public launch.

```bash
git clone https://github.com/jjssmyhaks-dev/keel.git authab
cd authab && npm ci && npm run cli:build
npm install -g ./cli
authab login --api-key sk_dev_...
authab whoami
```

`login` verifies the key against the API before writing it. Profiles live in `~/.authab/config.json` (owner-only `0600`, override with `AUTHAB_CONFIG`); `--env` selects a profile for a command. `AUTHAB_API_KEY` overrides the profile, and `AUTHAB_BASE_URL` or `--base-url` overrides the origin.

## Commands

```text
authab login --api-key sk_... [--env development] [--base-url URL]
authab whoami

authab agents list [--status active] [--tag research]
authab agents create --name "Atlas" [--description ...] [--framework ...] [--tag ...]
authab agents token <id> [--ttl 300]
authab agents pause|resume <id>
authab agents kill <id> --yes
authab agents rotate-key <id>
authab promote <id> [--confirm --email owner@example.com]

authab vault list
authab vault add --connector slack [--name ...] [--type oauth] [--from-stdin]
authab vault rotate <id> [--from-stdin]
authab vault revoke <id> --yes

authab grants list [--agent <id>]
authab grants create --agent <id> --credential <id> --actions slack.post_message [--resource ...] [--mode ...]
authab grants update <id> [--actions ...] [--resource ...] [--mode ...]
authab grants rm <id> --yes

authab call <connector.action> --agent <id> [--credential <id>] [--resource ...] [--input '{"...":...}'] [--watch]
authab approvals list [--status pending] [--risk financial]
authab approvals show <id>
authab approvals approve <id> [--note ...]
authab approvals deny <id> [--note ...]

authab audit verify
authab audit tail [--agent <id>] [--action proxy] [--limit 20]
authab audit export [--format jsonl|csv] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--out file]
```

Global flags: `--json` for machine-readable output, `--env` to pick a profile, `--base-url` to override the origin, `--help`, `--version`.

## Behaviour worth knowing

- `authab promote` is a dry run by default: it prints every readiness check and the grant diff for the production environment. Add `--confirm` (and the account email) to create the production identity.
- `authab call` mints a short-lived agent token, then calls the proxy. A pending approval is a success with an approval URL, not an error; `--watch` polls until a human decides and prints the executed result or denial.
- Secrets are read from stdin (`--from-stdin`) or a hidden prompt, never from argv, so they stay out of shell history.
- Destructive commands (`agents kill`, `vault revoke`, `grants rm`) require `--yes` or an interactive confirmation.
- `authab audit verify` walks the environment's hash chain and exits non-zero if any link is broken — safe to put in CI or a cron monitor.
- `--json` is intended for read commands; streaming or interactive commands ignore it.
- Errors print the API code and `requestId`. A denial (HTTP 403) exits with status 2; usage mistakes exit with status 1.

## Development

From the repo root:

```bash
npm run sdk:build     # the CLI typechecks against the SDK source
npm --prefix cli run typecheck
npm --prefix cli run build        # bundles dist/authab.js with esbuild
node cli/dist/authab.js --help
```

Set `AUTHAB_CONFIG=.authab/cli-config.json` to test against a local profile without touching your real config.
