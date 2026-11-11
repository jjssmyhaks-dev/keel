# Backup and disaster recovery

Authab keeps workspace metadata, credential ciphertext and the audit chain in Postgres (Neon). This runbook covers the two recovery paths we have:

1. **Point-in-time restore** inside Neon — the fast path for accidental writes, dropped rows or a bad migration.
2. **Logical backup and restore** via `scripts/backup-db.mjs` and `scripts/restore-db.mjs` — portable copies for long-term retention, cross-project recovery and restore rehearsals.

Prisma migrations own the schema. A logical backup contains **data only**; the target database must be migrated to the same schema before a restore.

## Key material is a separate asset

The logical backup stores credential ciphertext exactly as Postgres holds it. It does **not** contain `MASTER_KEY`, `JWT_SIGNING_PRIVATE_KEY` or `AUTH_COOKIE_SECRET`. Without the master key, restored vault rows cannot be decrypted and the audit payloads are still readable but sealed SSO secrets are not.

Keep all three in the deployment platform's secret manager and back that manager up under the same retention policy. A database backup without the master key is not a recoverable backup.

## What is in a backup

- Every table in schema `public` except `_prisma_migrations` and Prisma-internal tables.
- Timestamp columns are exported as raw `timestamp` text under `TIME ZONE 'UTC'`, so restores are independent of the machine timezone.
- A header, one section per table, and a summary line with row counts and audit-chain heads (latest `seq` and `hash` per environment).
- SHA-256 of the compressed file in a `.sha256` sidecar.

Encrypted credentials, password hashes, session token hashes and API-key hashes are included. Treat a backup file as production data: encrypt at rest, restrict access, and delete expired copies.

## Taking a backup

```bash
npm run db:backup
# or: node --env-file=.env scripts/backup-db.mjs --out /secure/path
```

The tool uses `DATABASE_URL_UNPOOLED` (direct connection) by default. It reads the whole database in one `REPEATABLE READ` read-only transaction, so every table reflects a single snapshot. Output:

- `.backups/authab-<database>-<timestamp>.jsonl.gz`
- `.backups/...jsonl.gz.sha256`

Record the printed `sha256`, row count and duration in the operations log. Copy the file and sidecar to durable storage outside the database provider — a backup held only in the same project is not a disaster-recovery control.

Suggested operating cadence for this stage of the product: daily logical backup, 35-day retention, monthly restore rehearsal. Increase frequency with data volume or RPO requirements.

## Restoring

```bash
# 1. Validate the backup and the target schema. No writes.
npm run db:restore:dry -- --file .backups/<file>.jsonl.gz --target "postgresql://..."

# 2. Migrate the target first if it is a fresh database.
DATABASE_URL="postgresql://..." npx prisma migrate deploy

# 3. Restore (destructive).
npm run db:restore -- --file .backups/<file>.jsonl.gz --target "postgresql://..."
```

Restore properties:

- `--target` is mandatory. The tool never falls back to `DATABASE_URL`, so a missing flag cannot wipe the configured database.
- If the target host and database match the backup source, the tool refuses unless `--force` is passed. Restoring in place is a deliberate act.
- The file checksum is verified before connecting. `--skip-checksum` exists for corrupted-sidecar emergencies only.
- The target schema must contain every table in the backup, in an order consistent with its foreign keys.
- All rows are truncated and reloaded in **one transaction**. Any insert, row-count or audit-head mismatch rolls back.
- Audit truncation opts in with `SET LOCAL app.audit_maintenance = 'on'`; the WORM trigger blocks it otherwise.
- After commit, the tool verifies per-table row counts and compares the latest audit `seq`/`hash` per environment with the manifest.

A complete recovery also needs the matching application keys, a deployed build and DNS/traffic cutover. The restore step itself is the database portion only.

## Current recovery objectives

Observed on 11 November 2026 for the current data size:

| Control | Value |
| --- | --- |
| Neon point-in-time history window | 6 hours (project setting `history_retention_seconds = 21600`) |
| Logical backup cadence | Daily (recommended) |
| Backup duration, 47 tables / 511 rows | 18–21 s |
| Restore duration, same data, remote branch | 11–13 s |
| Restore rehearsal verification | 47/47 tables, 511/511 rows, 6/6 audit chains valid |

These are **measured, not targets**. For production, set a defined RPO (for example 1 hour) and configure Neon history retention and backup cadence to meet it. The current 6-hour PITR window is not sufficient for a 1-hour RPO across a full day; a logical backup closes the gap only up to its cadence. Raise `history_retention_seconds` on the production project when the plan allows it.

## Restore rehearsal record

Performed 11 November 2026 against Neon project `royal-lab-65524291` (Singapore):

1. Took a logical backup: 47 tables, 511 rows, 218 audit events, 50,281 bytes gzipped, SHA-256 `6034cebd…5b79`.
2. Created a throwaway branch `restore-rehearsal` from `main` and applied migrations where needed.
3. Ran the restore tool against the branch's direct endpoint. It truncated and reloaded all tables in one transaction; row counts and audit heads matched.
4. Ran the application's own `verifyAuditChain` against the branch for every environment: 145 + 58 + 9 + 2 + 2 + 2 = 218 events verified, zero breaks.
5. Proved the TRUNCATE guard: a bare `TRUNCATE "AuditEvent"` failed with SQLSTATE `55000`; the same statement inside `SET LOCAL app.audit_maintenance = 'on'` succeeded and a rollback preserved all 218 rows.
6. Re-ran the full restore with the guard installed; it succeeded via the maintenance opt-in.
7. Deleted the rehearsal branch.

The checksum step caught a real defect during this rehearsal: an early build hashed the plaintext stream but wrote the sidecar for the compressed file. The restore refused the file, the bug was fixed, and the rehearsal was repeated from a fresh backup. That is the value of exercising the restore, not just writing it.

## Incident procedures

**Bad application write or migration, data still in Neon.** Open the Neon console, create a branch from the point in time before the change, validate it with the audit verification and a row-count diff, then either promote the branch or run a logical restore from it. Do not attempt to repair hash-chained audit rows in place.

**Database unavailable or corrupted.** Restore the latest verified logical backup into a new Neon project or branch, run `prisma migrate deploy`, start the application with the same key material, verify the audit chain, then move traffic. Expect the restore plus deployment time; the measured database portion is minutes at current size.

**Lost master key.** Credentials sealed under that key cannot be recovered. Restore the key from the secret manager; if it is gone, every vaulted credential must be rotated and re-entered by workspace owners. Audit rows remain, but sealed values are unreadable.

**Region or provider outage.** Backup files are portable. Provision Postgres elsewhere, migrate, restore, point the application's `DATABASE_URL` at it and redeploy. Verify the audit chain before admitting traffic.

## Honest limits

- There is no automated off-site backup schedule wired into this repository yet. The scripts are real and exercised; the scheduler and storage bucket are deployment work.
- The restore tool truncates and reloads; it is not an online migration tool.
- A logical backup at daily cadence with a 6-hour PITR window does not meet a strict 1-hour RPO. That is a configuration decision for the production project, stated here so the gap is not mistaken for coverage.
- The rehearsals above were run against a branch of the development project, at demo data volume. A production rehearsal at real volume is still required.
