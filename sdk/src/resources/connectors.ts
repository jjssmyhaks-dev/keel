import type { HttpClient } from "../client";
import type { Connector, List } from "../types";

export class ConnectorsResource {
  constructor(private readonly http: HttpClient) {}

  list(): Promise<List<Connector>> {
    return this.http.request({ method: "GET", path: "/connectors" });
  }
}
