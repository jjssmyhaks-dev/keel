"""LangChain and LangGraph adapter: one StructuredTool per granted action."""

from __future__ import annotations

import re
from typing import Any, Optional

from ..errors import KeelError
from .common import ToolSpec, ainvoke, build_tool_specs, invoke


def _require_langchain():
    try:
        from langchain_core.tools import StructuredTool
        from pydantic import ConfigDict, Field, create_model
    except ImportError:
        raise KeelError(
            "The LangChain adapter needs langchain-core and pydantic. "
            "Install them with: pip install 'keel-sdk[langchain]'",
            code="langchain_dependency_missing",
        ) from None
    return StructuredTool, ConfigDict, Field, create_model


def _model_name(tool_name: str) -> str:
    parts = re.split(r"[^a-zA-Z0-9]+", tool_name)
    name = "".join(part[:1].upper() + part[1:] for part in parts if part) + "Args"
    return name if name[0].isalpha() else f"Keel{name}"


def _args_model(spec: ToolSpec):
    _, ConfigDict, Field, create_model = _require_langchain()
    fields: dict[str, Any] = {}
    required = set(spec.input_schema.get("required") or [])
    for key, prop in (spec.input_schema.get("properties") or {}).items():
        description = str(prop.get("description") or key)
        if key in required:
            fields[key] = (str, Field(description=description))
        else:
            fields[key] = (Optional[str], Field(default=None, description=description))
    return create_model(_model_name(spec.name), __config__=ConfigDict(extra="allow"), **fields)


def _tool_from_spec(client: Any, spec: ToolSpec, agent_id: str):
    StructuredTool, _, _, _ = _require_langchain()

    def run(**kwargs: Any) -> dict[str, Any]:
        return invoke(client, spec, kwargs, agent_id)

    async def arun(**kwargs: Any) -> dict[str, Any]:
        return await ainvoke(client, spec, kwargs, agent_id)

    return StructuredTool.from_function(
        func=run,
        coroutine=arun,
        name=spec.name,
        description=spec.description,
        args_schema=_args_model(spec),
    )


def keel_langchain_tools(
    client: Any,
    agent_id: str,
    *,
    connector: Optional[str] = None,
) -> list[Any]:
    """Build LangChain tools for every action the agent may call.

    Pass the result to an agent, a chain, or LangGraph's ``ToolNode``. Each
    tool's execution is a Keel proxy call, so policy and approvals still apply.
    """

    return [_tool_from_spec(client, spec, agent_id) for spec in build_tool_specs(client, agent_id, connector=connector)]


def keel_langgraph_tool_node(
    client: Any,
    agent_id: str,
    *,
    connector: Optional[str] = None,
) -> Any:
    """A ready-made LangGraph ``ToolNode`` backed by governed Keel tools."""

    try:
        from langgraph.prebuilt import ToolNode
    except ImportError:
        raise KeelError(
            "The LangGraph helper needs langgraph. Install it with: pip install 'keel-sdk[langgraph]'",
            code="langgraph_dependency_missing",
        ) from None
    return ToolNode(keel_langchain_tools(client, agent_id, connector=connector))


__all__ = ["keel_langchain_tools", "keel_langgraph_tool_node"]
