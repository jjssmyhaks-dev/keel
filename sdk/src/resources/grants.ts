import type { HttpClient } from "../client";
import type {
  CreateGrantInput,
  Grant,
  GrantRequest,
  GrantRequestInput,
  List,
  UpdateGrantInput,
} from "../types";

export class GrantsResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * Ask for just-in-time access. The grant stays inert until an approver
   * activates it; call this from an agent token, not a secret key.
   */
  request(input: GrantRequestInput, options: { agentToken?: string } = {}): Promise<GrantRequest> {
    return this.http.request({
      method: "POST",
      path: "/grants/request",
      agentToken: options.agentToken,
      body: input,
    });
  }

  create(input: CreateGrantInput): Promise<Grant> {
    return this.http.request({ method: "POST", path: "/grants", body: input });
  }

  list(params: { agent?: string; credential?: string } = {}): Promise<List<Grant>> {
    return this.http.request({ method: "GET", path: "/grants", query: params });
  }

  get(id: string): Promise<Grant> {
    return this.http.request({ method: "GET", path: `/grants/${encodeURIComponent(id)}` });
  }

  update(id: string, patch: UpdateGrantInput): Promise<Grant> {
    return this.http.request({
      method: "PATCH",
      path: `/grants/${encodeURIComponent(id)}`,
      body: patch,
    });
  }

  remove(id: string): Promise<{ id: string; object: "grant"; deleted: true }> {
    return this.http.request({ method: "DELETE", path: `/grants/${encodeURIComponent(id)}` });
  }
}
