"""Governed proxy calls."""

from __future__ import annotations

import time
import uuid
from typing import Any, Optional

from .._utils import body, seg
from ..http import HttpTransport
from ..types import ProxyResponse


class ProxyResource:
    def __init__(self, http: HttpTransport) -> None:
        self._http = http
        self._tokens: dict[str, tuple[str, float]] = {}

    def call(
        self,
        *,
        action: str,
        connector: Optional[str] = None,
        resource: Optional[str] = None,
        input: Optional[dict[str, Any]] = None,
        credential_id: Optional[str] = None,
        token: Optional[str] = None,
        agent_id: Optional[str] = None,
        idempotency_key: Optional[str] = None,
        ttl: Optional[int] = None,
        private_key: Optional[str] = None,
    ) -> ProxyResponse:
        """Execute a governed connector call.

        Pass an agent ``token`` directly, or an ``agent_id`` and the SDK mints a
        short-lived token first. A call that needs approval returns a value with
        ``status="pending_approval"``; a policy denial raises :class:`KeelError`.
        """

        slug = connector or action.split(".", 1)[0]
        if not slug or not action:
            raise ValueError("proxy.call requires a connector and an action (e.g. slack.post_message).")

        if not token:
            if not agent_id:
                raise ValueError("proxy.call requires either an agent token or an agent_id to mint one.")
            token = self._agent_token(agent_id, ttl=ttl, private_key=private_key)

        return self._http.request(
            "POST",
            f"/proxy/{seg(slug)}",
            agent_token=token,
            idempotency_key=idempotency_key or f"sdk_{uuid.uuid4()}",
            retryable=True,
            body=body(
                action=action,
                credentialId=credential_id,
                resource=resource,
                input=input if input is not None else {},
            ),
        )

    def _agent_token(self, agent_id: str, *, ttl: Optional[int], private_key: Optional[str]) -> str:
        cached = self._tokens.get(agent_id)
        if cached and time.time() < cached[1] - 60:
            return cached[0]

        request_body: dict[str, Any] = body(ttl=ttl)
        if private_key:
            from ..signing import sign_challenge

            signed = sign_challenge(agent_id, private_key)
            request_body["challenge"] = signed["challenge"]
            request_body["signature"] = signed["signature"]

        issued = self._http.request("POST", f"/agents/{seg(agent_id)}/token", body=request_body)
        expires_at = issued.get("expiresAt")
        if isinstance(expires_at, str):
            try:
                from datetime import datetime

                stamp = datetime.fromisoformat(expires_at.replace("Z", "+00:00")).timestamp()
            except ValueError:
                stamp = time.time() + int(issued.get("expiresIn") or 300)
        else:
            stamp = time.time() + int(issued.get("expiresIn") or 300)
        self._tokens[agent_id] = (str(issued["accessToken"]), stamp)
        return str(issued["accessToken"])


__all__ = ["ProxyResource", "ProxyResponse"]
