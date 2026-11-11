import type { HttpClient, QueryValue } from "../client";
import { signChallenge } from "../signing";
import type {
  Agent,
  AgentCreated,
  AgentDetails,
  AgentToken,
  ClientSecret,
  ClientSecretCreated,
  CreateAgentInput,
  CreateClientSecretInput,
  List,
  TokenOptions,
  UpdateAgentInput,
} from "../types";

export class AgentsResource {
  constructor(private readonly http: HttpClient) {}

  create(input: CreateAgentInput): Promise<AgentCreated> {
    return this.http.request({ method: "POST", path: "/agents", body: input });
  }

  list(params: { status?: string; tag?: string; q?: string; limit?: number } = {}): Promise<List<Agent>> {
    return this.http.request({
      method: "GET",
      path: "/agents",
      query: params as Record<string, QueryValue>,
    });
  }

  get(id: string): Promise<AgentDetails> {
    return this.http.request({ method: "GET", path: `/agents/${encodeURIComponent(id)}` });
  }

  update(id: string, patch: UpdateAgentInput): Promise<Agent> {
    return this.http.request({
      method: "PATCH",
      path: `/agents/${encodeURIComponent(id)}`,
      body: patch,
    });
  }

  /** Permanently revoke an agent and delete its grants. */
  delete(id: string): Promise<Agent & { revoked: true }> {
    return this.http.request({ method: "DELETE", path: `/agents/${encodeURIComponent(id)}` });
  }

  pause(id: string): Promise<Agent> {
    return this.action<Agent>(id, "pause");
  }

  resume(id: string): Promise<Agent> {
    return this.action<Agent>(id, "resume");
  }

  suspend(id: string): Promise<Agent> {
    return this.action<Agent>(id, "suspend");
  }

  /** Revoke tokens and retire keys immediately. Irreversible. */
  kill(id: string): Promise<Agent & { killSwitch: true }> {
    return this.action<Agent & { killSwitch: true }>(id, "kill");
  }

  rotateKey(
    id: string,
  ): Promise<Agent & { keyId: string; privateKey: string; warning: string }> {
    return this.action<Agent & { keyId: string; privateKey: string; warning: string }>(id, "rotate-key");
  }

  transfer(id: string, email: string): Promise<Agent> {
    return this.action<Agent>(id, "transfer", { email });
  }

  /**
   * Issue a short-lived agent token. Client-key-mode agents must sign a
   * challenge; pass `privateKey` and the SDK signs one for you, or pass a
   * pre-signed `challenge`/`signature` pair.
   */
  async token(id: string, options: TokenOptions = {}): Promise<AgentToken> {
    const { privateKey, ...rest } = options;
    const body: Record<string, unknown> = { ...rest };
    if (privateKey && !options.signature) {
      const signed = signChallenge(id, privateKey, options.challenge);
      body.challenge = signed.challenge;
      body.signature = signed.signature;
    }
    return this.http.request({
      method: "POST",
      path: `/agents/${encodeURIComponent(id)}/token`,
      body,
    });
  }

  /** Readiness checks and grant diff without creating a production identity. */
  previewPromotion(id: string): Promise<{
    preview: true;
    agentId: string;
    readiness: { level: "pass" | "warn" | "fail"; label: string; detail: string }[];
    diff: {
      connector: string;
      credentialName: string;
      productionCredentialName: string | null;
      granted: boolean;
      actions: string[];
      resourcePattern: string;
      approvalMode: string | null;
    }[];
    plan: string;
    alreadyInProduction: boolean;
  }> {
    return this.action<{
      preview: true;
      agentId: string;
      readiness: { level: "pass" | "warn" | "fail"; label: string; detail: string }[];
      diff: {
        connector: string;
        credentialName: string;
        productionCredentialName: string | null;
        granted: boolean;
        actions: string[];
        resourcePattern: string;
        approvalMode: string | null;
      }[];
      plan: string;
      alreadyInProduction: boolean;
    }>(id, "promote", { preview: true });
  }

  promote(
    id: string,
    input: { email: string },
  ): Promise<{
    promotionId: string;
    agent: Agent;
    privateKey: string;
    readiness: unknown;
    diff: unknown;
    safeLaunchUntil: string;
  }> {
    return this.action<{
      promotionId: string;
      agent: Agent;
      privateKey: string;
      readiness: unknown;
      diff: unknown;
      safeLaunchUntil: string;
    }>(id, "promote", input);
  }

  /** Client secrets used for OAuth client_credentials token requests. */
  listClientSecrets(id: string): Promise<List<ClientSecret>> {
    return this.http.request({ method: "GET", path: `/agents/${encodeURIComponent(id)}/client-secrets` });
  }

  /** The raw secret is returned once; only a hash is stored. */
  createClientSecret(id: string, input: CreateClientSecretInput = {}): Promise<ClientSecretCreated> {
    return this.http.request({
      method: "POST",
      path: `/agents/${encodeURIComponent(id)}/client-secrets`,
      body: input,
    });
  }

  revokeClientSecret(id: string, secretId: string): Promise<ClientSecret> {
    return this.http.request({
      method: "DELETE",
      path: `/agents/${encodeURIComponent(id)}/client-secrets/${encodeURIComponent(secretId)}`,
    });
  }

  private action<T>(id: string, action: string, body: unknown = {}): Promise<T> {
    return this.http.request({
      method: "POST",
      path: `/agents/${encodeURIComponent(id)}/${action}`,
      body,
    });
  }
}
