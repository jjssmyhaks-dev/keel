"""CrewAI adapter: one BaseTool subclass instance per granted action."""

from __future__ import annotations

import json
import re
from typing import Any, Optional

from ..errors import KeelError
from .common import ToolSpec, build_tool_specs, error_payload, invoke


def _require_crewai():
    try:
        from crewai.tools import BaseTool
        from pydantic import ConfigDict, Field, create_model
    except ImportError:
        raise KeelError(
            "The CrewAI adapter needs crewai. Install it with: pip install 'keel-sdk[crewai]'",
            code="crewai_dependency_missing",
        ) from None
    return BaseTool, ConfigDict, Field, create_model


def _model_name(tool_name: str) -> str:
    parts = re.split(r"[^a-zA-Z0-9]+", tool_name)
    name = "".join(part[:1].upper() + part[1:] for part in parts if part) + "Args"
    return name if name[0].isalpha() else f"Keel{name}"


def _args_model(spec: ToolSpec):
    _, ConfigDict, Field, create_model = _require_crewai()
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
    BaseTool, _, _, _ = _require_crewai()

    def run(self: Any, **kwargs: Any) -> str:
        try:
            return json.dumps(invoke(client, spec, kwargs, agent_id), default=str)
        except Exception as error:  # surfaced to the model as data, not a crash
            return json.dumps(error_payload(error), default=str)

    class_name = _model_name(spec.name).removesuffix("Args") + "Tool"
    return type(
        class_name,
        (BaseTool,),
        {
            "__module__": __name__,
            "__qualname__": class_name,
            "__annotations__": {"name": str, "description": str, "args_schema": type},
            "name": spec.name,
            "description": spec.description,
            "args_schema": _args_model(spec),
            "_run": run,
        },
    )()


def keel_crewai_tools(
    client: Any,
    agent_id: str,
    *,
    connector: Optional[str] = None,
) -> list[Any]:
    """Build CrewAI tools for every action the agent may call."""

    return [_tool_from_spec(client, spec, agent_id) for spec in build_tool_specs(client, agent_id, connector=connector)]


__all__ = ["keel_crewai_tools"]
