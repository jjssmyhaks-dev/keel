import { randomUUID } from "node:crypto";
import type { HttpClient } from "../client";
import { KeelError } from "../errors";
import type { AgentsResource } from "./agents";
import type { ProxyCallInput, ProxyResponse } from "../types";

export class ProxyResource {
  constructor(
    private readonly http: HttpClient,
    private readonly agents: AgentsResource,
  ) {}

  /**
   * Execute a governed connector call. Pass an agent token directly, or an
   * agent id and the SDK mints a short-lived token first. A pending approval
   * is returned as a value, not thrown; a policy denial throws KeelError.
   */
  async call(input: ProxyCallInput): Promise<ProxyResponse> {
    const connector = input.connector || input.action.split(".")[0];
    if (!connector || !input.action) {
      throw new KeelError({
        status: 0,
        code: "invalid_call",
        message: "proxy.call requires a connector and an action (for example slack.post_message).",
      });
    }

    let token = input.token;
    if (!token) {
      if (!input.agentId) {
        throw new KeelError({
          status: 0,
          code: "token_or_agent_required",
          message: "proxy.call requires either an agent token or an agentId to mint one.",
        });
      }
      const issued = await this.agents.token(input.agentId, {
        ttl: input.ttl,
        privateKey: input.privateKey,
      });
      token = issued.accessToken;
    }

    const idempotencyKey = input.idempotencyKey ?? `sdk_${randomUUID()}`;
    return this.http.request<ProxyResponse>({
      method: "POST",
      path: `/proxy/${encodeURIComponent(connector)}`,
      agentToken: token,
      idempotencyKey,
      retryable: true,
      body: {
        action: input.action,
        credentialId: input.credentialId,
        resource: input.resource,
        input: input.input ?? {},
      },
    });
  }
}
