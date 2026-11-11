"""Webhook endpoints and signature verification."""

from __future__ import annotations

import hashlib
import hmac
import time
from typing import Any, Optional

from .._utils import UNSET, payload, seg
from ..http import HttpTransport
from ..types import WebhookEndpoint


class WebhooksResource:
    def __init__(self, http: HttpTransport) -> None:
        self._http = http

    def create(self, *, url: str, events: list[str]) -> WebhookEndpoint:
        return self._http.request("POST", "/webhooks", body={"url": url, "events": events})

    def list(self) -> dict[str, Any]:
        return self._http.request("GET", "/webhooks")

    def get(self, webhook_id: str) -> WebhookEndpoint:
        return self._http.request("GET", f"/webhooks/{seg(webhook_id)}")

    def update(
        self,
        webhook_id: str,
        *,
        url: Any = UNSET,
        events: Any = UNSET,
        status: Any = UNSET,
    ) -> WebhookEndpoint:
        return self._http.request(
            "PATCH",
            f"/webhooks/{seg(webhook_id)}",
            body=payload(url=url, events=events, status=status),
        )

    def remove(self, webhook_id: str) -> dict[str, Any]:
        return self._http.request("DELETE", f"/webhooks/{seg(webhook_id)}")


def verify_webhook(
    secret: str,
    header: str,
    body: str,
    *,
    tolerance_seconds: int = 300,
    now: Optional[float] = None,
) -> bool:
    """Verify a Authab webhook delivery.

    ``header`` is the ``Authab-Signature`` value: ``t=<unix-seconds>,v1=<hex
    HMAC-SHA256 of "t.body">``. ``body`` must be the exact raw request body.
    """

    if not secret or not header:
        return False
    timestamp: Optional[int] = None
    signatures: list[str] = []
    for part in header.split(","):
        key, _, value = part.strip().partition("=")
        if key == "t" and value.isdigit():
            timestamp = int(value)
        if key == "v1" and len(value) == 64:
            try:
                int(value, 16)
            except ValueError:
                continue
            signatures.append(value.lower())
    if timestamp is None or not signatures:
        return False
    moment = time.time() if now is None else now
    if abs(moment - timestamp) > tolerance_seconds:
        return False
    expected = hmac.new(secret.encode("utf-8"), f"{timestamp}.{body}".encode("utf-8"), hashlib.sha256).hexdigest()
    return any(hmac.compare_digest(candidate, expected) for candidate in signatures)


__all__ = ["WebhooksResource", "verify_webhook"]
