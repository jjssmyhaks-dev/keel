"""Workload identities: SPIFFE, Kubernetes and OIDC issuers."""

from __future__ import annotations

from typing import Any, Optional

from .._utils import body, seg
from ..http import HttpTransport


class WorkloadIdentitiesResource:
    def __init__(self, http: HttpTransport) -> None:
        self._http = http

    def list(self) -> dict[str, Any]:
        return self._http.request("GET", "/workload-identities")

    def get(self, identity_id: str) -> dict[str, Any]:
        return self._http.request("GET", f"/workload-identities/{seg(identity_id)}")

    def create(
        self,
        *,
        name: str,
        issuer: str,
        audience: str,
        agent_id: str,
        type: str = "spiffe",
        jwks_url: Optional[str] = None,
        jwks: Optional[dict[str, Any]] = None,
        subject_pattern: Optional[str] = None,
        required_claims: Optional[dict[str, Any]] = None,
        token_ttl_seconds: Optional[int] = None,
        enabled: Optional[bool] = None,
    ) -> dict[str, Any]:
        return self._http.request(
            "POST",
            "/workload-identities",
            body=body(
                name=name,
                type=type,
                issuer=issuer,
                audience=audience,
                agentId=agent_id,
                jwksUrl=jwks_url,
                jwks=jwks,
                subjectPattern=subject_pattern,
                requiredClaims=required_claims,
                tokenTtlSeconds=token_ttl_seconds,
                enabled=enabled,
            ),
        )

    def update(self, identity_id: str, **fields: Any) -> dict[str, Any]:
        """Patch any subset of the create fields, using API field names."""

        return self._http.request(
            "PATCH", f"/workload-identities/{seg(identity_id)}", body=payload_fields(fields)
        )

    def remove(self, identity_id: str) -> dict[str, Any]:
        return self._http.request("DELETE", f"/workload-identities/{seg(identity_id)}")


def payload_fields(fields: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in fields.items() if value is not None}


__all__ = ["WorkloadIdentitiesResource"]
