"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getContext } from "@/lib/session";
import { signAgentToken } from "@/lib/jwt";
import { auditEvent } from "@/lib/audit";
import { SANDBOX_CONNECTOR } from "@/lib/connectors";
import { ensureSandboxConnection, ensureSandboxGrant } from "@/lib/sandbox";
import { POST as proxyPOST } from "@/app/api/v1/proxy/[connector]/route";

export type PlaygroundRunState = {
  ok: boolean;
  error?: string;
  httpStatus?: number;
  requestId?: string;
  durationMs?: number;
  payload?: unknown;
  provisioned?: boolean;
};

function field(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

export async function runSandboxAction(
  _prev: PlaygroundRunState | null,
  formData: FormData,
): Promise<PlaygroundRunState> {
  const ctx = await getContext();
  if (!ctx.capabilities.manageAgents || !ctx.capabilities.manageCredentials || !ctx.capabilities.manageGrants) {
    return {
      ok: false,
      error:
        "Only owners, admins and developers with vault and grant access can run sandbox calls in this environment.",
    };
  }

  const actionName = field(formData, "action");
  const agentId = field(formData, "agentId");
  const resource = field(formData, "resource").trim();
  const rawInput = field(formData, "input").trim();

  const action = SANDBOX_CONNECTOR.actions.find((entry) => entry.name === actionName);
  if (!action) return { ok: false, error: "Pick an action from the sandbox catalogue." };

  let input: Record<string, unknown> = {};
  if (rawInput) {
    if (rawInput.length > 20_000) return { ok: false, error: "Sandbox input is limited to 20 KB." };
    try {
      const parsed = JSON.parse(rawInput) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
      input = parsed as Record<string, unknown>;
    } catch {
      return { ok: false, error: 'Input must be a JSON object, for example {"amount": 4200}.' };
    }
  }

  const agent = await db.agent.findFirst({
    where: { id: agentId, environmentId: ctx.environment.id },
  });
  if (!agent) return { ok: false, error: "Pick an agent from this environment." };
  if (agent.status !== "active") {
    return { ok: false, error: `${agent.name} is ${agent.status}. Resume it before running a call.` };
  }
  if (agent.keyMode === "client") {
    return {
      ok: false,
      error: `${agent.name} holds its own private key. Tokens for client-held keys must be issued from your backend with a signed challenge.`,
    };
  }

  const requestHeaders = await headers();
  const forwardedFor = requestHeaders.get("x-forwarded-for");
  const realIp = requestHeaders.get("x-real-ip");
  const ip = forwardedFor?.split(",")[0]?.trim() || realIp || undefined;

  const connection = await ensureSandboxConnection({
    environmentId: ctx.environment.id,
    userId: ctx.user.id,
    actorName: ctx.user.name,
    ip,
  });
  const grant = await ensureSandboxGrant({
    environmentId: ctx.environment.id,
    organizationId: ctx.org.id,
    agentId: agent.id,
    credentialId: connection.credential.id,
    userId: ctx.user.id,
    actorName: ctx.user.name,
    ip,
  });

  let scopes: string[] = ["sandbox.*"];
  try {
    const parsed = JSON.parse(grant.grant.actionsJson || "[]") as unknown;
    if (Array.isArray(parsed)) {
      scopes = parsed.filter((scope): scope is string => typeof scope === "string");
    }
  } catch {
    // Keep the scoped default; the proxy enforces whatever the grant says.
  }

  const issued = await signAgentToken(
    {
      agentId: agent.id,
      environmentId: ctx.environment.id,
      projectId: ctx.project.id,
      organizationId: ctx.org.id,
      principalId: ctx.user.id,
      scopes,
    },
    60,
  );

  await auditEvent({
    environmentId: ctx.environment.id,
    actorType: "human",
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    agentId: agent.id,
    action: "token.issued",
    resourceType: "token",
    resourceId: issued.tokenId,
    outcome: "recorded",
    ip,
    payloadSummary: { ttl: issued.expiresIn, scopes, method: "playground" },
  });

  const proxyHeaders: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${issued.token}`,
  };
  if (forwardedFor) proxyHeaders["x-forwarded-for"] = forwardedFor;
  if (realIp) proxyHeaders["x-real-ip"] = realIp;

  const started = Date.now();
  let response: Response;
  try {
    response = await proxyPOST(
      new Request("https://authab.internal/api/v1/proxy/sandbox", {
        method: "POST",
        headers: proxyHeaders,
        body: JSON.stringify({ action: actionName, ...(resource ? { resource } : {}), input }),
      }),
      { params: Promise.resolve({ connector: "sandbox" }) },
    );
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "The proxy call failed." };
  }

  const payload = (await response.json().catch(() => null)) as unknown;
  revalidatePath("/app", "layout");

  return {
    ok: response.ok,
    httpStatus: response.status,
    requestId: response.headers.get("x-request-id") ?? undefined,
    durationMs: Date.now() - started,
    payload,
    provisioned: connection.created || grant.created,
  };
}
