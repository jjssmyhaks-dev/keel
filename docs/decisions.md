# Decisions log

Engineering decisions and verification records for the Part 1 foundations build.

## 2026-11-12 — Green baseline (Task 0)

- Node.js: v24.17.0; npm 11.13.0 (CI targets Node 22).
- Commands that passed, in order:
  - `npm ci`
  - `npx prisma generate`
  - `npm test` — 194 tests
  - `npm run connectors:check`
  - `npm run typecheck`
  - `npm run build`
  - `npm run sdk:build`
  - `npm run sdk:test`
  - `npm run cli:typecheck`
  - `npm run cli:build`
  - `npm run mcp:typecheck`
  - `npm run mcp:build`
  - `python -m unittest discover -s python/tests -v` — 39 tests
- CI workflow `.github/workflows/ci.yml` runs on pushes to `main` and on pull requests; the README carries its badge.
- The database-backed acceptance checks below ran against the Neon branch because CI has no `DATABASE_URL`; the new test files are DB-free.

## Ambiguity decisions

The build document asks for the simplest option consistent with its text, recorded here.

1. **Identity document staleness uses embedded fields, not `Agent.updatedAt`.** The nightly repair re-issues a document when its embedded `status`, `key_fingerprint` or `visibility` disagrees with the agent row. `updatedAt` moves on every activity touch, which would re-issue documents constantly and inflate `doc_seq`.
2. **Unknown agent status maps to `revoked`; an absent or invalid `verificationVisibility` maps to `public`.** The document must never overstate access, so an unrecognised status is treated as revoked. Visibility defaults to the schema default (`public`); enforcement is deferred to the Release 1.1 public endpoint, as the document specifies.
3. **Issuance during agent actions is best-effort; the read endpoint is authoritative.** Status-changing actions call `issueIdentityDocumentSafe`, which logs and audits `identity.issue_failed` instead of failing a kill/rotate/pause. `GET /api/v1/agents/:id/identity-document` backfills a missing document and returns `503 identity_document_unavailable` if signing still fails, so a caller never receives an unverifiable document.
4. **Revocation list semantics.** `environment` in the signed payload is derived from the caller environment's type (`production`, otherwise `development`); `since` is inclusive (`revokedAt >= since`); a cursor is the last row id from the previous page, validated against the caller's environment (`422 invalid_cursor` otherwise); `nextAfter` returns a cursor only when the page is full. The ETag is computed over the revocation list alone so it stays stable while `iat` and `exp` move, and both `200` and `304` carry `Cache-Control: private, max-age=30`.
5. **Revocation and telemetry writes never throw.** `recordRevocation` returns `false` and logs when the write fails; `recordAgentEvent` and `recordPolicyEvent` log and swallow. A kill switch, grant change or approval must not fail because a feed row or learning event could not be stored. A missed revocation row is therefore possible if the database is unavailable at status-change time; the identity document and agent status remain authoritative.
6. **Environment-wide approval policies store `agentId: ""`.** `PolicyEvent.agentId` is a required string and an environment-wide policy has no agent, so the writer receives an empty string and `agentType` falls back to `"other"`. The subject and `approvalPolicyId` identify the policy.
7. **Just-in-time grant activation.** The approval request itself writes no `PolicyEvent`; approving a `jit_grant` writes one event with subject `jit_grant`, change kind `update` and the activated grant's fields. When the approver also chooses "approve always", a second event with subject `grant` and change kind `update` links to the previous grant event through `changedFromEventId`.
8. **Expired approvals produce one `denied`/`approval_expired` event.** Both the stale-approval sweep and a late decision attempt write it, but each is guarded by a conditional update on `status: "pending"`, so at most one event is written per request.
9. **Sandbox policy changes are flagged.** Sandbox helpers already set `isSandbox: true`; the grant create/update/delete API routes now also set it when the credential's connector is `sandbox`, so playground grants do not look like production learning data.
10. **Data contribution is resolved at write time.** Both event writers read the organization's current `dataContributionEnabled` when `contributes` is not supplied. Turning the setting off stops future contribution and excludes the organization's history from aggregates through `contributingOrgFilter()`; existing rows are not rewritten.
11. **The data-contribution migration opts existing organizations out.** It adds the column with `DEFAULT true`, then runs one `UPDATE "Organization" SET "dataContributionEnabled" = false` so every pre-existing organization is recorded as not consented. New organizations keep the `true` default because organization provisioning does not override it.

