import type { HttpClient } from "../client";
import type {
  ConnectorList,
  CustomConnectorDetails,
  CustomConnectorList,
  ImportConnectorInput,
  ImportConnectorResult,
  RollbackConnectorResult,
} from "../types";

export class ConnectorsResource {
  constructor(private readonly http: HttpClient) {}

  /** Every connector usable in this environment: built-ins plus active custom imports. */
  list(): Promise<ConnectorList> {
    return this.http.request({ method: "GET", path: "/connectors" });
  }

  async listCustom(): Promise<CustomConnectorList> {
    const list = await this.list();
    return { object: "list", data: list.custom ?? [], builtin: list.builtin ?? [] };
  }

  get(slug: string): Promise<CustomConnectorDetails> {
    return this.http.request({ method: "GET", path: `/connectors/${encodeURIComponent(slug)}` });
  }

  /** Import an OpenAPI 3 document. Re-importing an unchanged spec is a no-op. */
  import(input: ImportConnectorInput): Promise<ImportConnectorResult> {
    return this.http.request({ method: "POST", path: "/connectors", body: input });
  }

  rollback(slug: string, version: number): Promise<RollbackConnectorResult> {
    return this.http.request({
      method: "POST",
      path: `/connectors/${encodeURIComponent(slug)}/rollback`,
      body: { version },
    });
  }

  archive(slug: string): Promise<{ object: "custom_connector"; slug: string; archived: true; id: string }> {
    return this.http.request({ method: "DELETE", path: `/connectors/${encodeURIComponent(slug)}` });
  }
}
