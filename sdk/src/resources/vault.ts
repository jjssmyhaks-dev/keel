import type { HttpClient } from "../client";
import type {
  Credential,
  CredentialInput,
  CredentialUpdate,
  List,
} from "../types";

export class VaultResource {
  constructor(private readonly http: HttpClient) {}

  create(input: CredentialInput): Promise<Credential> {
    return this.http.request({ method: "POST", path: "/credentials", body: input });
  }

  list(params: { connector?: string } = {}): Promise<List<Credential>> {
    return this.http.request({ method: "GET", path: "/credentials", query: params });
  }

  get(id: string): Promise<Credential> {
    return this.http.request({ method: "GET", path: `/credentials/${encodeURIComponent(id)}` });
  }

  /** Rotate the stored secret. The old value is unrecoverable afterwards. */
  rotate(id: string, input: CredentialUpdate): Promise<Credential> {
    if (input.secret === undefined) {
      throw new Error("vault.rotate requires a new secret.");
    }
    return this.http.request({
      method: "PATCH",
      path: `/credentials/${encodeURIComponent(id)}`,
      body: input,
    });
  }

  update(id: string, input: CredentialUpdate): Promise<Credential> {
    return this.http.request({
      method: "PATCH",
      path: `/credentials/${encodeURIComponent(id)}`,
      body: input,
    });
  }

  revoke(id: string): Promise<Credential> {
    return this.http.request({ method: "DELETE", path: `/credentials/${encodeURIComponent(id)}` });
  }
}