## 2026-11-13 — Part 2 ambiguity decisions (consent, trust, configuration)

The Part 2 build document leaves scope open in several places; the simplest reading consistent with the text is recorded below.

1. **Consent requests are limited to internal agents.** A shadow agent acts for another organization, so asking an end user to consent to it would attribute one organization's data flow to a keyless proxy. `POST /consent/requests` rejects `kind: "external"` agents with `422 agent_not_consentable`.
2. **Consent is bounded by project settings, not by the caller.** `ConsentBranding` stores the product name, the redirect-URI allowlist, a risk ceiling (`maxRisk`, default `write`) and a maximum grant length (`maxGrantDays`, default 90). A request whose scopes include actions above the ceiling, or whose duration exceeds the cap, is rejected at creation and again at approval, so a stale hosted page cannot grant more than settings allow. Redirect URIs must be registered HTTPS origins and are matched exactly; there is no prefix or wildcard matching.
3. **The hosted page is the only approval surface.** The consent token is a signed, single-use bearer link (hashed at rest); the approval form is a server action on `/consent/[token]`. Coding the approval as an API call would let an agent approve its own request, so no such endpoint exists.
4. **Code and token lifetimes differ deliberately.** The one-time authorization code lives five minutes and is stored as a SHA-256 hash; it is exchanged exactly once. Consent tokens live one hour (`CONSENT_TOKEN_TTL_SECONDS = 3600`) and are revalidated against the consent record on every authenticated request, so revoking a consent invalidates already-minted tokens without a token blocklist.
5. **End-user data is isolated by credential ownership, not by scopes.** An end-user token can select only a connection whose `endUserId` matches the token's `end_user.id`; a mismatch returns `403 credential_not_owned`, and an organization token never sees end-user connections, even when it names a credential ID (`404 credential_not_found`). Scopes alone cannot express "this Slack workspace belongs to this person".
6. **Consent revocation expires grants, it does not delete them.** Revoking marks the consent and sets every grant it created to expire now. Historical audit and policy events therefore keep pointing at rows that still exist.
7. **Trust requires distinct organizations and matching environment types.** Inviting across a development/production boundary would grant a test agent production reach, so relationships are limited to same-type environments; private agents are not invitable, and each owner-environment/external-agent pair is unique so only one relationship can be open at a time.
8. **The owner gets a keyless shadow agent.** Accepting creates an agent row with `kind: "external"`, `keyMode: "external"`, no public key, and the external agent's fingerprint. Grants, approvals, rate limits, audit and revocation all run against that shadow row, which keeps the existing proxy pipeline unchanged. The external organization never receives a private key for the owner's environment.
9. **Trust exchange intersects three sets.** Issued scopes are grants ∩ `maxScopes` ∩ requested; requested scopes that fall outside are denied rather than silently filtered. Tokens are capped at 300 seconds, carry `act`, `trust` and `x_org` claims, and `authenticateAgent` re-reads the relationship on every call, so a revoked or declined relationship fails immediately and the shadow agent is also added to the signed revocation list.
10. **Configuration uses natural keys and never creates connections.** Agents match by name, grants by agent + connection + resource, webhooks by URL, approval policies by action pattern. A duplicate natural key returns `409 ambiguous_name` rather than guessing. Connections are intentionally out of scope: a config file cannot carry provider secrets, so exporting and re-applying it must not invent credentials.
11. **Production prune is explicit.** `prune` deletes objects absent from the file. It is allowed in development with a warning, and requires the `x-authab-confirm: prune` header in production (the CLI sends it only when `--prune` is passed) so a forgotten object is not destroyed by a routine apply.
12. **Apply is one transaction and one-time secrets are returned once.** The whole document applies inside `$transaction` with a 30-second timeout / 10-second wait; a validation failure leaves nothing partially applied. New agent private keys and webhook signing secrets are returned in `results` and never appear in a later export.
13. **One secret scanner serves the CLI and the dashboard.** `shared/secret-patterns.json` and `shared/scan-core.ts` are imported by both `authab scan` and the vault import server action, so the two surfaces cannot disagree about what a live key looks like. High-confidence findings exit `1` from the CLI. The dashboard reclassifies findings on the server and refuses live keys in development with an explicit message, rather than trusting the browser's classification.
14. **`--write` requires a git repository and a clean tree.** Rewriting files in place is the only destructive scanner option; refusing on a dirty tree (with `--force` as the documented override) keeps unreviewed edits from being overwritten. Dashboard import has no write mode at all — it creates vault entries, never edits source files.
15. **End-user identifiers stay out of derived data.** `AgentEvent.endUserId` exists to attribute call volume to a connection owner and to enforce per-user isolation; it is not included in configuration export, audit payload summaries, or any aggregate. Future aggregates remain gated by `contributingOrgFilter()`, which requires both `contributes: true` and an organization that currently has contribution enabled.

