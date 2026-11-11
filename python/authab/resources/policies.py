"""Approval policies: default modes per action pattern."""

from __future__ import annotations

from typing import Any, Optional

from .._utils import UNSET, payload, query, seg
from ..http import HttpTransport


class PoliciesResource:
    def __init__(self, http: HttpTransport) -> None:
        self._http = http

    def simulate(
        self,
        *,
        agent_id: str,
        credential_id: str,
        action: str,
        resource: Optional[str] = None,
        input: Optional[dict[str, Any]] = None,
        ip: Optional[str] = None,
        now: Optional[str] = None,
    ) -> dict[str, Any]:
        """Dry-run a decision without calling the provider or creating an approval."""

        return self._http.request(
            "POST",
            "/policy/simulate",
            body=payload(
                agentId=agent_id,
                credentialId=credential_id,
                action=action,
                resource=resource,
                input=input,
                ip=ip,
                now=now,
            ),
        )

    def create(
        self,
        *,
        action_pattern: str,
        mode: str,
        agent_id: Optional[str] = None,
    ) -> dict[str, Any]:
        return self._http.request(
            "POST",
            "/approval-policies",
            body=payload(agentId=agent_id, actionPattern=action_pattern, mode=mode),
        )

    def list(self, *, agent: Optional[str] = None) -> dict[str, Any]:
        return self._http.request("GET", "/approval-policies", query=query(agent=agent))

    def get(self, policy_id: str) -> dict[str, Any]:
        return self._http.request("GET", f"/approval-policies/{seg(policy_id)}")

    def update(
        self,
        policy_id: str,
        *,
        action_pattern: Any = UNSET,
        mode: Any = UNSET,
    ) -> dict[str, Any]:
        return self._http.request(
            "PATCH",
            f"/approval-policies/{seg(policy_id)}",
            body=payload(actionPattern=action_pattern, mode=mode),
        )

    def remove(self, policy_id: str) -> dict[str, Any]:
        return self._http.request("DELETE", f"/approval-policies/{seg(policy_id)}")


__all__ = ["PoliciesResource"]
