import type { HttpClient } from "../client";
import type {
  ApprovalMode,
  ApprovalPolicy,
  List,
  PolicyInput,
  PolicyUpdate,
} from "../types";

export class PoliciesResource {
  constructor(private readonly http: HttpClient) {}

  create(input: PolicyInput): Promise<ApprovalPolicy> {
    return this.http.request({ method: "POST", path: "/approval-policies", body: input });
  }

  list(params: { agent?: string } = {}): Promise<List<ApprovalPolicy>> {
    return this.http.request({ method: "GET", path: "/approval-policies", query: params });
  }

  get(id: string): Promise<ApprovalPolicy> {
    return this.http.request({ method: "GET", path: `/approval-policies/${encodeURIComponent(id)}` });
  }

  update(id: string, patch: PolicyUpdate): Promise<ApprovalPolicy> {
    return this.http.request({
      method: "PATCH",
      path: `/approval-policies/${encodeURIComponent(id)}`,
      body: patch,
    });
  }

  remove(id: string): Promise<{ id: string; object: "approval_policy"; deleted: true }> {
    return this.http.request({ method: "DELETE", path: `/approval-policies/${encodeURIComponent(id)}` });
  }
}

export type { ApprovalMode };
