"""Authab Python SDK — agent identity, vault, grants, approvals and proxy calls."""

from __future__ import annotations

from .client import AsyncAuthab, Authab
from .errors import AuthabError, is_authab_error
from .integrations.common import ToolSpec, build_tool_specs
from .resources.webhooks import verify_webhook
from .signing import generate_agent_keypair, sign_challenge

__version__ = "1.0.0"

__all__ = [
    "Authab",
    "AsyncAuthab",
    "AuthabError",
    "is_authab_error",
    "sign_challenge",
    "generate_agent_keypair",
    "verify_webhook",
    "ToolSpec",
    "build_tool_specs",
    "__version__",
]
