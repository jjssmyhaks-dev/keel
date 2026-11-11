from __future__ import annotations

import asyncio
import json
import sys
import unittest
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from authab import AuthabError
from authab.integrations import (
    build_tool_specs,
    authab_crewai_tools,
    authab_langchain_tools,
    authab_langgraph_tool_node,
    authab_openai_agents_tools,
)
from authab.integrations.common import ToolSpec, invoke, tool_name_for

CATALOG = {
    "object": "list",
    "data": [
        {
            "slug": "slack",
            "name": "Slack",
            "actions": [
                {
                    "name": "slack.post_message",
                    "label": "Post message",
                    "description": "Send a message to a channel.",
                    "risk": "write",
                    "fields": [
                        {"key": "channel", "label": "Channel", "required": True},
                        {"key": "text", "label": "Text", "required": True},
                    ],
                },
                {
                    "name": "slack.list_channels",
                    "label": "List channels",
                    "description": "List channels the app can see.",
                    "risk": "read",
                    "fields": [],
                },
                {
                    "name": "slack.archive_channel",
                    "label": "Archive channel",
                    "description": "Archive a channel.",
                    "risk": "destructive",
                    "fields": [{"key": "channel", "label": "Channel", "required": True}],
                },
            ],
        }
    ],
}


def grants(actions, credential_id="cred_1", resource_pattern="#eng-*"):
    return {
        "object": "list",
        "data": [
            {
                "id": f"gr_{credential_id}",
                "agentId": "agt_1",
                "credentialId": credential_id,
                "actions": actions,
                "resourcePattern": resource_pattern,
                "credential": {"id": credential_id, "connectorSlug": "slack"},
            }
        ],
    }


class FakeProxy:
    def __init__(self):
        self.calls = []

    def call(self, **kwargs):
        self.calls.append(kwargs)
        return {"status": "executed", "result": {"ok": True}}


class FakeClient:
    def __init__(self, grant_data=None, catalog=None):
        self.grants = SimpleNamespace(list=lambda **kwargs: grant_data or grants(["slack.post_message", "risk:read"]))
        self.connectors = SimpleNamespace(list=lambda: catalog or CATALOG)
        self.proxy = FakeProxy()


