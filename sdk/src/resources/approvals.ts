import type { HttpClient } from "../client";
import type {
  Approval,
  ApprovalDecision,
  List,
} from "../types";

export class ApprovalsResource {
  constructor(private readonly http: HttpClient) {}

  list(
    params: { status?: string; agentId?: string; risk?: string; limit?: number } = {},
  ): Promise<List<Approval>> {
    return this.http.request({
      method: "GET",
      path: "/approvals",
      query: {
        status: params.status,
        agent: params.agentId,
        risk: params.risk,
        limit: params.limit,
      },
    });
  }

  get(id: string): Promise<Approval> {
    return this.http.request({ method: "GET", path: `/approvals/${encodeURIComponent(id)}` });
  }

  /** Approving executes the stored call immediately; denying closes it. */
  decide(
    id: string,
    decision: ApprovalDecision,
  ): Promise<Approval & { execution: unknown }> {
    return this.http.request({
      method: "POST",
      path: `/approvals/${encodeURIComponent(id)}`,
      body: decision,
    });
  }

  approve(id: string, options: { note?: string; approveAlways?: boolean } = {}) {
    return this.decide(id, { decision: "approve", ...options });
  }

  deny(id: string, options: { note?: string } = {}) {
    return this.decide(id, { decision: "deny", ...options });
  }
}
