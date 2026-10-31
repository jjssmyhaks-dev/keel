import type { HttpClient } from "../client";

export interface TokenIntrospection {
  active: boolean;
  reason?: string;
  tokenId?: string;
  agent?: { id: string; name: string; status: string };
  claims?: Record<string, unknown>;
}

export class TokensResource {
  constructor(private readonly http: HttpClient) {}

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
