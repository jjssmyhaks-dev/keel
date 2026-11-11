"""Framework adapters for the Keel Python SDK.

Each adapter turns the agent's grants into tools and executes them through the
Keel proxy. Framework packages are imported lazily, so installing Keel alone
does not install LangChain, CrewAI or the OpenAI Agents SDK.
"""

from .common import ToolSpec, ainvoke, build_tool_specs, invoke, tool_name_for
from .crewai import keel_crewai_tools
from .langchain import keel_langchain_tools, keel_langgraph_tool_node
from .openai_agents import keel_openai_agents_tools

__all__ = [
    "ToolSpec",
    "build_tool_specs",
    "invoke",
    "ainvoke",
    "tool_name_for",
    "keel_langchain_tools",
    "keel_langgraph_tool_node",
    "keel_crewai_tools",
    "keel_openai_agents_tools",
]
