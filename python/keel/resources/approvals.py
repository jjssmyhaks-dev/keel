"""Approval requests and human decisions."""

from __future__ import annotations

from typing import Any, Optional

from .._utils import body, query, seg
from ..http import HttpTransport


class ApprovalsResource:
    def __init__(self, http: HttpTransport) -> None:
        self._http = http

    def list(
        self,
        *,
        status: Optional[str] = None,
        agent_id: Optional[str] = None,
        risk: Optional[str] = None,
        limit: Optional[int] = None,
    ) -> dict[str, Any]:
        return self._http.request(
            "GET",
            "/approvals",
            query=query(status=status, agent=agent_id, risk=risk, limit=limit),
        )

    def get(self, approval_id: str) -> dict[str, Any]:
        return self._http.request("GET", f"/approvals/{seg(approval_id)}")

    def decide(
        self,
        approval_id: str,
        decision: str,
        *,
        note: Optional[str] = None,
        approve_always: Optional[bool] = None,
    ) -> dict[str, Any]:
        """Approve or deny a request. Approving executes the stored call immediately."""

        return self._http.request(
            "POST",
            f"/approvals/{seg(approval_id)}",
            body=body(decision=decision, note=note, approveAlways=approve_always),
        )

    def approve(
        self,
        approval_id: str,
        *,
        note: Optional[str] = None,
        approve_always: Optional[bool] = None,
    ) -> dict[str, Any]:
        return self.decide(approval_id, "approve", note=note, approve_always=approve_always)

    def deny(self, approval_id: str, *, note: Optional[str] = None) -> dict[str, Any]:
        return self.decide(approval_id, "deny", note=note)


__all__ = ["ApprovalsResource"]
