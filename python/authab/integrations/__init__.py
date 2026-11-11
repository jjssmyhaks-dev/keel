"""Framework adapters for the Authab Python SDK.

Each adapter turns the agent's grants into tools and executes them through the
Authab proxy. Framework packages are imported lazily, so installing Authab alone
does not install LangChain, CrewAI or the OpenAI Agents SDK.
"""

from .common import ToolSpec, ainvoke, build_tool_specs, invoke, tool_name_for
from .crewai import authab_crewai_tools
from .langchain import authab_langchain_tools, authab_langgraph_tool_node
from .openai_agents import authab_openai_agents_tools

__all__ = [
    "ToolSpec",
    "build_tool_specs",
    "invoke",
    "ainvoke",
    "tool_name_for",
    "authab_langchain_tools",
    "authab_langgraph_tool_node",
    "authab_crewai_tools",
    "authab_openai_agents_tools",
]
