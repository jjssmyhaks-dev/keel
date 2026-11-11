"""Wire the same Keel grants into LangChain, CrewAI and the OpenAI Agents SDK.

Install the extras first:
    pip install "keel-sdk[all]"

Usage:
    KEEL_API_KEY=sk_dev_... KEEL_AGENT_ID=agt_atlas python python/examples/framework_tools.py
"""

import os
import sys
from pathlib import Path

# Allow running from a checkout without `pip install -e ./python`.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from keel import Keel, KeelError


def show(label: str, build) -> None:
    try:
        tools = build()
    except KeelError as error:
        print(f"{label}: {error.message}")
        return
    print(f"{label}: {len(tools)} tools")
    for tool in tools:
        name = getattr(tool, "name", type(tool).__name__)
        print(f"  {name}")


def main() -> None:
    keel = Keel.from_env()
    agent_id = os.environ["KEEL_AGENT_ID"]

    from keel.integrations.crewai import keel_crewai_tools
    from keel.integrations.langchain import keel_langchain_tools, keel_langgraph_tool_node
    from keel.integrations.openai_agents import keel_openai_agents_tools

    show("LangChain", lambda: keel_langchain_tools(keel, agent_id))
    show("LangGraph ToolNode", lambda: [keel_langgraph_tool_node(keel, agent_id)])
    show("CrewAI", lambda: keel_crewai_tools(keel, agent_id))
    show("OpenAI Agents", lambda: keel_openai_agents_tools(keel, agent_id))


if __name__ == "__main__":
    main()
