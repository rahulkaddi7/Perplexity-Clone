from typing import TypedDict, Annotated, Optional
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_community.tools.tavily_search import TavilySearchResults
from langchain_core.messages import HumanMessage, AIMessage, ToolMessage
from langgraph.graph import add_messages, StateGraph, END
from langgraph.checkpoint.memory import MemorySaver
from dotenv import load_dotenv 
from uuid import uuid4
import json
import asyncio

load_dotenv()

llm = ChatGoogleGenerativeAI(model = "gemini-3.1-flash-lite")

search_tool = TavilySearchResults(max_results=3)
tools = [search_tool]

memory = MemorySaver()
llm_with_tools = llm.bind_tools(tools)

class State(TypedDict):
    messages: Annotated[list, add_messages]

async def model(state: State)-> State:
    result = await llm_with_tools.ainvoke(state["messages"])
    return{
        "messages": [result]
    }

async def tool_node(state:State):
    tool_calls = state["messages"][-1].tool_calls

    tool_messages = []

    for tool_call in tool_calls:
        tool_name = tool_call["name"]
        tool_args = tool_call["args"]
        tool_id = tool_call["id"]

        if tool_name == 'tavily_search_results_json':
            search_results = await search_tool.ainvoke(tool_args)

            tool_message = ToolMessage(
                content= str(search_results),
                tool_call_id = tool_id,
                name = tool_name
            )
            tool_messages.append(tool_message)
    return{
        "messages": tool_messages
    }

def tools_router(state: State):
    last_message = state["messages"][-1]

    if hasattr(last_message, "tool_calls") and len(last_message.tool_calls)>0:
        return "tool_node"
    return END

graph_builder = StateGraph(State)

graph_builder.add_node("model", model)
graph_builder.add_node("tool_node", tool_node)

graph_builder.add_edge('tool_node', "model")
graph_builder.add_conditional_edges("model", tools_router)

graph_builder.set_entry_point("model")

graph = graph_builder.compile(checkpointer=memory)
