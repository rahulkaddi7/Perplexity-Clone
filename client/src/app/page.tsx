"use client";

import Header from "@/components/Header";
import InputBar from "@/components/InputBar";
import MessageArea from "@/components/MessageArea";
import React, { useState } from "react";

interface SearchInfo {
  stages: string[];
  query: string;
  urls: string[];
}

interface Message {
  id: number;
  content: string;
  isUser: boolean;
  type: string;
  isLoading?: boolean;
  searchInfo?: SearchInfo;
}

const Home = () => {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 1,
      content: "Hi there, how can I help you?",
      isUser: false,
      type: "message",
    },
  ]);
  const [currentMessage, setCurrentMessage] = useState("");
  const [checkpointId, setCheckpointId] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (currentMessage.trim()) {
      // First add the user message to the chat
      const newMessageId =
        messages.length > 0
          ? Math.max(...messages.map((msg) => msg.id)) + 1
          : 1;

      setMessages((prev) => [
        ...prev,
        {
          id: newMessageId,
          content: currentMessage,
          isUser: true,
          type: "message",
        },
      ]);

      const userInput = currentMessage;
      setCurrentMessage(""); // Clear input field immediately

      try {
        // Create AI response placeholder
        const aiResponseId = newMessageId + 1;
        setMessages((prev) => [
          ...prev,
          {
            id: aiResponseId,
            content: "",
            isUser: false,
            type: "message",
            isLoading: true,
            searchInfo: {
              stages: [],
              query: "",
              urls: [],
            },
          },
        ]);

        // Create URL with checkpoint ID if it exists
        // Create URL
        let url = "http://127.0.0.1:8000/chat_stream";

        if (checkpointId) {
          url += `?checkpoint_id=${encodeURIComponent(checkpointId)}`;
        }

        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: userInput,
          }),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        if (!response.body) {
          throw new Error("Response body is null.");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        let streamedContent = "";
        let searchData = null;
        let hasReceivedContent = false;

        let buffer = "";

        while (true) {
          const { value, done } = await reader.read();

          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          const events = buffer.split("\n\n");
          buffer = events.pop() || "";

          for (const event of events) {
            if (!event.startsWith("data: ")) continue;

            const json = event.substring(6);

            try {
              console.log("RAW:", json);

              const data = JSON.parse(json);

              console.log("TYPE:", data.type);
              console.log("CONTENT:", data.content);

              if (data.type === "checkpoint") {
                setCheckpointId(data.checkpoint_id);
              } else if (data.type === "content") {
                streamedContent += data.content;
                hasReceivedContent = true;

                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === aiResponseId
                      ? {
                          ...msg,
                          content: streamedContent,
                          isLoading: false,
                        }
                      : msg,
                  ),
                );
              } else if (data.type === "search_start") {
                const newSearchInfo = {
                  stages: ["searching"],
                  query: data.query,
                  urls: [],
                };

                searchData = newSearchInfo;

                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === aiResponseId
                      ? {
                          ...msg,
                          content: streamedContent,
                          searchInfo: newSearchInfo,
                          isLoading: false,
                        }
                      : msg,
                  ),
                );
              } else if (data.type === "search_results") {
                const urls =
                  typeof data.urls === "string"
                    ? JSON.parse(data.urls)
                    : data.urls;

                const newSearchInfo = {
                  stages: searchData
                    ? [...searchData.stages, "reading"]
                    : ["reading"],
                  query: searchData?.query || "",
                  urls,
                };

                searchData = newSearchInfo;

                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === aiResponseId
                      ? {
                          ...msg,
                          content: streamedContent,
                          searchInfo: newSearchInfo,
                          isLoading: false,
                        }
                      : msg,
                  ),
                );
              } else if (data.type === "search_error") {
                const newSearchInfo = {
                  stages: searchData
                    ? [...searchData.stages, "error"]
                    : ["error"],
                  query: searchData?.query || "",
                  error: data.error,
                  urls: [],
                };

                searchData = newSearchInfo;

                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === aiResponseId
                      ? {
                          ...msg,
                          content: streamedContent,
                          searchInfo: newSearchInfo,
                          isLoading: false,
                        }
                      : msg,
                  ),
                );
              } else if (data.type === "end") {
                if (searchData) {
                  const finalSearchInfo = {
                    ...searchData,
                    stages: [...searchData.stages, "writing"],
                  };

                  setMessages((prev) =>
                    prev.map((msg) =>
                      msg.id === aiResponseId
                        ? {
                            ...msg,
                            searchInfo: finalSearchInfo,
                            isLoading: false,
                          }
                        : msg,
                    ),
                  );
                }

                await reader.cancel();
                break;
              }
            } catch (err) {
              console.error("Error parsing event:", err);
            }
          }
        }
      } catch (error) {
        console.error("Error setting up EventSource:", error);
        setMessages((prev) => [
          ...prev,
          {
            id: newMessageId + 1,
            content: "Sorry, there was an error connecting to the server.",
            isUser: false,
            type: "message",
            isLoading: false,
          },
        ]);
      }
    }
  };

  return (
    <div className="flex justify-center bg-gray-100 min-h-screen py-8 px-4">
      {/* Main container with refined shadow and border */}
      <div className="w-[70%] bg-white flex flex-col rounded-xl shadow-lg border border-gray-100 overflow-hidden h-[90vh]">
        <Header />
        <MessageArea messages={messages} />
        <InputBar
          currentMessage={currentMessage}
          setCurrentMessage={setCurrentMessage}
          onSubmit={handleSubmit}
        />
      </div>
    </div>
  );
};

export default Home;
