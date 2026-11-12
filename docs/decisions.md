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

## Verification notes

- **`db:seed` cannot reset the Neon branch.** Deleting seeded rows trips the append-only `AuditEvent` trigger (Postgres error 55000). The guard was not bypassed. Identity documents for existing agents were issued with `npm run db:backfill-identity`, and demo agent types were set directly.
- **Platform-key agent creation fails locally.** Creating an agent with `keyMode: "platform"` calls `encryptSecret` for the project key, which currently fails with "Unsupported state or unable to authenticate data": the Neon Project row was wrapped with a different `MASTER_KEY` than the one in the local `.env`. The live approval-latency check therefore reuses the existing platform-mode demo agent `agt_atlas`. This must be resolved by restoring the original master key or re-wrapping the project key; it was not worked around in code.
- **Live acceptance checks** ran against the Neon branch with the dev server: signed identity documents verified externally against `/api/v1/jwks`, `doc_seq` superseded on kill, revocation list JWS/ETag/304/cache-control/environment isolation, PolicyEvent create/update/delete linking, AgentEvent denial capture with no request content, and an approved sandbox execution recorded with `approvalLatencyMs` > 0 and `upstreamStatusClass` 2xx. Temporary rows were removed afterwards; the audit log was left untouched.
