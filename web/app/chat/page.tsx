"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { TopNav } from "@/components/chat/top-nav";
import { ChatSidebar } from "@/components/chat/chat-sidebar";
import { ChatThread } from "@/components/chat/chat-thread";
import { Composer } from "@/components/chat/composer";
import { MOCK_AGENT, getSeedChats, mockChatStream } from "@/lib/mock-chat";
import type { ChatMessage, ChatSummary } from "@/lib/chat-types";

type AssistantMessage = Extract<ChatMessage, { role: "assistant" }>;

let localIdCounter = 0;
function localId(prefix: string) {
  localIdCounter += 1;
  return `${prefix}_local_${localIdCounter}`;
}

function truncateTitle(text: string, max = 42): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

export default function ChatPage() {
  return (
    <Suspense fallback={<div className="flex-1 bg-canvas" />}>
      <ChatPageInner />
    </Suspense>
  );
}

function ChatPageInner() {
  const searchParams = useSearchParams();
  const forceEmpty = searchParams.get("empty") === "1";
  const forceChatsError = searchParams.get("chatsError") === "1";
  // Tests run the mock stream at a much higher speed so the suite stays
  // fast; the UI still goes through every real event in order.
  const streamSpeed = searchParams.get("fastStream") === "1" ? 0.05 : 1;

  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [chatsState, setChatsState] = useState<"loading" | "error" | "ready">(
    "loading"
  );
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [threadState, setThreadState] = useState<"loading" | "ready">(
    "ready"
  );
  const [isStreaming, setIsStreaming] = useState(false);
  const loadAttempt = useRef(0);

  // Fetches never set state synchronously within the triggering effect —
  // only inside the setTimeout callback — so the initial mount-triggered
  // load doesn't need a separate "mark loading" step (chatsState already
  // starts as "loading").
  const fetchChats = useCallback(
    (attempt: number) => {
      setTimeout(() => {
        if (attempt !== loadAttempt.current) return; // superseded by a retry
        if (forceChatsError) {
          setChatsState("error");
          return;
        }
        const seeded = forceEmpty ? [] : getSeedChats();
        setChats(seeded);
        setActiveChatId(seeded[0]?.id ?? null);
        setChatsState("ready");
      }, 350);
    },
    [forceEmpty, forceChatsError]
  );

  useEffect(() => {
    const attempt = ++loadAttempt.current;
    fetchChats(attempt);
  }, [fetchChats]);

  function retryLoadChats() {
    const attempt = ++loadAttempt.current;
    setChatsState("loading");
    fetchChats(attempt);
  }

  function patchAssistantMessage(
    chatId: string,
    assistantId: string,
    patch: Partial<AssistantMessage> | ((m: AssistantMessage) => AssistantMessage)
  ) {
    setChats((prev) =>
      prev.map((chat) => {
        if (chat.id !== chatId) return chat;
        return {
          ...chat,
          messages: chat.messages.map((m) => {
            if (m.id !== assistantId || m.role !== "assistant") return m;
            return typeof patch === "function" ? patch(m) : { ...m, ...patch };
          }),
        };
      })
    );
  }

  async function runStream(chatId: string, assistantId: string, text: string) {
    setIsStreaming(true);
    let preview = "";
    try {
      for await (const event of mockChatStream(text, { speed: streamSpeed })) {
        switch (event.type) {
          case "run_started":
            break;
          case "token":
            preview += event.text;
            patchAssistantMessage(chatId, assistantId, { preview });
            break;
          case "tool_call":
            patchAssistantMessage(chatId, assistantId, {
              toolNote: { name: event.name, status: "running" },
            });
            break;
          case "tool_result": {
            const durationMs =
              typeof event.output.duration_ms === "number"
                ? event.output.duration_ms
                : 0;
            // tool_result.output is a free-form dict in the contract; our
            // mock search tool reports citations in it (see mock-chat.ts).
            const citations = Array.isArray(event.output.citations)
              ? (event.output.citations as string[])
              : undefined;
            patchAssistantMessage(chatId, assistantId, (m) => ({
              ...m,
              toolNote: {
                name: event.name,
                seconds: Math.round(durationMs) / 1000,
                status: "done",
              },
              citations: citations ?? m.citations,
            }));
            break;
          }
          case "guard_note":
            patchAssistantMessage(chatId, assistantId, { guardNote: event.note });
            break;
          case "message_complete":
            patchAssistantMessage(chatId, assistantId, { text: event.text });
            break;
          case "error":
            patchAssistantMessage(chatId, assistantId, {
              status: "error",
              error: { code: event.code, message: event.message },
            });
            break;
          case "run_finished":
            patchAssistantMessage(chatId, assistantId, (m) =>
              m.status === "error" ? m : { ...m, status: "done" }
            );
            break;
          case "approval_required":
          case "budget_paused":
            // Approval and budget-pause UI are owned by separate tickets
            // (#25 / budget ladder work); not exercised by this mock.
            break;
        }
      }
    } finally {
      setIsStreaming(false);
    }
  }

  function sendMessage(text: string) {
    const now = new Date().toISOString();
    const userMsg: ChatMessage = {
      id: localId("msg"),
      role: "user",
      text,
      createdAt: now,
    };
    const assistantMsg: ChatMessage = {
      id: localId("msg"),
      role: "assistant",
      text: null,
      preview: "",
      status: "streaming",
      createdAt: now,
    };

    const chatId = activeChatId ?? localId("chat");

    setChats((prev) => {
      const existing = prev.find((c) => c.id === chatId);
      if (existing) {
        return prev.map((c) =>
          c.id === chatId
            ? { ...c, messages: [...c.messages, userMsg, assistantMsg], updatedAt: now }
            : c
        );
      }
      const newChat: ChatSummary = {
        id: chatId,
        title: truncateTitle(text),
        relativeLabel: "Today",
        updatedAt: now,
        messages: [userMsg, assistantMsg],
      };
      return [newChat, ...prev];
    });
    setActiveChatId(chatId);

    void runStream(chatId, assistantMsg.id, text);
  }

  function handleSelectChat(chatId: string) {
    if (chatId === activeChatId) return;
    setThreadState("loading");
    setTimeout(() => {
      setActiveChatId(chatId);
      setThreadState("ready");
    }, 250);
  }

  function handleNewChat() {
    setActiveChatId(null);
    setThreadState("ready");
  }

  function handleRetryMessage(messageId: string) {
    if (!activeChatId) return;
    const chat = chats.find((c) => c.id === activeChatId);
    const assistantIndex = chat?.messages.findIndex((m) => m.id === messageId) ?? -1;
    if (!chat || assistantIndex < 1) return;
    const userMessage = chat.messages[assistantIndex - 1];
    if (userMessage.role !== "user") return;

    patchAssistantMessage(activeChatId, messageId, {
      text: null,
      preview: "",
      status: "streaming",
      error: undefined,
      toolNote: undefined,
      guardNote: undefined,
      citations: undefined,
    });
    void runStream(activeChatId, messageId, userMessage.text);
  }

  const activeMessages =
    chats.find((c) => c.id === activeChatId)?.messages ?? [];

  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <TopNav />
      <div className="flex min-h-0 flex-1">
        <ChatSidebar
          agent={MOCK_AGENT}
          chats={chats}
          chatsState={chatsState}
          activeChatId={activeChatId}
          onSelectChat={handleSelectChat}
          onNewChat={handleNewChat}
          onRetryChats={retryLoadChats}
        />
        <main className="flex min-h-0 flex-1 flex-col">
          <ChatThread
            messages={activeMessages}
            threadState={threadState}
            agentName={MOCK_AGENT.name}
            onRetryMessage={handleRetryMessage}
          />
          <Composer
            agentName={MOCK_AGENT.name}
            disabled={isStreaming}
            onSend={sendMessage}
          />
        </main>
      </div>
    </div>
  );
}
