import json

from fastapi import FastAPI, Query
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from typing import Optional
from langchain_core.messages import AIMessageChunk, HumanMessage
import uuid
import asyncio

from pydantic import BaseModel

from server.chatbot import graph

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins = ["*"],
    allow_credentials = True,
    allow_methods = ["*"],
    allow_headers = ["*"],
    expose_headers = ["Content-Type"]
)

def serialise_ai_message_chunk(chunk):
    if not isinstance(chunk, AIMessageChunk):
        raise TypeError()

    if isinstance(chunk.content, str):
        return chunk.content
    
    text = ""

    for block in chunk.content:
        if isinstance(block, dict) and block.get("type") == "text":
            text += block.get("text", "")

    return text

async def generate_chat_responses(message: str, checkpoint_id: Optional[str]= None):
    is_new_converstaion = checkpoint_id is None

    if is_new_converstaion:
        new_checkpoint_id = str(uuid.uuid4())

        config = {
            "configurable":{
                "thread_id": new_checkpoint_id
            }
        }
    
        # first send the checkpoint id to sse 
        yield (
            "data: "
            + json.dumps(
                {
                    "type": "checkpoint",
                    "checkpoint_id": new_checkpoint_id,
                }
            )
            + "\n\n"
        )
    else:
        config = {
            "configurable":{
                "thread_id": checkpoint_id
            }
        } 

    events = graph.astream_events({
        "messages": [HumanMessage(content= message)]
    }, version="v2", config=config)

    async for event in events:
        # print("=" * 80)
        # print("EVENT:", event["event"])
        # print("NAME:", event.get("name"))
        # print("DATA:", event.get("data"))
        # print("=" * 80)
        event_type = event["event"]
        if event_type == "on_chat_model_stream":
            chunk_content = serialise_ai_message_chunk(event["data"]["chunk"])
            # Escape single quotes and newlines for safe JSON parsing
            yield (
                "data: "
                + json.dumps(
                    {
                        "type": "content",
                        "content": chunk_content,
                    }
                )
                + "\n\n"
            )
            
        elif event_type == "on_chat_model_end":
            # Check if there are tool calls for search
            tool_calls = event["data"]["output"].tool_calls if hasattr(event["data"]["output"], "tool_calls") else []
            search_calls = [call for call in tool_calls if call["name"] == "tavily_search_results_json"]
            
            if search_calls:
                # Signal that a search is starting
                search_query = search_calls[0]["args"].get("query", "")
                # Escape quotes and special characters
                yield (
                    "data: "
                    + json.dumps(
                        {
                            "type": "search_start",
                            "query": search_query,
                        }
                    )
                    + "\n\n"
                )
                
        elif event_type == "on_tool_end" and event["name"] == "tavily_search_results_json":
            # Search completed - send results or error
            output = event["data"]["output"]
            
            # Check if output is a list 
            if isinstance(output, list):
                # Extract URLs from list of search results
                urls = []
                for item in output:
                    if isinstance(item, dict) and "url" in item:
                        urls.append(item["url"])
                
                # Convert URLs to JSON and yield them
                yield (
                    "data: "
                    + json.dumps(
                        {
                            "type": "search_results",
                            "urls": urls,
                        }
                    )
                    + "\n\n"
                )
    
    # Send an end event
    yield "data: " + json.dumps({"type": "end"}) + "\n\n"


class chatRequest(BaseModel):
    message: str

@app.post("/chat_stream")
async def chat_stream(request: chatRequest, checkpoint_id: Optional[str]= Query(None)):
    return StreamingResponse(
        generate_chat_responses(request.message, checkpoint_id),
        media_type= "text/event-stream"
    )

# StreamingResponse uses SSE (server sent events)