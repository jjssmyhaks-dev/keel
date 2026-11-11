import type { HttpClient } from "../client";
import type {
  CreateWorkloadIdentityInput,
  List,
  WorkloadIdentity,
} from "../types";

export class WorkloadIdentitiesResource {
  constructor(private readonly http: HttpClient) {}

  list(): Promise<List<WorkloadIdentity>> {
    return this.http.request({ method: "GET", path: "/workload-identities" });
  }

  get(id: string): Promise<WorkloadIdentity> {
    return this.http.request({ method: "GET", path: `/workload-identities/${encodeURIComponent(id)}` });
  }

  create(input: CreateWorkloadIdentityInput): Promise<WorkloadIdentity> {
    return this.http.request({ method: "POST", path: "/workload-identities", body: input });
  }

  update(id: string, patch: Partial<CreateWorkloadIdentityInput>): Promise<WorkloadIdentity> {
    return this.http.request({
      method: "PATCH",
      path: `/workload-identities/${encodeURIComponent(id)}`,
      body: patch,
    });
  }

  remove(id: string): Promise<{ object: "workload_identity"; id: string; deleted: true }> {
    return this.http.request({ method: "DELETE", path: `/workload-identities/${encodeURIComponent(id)}` });
  }
}
