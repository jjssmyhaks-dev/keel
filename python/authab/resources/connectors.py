"""Connector catalogue, including custom OpenAPI connectors."""

from __future__ import annotations

from typing import Any, Optional

from .._utils import body, seg
from ..http import HttpTransport


class ConnectorsResource:
    def __init__(self, http: HttpTransport) -> None:
        self._http = http

    def list(self) -> dict[str, Any]:
        """Built-in catalogue plus every custom connector in this environment."""

        return self._http.request("GET", "/connectors")

    def get(self, slug: str) -> dict[str, Any]:
        return self._http.request("GET", f"/connectors/{seg(slug)}")

    def import_spec(
        self,
        spec: str,
        *,
        slug: Optional[str] = None,
        name: Optional[str] = None,
        category: Optional[str] = None,
        color: Optional[str] = None,
        mark: Optional[str] = None,
        base_url: Optional[str] = None,
        auth_scheme: Optional[str] = None,
    ) -> dict[str, Any]:
        """Import an OpenAPI 3 document. Re-importing an unchanged spec is a no-op."""

        return self._http.request(
            "POST",
            "/connectors",
            body=body(
                spec=spec,
                slug=slug,
                name=name,
                category=category,
                color=color,
                mark=mark,
                baseUrl=base_url,
                authScheme=auth_scheme,
            ),
        )

    def rollback(self, slug: str, version: int) -> dict[str, Any]:
        return self._http.request(
            "POST", f"/connectors/{seg(slug)}/rollback", body={"version": version}
        )

    def archive(self, slug: str) -> dict[str, Any]:
        return self._http.request("DELETE", f"/connectors/{seg(slug)}")


__all__ = ["ConnectorsResource"]