class SpecTests(unittest.TestCase):
    def test_builds_one_tool_per_granted_action(self):
        client = FakeClient()
        specs = build_tool_specs(client, "agt_1")
        self.assertEqual([spec.name for spec in specs], ["slack_list_channels", "slack_post_message"])
        post = next(spec for spec in specs if spec.action == "slack.post_message")
        self.assertEqual(post.connector, "slack")
        self.assertEqual(post.credential_id, "cred_1")
        self.assertEqual(post.resource_key, "resource")
        self.assertEqual(post.input_schema["properties"]["channel"]["type"], "string")
        self.assertEqual(post.input_schema["required"], ["channel", "resource", "text"])
        self.assertFalse(post.input_schema["additionalProperties"] is False)
        self.assertIn("Risk: write", post.description)
        self.assertIn("#eng-*", post.description)

    def test_wildcard_grant_expands_whole_catalogue(self):
        client = FakeClient(grant_data=grants(["*"], resource_pattern="*"))
        specs = build_tool_specs(client, "agt_1")
        self.assertEqual(len(specs), 3)
        self.assertTrue(all(spec.resource_key is None for spec in specs))

    def test_connector_filter(self):
        client = FakeClient()
        self.assertEqual(build_tool_specs(client, "agt_1", connector="github"), [])
        self.assertEqual(len(build_tool_specs(client, "agt_1", connector="slack")), 2)

    def test_invoke_routes_the_governed_call(self):
        client = FakeClient()
        post = next(spec for spec in build_tool_specs(client, "agt_1") if spec.action == "slack.post_message")
        result = invoke(client, post, {"channel": "#eng", "text": "hello", "resource": "#eng-launch"}, "agt_1")
        self.assertEqual(result["status"], "executed")
        call = client.proxy.calls[0]
        self.assertEqual(call["action"], "slack.post_message")
        self.assertEqual(call["connector"], "slack")
        self.assertEqual(call["credential_id"], "cred_1")
        self.assertEqual(call["resource"], "#eng-launch")
        self.assertEqual(call["input"], {"channel": "#eng", "text": "hello"})
        self.assertEqual(call["agent_id"], "agt_1")

    def test_invoke_requires_a_resource_when_grant_is_scoped(self):
        client = FakeClient()
        post = next(spec for spec in build_tool_specs(client, "agt_1") if spec.action == "slack.post_message")
        with self.assertRaises(ValueError):
            invoke(client, post, {"channel": "#eng", "text": "hello"}, "agt_1")

    def test_duplicate_actions_across_credentials_get_unique_names(self):
        data = grants(["slack.post_message"])
        data["data"].append(
            {
                "id": "gr_2",
                "agentId": "agt_1",
                "credentialId": "cred_2",
                "actions": ["slack.post_message"],
                "resourcePattern": "*",
                "credential": {"id": "cred_2", "connectorSlug": "slack"},
            }
        )
        specs = build_tool_specs(FakeClient(grant_data=data), "agt_1")
        self.assertEqual([spec.name for spec in specs], ["slack_post_message", "slack_post_message_2"])
        self.assertEqual({spec.credential_id for spec in specs}, {"cred_1", "cred_2"})

    def test_tool_names_are_provider_safe(self):
        self.assertEqual(tool_name_for("slack.post_message"), "slack_post_message")
        self.assertEqual(tool_name_for("weird action/name"), "weird_action_name")
        long_name = tool_name_for("slack." + "a" * 100)
        self.assertLessEqual(len(long_name), 64)
        self.assertNotIn(".", long_name)

    def test_resource_field_collision_is_renamed(self):
        catalog = json.loads(json.dumps(CATALOG))
        catalog["data"][0]["actions"][0]["fields"].append({"key": "resource", "label": "Resource"})
        client = FakeClient(catalog=catalog)
        post = next(spec for spec in build_tool_specs(client, "agt_1") if spec.action == "slack.post_message")
        self.assertEqual(post.resource_key, "_authab_resource")
        self.assertIn("resource", post.input_schema["properties"])
        self.assertIn("_authab_resource", post.input_schema["properties"])


def fake_pydantic():
    pydantic = ModuleType("pydantic")

    def field(*, description=None, default=None, **kwargs):
        return SimpleNamespace(description=description, default=default)

    def config_dict(**kwargs):
        return dict(kwargs)

    def create_model(name, *, __config__=None, **fields):
        return SimpleNamespace(__name__=name, model_fields=dict(fields))

    pydantic.ConfigDict = config_dict
    pydantic.Field = field
    pydantic.create_model = create_model
    return pydantic


class LangChainStubTests(unittest.TestCase):
    def _modules(self):
        core = ModuleType("langchain_core")
        tools = ModuleType("langchain_core.tools")

        class FakeStructuredTool:
            @classmethod
            def from_function(cls, **kwargs):
                return SimpleNamespace(**kwargs)

        tools.StructuredTool = FakeStructuredTool
        core.tools = tools

        langgraph = ModuleType("langgraph")
        prebuilt = ModuleType("langgraph.prebuilt")

        class FakeToolNode:
            def __init__(self, tools):
                self.tools = tools

        prebuilt.ToolNode = FakeToolNode
        langgraph.prebuilt = prebuilt
        return {
            "langchain_core": core,
            "langchain_core.tools": tools,
            "langgraph": langgraph,
            "langgraph.prebuilt": prebuilt,
            "pydantic": fake_pydantic(),
        }

    def test_builds_structured_tools_and_runs_them(self):
        client = FakeClient()
        with patch.dict(sys.modules, self._modules()):
            tools = authab_langchain_tools(client, "agt_1")
            self.assertEqual([tool.name for tool in tools], ["slack_list_channels", "slack_post_message"])
            post = next(tool for tool in tools if tool.name == "slack_post_message")
            self.assertEqual(set(post.args_schema.model_fields), {"channel", "text", "resource"})
            result = post.func(channel="#eng", text="hi", resource="#eng-1")
            self.assertEqual(result["status"], "executed")
            async_result = asyncio.run(post.coroutine(channel="#eng", text="hi", resource="#eng-1"))
            self.assertEqual(async_result["status"], "executed")

            node = authab_langgraph_tool_node(client, "agt_1")
            self.assertEqual(len(node.tools), 2)

    def test_reports_missing_dependency(self):
        with patch.dict(sys.modules, {"langchain_core": None, "langchain_core.tools": None}):
            with self.assertRaises(AuthabError) as caught:
                authab_langchain_tools(FakeClient(), "agt_1")
        self.assertEqual(caught.exception.code, "langchain_dependency_missing")


