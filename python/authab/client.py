"""Authab clients: synchronous by default, with an asyncio wrapper."""

from __future__ import annotations

import asyncio
import os
from typing import Any, Optional

from .http import HttpTransport
from .resources.agents import AgentsResource
from .resources.approvals import ApprovalsResource
from .resources.audit import AuditResource
from .resources.connectors import ConnectorsResource
from .resources.grants import GrantsResource
from .resources.policies import PoliciesResource
from .resources.proxy import ProxyResource
from .resources.tokens import TokensResource
from .resources.vault import VaultResource
from .resources.webhooks import WebhooksResource
from .types import ApiKeyContext


class Authab:
    """Server-side Authab client.

    The key's environment is the client's environment; there is no environment
    parameter to forget. The client is thread-safe: every request opens its own
    connection.
    """

    def __init__(
        self,
        api_key: str,
        *,
        base_url: Optional[str] = None,
        max_retries: int = 2,
        timeout_ms: int = 15_000,
    ) -> None:
        http = HttpTransport(api_key, base_url=base_url, max_retries=max_retries, timeout_ms=timeout_ms)
        self._http = http
        self.agents = AgentsResource(http)
        self.tokens = TokensResource(http)
        self.vault = VaultResource(http)
        self.grants = GrantsResource(http)
        self.policies = PoliciesResource(http)
        self.proxy = ProxyResource(http)
        self.approvals = ApprovalsResource(http)
        self.audit = AuditResource(http)
        self.webhooks = WebhooksResource(http)
        self.connectors = ConnectorsResource(http)

    @classmethod
    def from_env(cls, **options: Any) -> "Authab":
        """Build a client from ``AUTHAB_API_KEY`` and optional ``AUTHAB_BASE_URL``."""

        api_key = os.environ.get("AUTHAB_API_KEY", "")
        base_url = options.pop("base_url", None) or os.environ.get("AUTHAB_BASE_URL") or None
        return cls(api_key, base_url=base_url, **options)

    def me(self) -> ApiKeyContext:
        """Organisation, project, environment and key metadata for this key."""

        return self._http.request("GET", "/me")


class _AsyncResource:
    """Expose a sync resource with coroutine methods backed by a worker thread."""

    def __init__(self, wrapped: Any) -> None:
        object.__setattr__(self, "_wrapped", wrapped)

    def __getattr__(self, name: str) -> Any:
        value = getattr(self._wrapped, name)
        if not callable(value):
            return value

        async def call(*args: Any, **kwargs: Any) -> Any:
            return await asyncio.to_thread(value, *args, **kwargs)

        return call


class AsyncAuthab:
    """Async facade over :class:`Authab`.

    Calls are executed on a worker thread, so this works on every Python 3.9+
    runtime without third-party HTTP libraries. Use it when the rest of your
    application is async; behaviour, retries and errors are identical.
    """

    def __init__(
        self,
        api_key: str,
        *,
        base_url: Optional[str] = None,
        max_retries: int = 2,
        timeout_ms: int = 15_000,
    ) -> None:
        self._client = Authab(api_key, base_url=base_url, max_retries=max_retries, timeout_ms=timeout_ms)
        self.agents = _AsyncResource(self._client.agents)
        self.tokens = _AsyncResource(self._client.tokens)
        self.vault = _AsyncResource(self._client.vault)
        self.grants = _AsyncResource(self._client.grants)
        self.policies = _AsyncResource(self._client.policies)
        self.proxy = _AsyncResource(self._client.proxy)
        self.approvals = _AsyncResource(self._client.approvals)
        self.audit = _AsyncResource(self._client.audit)
        self.webhooks = _AsyncResource(self._client.webhooks)
        self.connectors = _AsyncResource(self._client.connectors)

    @classmethod
    def from_env(cls, **options: Any) -> "AsyncAuthab":
        api_key = os.environ.get("AUTHAB_API_KEY", "")
        base_url = options.pop("base_url", None) or os.environ.get("AUTHAB_BASE_URL") or None
        return cls(api_key, base_url=base_url, **options)

    async def me(self) -> ApiKeyContext:
        return await asyncio.to_thread(self._client.me)


__all__ = ["Authab", "AsyncAuthab"]
