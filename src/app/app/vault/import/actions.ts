"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auditEvent } from "@/lib/audit";
import { storeCredential } from "@/lib/credentials";
import { checkPlanLimit, productionAccess } from "@/lib/limits";
import { classifyEntry } from "@/lib/secret-patterns";
import { getContext, requestMeta } from "@/lib/session";

export type ImportRow = {
  connector: string;
  type: string;
  variables: string[];
  fields: Record<string, string>;
};

export type ImportActionResult =
  | { ok: true }
  | { ok: false; error: "permission" | "production" | "plan" | "limit" | "live_key" | "invalid" | "failed"; message: string };

const LIVE_KEY_MESSAGE = "This looks like a live key. Switch to the production environment to import it.";

export async function importEnvAction(rows: ImportRow[]): Promise<ImportActionResult> {
  const ctx = await getContext();
  if (!ctx.capabilities.manageCredentials) {
    return { ok: false, error: "permission", message: "Your role cannot add connections in this environment." };
  }
  if (ctx.isProduction && !ctx.capabilities.writeProduction) {
    return { ok: false, error: "production", message: "Only owners and admins can add production connections." };
  }
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 20) {
    return { ok: false, error: "invalid", message: "Select between one and twenty connections to import." };
  }

  if (ctx.isProduction && !productionAccess(ctx.org.plan, ctx.org.planStatus).allowed) {
    return { ok: false, error: "plan", message: "Production mode requires a paid plan. Upgrade the workspace in Billing." };
  }
  const quota = await checkPlanLimit(ctx.org.id, "credentials", ctx.org.plan, ctx.org.planStatus);
  if (!quota.allowed || (quota.limit >= 0 && quota.used + rows.length > quota.limit)) {
    return {
      ok: false,
      error: "limit",
      message: quota.allowed
        ? `This import needs ${rows.length} connection slots and the ${quota.planName} plan has ${Math.max(quota.limit - quota.used, 0)} left. Upgrade the workspace in Billing or import fewer entries.`
        : quota.message,
    };
  }

  for (const row of rows) {
    if (
      !row ||
      typeof row.connector !== "string" ||
      !row.connector ||
      !row.fields ||
      typeof row.fields !== "object" ||
      !Array.isArray(row.variables)
    ) {
      return { ok: false, error: "invalid", message: "One of the selected rows is malformed. Scan the file again." };
    }
    for (const value of Object.values(row.fields)) {
      if (typeof value !== "string") {
        return { ok: false, error: "invalid", message: "One of the selected rows is malformed. Scan the file again." };
      }
      const live = classifyEntry("", value)?.environmentHint === "live";
      if (live && !ctx.isProduction) {
        return { ok: false, error: "live_key", message: LIVE_KEY_MESSAGE };
      }
    }
  }

  const meta = await requestMeta();
  const created: string[] = [];
  let failed = 0;

  for (const row of rows) {
    const stored = await storeCredential({
      projectId: ctx.project.id,
      environmentId: ctx.environment.id,
      connectorSlug: row.connector,
      type: typeof row.type === "string" && row.type ? row.type : undefined,
      fields: row.fields,
      createdBy: ctx.user.id,
    });
    if (!stored.ok) {
      failed += 1;
      continue;
    }
    created.push(stored.credential.id);
    await auditEvent({
      environmentId: ctx.environment.id,
      actorType: "human",
      actorId: ctx.user.id,
      actorName: ctx.user.name,
      action: "credential.imported",
      resourceType: "credential",
      resourceId: stored.credential.id,
      outcome: "recorded",
      ip: meta.ip,
      payloadSummary: {
        connector: stored.credential.connectorSlug,
        variables: row.variables.filter((name): name is string => typeof name === "string").slice(0, 20),
      },
    });
  }

  revalidatePath("/app", "layout");
  if (!created.length) {
    return {
      ok: false,
      error: "failed",
      message: "Nothing was imported. Check the connector fields and try again, or add the connection manually.",
    };
  }
  redirect(`/app/vault/import?imported=${created.join(",")}${failed ? `&failed=${failed}` : ""}`);
}
