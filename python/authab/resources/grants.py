"""Grants: which agent may use which connection, for which actions."""

from __future__ import annotations

from typing import Any, Optional

from .._utils import UNSET, body, payload, query, seg
from ..http import HttpTransport


class GrantsResource:
    def __init__(self, http: HttpTransport) -> None:
        self._http = http

    def create(
        self,
        *,
        agent_id: str,
        credential_id: str,
        actions: list[str],
        resource_pattern: Optional[str] = None,
        conditions: Optional[dict[str, Any]] = None,
        approval_mode: Optional[str] = None,
        purpose: Optional[str] = None,
        expires_at: Optional[str] = None,
    ) -> dict[str, Any]:
        return self._http.request(
            "POST",
            "/grants",
            body=body(
                agentId=agent_id,
                credentialId=credential_id,
                actions=actions,
                resourcePattern=resource_pattern,
                conditions=conditions,
                approvalMode=approval_mode,
                purpose=purpose,
                expiresAt=expires_at,
            ),
        )

    def request(
        self,
        *,
        actions: list[str],
        reason: str,
        credential_id: Optional[str] = None,
        connector: Optional[str] = None,
        resource_pattern: Optional[str] = None,
        duration_minutes: Optional[int] = None,
        agent_token: Optional[str] = None,
    ) -> dict[str, Any]:
        """Ask for just-in-time access as an agent; the grant stays inert until approved."""

        return self._http.request(
            "POST",
            "/grants/request",
            agent_token=agent_token,
            body=body(
                credentialId=credential_id,
                connector=connector,
                actions=actions,
                resourcePattern=resource_pattern,
                reason=reason,
                durationMinutes=duration_minutes,
            ),
        )

    def list(
        self,
        *,
        agent: Optional[str] = None,
        credential: Optional[str] = None,
    ) -> dict[str, Any]:
        return self._http.request("GET", "/grants", query=query(agent=agent, credential=credential))

    def get(self, grant_id: str) -> dict[str, Any]:
        return self._http.request("GET", f"/grants/{seg(grant_id)}")

    def update(
        self,
        grant_id: str,
        *,
        actions: Any = UNSET,
        resource_pattern: Any = UNSET,
        conditions: Any = UNSET,
        approval_mode: Any = UNSET,
        purpose: Any = UNSET,
        expires_at: Any = UNSET,
    ) -> dict[str, Any]:
        return self._http.request(
            "PATCH",
            f"/grants/{seg(grant_id)}",
            body=payload(
                actions=actions,
                resourcePattern=resource_pattern,
                conditions=conditions,
                approvalMode=approval_mode,
                purpose=purpose,
                expiresAt=expires_at,
            ),
        )

    def remove(self, grant_id: str) -> dict[str, Any]:
        return self._http.request("DELETE", f"/grants/{seg(grant_id)}")


__all__ = ["GrantsResource"]
