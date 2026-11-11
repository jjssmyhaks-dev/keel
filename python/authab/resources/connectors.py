"""Connector catalogue."""

from __future__ import annotations

from typing import Any

from ..http import HttpTransport


class ConnectorsResource:
    def __init__(self, http: HttpTransport) -> None:
        self._http = http

    def list(self) -> dict[str, Any]:
        return self._http.request("GET", "/connectors")


__all__ = ["ConnectorsResource"]
