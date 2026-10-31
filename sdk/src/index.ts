import { HttpClient, type HttpClientOptions } from "./client";
import { AgentsResource } from "./resources/agents";
import { ApprovalsResource } from "./resources/approvals";
import { AuditResource } from "./resources/audit";
import { ConnectorsResource } from "./resources/connectors";
import { GrantsResource } from "./resources/grants";
import { PoliciesResource } from "./resources/policies";
import { ProxyResource } from "./resources/proxy";
import { TokensResource } from "./resources/tokens";
import { VaultResource } from "./resources/vault";
import { WebhooksResource } from "./resources/webhooks";
import type { ApiKeyContext } from "./types";

export type KeelOptions = HttpClientOptions;

/**
 * Server-side Keel client. The key's environment is the client's
 * environment; there is no environment parameter to forget.
 */
export class Keel {
  readonly agents: AgentsResource;
  readonly tokens: TokensResource;
  readonly vault: VaultResource;
  readonly grants: GrantsResource;
  readonly policies: PoliciesResource;
  readonly proxy: ProxyResource;
  readonly approvals: ApprovalsResource;
  readonly audit: AuditResource;
  readonly webhooks: WebhooksResource;
  readonly connectors: ConnectorsResource;

  private readonly http: HttpClient;

  constructor(options: KeelOptions) {
    this.http = new HttpClient(options);
    this.agents = new AgentsResource(this.http);
    this.tokens = new TokensResource(this.http);
    this.vault = new VaultResource(this.http);
    this.grants = new GrantsResource(this.http);
    this.policies = new PoliciesResource(this.http);
    this.proxy = new ProxyResource(this.http, this.agents);
    this.approvals = new ApprovalsResource(this.http);
    this.audit = new AuditResource(this.http);
    this.webhooks = new WebhooksResource(this.http);
    this.connectors = new ConnectorsResource(this.http);
  }

  /** Organisation, project, environment and key metadata for this key. */
  me(): Promise<ApiKeyContext> {
    return this.http.request({ method: "GET", path: "/me" });
  }
}

export { KeelError, isKeelError } from "./errors";
export { signChallenge, generateAgentKeypair, type SignedChallenge } from "./signing";
export { verifyWebhook, type VerifyWebhookOptions } from "./resources/webhooks";
export type * from "./types";
