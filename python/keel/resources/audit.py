"""Audit trail: list, verify the hash chain, export."""

from __future__ import annotations

from typing import Any, Optional

from .._utils import query
from ..http import HttpTransport
from ..types import AuditPage


class AuditResource:
    def __init__(self, http: HttpTransport) -> None:
        self._http = http

    def list(
        self,
        *,
        agent: Optional[str] = None,
        action: Optional[str] = None,
        outcome: Optional[str] = None,
        from_: Optional[str] = None,
        to: Optional[str] = None,
        before: Optional[int] = None,
        limit: Optional[int] = None,
        order: Optional[str] = None,
    ) -> AuditPage:
        return self._http.request(
            "GET",
            "/audit",
            query=query(
                agent=agent,
                action=action,
                outcome=outcome,
                **{"from": from_, "to": to},
                before=before,
                limit=limit,
                order=order,
            ),
        )

    def verify(self, *, from_: Optional[int] = None, to: Optional[int] = None) -> dict[str, Any]:
        return self._http.request(
            "GET", "/audit/verify", query=query(**{"from": from_, "to": to})
        )

    def export(
        self,
        *,
        format: str = "jsonl",
        from_: Optional[str] = None,
        to: Optional[str] = None,
        agent: Optional[str] = None,
        action: Optional[str] = None,
    ) -> str:
        """Return the raw export contents (CSV or newline-delimited JSON)."""

        return self._http.request(
            "GET",
            "/audit/export",
            query=query(
                format=format,
                **{"from": from_, "to": to},
                agent=agent,
                action=action,
            ),
            raw_text=True,
        )


__all__ = ["AuditResource"]