## Verification notes

- **`db:seed` cannot reset the Neon branch.** Deleting seeded rows trips the append-only `AuditEvent` trigger (Postgres error 55000). The guard was not bypassed. Identity documents for existing agents were issued with `npm run db:backfill-identity`, and demo agent types were set directly.
- **Platform-key agent creation fails locally.** Creating an agent with `keyMode: "platform"` calls `encryptSecret` for the project key, which currently fails with "Unsupported state or unable to authenticate data": the Neon Project row was wrapped with a different `MASTER_KEY` than the one in the local `.env`. The live approval-latency check therefore reuses the existing platform-mode demo agent `agt_atlas`. This must be resolved by restoring the original master key or re-wrapping the project key; it was not worked around in code.
- **Live acceptance checks** ran against the Neon branch with the dev server: signed identity documents verified externally against `/api/v1/jwks`, `doc_seq` superseded on kill, revocation list JWS/ETag/304/cache-control/environment isolation, PolicyEvent create/update/delete linking, AgentEvent denial capture with no request content, and an approved sandbox execution recorded with `approvalLatencyMs` > 0 and `upstreamStatusClass` 2xx. Temporary rows were removed afterwards; the audit log was left untouched.

## 2026-11-13 — Part 2 verification

Commands that passed, in order:

- `npm test` — 261 tests (the OpenAPI route-coverage file is appended to the script)
- `npm run connectors:check` — 31 connectors, 301 actions
- `npm run typecheck`
- `npm run build`
- `npm run sdk:build`, `npm run sdk:test`
- `npm run cli:typecheck`, `npm run cli:build`
- `npm run mcp:typecheck`, `npm run mcp:build`
- `python -m unittest discover -s python/tests` — 39 tests (4 skipped)

Live checks against the Neon branch and a local dev server:

- Config round trip with the development demo key: `authab config export --format yaml` produced a 214-line file; dry run reported `0 create, 0 update, 0 delete`; a real apply succeeded and wrote `config.applied` (seq 207) with zero counts. The production demo key exported and dry-ran to zero changes without writing.
- Two defects surfaced by that round trip and were fixed: `validateActions` rejected catalogue wildcards such as `sandbox.*` even though the policy engine already matches them with `globMatch` (a seeded sandbox grant could not be re-applied), and the apply planner re-resolved the hostname of every declared webhook, including unchanged existing endpoints, so a temporarily unresolvable host blocked reconciliation. New webhook URLs are still resolved and checked; existing endpoints keep their stored URL, and delivery resolves the host again at send time.
- Scanner: `authab scan` on a temporary file containing a fake `xoxb-` token reported one high-confidence Slack finding and exited `1`; `--write` without `--import` was refused as documented.
- Consent/trust APIs: missing fields return `agent_required`, `redirect_required` and `end_user_required`; an out-of-range expiry returns `invalid_expiry`; the hosted page for an unknown token renders the “This link is not valid.” state; `POST /consent/token` with a secret key and a bogus code returns `invalid_code`; trust listing rejects an unknown `side`; an unauthenticated trust exchange returns `401`.
- Not exercised live: approving a hosted consent and completing an OAuth account connection require a real end-user mailbox and provider credentials, which are not available in this workspace. Those paths are covered by the unit tests and the hosted page was rendered for an invalid-link state only.
- No demo data was deleted or rewritten. The only demo-workspace write was the intentional zero-change `config.applied` audit event; the append-only audit log was not modified.
