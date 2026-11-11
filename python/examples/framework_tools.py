"""Wire the same Authab grants into LangChain, CrewAI and the OpenAI Agents SDK.

Install the extras first:
    pip install "authab-sdk[all]"

Usage:
    AUTHAB_API_KEY=sk_dev_... AUTHAB_AGENT_ID=agt_atlas python python/examples/framework_tools.py
"""

import os
import sys
from pathlib import Path

# Allow running from a checkout without `pip install -e ./python`.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from authab import Authab, AuthabError


def show(label: str, build) -> None:
    try:
        tools = build()
    except AuthabError as error:
        print(f"{label}: {error.message}")
        return
    print(f"{label}: {len(tools)} tools")
    for tool in tools:
        name = getattr(tool, "name", type(tool).__name__)
        print(f"  {name}")


def main() -> None:
    authab = Authab.from_env()
    agent_id = os.environ["AUTHAB_AGENT_ID"]

    from authab.integrations.crewai import authab_crewai_tools
    from authab.integrations.langchain import authab_langchain_tools, authab_langgraph_tool_node
    from authab.integrations.openai_agents import authab_openai_agents_tools

    show("LangChain", lambda: authab_langchain_tools(authab, agent_id))
    show("LangGraph ToolNode", lambda: [authab_langgraph_tool_node(authab, agent_id)])
    show("CrewAI", lambda: authab_crewai_tools(authab, agent_id))
    show("OpenAI Agents", lambda: authab_openai_agents_tools(authab, agent_id))


if __name__ == "__main__":
    main()
