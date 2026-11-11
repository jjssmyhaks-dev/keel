"""Authab error types."""

from __future__ import annotations

from typing import Any, Optional


class AuthabError(Exception):
    """An error returned by Authab, or a transport failure before one arrived.

    ``status`` is the HTTP status, or 0 when the request never reached Authab.
    ``code`` is a stable machine-readable string such as ``policy_denied`` or
    ``timeout``. ``request_id`` matches the ``x-request-id`` header and can be
    quoted to support.
    """

    def __init__(
        self,
        message: str,
        *,
        status: int = 0,
        code: str = "api_error",
        details: Any = None,
        request_id: Optional[str] = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.status = status
        self.code = code
        self.details = details
        self.request_id = request_id

    def __str__(self) -> str:
        label = self.code or "api_error"
        if self.status:
            label = f"{label} ({self.status})"
        return f"{label}: {self.message}"

    def to_dict(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "message": self.message,
            "status": self.status,
            "details": self.details,
            "request_id": self.request_id,
        }


def is_authab_error(value: object) -> bool:
    return isinstance(value, AuthabError)
