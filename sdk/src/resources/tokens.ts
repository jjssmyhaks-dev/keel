import type { HttpClient } from "../client";
import type {
  ClientCredentialsInput,
  TokenExchangeInput,
  TokenGrant,
  TrustExchangeInput,
  TrustTokenGrant,
  WorkloadExchangeInput,
} from "../types";

export interface TokenIntrospection {
  active: boolean;
  reason?: string;
  tokenId?: string;
  agent?: { id: string; name: string; status: string };
  claims?: Record<string, unknown>;
}

function dpopHeaders(proof?: string) {
  return proof ? { DPoP: proof } : undefined;
}

function scopeBody(input: { scopes?: string[]; ttl?: number }) {
  return {
    ...(input.scopes?.length ? { scope: input.scopes.join(" ") } : {}),
    ...(input.ttl !== undefined ? { ttl: input.ttl } : {}),
  };
}

export class TokensResource {
  constructor(private readonly http: HttpClient) {}

  /** OAuth 2.0 client_credentials with an agent client secret. */
  clientCredentials(input: ClientCredentialsInput): Promise<TokenGrant> {
    return this.http.request({
      method: "POST",
      path: "/tokens/client-credentials",
      headers: dpopHeaders(input.dpopProof),
      body: {
        client_id: input.clientId,
        client_secret: input.clientSecret,
        ...scopeBody(input),
      },
    });
  }

  /** RFC 8693 token exchange: narrow or delegate an existing agent token. */
  exchange(input: TokenExchangeInput): Promise<TokenGrant> {
    return this.http.request({
      method: "POST",
      path: "/tokens/exchange",
      headers: dpopHeaders(input.dpopProof),
      body: {
        subject_token: input.subjectToken,
        subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
        ...(input.agentId ? { agent_id: input.agentId } : {}),
        ...scopeBody(input),
      },
    });
  }

  /** Exchange a workload JWT (SPIFFE, Kubernetes or OIDC) for an agent token. */
  workloadExchange(input: WorkloadExchangeInput): Promise<TokenGrant> {
    return this.http.request({
      method: "POST",
      path: "/tokens/workload-exchange",
      headers: dpopHeaders(input.dpopProof),
      body: {
        token: input.token,
        subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
        ...scopeBody(input),
      },
    });
  }

  /**
   * Cross-organization trust exchange: the external agent trades its own
   * token for a 5-minute token on the owner's shadow agent.
   */
  trustExchange(input: TrustExchangeInput): Promise<TrustTokenGrant> {
    return this.http.request({
      method: "POST",
      path: "/tokens/trust-exchange",
      body: {
        trustRelationshipId: input.trustRelationshipId,
        ...(input.scopes?.length ? { scopes: input.scopes } : {}),
        ...(input.ttl !== undefined ? { ttl: input.ttl } : {}),
      },
    });
  }

  introspect(token: string): Promise<TokenIntrospection> {
    return this.http.request({ method: "POST", path: "/tokens/introspect", body: { token } });
  }

  revoke(input: { token?: string; tokenId?: string; agentId?: string; expiresAt?: string }): Promise<{
    object: "token";
    tokenId: string;
    agentId: string;
    revoked: true;
  }> {
    return this.http.request({ method: "POST", path: "/tokens/revoke", body: input });
  }

  status(tokenId: string): Promise<{
    object: "token";
    tokenId: string;
    revoked: boolean;
    revokedAt: string | null;
  }> {
    return this.http.request({ method: "GET", path: "/tokens/revoke", query: { tokenId } });
  }
}
