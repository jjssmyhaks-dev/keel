"""Agents: identity, lifecycle, tokens and promotion."""

from __future__ import annotations

from typing import Any, Optional

from .._utils import UNSET, body, payload, query, seg
from ..http import HttpTransport
from ..signing import sign_challenge
from ..types import Agent, AgentToken


class AgentsResource:
    def __init__(self, http: HttpTransport) -> None:
        self._http = http

    def create(
        self,
        name: str,
        *,
        description: Optional[str] = None,
        tags: Optional[list[str]] = None,
        framework: Optional[str] = None,
        public_key: Optional[str] = None,
        key_mode: Optional[str] = None,
        owner: Optional[str] = None,
        autonomous_mode: Optional[bool] = None,
    ) -> dict[str, Any]:
        return self._http.request(
            "POST",
            "/agents",
            body=body(
                name=name,
                description=description,
                tags=tags,
                framework=framework,
                publicKey=public_key,
                keyMode=key_mode,
                owner=owner,
                autonomousMode=autonomous_mode,
            ),
        )

    def list(
        self,
        *,
        status: Optional[str] = None,
        tag: Optional[str] = None,
        q: Optional[str] = None,
        limit: Optional[int] = None,
    ) -> dict[str, Any]:
        return self._http.request(
            "GET", "/agents", query=query(status=status, tag=tag, q=q, limit=limit)
        )

    def get(self, agent_id: str) -> dict[str, Any]:
        return self._http.request("GET", f"/agents/{seg(agent_id)}")

    def update(
        self,
        agent_id: str,
        *,
        name: Any = UNSET,
        description: Any = UNSET,
        tags: Any = UNSET,
        framework: Any = UNSET,
        autonomous_mode: Any = UNSET,
    ) -> dict[str, Any]:
        return self._http.request(
            "PATCH",
            f"/agents/{seg(agent_id)}",
            body=payload(
                name=name,
                description=description,
                tags=tags,
                framework=framework,
                autonomousMode=autonomous_mode,
            ),
        )

    def delete(self, agent_id: str) -> dict[str, Any]:
        """Permanently revoke an agent and delete its grants."""

        return self._http.request("DELETE", f"/agents/{seg(agent_id)}")

    def pause(self, agent_id: str) -> dict[str, Any]:
        return self._action(agent_id, "pause")

    def resume(self, agent_id: str) -> dict[str, Any]:
        return self._action(agent_id, "resume")

    def suspend(self, agent_id: str) -> dict[str, Any]:
        return self._action(agent_id, "suspend")

    def kill(self, agent_id: str) -> dict[str, Any]:
        """Revoke tokens and retire keys immediately. Irreversible."""

        return self._action(agent_id, "kill")

    def rotate_key(self, agent_id: str) -> dict[str, Any]:
        return self._action(agent_id, "rotate-key")

    def transfer(self, agent_id: str, email: str) -> dict[str, Any]:
        return self._action(agent_id, "transfer", email=email)

    def token(
        self,
        agent_id: str,
        *,
        ttl: Optional[int] = None,
        challenge: Optional[str] = None,
        signature: Optional[str] = None,
        key_id: Optional[str] = None,
        private_key: Optional[str] = None,
    ) -> AgentToken:
        """Issue a short-lived agent token.

        Client-key-mode agents must sign a challenge. Pass ``private_key`` and
        the SDK signs one, or pass a pre-signed ``challenge`` and ``signature``.
        """

        request_body: dict[str, Any] = body(ttl=ttl, challenge=challenge, signature=signature, keyId=key_id)
        if private_key and not signature:
            signed = sign_challenge(agent_id, private_key, challenge)
            request_body["challenge"] = signed["challenge"]
            request_body["signature"] = signed["signature"]
        return self._http.request("POST", f"/agents/{seg(agent_id)}/token", body=request_body)

    def preview_promotion(self, agent_id: str) -> dict[str, Any]:
        """Readiness checks and grant diff without creating a production identity."""

        return self._action(agent_id, "promote", preview=True)

    def promote(self, agent_id: str, email: str) -> dict[str, Any]:
        return self._action(agent_id, "promote", email=email)

    def _action(self, agent_id: str, action: str, **body: Any) -> dict[str, Any]:
        return self._http.request("POST", f"/agents/{seg(agent_id)}/{action}", body=body or {})


__all__ = ["AgentsResource", "Agent"]