class CrewAIStubTests(unittest.TestCase):
    def _modules(self):
        crewai = ModuleType("crewai")
        tools = ModuleType("crewai.tools")

        class FakeBaseTool:
            pass

        tools.BaseTool = FakeBaseTool
        crewai.tools = tools
        return {"crewai": crewai, "crewai.tools": tools, "pydantic": fake_pydantic()}

    def test_builds_crewai_tools_and_returns_json(self):
        client = FakeClient()
        with patch.dict(sys.modules, self._modules()):
            tools = authab_crewai_tools(client, "agt_1")
            post = next(tool for tool in tools if tool.name == "slack_post_message")
            self.assertEqual(set(post.args_schema.model_fields), {"channel", "text", "resource"})
            payload = json.loads(post._run(channel="#eng", text="hi", resource="#eng-1"))
            self.assertEqual(payload["status"], "executed")
            self.assertEqual(client.proxy.calls[0]["agent_id"], "agt_1")

    def test_errors_become_json_for_the_model(self):
        client = FakeClient()
        with patch.dict(sys.modules, self._modules()):
            tools = authab_crewai_tools(client, "agt_1")
            post = next(tool for tool in tools if tool.name == "slack_post_message")
            payload = json.loads(post._run(channel="#eng", text="hi"))
            self.assertEqual(payload["error"]["code"], "tool_error")


class OpenAIAgentsStubTests(unittest.TestCase):
    def _modules(self):
        agents = ModuleType("agents")

        class FakeFunctionTool:
            def __init__(self, **kwargs):
                self.__dict__.update(kwargs)

        agents.FunctionTool = FakeFunctionTool
        return {"agents": agents}

    def test_builds_function_tools_with_json_schema(self):
        client = FakeClient()
        with patch.dict(sys.modules, self._modules()):
            tools = authab_openai_agents_tools(client, "agt_1")
            post = next(tool for tool in tools if tool.name == "slack_post_message")
            self.assertEqual(post.params_json_schema["required"], ["channel", "resource", "text"])
            self.assertFalse(post.strict_json_schema)
            result = json.loads(
                asyncio.run(post.on_invoke_tool(None, json.dumps({"channel": "#eng", "text": "hi", "resource": "#eng-1"})))
            )
            self.assertEqual(result["status"], "executed")
            self.assertEqual(client.proxy.calls[0]["resource"], "#eng-1")

    def test_errors_are_returned_as_json(self):
        client = FakeClient()
        with patch.dict(sys.modules, self._modules()):
            tools = authab_openai_agents_tools(client, "agt_1")
            post = next(tool for tool in tools if tool.name == "slack_post_message")
            result = json.loads(asyncio.run(post.on_invoke_tool(None, json.dumps({"channel": "#eng"}))))
            self.assertEqual(result["error"]["code"], "tool_error")
            invalid = json.loads(asyncio.run(post.on_invoke_tool(None, "not json")))
            self.assertEqual(invalid["error"]["code"], "invalid_arguments")


if __name__ == "__main__":
    unittest.main()
