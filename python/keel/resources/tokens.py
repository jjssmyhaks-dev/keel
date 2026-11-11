"""Token introspection and revocation."""

from __future__ import annotations

from typing import Any, Optional

from .._utils import body, query
from ..http import HttpTransport


class TokensResource:
    def __init__(self, http: HttpTransport) -> None:
        self._http = http

    def introspect(self, token: str) -> dict[str, Any]:
        return self._http.request("POST", "/tokens/introspect", body={"token": token})

    def revoke(
        self,
        *,
        token: Optional[str] = None,
        token_id: Optional[str] = None,
        agent_id: Optional[str] = None,
        expires_at: Optional[str] = None,
    ) -> dict[str, Any]:
        return self._http.request(
            "POST",
            "/tokens/revoke",
            body=body(token=token, tokenId=token_id, agentId=agent_id, expiresAt=expires_at),
        )

    def status(self, token_id: str) -> dict[str, Any]:
        return self._http.request("GET", "/tokens/revoke", query=query(tokenId=token_id))


__all__ = ["TokensResource"]
