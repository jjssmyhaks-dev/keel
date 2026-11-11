"""Credential vault: create, list, rotate and revoke connections."""

from __future__ import annotations

from typing import Any, Optional, Union

from .._utils import UNSET, body, payload, query, seg
from ..http import HttpTransport
from ..types import Credential

Secret = Union[str, dict[str, Any]]


class VaultResource:
    def __init__(self, http: HttpTransport) -> None:
        self._http = http

    def create(
        self,
        *,
        connector: str,
        secret: Secret,
        name: Optional[str] = None,
        type: Optional[str] = None,
        metadata: Optional[dict[str, Any]] = None,
        expires_at: Optional[str] = None,
    ) -> Credential:
        return self._http.request(
            "POST",
            "/credentials",
            body=body(
                connector=connector,
                name=name,
                type=type,
                secret=secret,
                metadata=metadata,
                expiresAt=expires_at,
            ),
        )

    def list(self, *, connector: Optional[str] = None) -> dict[str, Any]:
        return self._http.request("GET", "/credentials", query=query(connector=connector))

    def get(self, credential_id: str) -> Credential:
        return self._http.request("GET", f"/credentials/{seg(credential_id)}")

    def rotate(
        self,
        credential_id: str,
        secret: Secret,
        *,
        metadata: Optional[dict[str, Any]] = None,
        expires_at: Any = UNSET,
    ) -> Credential:
        """Replace the stored secret. The old value is unrecoverable afterwards."""

        return self._http.request(
            "PATCH",
            f"/credentials/{seg(credential_id)}",
            body=body(secret=secret, metadata=metadata, expiresAt=expires_at),
        )

    def update(
        self,
        credential_id: str,
        *,
        name: Any = UNSET,
        metadata: Any = UNSET,
        expires_at: Any = UNSET,
        status: Any = UNSET,
    ) -> Credential:
        return self._http.request(
            "PATCH",
            f"/credentials/{seg(credential_id)}",
            body=payload(name=name, metadata=metadata, expiresAt=expires_at, status=status),
        )

    def revoke(self, credential_id: str) -> Credential:
        return self._http.request("DELETE", f"/credentials/{seg(credential_id)}")


__all__ = ["VaultResource"]
