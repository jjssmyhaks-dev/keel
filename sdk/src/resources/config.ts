import type { HttpClient } from "../client";
import type { ConfigApplyInput, ConfigApplyResult, ConfigFile } from "../types";

export class ConfigResource {
  constructor(private readonly http: HttpClient) {}

  /** Version 1 configuration with no secrets. */
  export(): Promise<ConfigFile> {
    return this.http.request({ method: "GET", path: "/config/export" });
  }

  exportYaml(): Promise<string> {
    return this.http.request({
      method: "GET",
      path: "/config/export",
      query: { format: "yaml" },
      rawText: true,
    });
  }

  /** Validates first; writes in one transaction unless dryRun is set. */
  apply(input: ConfigApplyInput): Promise<ConfigApplyResult> {
    const { confirmPrune, ...body } = input;
    return this.http.request({
      method: "POST",
      path: "/config/apply",
      body,
      headers: confirmPrune ? { "x-authab-confirm": "prune" } : undefined,
    });
  }
}
