import type { HttpClient } from "../client";
import type { TrustInviteInput, TrustRelationship, TrustStatus } from "../types";

export class TrustResource {
  constructor(private readonly http: HttpClient) {}

  /** Relationships this environment owns, or ones where it is the external party. */
  list(params: { side?: "owner" | "external" } = {}): Promise<{
    side: "owner" | "external";
    relationships: TrustRelationship[];
  }> {
    return this.http.request({ method: "GET", path: "/trust-relationships", query: params });
  }

  /** Invite another organization's internal agent. The invitation is accepted from their side. */
  create(input: TrustInviteInput): Promise<{
    id: string;
    status: TrustStatus;
    externalAgentId: string;
    externalEnvironmentId: string;
    maxScopes: string[];
    note: string | null;
    invitedAt: string;
  }> {
    return this.http.request({ method: "POST", path: "/trust-relationships", body: input });
  }

  /** Accept as the external organization. Creates the shadow agent this side will call through. */
  accept(id: string): Promise<{ id: string; status: "active"; shadowAgentId: string }> {
    return this.http.request({
      method: "POST",
      path: `/trust-relationships/${encodeURIComponent(id)}/accept`,
    });
  }

  decline(id: string): Promise<{ id: string; status: "declined" }> {
    return this.http.request({
      method: "POST",
      path: `/trust-relationships/${encodeURIComponent(id)}/decline`,
    });
  }

  revoke(id: string): Promise<{ id: string; status: "revoked"; revokedAt?: string; alreadyRevoked?: boolean }> {
    return this.http.request({
      method: "POST",
      path: `/trust-relationships/${encodeURIComponent(id)}/revoke`,
    });
  }
}
