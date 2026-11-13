# GitOps for Authab configuration

Authab configuration can live in a reviewed file instead of dashboard clicks. `authab config export` writes the
environment's agents, grants, approval policies and webhook endpoints; `authab config apply` reconciles the environment
to that file. Applying is idempotent: a second run of an unchanged file reports zero changes.

Provider connections, credentials, consents and end-user records are deliberately excluded. A configuration file can
never carry a provider secret, so apply will not create connections; grants that reference a connection must find it
already in the vault, and a missing connection fails validation instead of inventing one.

## What the file contains

| Section | Natural key | Fields |
| --- | --- | --- |
| `agents` | name | description, tags, framework, autonomous mode, status, key mode, public key |
| `grants` | agent + connector + resource | actions, conditions, approval mode, expiry, call cap |
| `approvalPolicies` | action pattern | risk ceiling, required role, SLA minutes |
| `webhooks` | URL | subscribed events, enabled flag |

Exports are environment-scoped: a production key exports production objects only, and applies to production only. No
secret material, audit rows, policy events, end-user identifiers or consents are included.

## Set up the key

Use a secret key for the target environment. The key used in CI should be dedicated to GitOps, stored as a repository
secret, and granted no broader capability than the plan allows. It is a secret key, so it can create agents and rewrite
grants; treat it like a deploy credential.

```bash
export AUTHAB_API_KEY=sk_prod_...
export AUTHAB_BASE_URL=https://api.authab.dev/api/v1
authab config export --format yaml --out authab.yaml
```

Prefer exporting from production and reviewing the result before the first apply. A development export applied to
production will show every object as a create, which is visible in the dry run.

## Scan before you commit

The same secret catalogue that powers vault import runs in the CLI. Run it over the whole repository in CI, not only
over `authab.yaml`; it also catches keys pasted into fixtures and docs.

```bash
authab scan . --exclude .next --exclude node_modules
```

High-confidence findings exit `1`, so an unmodified CI step fails the build. Lower-confidence findings are reported but
do not fail the build; they are still printed for review. Use `--import` to turn eligible findings into vault entries
and `--write` to replace them in source with references — `--write` refuses to run outside a git work tree or with
uncommitted changes unless `--force` is passed.

## Dry run on pull requests

The plan step never writes. It fails the job when the file cannot be parsed, references a missing connection, or
contains an object that would need a prune. Output is the same create/update/delete plan the apply step will execute.

```yaml
name: authab-config

on:
  pull_request:
    paths: ["authab.yaml", ".github/workflows/authab-config.yml"]
  push:
    branches: [main]
    paths: ["authab.yaml", ".github/workflows/authab-config.yml"]

permissions:
  contents: read

jobs:
  plan:
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - name: Install Authab CLI
        run: |
          git clone --depth 1 https://github.com/jjssmyhaks-dev/keel.git /tmp/authab
          cd /tmp/authab
          npm ci
          npm run sdk:build
          npm run cli:build
          npm install -g ./cli
      - name: Validate configuration
        env:
          AUTHAB_API_KEY: ${{ secrets.AUTHAB_PROD_KEY }}
          AUTHAB_BASE_URL: https://api.authab.dev/api/v1
        run: authab config apply authab.yaml --dry-run
      - name: Scan for secrets
        run: authab scan . --exclude node_modules --exclude .next

  apply:
    if: github.event_name == 'push'
    runs-on: ubuntu-latest
    environment: production
    concurrency:
      group: authab-config-apply
      cancel-in-progress: false
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - name: Install Authab CLI
        run: |
          git clone --depth 1 https://github.com/jjssmyhaks-dev/keel.git /tmp/authab
          cd /tmp/authab
          npm ci
          npm run sdk:build
          npm run cli:build
          npm install -g ./cli
      - name: Apply configuration
        env:
          AUTHAB_API_KEY: ${{ secrets.AUTHAB_PROD_KEY }}
          AUTHAB_BASE_URL: https://api.authab.dev/api/v1
        run: authab config apply authab.yaml
```

The `concurrency` block prevents two merges from applying simultaneously. The production environment can require a
reviewer in repository settings; that gate is separate from the dry run.

## Apply semantics

- **One transaction.** The whole document applies or none of it does. Validation errors return `422` with a code per
  object (`invalid_yaml`, `invalid_config`, `unsupported_version`, `config_too_large`) and nothing is partially written.
- **Duplicates fail.** Two objects sharing a natural key return `409 ambiguous_name`; rename one in the file.
- **Prune is explicit.** `--prune` deletes objects that are absent from the file. In production the API also requires
  the `x-authab-confirm: prune` header, which the CLI sends only when `--prune` is passed. Run the dry run with
  `--prune` first and read the delete list before merging.
- **Secrets are shown once.** Agent private keys and webhook signing secrets created by an apply are printed to
  stdout in `results` and never returned again. Capture them securely in the apply job, or create those objects in the
  dashboard and import them into the file by natural key.
- **Audit.** An apply writes one `config.applied` audit event per environment with the counts, the actor and the
  request ID; pruned objects appear in the event summary. The audit chain is not modified.

## Rollback

Configuration has no automatic undo. To roll back, check out the previous commit of `authab.yaml` and open a pull
request. The dry run shows the inverse plan and the merge applies it. For an emergency, run the same command locally
with the previous file; applying from a laptop is audited the same way but bypasses review, so prefer the pipeline.

Deleting an agent by prune revokes it. Recreating it from the file later produces a new agent ID and a new key; grants
that referenced the old agent are recreated by the same file, but tokens minted for the old agent stay invalid. When
the intent is only to stop an agent, set its status in the file instead of removing it.

## Limits

- Config schema version `1`; an unknown version is rejected rather than interpreted.
- Imports and applies are capped at 1 MB.
- Custom connector definitions are not part of config; import them through the connector API or dashboard.
- A production apply requires the organization's plan to allow the operation, like any other management call.
