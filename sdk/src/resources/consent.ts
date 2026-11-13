import type { HttpClient } from "../client";
import type { ConsentRequestCreated, ConsentRequestInput, ConsentTokenGrant } from "../types";

export class ConsentResource {
  constructor(private readonly http: HttpClient) {}

  /** Create a hosted consent request; redirect the end user to `url`. */
  createRequest(input: ConsentRequestInput): Promise<ConsentRequestCreated> {
    return this.http.request({ method: "POST", path: "/consent/requests", body: input });
  }

  /** Exchange the one-time code from the redirect for a consent-scoped agent token. */
  exchangeCode(input: { code: string; redirectUri: string }): Promise<ConsentTokenGrant> {
    return this.http.request({ method: "POST", path: "/consent/token", body: input });
  }

  /** Mint a fresh short-lived token for an active consent without a new redirect. */
  mintToken(consentId: string): Promise<ConsentTokenGrant> {
    return this.http.request({
      method: "POST",
      path: `/consent/${encodeURIComponent(consentId)}/token`,
    });
  }

  revoke(consentId: string, input: { reason?: string } = {}): Promise<{
    id: string;
    agentId: string;
    endUserId: string;
    revokedAt: string | null;
  }> {
    return this.http.request({
      method: "POST",
      path: `/consent/${encodeURIComponent(consentId)}/revoke`,
      body: input,
    });
  }
}
