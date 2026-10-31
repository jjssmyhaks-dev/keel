import type { HttpClient } from "../client";
import type { AuditListParams, AuditPage, AuditVerification } from "../types";

export class AuditResource {
  constructor(private readonly http: HttpClient) {}

  list(params: AuditListParams = {}): Promise<AuditPage> {
    return this.http.request({
      method: "GET",
      path: "/audit",
      query: {
        agent: params.agent,
        action: params.action,
        outcome: params.outcome,
        from: params.from,
        to: params.to,
        before: params.before,
        limit: params.limit,
        order: params.order,
      },
    });
  }

  verify(params: { from?: number; to?: number } = {}): Promise<AuditVerification> {
    return this.http.request({
      method: "GET",
      path: "/audit/verify",
      query: params,
    });
  }

  /** Export returns the raw file contents (CSV or newline-delimited JSON). */
  export(
    params: {
      format?: "csv" | "jsonl";
      from?: string;
      to?: string;
      agent?: string;
      action?: string;
    } = {},
  ): Promise<string> {
    return this.http.request({
      method: "GET",
      path: "/audit/export",
      query: {
        format: params.format ?? "jsonl",
        from: params.from,
        to: params.to,
        agent: params.agent,
        action: params.action,
      },
      rawText: true,
    });
  }
}
