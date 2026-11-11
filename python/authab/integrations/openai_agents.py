"""OpenAI Agents SDK adapter: FunctionTool instances with JSON schemas."""

from __future__ import annotations

import json
from typing import Any, Optional

from ..errors import AuthabError
from .common import ToolSpec, ainvoke, build_tool_specs, error_payload


def _require_agents():
    try:
        from agents import FunctionTool
    except ImportError:
        raise AuthabError(
            "The OpenAI Agents adapter needs openai-agents. "
            "Install it with: pip install 'authab-sdk[openai-agents]'",
            code="openai_agents_dependency_missing",
        ) from None
    return FunctionTool


def _tool_from_spec(client: Any, spec: ToolSpec, agent_id: str):
    FunctionTool = _require_agents()

    async def on_invoke(ctx: Any, args_json: str) -> str:
        try:
            arguments = json.loads(args_json) if args_json else {}
            if not isinstance(arguments, dict):
                raise ValueError("Tool arguments must be a JSON object.")
        except (json.JSONDecodeError, ValueError) as error:
            return json.dumps({"error": {"code": "invalid_arguments", "message": str(error)}})
        try:
            result = await ainvoke(client, spec, arguments, agent_id)
        except Exception as error:
            return json.dumps(error_payload(error), default=str)
        return json.dumps(result, default=str)

    try:
        return FunctionTool(
            name=spec.name,
            description=spec.description,
            params_json_schema=spec.input_schema,
            on_invoke_tool=on_invoke,
            strict_json_schema=False,
        )
    except TypeError:  # older openai-agents releases lack the strict flag
        return FunctionTool(
            name=spec.name,
            description=spec.description,
            params_json_schema=spec.input_schema,
            on_invoke_tool=on_invoke,
        )


def authab_openai_agents_tools(
    client: Any,
    agent_id: str,
    *,
    connector: Optional[str] = None,
) -> list[Any]:
    """Build OpenAI Agents SDK tools for every action the agent may call.

    Pass them as ``Agent(tools=...)``. Approval requests come back as a JSON
    string with ``status: "pending_approval"`` so the model can explain it.
    """

    return [_tool_from_spec(client, spec, agent_id) for spec in build_tool_specs(client, agent_id, connector=connector)]


__all__ = ["authab_openai_agents_tools"]
