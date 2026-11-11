import { writeFile } from "node:fs/promises";
import { Authab, AuthabError, type Approval, type GrantConditions } from "@authab/sdk";
import {
  UsageError,
  flagBool,
  flagList,
  flagString,
  parseArgs,
  requireFlag,
  type ParsedArgs,
} from "./args";
import { CONFIG_PATH, resolveClient, saveProfile } from "./config";
import { heading, kv, printJson, shortTime, table } from "./format";
import { promptHidden, promptText, readStdin, requireYes } from "./io";

const VERSION = "1.0.0";
const DEFAULT_BASE_URL = "https://api.authab.dev/v1";

const HELP = `authab ${VERSION} — identity, vault and governance for AI agents

Usage: authab <command> [subcommand] [options]

Authentication
  authab login --api-key sk_... [--env development] [--base-url URL]
  authab whoami [--json]

Agents
  authab agents list [--status active] [--tag research] [--json]
  authab agents create --name "Atlas" [--description ...] [--framework ...] [--tag ...]
  authab agents token <id> [--ttl 300] [--json]
  authab agents pause|resume <id>
  authab agents kill <id> --yes
  authab agents rotate-key <id>
  authab promote <id> [--confirm --email owner@example.com]

Vault
  authab vault list
  authab vault add --connector slack [--name ...] [--type oauth] [--from-stdin]
  authab vault rotate <id> [--from-stdin]
  authab vault revoke <id> --yes

Grants and policy
  authab grants list [--agent <id>]
  authab grants create --agent <id> --credential <id> --actions slack.post_message [--resource ...] [--mode ...]
  authab grants update <id> [--actions ...] [--resource ...] [--mode ...]
  authab grants rm <id> --yes

Calls and approvals
  authab call <connector.action> --agent <id> [--credential <id>] [--resource ...] [--input '{"...":...}'] [--idempotency-key ...] [--watch]
  authab approvals list [--status pending] [--risk financial]
  authab approvals show <id>
  authab approvals approve <id> [--note ...]
  authab approvals deny <id> [--note ...]

Audit
  authab audit verify
  authab audit tail [--agent <id>] [--action proxy] [--limit 20]
  authab audit export [--format jsonl|csv] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--out file]

Global
  --json      machine-readable output on read commands
  --env NAME  use a stored profile (or AUTHAB_ENV)
  --base-url  override the API origin
  --help      show this help
  --version   print the version`;

