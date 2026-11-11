"""Token introspection and revocation."""

from __future__ import annotations

from typing import Any, Optional

from .._utils import body, query
from ..http import HttpTransport


def _scope_body(scopes: Optional[list[str]], ttl: Optional[int]) -> dict[str, Any]:
    return body(scope=" ".join(scopes) if scopes else None, ttl=ttl)


def _dpop_headers(proof: Optional[str]) -> Optional[dict[str, str]]:
    return {"DPoP": proof} if proof else None


class TokensResource:
    def __init__(self, http: HttpTransport) -> None:
        self._http = http

    def client_credentials(
        self,
        *,
        client_id: str,
        client_secret: str,
        scopes: Optional[list[str]] = None,
        ttl: Optional[int] = None,
        dpop_proof: Optional[str] = None,
    ) -> dict[str, Any]:
        """OAuth 2.0 client_credentials with an agent client secret."""

        return self._http.request(
            "POST",
            "/tokens/client-credentials",
            headers=_dpop_headers(dpop_proof),
            body=body(client_id=client_id, client_secret=client_secret, **_scope_body(scopes, ttl)),
        )

    def exchange(
        self,
        *,
        subject_token: str,
        agent_id: Optional[str] = None,
        scopes: Optional[list[str]] = None,
        ttl: Optional[int] = None,
        dpop_proof: Optional[str] = None,
    ) -> dict[str, Any]:
        """RFC 8693 token exchange: narrow or delegate an existing agent token."""

        return self._http.request(
            "POST",
            "/tokens/exchange",
            headers=_dpop_headers(dpop_proof),
            body=body(
                subject_token=subject_token,
                subject_token_type="urn:ietf:params:oauth:token-type:access_token",
                agent_id=agent_id,
                **_scope_body(scopes, ttl),
            ),
        )

    def workload_exchange(
        self,
        *,
        token: str,
        scopes: Optional[list[str]] = None,
        ttl: Optional[int] = None,
        dpop_proof: Optional[str] = None,
    ) -> dict[str, Any]:
        """Exchange a workload JWT (SPIFFE, Kubernetes or OIDC) for an agent token."""

        return self._http.request(
            "POST",
            "/tokens/workload-exchange",
            headers=_dpop_headers(dpop_proof),
            body=body(
                token=token,
                subject_token_type="urn:ietf:params:oauth:token-type:jwt",
                **_scope_body(scopes, ttl),
            ),
        )

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
