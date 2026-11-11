from __future__ import annotations

import asyncio
import importlib.util
import json
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from keel.integrations import (
    keel_crewai_tools,
    keel_langchain_tools,
    keel_langgraph_tool_node,
    keel_openai_agents_tools,
)

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
            ],
        }
    ],
}

GRANTS = {
    "object": "list",
    "data": [
        {
            "id": "gr_1",
            "agentId": "agt_1",
            "credentialId": "cred_1",
            "actions": ["slack.post_message", "risk:read"],
            "resourcePattern": "#eng-*",
            "credential": {"id": "cred_1", "connectorSlug": "slack"},
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
    def __init__(self):
        self.grants = SimpleNamespace(list=lambda **kwargs: GRANTS)
        self.connectors = SimpleNamespace(list=lambda: CATALOG)
        self.proxy = FakeProxy()


def installed(*modules: str) -> bool:
    return all(importlib.util.find_spec(name) is not None for name in modules)


@unittest.skipUnless(installed("langchain_core", "pydantic"), "langchain-core and pydantic are not installed")
class RealLangChainTests(unittest.TestCase):
    def test_structured_tools_validate_and_execute(self):
        from langchain_core.tools import StructuredTool
        from pydantic import ValidationError

        client = FakeClient()
        tools = keel_langchain_tools(client, "agt_1")
        self.assertTrue(all(isinstance(tool, StructuredTool) for tool in tools))
        post = next(tool for tool in tools if tool.name == "slack_post_message")
        self.assertEqual(set(post.args_schema.model_fields), {"channel", "text", "resource"})

        result = post.invoke({"channel": "#eng", "text": "hi", "resource": "#eng-1"})
        self.assertEqual(result["status"], "executed")
        self.assertEqual(client.proxy.calls[0]["agent_id"], "agt_1")

        async_result = asyncio.run(
            post.ainvoke({"channel": "#eng", "text": "hi", "resource": "#eng-1"})
        )
        self.assertEqual(async_result["status"], "executed")

        with self.assertRaises(ValidationError):
            post.invoke({"channel": "#eng"})

    @unittest.skipUnless(installed("langgraph"), "langgraph is not installed")
    def test_langgraph_tool_node_executes_a_tool_call(self):
        from langchain_core.messages import AIMessage, ToolMessage
        from langgraph.graph import END, START, MessagesState, StateGraph
        from langgraph.prebuilt import ToolNode

        client = FakeClient()
        node = keel_langgraph_tool_node(client, "agt_1")
        self.assertIsInstance(node, ToolNode)
        graph = StateGraph(MessagesState)
        graph.add_node("tools", node)
        graph.add_edge(START, "tools")
        graph.add_edge("tools", END)
        app = graph.compile()

        state = {
            "messages": [
                AIMessage(
                    content="",
                    tool_calls=[
                        {
                            "name": "slack_post_message",
                            "args": {"channel": "#eng", "text": "hi", "resource": "#eng-1"},
                            "id": "call_1",
                            "type": "tool_call",
                        }
                    ],
                )
            ]
        }
        output = app.invoke(state)
        message = next(item for item in output["messages"] if isinstance(item, ToolMessage))
        payload = json.loads(message.content)
        self.assertEqual(payload["status"], "executed")
        self.assertEqual(client.proxy.calls[0]["resource"], "#eng-1")


@unittest.skipUnless(installed("crewai", "pydantic"), "crewai and pydantic are not installed")
class RealCrewAITests(unittest.TestCase):
    def test_base_tool_subclass_runs(self):
        from crewai.tools import BaseTool

        client = FakeClient()
        tools = keel_crewai_tools(client, "agt_1")
        self.assertTrue(all(isinstance(tool, BaseTool) for tool in tools))
        post = next(tool for tool in tools if tool.name == "slack_post_message")
        self.assertEqual(set(post.args_schema.model_fields), {"channel", "text", "resource"})

        payload = json.loads(post.run(channel="#eng", text="hi", resource="#eng-1"))
        self.assertEqual(payload["status"], "executed")
        self.assertEqual(client.proxy.calls[0]["agent_id"], "agt_1")

        with self.assertRaises(ValueError):
            post.run(channel="#eng", text="hi")


@unittest.skipUnless(installed("agents"), "openai-agents is not installed")
class RealOpenAIAgentsTests(unittest.TestCase):
    def test_function_tool_contract(self):
        from agents import FunctionTool

        client = FakeClient()
        tools = keel_openai_agents_tools(client, "agt_1")
        self.assertTrue(all(isinstance(tool, FunctionTool) for tool in tools))
        post = next(tool for tool in tools if tool.name == "slack_post_message")
        self.assertEqual(post.params_json_schema["required"], ["channel", "resource", "text"])

        result = json.loads(
            asyncio.run(
                post.on_invoke_tool(
                    None,
                    json.dumps({"channel": "#eng", "text": "hi", "resource": "#eng-1"}),
                )
            )
        )
        self.assertEqual(result["status"], "executed")
        self.assertEqual(client.proxy.calls[0]["resource"], "#eng-1")

        invalid = json.loads(asyncio.run(post.on_invoke_tool(None, "not json")))
        self.assertEqual(invalid["error"]["code"], "invalid_arguments")


if __name__ == "__main__":
    unittest.main()