async function main(argv: string[]): Promise<void> {
  const first = argv[0];
  if (!first || first === "--help" || first === "-h" || first === "help") {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  if (first === "--version" || first === "-v" || first === "version") {
    process.stdout.write(`${VERSION}\n`);
    return;
  }

  const args = parseArgs(argv.slice(1));
  if (flagBool(args, "help")) {
    process.stdout.write(`${HELP}\n`);
    return;
  }

  switch (first) {
    case "login":
      return login(args);
    case "whoami":
      return whoami(args);
    case "agents":
      return agents(args);
    case "vault":
      return vault(args);
    case "grants":
      return grants(args);
    case "call":
      return call(args);
    case "approvals":
      return approvals(args);
    case "audit":
      return audit(args);
    case "promote":
      return promote(args);
    default:
      throw new UsageError(`Unknown command “${first}”. Run \`authab --help\`.`);
  }
}

/* ------------------------------------------------------------------ */
/* Auth                                                                */
/* ------------------------------------------------------------------ */

async function login(args: ParsedArgs) {
  const apiKey = flagString(args, "api-key") ?? (await promptHidden("Secret key: "));
  if (!apiKey.startsWith("sk_")) {
    throw new UsageError("That does not look like a secret key. Secret keys start with sk_.");
  }
  const baseUrl = flagString(args, "base-url") ?? process.env.AUTHAB_BASE_URL ?? DEFAULT_BASE_URL;
  const authab = new Authab({ apiKey, baseUrl });
  const me = await authab.me();
  const profileName = flagString(args, "env") ?? me.environment.type;

  await saveProfile(profileName, { apiKey, baseUrl: baseUrl === DEFAULT_BASE_URL ? undefined : baseUrl });

  if (flagBool(args, "json")) {
    printJson({ profile: profileName, configPath: CONFIG_PATH, ...me });
    return;
  }
  process.stdout.write(`Signed in to ${me.organization.name} (${me.environment.type}) as ${profileName}.\n`);
  if (flagString(args, "env") && flagString(args, "env") !== me.environment.type) {
    process.stderr.write(
      `warning: this key belongs to the ${me.environment.type} environment, but the profile is named “${profileName}”.\n`,
    );
  }
  process.stderr.write(`Stored in ${CONFIG_PATH} with owner-only permissions.\n`);
}

async function whoami(args: ParsedArgs) {
  const { authab, profileName, baseUrl } = await resolveClient(args);
  const me = await authab.me();
  if (flagBool(args, "json")) {
    printJson({ profile: profileName, baseUrl, ...me });
    return;
  }
  kv([
    ["Organization", `${me.organization.name} (${me.organization.plan})`],
    ["Project", me.project.name],
    ["Environment", me.environment.type],
    ["Key", `${me.key?.prefix ?? "—"} (${me.key?.type ?? "—"})`],
    ["Profile", profileName],
    ["Base URL", baseUrl],
  ]);
}

/* ------------------------------------------------------------------ */
/* Agents                                                              */
/* ------------------------------------------------------------------ */

async function agents(args: ParsedArgs) {
  const sub = args.positionals[0];
  const rest = args.positionals.slice(1);
  const { authab } = await resolveClient(args);
  const json = flagBool(args, "json");

  if (sub === "list") {
    const listed = await authab.agents.list({
      status: flagString(args, "status"),
      tag: flagList(args, "tag")[0],
      q: flagString(args, "q"),
      limit: numberFlag(args, "limit"),
    });
    if (json) return printJson(listed);
    table(
      ["id", "name", "status", "key mode", "last active"],
      listed.data.map((agent) => [
        agent.id,
        agent.name,
        agent.status,
        agent.keyMode,
        shortTime(agent.lastActiveAt),
      ]),
    );
    return;
  }

  if (sub === "create") {
    const name = requireFlag(args, "name", 'Example: authab agents create --name "Atlas Research".');
    const keyMode = flagString(args, "key-mode");
    if (keyMode && keyMode !== "client" && keyMode !== "platform") {
      throw new UsageError("--key-mode must be client or platform.");
    }
    const agent = await authab.agents.create({
      name,
      description: flagString(args, "description"),
      framework: flagString(args, "framework"),
      tags: flagList(args, "tag"),
      keyMode: keyMode as "client" | "platform" | undefined,
      publicKey: flagString(args, "public-key"),
    });
    if (json) return printJson(agent);
    kv([
      ["Agent", `${agent.name} (${agent.id})`],
      ["Status", agent.status],
      ["Key mode", agent.keyMode],
      ["Fingerprint", agent.fingerprint],
    ]);
    if (agent.privateKey) {
      process.stdout.write(`\nPrivate key (shown once):\n${agent.privateKey}\n`);
      process.stderr.write("Store this key securely. Authab cannot show it again.\n");
    }
    return;
  }

  if (sub === "token") {
    const id = requiredId(rest[0], "agent");
    const token = await authab.agents.token(id, { ttl: numberFlag(args, "ttl") });
    if (json) {
      return printJson({
        token: token.accessToken,
        tokenId: token.tokenId,
        expiresIn: token.expiresIn,
        expiresAt: token.expiresAt,
        scopes: token.scopes,
      });
    }
    process.stdout.write(`${token.accessToken}\n`);
    process.stderr.write(
      `Expires ${shortTime(token.expiresAt)} · ${token.scopes.length} scope(s) · ${token.tokenId}\n`,
    );
    return;
  }

  if (sub === "pause" || sub === "resume" || sub === "suspend") {
    const id = requiredId(rest[0], "agent");
    const agent =
      sub === "pause"
        ? await authab.agents.pause(id)
        : sub === "resume"
          ? await authab.agents.resume(id)
          : await authab.agents.suspend(id);
    if (json) return printJson(agent);
    process.stdout.write(`${agent.name} is ${agent.status}.\n`);
    return;
  }

  if (sub === "kill" || sub === "revoke") {
    const id = requiredId(rest[0], "agent");
    await requireYes(args, `Kill ${id}? This revokes tokens, retires keys and deletes grants.`);
    const agent = await authab.agents.kill(id);
    if (json) return printJson(agent);
    process.stdout.write(`${agent.name} is revoked. Its keys are retired and grants are gone.\n`);
    return;
  }

  if (sub === "rotate-key") {
    const id = requiredId(rest[0], "agent");
    const rotated = await authab.agents.rotateKey(id);
    if (json) return printJson(rotated);
    kv([
      ["Agent", `${rotated.name} (${rotated.id})`],
      ["Fingerprint", rotated.fingerprint],
    ]);
    process.stdout.write(`\nNew private key (shown once):\n${rotated.privateKey}\n`);
    process.stderr.write("The previous key remains valid for 7 days.\n");
    return;
  }

  throw new UsageError(`Unknown agents command “${sub ?? ""}”. Run \`authab --help\`.`);
}

async function promote(args: ParsedArgs) {
  const id = requiredId(args.positionals[0], "agent");
  const { authab } = await resolveClient(args);
  const json = flagBool(args, "json");

  if (!flagBool(args, "confirm")) {
    const preview = await authab.agents.previewPromotion(id);
    if (json) return printJson(preview);
    heading(`Readiness for ${id} · plan ${preview.plan}`);
    for (const check of preview.readiness) {
      process.stdout.write(`${levelLabel(check.level)}  ${check.label}\n          ${check.detail}\n`);
    }
    process.stdout.write("\nGrant diff\n");
    table(
      ["connector", "granted", "production connection", "resource", "mode"],
      preview.diff.map((row) => [
        row.connector,
        row.granted ? "yes" : "missing",
        row.productionCredentialName ?? "—",
        row.resourcePattern,
        row.approvalMode ?? "policy default",
      ]),
    );
    process.stdout.write(
      `\nRun \`authab promote ${id} --confirm --email you@example.com\` to create the production identity.\n`,
    );
    return;
  }

  const email = flagString(args, "email") ?? (await promptText("Approver email (Owner or Admin): "));
  const result = await authab.agents.promote(id, { email });
  if (json) return printJson(result);
  kv([
    ["Production agent", `${result.agent.name} (${result.agent.id})`],
    ["Fingerprint", result.agent.fingerprint],
    ["Safe launch until", shortTime(result.safeLaunchUntil)],
    ["Promotion", result.promotionId],
  ]);
  process.stdout.write(`\nProduction private key (shown once):\n${result.privateKey}\n`);
  process.stderr.write("Non-read calls require approval during safe launch.\n");
}

/* ------------------------------------------------------------------ */
/* Vault                                                               */
/* ------------------------------------------------------------------ */

async function vault(args: ParsedArgs) {
  const sub = args.positionals[0];
  const rest = args.positionals.slice(1);
  const { authab } = await resolveClient(args);
  const json = flagBool(args, "json");

  if (sub === "list") {
    const listed = await authab.vault.list({ connector: flagString(args, "connector") });
    if (json) return printJson(listed);
    table(
      ["id", "connector", "name", "status", "hint"],
      listed.data.map((credential) => [
        credential.id,
        credential.connector,
        credential.name,
        credential.status,
        credential.maskedHint,
      ]),
    );
    return;
  }

  if (sub === "add") {
    const connector = requireFlag(args, "connector", "Example: authab vault add --connector slack --from-stdin.");
    const secret = await readSecret(args, `Secret for ${connector}: `);
    const credential = await authab.vault.create({
      connector,
      name: flagString(args, "name"),
      type: flagString(args, "type"),
      secret,
      expiresAt: flagString(args, "expires"),
    });
    if (json) return printJson(credential);
    kv([
      ["Connection", `${credential.name} (${credential.id})`],
      ["Connector", credential.connector],
      ["Status", credential.status],
      ["Hint", credential.maskedHint],
    ]);
    return;
  }

  if (sub === "rotate") {
    const id = requiredId(rest[0], "connection");
    const secret = await readSecret(args, "New secret: ");
    const credential = await authab.vault.rotate(id, { secret });
    if (json) return printJson(credential);
    process.stdout.write(`Rotated ${credential.name}. New hint: ${credential.maskedHint}.\n`);
    return;
  }

  if (sub === "revoke") {
    const id = requiredId(rest[0], "connection");
    await requireYes(args, `Revoke ${id}? Grants that depend on it will fail closed.`);
    const credential = await authab.vault.revoke(id);
    if (json) return printJson(credential);
    process.stdout.write(`${credential.name} is revoked.\n`);
    return;
  }

  throw new UsageError(`Unknown vault command “${sub ?? ""}”. Run \`authab --help\`.`);
}

async function readSecret(args: ParsedArgs, prompt: string): Promise<string> {
  if (flagBool(args, "from-stdin")) return readStdin();
  return promptHidden(prompt);
}

/* ------------------------------------------------------------------ */
/* Grants                                                              */
/* ------------------------------------------------------------------ */

async function grants(args: ParsedArgs) {
  const sub = args.positionals[0];
  const rest = args.positionals.slice(1);
  const { authab } = await resolveClient(args);
  const json = flagBool(args, "json");

  if (sub === "list") {
    const listed = await authab.grants.list({ agent: flagString(args, "agent") });
    if (json) return printJson(listed);
    table(
      ["id", "agent", "connector", "actions", "resource", "mode"],
      listed.data.map((grant) => [
        grant.id,
        grant.agent?.name ?? grant.agentId,
        grant.credential?.connectorSlug ?? grant.credentialId,
        grant.actions.join(","),
        grant.resourcePattern,
        grant.approvalMode ?? "policy default",
      ]),
    );
    return;
  }

  if (sub === "create") {
    const actions = flagList(args, "actions");
    if (!actions.length) {
      throw new UsageError("Pass at least one action with --actions, for example --actions slack.post_message.");
    }
    const grant = await authab.grants.create({
      agentId: requireFlag(args, "agent", "Which agent should receive this grant?"),
      credentialId: requireFlag(args, "credential", "Which connection should it use?"),
      actions,
      resourcePattern: flagString(args, "resource"),
      approvalMode: approvalMode(args),
      purpose: flagString(args, "purpose"),
      expiresAt: flagString(args, "expires"),
      conditions: conditionsFrom(args),
    });
    if (json) return printJson(grant);
    kv([
      ["Grant", grant.id],
      ["Agent", grant.agentId],
      ["Connection", grant.credentialId],
      ["Actions", grant.actions.join(", ")],
      ["Resource", grant.resourcePattern],
      ["Approval", grant.approvalMode ?? "policy default"],
    ]);
    return;
  }

  if (sub === "update") {
    const id = requiredId(rest[0], "grant");
    const actions = flagList(args, "actions");
    const resource = flagString(args, "resource");
    const mode = approvalMode(args);
    const purpose = flagString(args, "purpose");
    const expires = flagString(args, "expires");
    const conditions = conditionsFrom(args);
    const patch = {
      ...(actions.length ? { actions } : {}),
      ...(resource ? { resourcePattern: resource } : {}),
      ...(mode !== undefined ? { approvalMode: mode } : {}),
      ...(purpose ? { purpose } : {}),
      ...(expires ? { expiresAt: expires } : {}),
      ...(conditions ? { conditions } : {}),
    };
    if (!Object.keys(patch).length) throw new UsageError("Provide a field to update.");
    const grant = await authab.grants.update(id, patch);
    if (json) return printJson(grant);
    process.stdout.write(`Updated grant ${grant.id}.\n`);
    return;
  }

  if (sub === "rm" || sub === "remove") {
    const id = requiredId(rest[0], "grant");
    await requireYes(args, `Remove grant ${id}? The agent will lose access immediately.`);
    await authab.grants.remove(id);
    process.stdout.write(`Removed grant ${id}.\n`);
    return;
  }

  throw new UsageError(`Unknown grants command “${sub ?? ""}”. Run \`authab --help\`.`);
}

function approvalMode(args: ParsedArgs): "allow" | "require_approval" | "deny" | undefined {
  const value = flagString(args, "mode");
  if (!value) return undefined;
  if (value !== "allow" && value !== "require_approval" && value !== "deny") {
    throw new UsageError("--mode must be allow, require_approval or deny.");
  }
  return value;
}

function conditionsFrom(args: ParsedArgs): GrantConditions | undefined {
  const conditions: GrantConditions = {};
  const maxCalls = numberFlag(args, "max-calls");
  const periodHours = numberFlag(args, "period-hours");
  const allowedIps = flagList(args, "allowed-ips");
  const start = flagString(args, "window-start");
  const end = flagString(args, "window-end");
  if (maxCalls !== undefined) conditions.maxCallsPerPeriod = maxCalls;
  if (periodHours !== undefined) conditions.periodHours = periodHours;
  if (allowedIps.length) conditions.allowedIps = allowedIps;
  if (start) conditions.timeWindowStart = start;
  if (end) conditions.timeWindowEnd = end;
  return Object.keys(conditions).length ? conditions : undefined;
}

/* ------------------------------------------------------------------ */
/* Proxy                                                               */
/* ------------------------------------------------------------------ */

async function call(args: ParsedArgs) {
  const action = args.positionals[0];
  if (!action) throw new UsageError("Usage: authab call slack.post_message --agent agt_... [--input '{\"channel\":\"#x\"}']");
  const agentId = requireFlag(args, "agent", "Which agent should make the call?");
  const { authab } = await resolveClient(args);
  const json = flagBool(args, "json");
  const connector = flagString(args, "connector") ?? action.split(".")[0];

  let input: Record<string, unknown> = {};
  const rawInput = flagString(args, "input");
  if (rawInput) {
    try {
      input = JSON.parse(rawInput) as Record<string, unknown>;
    } catch {
      throw new UsageError("--input must be valid JSON.");
    }
  }

  const result = await authab.proxy.call({
    agentId,
    connector,
    action,
    credentialId: flagString(args, "credential"),
    resource: flagString(args, "resource"),
    input,
    idempotencyKey: flagString(args, "idempotency-key"),
    ttl: numberFlag(args, "ttl"),
  });

  if (result.status === "executed") {
    if (json) return printJson(result);
    kv([
      ["Status", "executed"],
      ["Decision", `${result.decision.effect} · ${result.decision.source}`],
      ["Risk", result.decision.risk],
      ["Latency", `${result.result.latencyMs}ms${result.result.truncated ? " (truncated)" : ""}`],
      ["Request", result.requestId],
    ]);
    process.stdout.write(`\n${JSON.stringify(result.result.body, null, 2)}\n`);
    return;
  }

  if (json && !flagBool(args, "watch")) return printJson(result);

  process.stderr.write(`Pending approval ${result.approval.id} · ${result.approval.risk}\n`);
  process.stderr.write(`${result.approvalUrl}\n`);
  if (!flagBool(args, "watch")) {
    if (json) printJson(result);
    return;
  }

  let approval: Approval = result.approval;
  while (approval.status === "pending") {
    await sleep(2000);
    approval = await authab.approvals.get(approval.id);
    process.stderr.write(`status: ${approval.status}\n`);
  }

  if (json) return printJson({ ...result, approval });
  if (approval.status === "approved") {
    kv([
      ["Approval", `${approval.id} · approved`],
      ["Decided by", approval.decidedBy],
      ["Request", approval.requestId],
    ]);
    process.stdout.write(`\n${JSON.stringify(approval.executionResult, null, 2)}\n`);
    return;
  }

  throw new UsageError(`The approval was ${approval.status}. Nothing was executed.`);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ------------------------------------------------------------------ */
/* Approvals                                                           */
/* ------------------------------------------------------------------ */

async function approvals(args: ParsedArgs) {
  const sub = args.positionals[0];
  const rest = args.positionals.slice(1);
  const { authab } = await resolveClient(args);
  const json = flagBool(args, "json");

  if (sub === "list" || sub === undefined) {
    const listed = await authab.approvals.list({
      status: flagString(args, "status"),
      risk: flagString(args, "risk"),
      limit: numberFlag(args, "limit"),
    });
    if (json) return printJson(listed);
    table(
      ["id", "agent", "action", "risk", "status", "expires"],
      listed.data.map((approval) => [
        approval.id,
        approval.agent?.name ?? approval.agentId,
        approval.action,
        approval.risk,
        approval.status,
        shortTime(approval.expiresAt),
      ]),
    );
    return;
  }

  if (sub === "show") {
    const id = requiredId(rest[0], "approval");
    const approval = await authab.approvals.get(id);
    if (json) return printJson(approval);
    kv([
      ["Approval", approval.id],
      ["Agent", approval.agent?.name ?? approval.agentId],
      ["Action", approval.action],
      ["Risk", approval.risk],
      ["Status", approval.status],
      ["Summary", approval.summary],
      ["Expires", shortTime(approval.expiresAt)],
      ["Decided by", approval.decidedBy],
      ["Note", approval.decisionNote],
    ]);
    process.stdout.write(`\nPayload (redacted)\n${JSON.stringify(approval.payload, null, 2)}\n`);
    if (approval.executionResult) {
      process.stdout.write(`\nExecution result\n${JSON.stringify(approval.executionResult, null, 2)}\n`);
    }
    return;
  }

  if (sub === "approve" || sub === "deny") {
    const id = requiredId(rest[0], "approval");
    const note = flagString(args, "note");
    const approval =
      sub === "approve"
        ? await authab.approvals.approve(id, { note, approveAlways: flagBool(args, "always") })
        : await authab.approvals.deny(id, { note });
    if (json) return printJson(approval);
    process.stdout.write(`Approval ${approval.id} is ${approval.status}.\n`);
    if (approval.executionResult) {
      process.stdout.write(`${JSON.stringify(approval.executionResult, null, 2)}\n`);
    }
    return;
  }

  throw new UsageError(`Unknown approvals command “${sub ?? ""}”. Run \`authab --help\`.`);
}

/* ------------------------------------------------------------------ */
/* Audit                                                               */
/* ------------------------------------------------------------------ */

async function audit(args: ParsedArgs) {
  const sub = args.positionals[0];
  const { authab } = await resolveClient(args);
  const json = flagBool(args, "json");

  if (sub === "verify") {
    const result = await authab.audit.verify();
    if (json) {
      printJson(result);
    } else if (result.valid) {
      process.stdout.write(`Audit chain valid · ${result.eventsChecked} events in ${result.environment}.\n`);
    } else {
      process.stderr.write(`Audit chain BROKEN at seq ${result.brokenAtSeq ?? "unknown"}.\n`);
    }
    if (!result.valid) process.exitCode = 1;
    return;
  }

  if (sub === "tail") {
    const page = await authab.audit.list({
      agent: flagString(args, "agent"),
      action: flagString(args, "action"),
      limit: numberFlag(args, "limit") ?? 20,
      order: "desc",
    });
    if (json) return printJson(page);
    table(
      ["seq", "time", "actor", "action", "outcome"],
      page.data.map((event) => [
        String(event.seq),
        shortTime(event.timestamp),
        event.actor.name,
        event.action,
        event.outcome,
      ]),
    );
    return;
  }

  if (sub === "export") {
    const format = (flagString(args, "format") ?? "jsonl") === "csv" ? "csv" : "jsonl";
    const body = await authab.audit.export({
      format,
      from: flagString(args, "from"),
      to: flagString(args, "to"),
      agent: flagString(args, "agent"),
      action: flagString(args, "action"),
    });
    const out = flagString(args, "out");
    if (!out) {
      process.stdout.write(body.endsWith("\n") ? body : `${body}\n`);
      return;
    }
    await writeFile(out, body, "utf8");
    const count = body ? body.split("\n").filter(Boolean).length : 0;
    process.stderr.write(`Wrote ${count} event(s) to ${out} (${format}).\n`);
    return;
  }

  throw new UsageError(`Unknown audit command “${sub ?? ""}”. Run \`authab --help\`.`);
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function requiredId(value: string | undefined, noun: string): string {
  if (!value) throw new UsageError(`Provide the ${noun} id.`);
  return value;
}

function numberFlag(args: ParsedArgs, key: string): number | undefined {
  const raw = flagString(args, key);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new UsageError(`--${key} must be a number.`);
  return value;
}

function levelLabel(level: "pass" | "warn" | "fail") {
  return level === "pass" ? "PASS" : level === "warn" ? "WARN" : "FAIL";
}

/* ------------------------------------------------------------------ */

main(process.argv.slice(2)).catch((error: unknown) => {
  if (error instanceof UsageError) {
    process.stderr.write(`error: ${error.message}\n`);
    process.exitCode = 1;
    return;
  }
  if (error instanceof AuthabError) {
    process.stderr.write(`error [${error.code}]${error.status ? ` HTTP ${error.status}` : ""}: ${error.message}\n`);
    if (error.requestId) process.stderr.write(`request: ${error.requestId}\n`);
    process.exitCode = error.status === 403 ? 2 : 1;
    return;
  }
  process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
