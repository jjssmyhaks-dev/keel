import type { HttpClient } from "../client";
import type { ControlLink, EndUserDetails, EndUserSummary, List } from "../types";

export class EndUsersResource {
  constructor(private readonly http: HttpClient) {}

  list(): Promise<List<EndUserSummary>> {
    return this.http.request({ method: "GET", path: "/end-users" });
  }

  get(externalUserId: string): Promise<EndUserDetails> {
    return this.http.request({
      method: "GET",
      path: `/end-users/${encodeURIComponent(externalUserId)}`,
    });
  }

  /** Issue a 15-minute link to the end user's hosted control center. */
  controlLink(externalUserId: string): Promise<ControlLink> {
    return this.http.request({
      method: "POST",
      path: `/end-users/${encodeURIComponent(externalUserId)}/control-link`,
    });
  }
}
