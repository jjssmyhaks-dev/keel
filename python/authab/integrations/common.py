"""Turn an agent's grants into concrete tool definitions.

Shared by the LangChain, CrewAI and OpenAI Agents adapters, and usable on its
own for any other framework: a :class:`ToolSpec` is just a name, a JSON schema
and the governed call it maps to.
"""

from __future__ import annotations

import asyncio
import fnmatch
import hashlib
import re
from dataclasses import dataclass
from typing import Any, Optional

from ..errors import AuthabError

RISKS = ("read", "write", "destructive", "financial", "admin")
MAX_TOOL_NAME = 64


@dataclass(frozen=True)
class ToolSpec:
    name: str
    action: str
    connector: str
    connector_name: str
    description: str
    input_schema: dict[str, Any]
    credential_id: str
    resource_key: Optional[str]
    resource_pattern: str
    risk: str


def tool_name_for(action: str) -> str:
    """A provider-neutral function name: ``slack.post_message`` → ``slack_post_message``."""

    name = re.sub(r"[^a-zA-Z0-9_-]+", "_", action).strip("_")
    if not name:
        name = "authab_action"
    if len(name) > MAX_TOOL_NAME:
        digest = hashlib.sha256(action.encode("utf-8")).hexdigest()[:8]
        name = f"{name[: MAX_TOOL_NAME - 9]}_{digest}"
    return name


def _matches(pattern: str, action_name: str) -> bool:
    return fnmatch.fnmatchcase(action_name.lower(), pattern.lower())


def _expand_actions(actions: list[dict[str, Any]], patterns: list[str]) -> list[dict[str, Any]]:
    if "*" in patterns:
        return list(actions)
    risks: set[str] = set()
    exact: list[str] = []
    for pattern in patterns:
        entry = str(pattern).strip()
        if entry.startswith("risk:"):
            risks.add(entry[5:])
        elif entry in RISKS:
            risks.add(entry)
        elif entry:
            exact.append(entry)

    selected: list[dict[str, Any]] = []
    for action in actions:
        if action.get("risk") in risks or any(_matches(pattern, str(action.get("name", ""))) for pattern in exact):
            selected.append(action)
    return selected


def _connector_slug(grant: dict[str, Any], actions: list[str]) -> Optional[str]:
    credential = grant.get("credential") or {}
    slug = credential.get("connectorSlug") or grant.get("connector")
    if slug:
        return str(slug)
    for action in actions:
        if "." in action:
            return action.split(".", 1)[0]
    return None


def _input_schema(action: dict[str, Any], resource_pattern: str) -> tuple[dict[str, Any], Optional[str]]:
    properties: dict[str, Any] = {}
    required: list[str] = []

    for field in action.get("fields") or []:
        key = field.get("key")
        if not key:
            continue
        description = str(field.get("label") or key)
        if field.get("placeholder"):
            description = f"{description} (e.g. {field['placeholder']})"
        properties[key] = {"type": "string", "description": description}
        if field.get("required"):
            required.append(key)

    restricted = resource_pattern.strip() not in ("", "*")
    resource_key: Optional[str] = None
    if restricted:
        resource_key = "_authab_resource" if "resource" in properties else "resource"
        properties[resource_key] = {
            "type": "string",
            "description": f'The resource this call applies to. This grant is limited to "{resource_pattern}".',
        }
        required.append(resource_key)

    schema: dict[str, Any] = {
        "type": "object",
        "properties": properties,
        "additionalProperties": True,
    }
    if required:
        schema["required"] = sorted(set(required))
    return schema, resource_key


def _description(
    connector_name: str,
    action: dict[str, Any],
    resource_pattern: str,
    risk: str,
) -> str:
    label = action.get("label") or action.get("name")
    detail = action.get("description") or ""
    text = f"{label} on {connector_name}. {detail}".strip()
    text = f"{text} Risk: {risk}. Runs through Authab, which enforces grants, approvals and audit."
    if resource_pattern.strip() not in ("", "*"):
        text = f'{text} Resource must match "{resource_pattern}".'
    return text[:1024]


def build_tool_specs(
    client: Any,
    agent_id: str,
    *,
    connector: Optional[str] = None,
) -> list[ToolSpec]:
    """List the actions this agent may call, as one concrete tool per action.

    The tool list is derived from the agent's grants, not from the full
    connector catalogue, so a tool that appears here is authorised.
    """

    grants = client.grants.list(agent=agent_id).get("data", [])
    catalog = client.connectors.list().get("data", [])
    by_slug = {entry.get("slug"): entry for entry in catalog}

    specs: list[ToolSpec] = []
    used_names: set[str] = set()

    for grant in grants:
        grant_actions = [str(entry) for entry in grant.get("actions") or []]
        slug = _connector_slug(grant, grant_actions)
        if not slug:
            continue
        if connector and slug != connector:
            continue
        definition = by_slug.get(slug)
        if not definition:
            continue
        actions = definition.get("actions") or []
        expanded = _expand_actions(actions, grant_actions)
        resource_pattern = str(grant.get("resourcePattern") or "")
        connector_name = str(definition.get("name") or slug)

        for action in expanded:
            action_name = str(action.get("name") or "")
            if not action_name:
                continue
            base = tool_name_for(action_name)
            name = base
            suffix = 2
            while name in used_names:
                name = f"{base[: MAX_TOOL_NAME - 3]}_{suffix}"
                suffix += 1
            used_names.add(name)

            schema, resource_key = _input_schema(action, resource_pattern)
            specs.append(
                ToolSpec(
                    name=name,
                    action=action_name,
                    connector=slug,
                    connector_name=connector_name,
                    description=_description(connector_name, action, resource_pattern, str(action.get("risk") or "read")),
                    input_schema=schema,
                    credential_id=str(grant.get("credentialId") or ""),
                    resource_key=resource_key,
                    resource_pattern=resource_pattern,
                    risk=str(action.get("risk") or "read"),
                )
            )

    specs.sort(key=lambda spec: spec.name)
    return specs


def invoke(client: Any, spec: ToolSpec, arguments: Optional[dict[str, Any]], agent_id: str) -> dict[str, Any]:
    """Run one tool call through the Authab proxy, with the agent's identity."""

    args = dict(arguments or {})
    resource: Optional[str] = None

    if spec.resource_key:
        value = args.pop(spec.resource_key, None)
        if isinstance(value, str) and value.strip():
            resource = value.strip()
        if not resource:
            raise ValueError(
                f'{spec.name} requires a resource matching "{spec.resource_pattern}".'
            )
    elif "resource" not in (spec.input_schema.get("properties") or {}):
        # A model may volunteer a resource even when the grant lets it pick any.
        value = args.pop("resource", None)
        if isinstance(value, str) and value.strip():
            resource = value.strip()

    return client.proxy.call(
        action=spec.action,
        connector=spec.connector,
        resource=resource,
        input=args,
        credential_id=spec.credential_id or None,
        agent_id=agent_id,
    )


async def ainvoke(client: Any, spec: ToolSpec, arguments: Optional[dict[str, Any]], agent_id: str) -> dict[str, Any]:
    return await asyncio.to_thread(invoke, client, spec, arguments, agent_id)


def error_payload(error: BaseException) -> dict[str, Any]:
    if isinstance(error, AuthabError):
        return {"error": error.to_dict()}
    return {"error": {"code": "tool_error", "message": str(error)}}


__all__ = [
    "ToolSpec",
    "build_tool_specs",
    "invoke",
    "ainvoke",
    "tool_name_for",
    "error_payload",
]
