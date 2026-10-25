"use client";

import { Suspense, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";
import { TopNav } from "@/components/chat/top-nav";
import { ChatSidebar } from "@/components/chat/chat-sidebar";
import { ChatThread } from "@/components/chat/chat-thread";
import { Composer } from "@/components/chat/composer";
import { BudgetPausedCard } from "@/components/budget/budget-paused-card";
import { BudgetWarningBanner } from "@/components/budget/budget-warning-banner";
import { ApiError } from "@/lib/api/client";
import {
  mockBudgetState,
  mockSetSpendShare,
  subscribeMockBudgets,
} from "@/lib/api/mock-budgets";
import {
  MOCK_AGENT,
  getSeedChats,
  mockContinueRun,
  mockDecideApproval,
  mockFlagAnswer,
  mockSendMessage,
} from "@/lib/mock-chat";
import type {
  ApprovalDecision,
  ApprovalRequest,
  ChatMessage,
  ChatSummary,
  FlagState,
} from "@/lib/chat-types";
import type { StreamEvent } from "@/lib/contracts/events";

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

/** The run that stopped on the budget, so Continue can pick it up. */
interface PausedRun {
  chatId: string;
  assistantId: string;
  /** The user message the run was answering; null when unknown. */
  userText: string | null;
}

/** Spend share the `?budget=` preview puts the mock agent at. */
const BUDGET_PREVIEW_SHARE = { ok: 0.4, warned: 0.82, paused: 1 } as const;

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
  const forceDecideError = searchParams.get("decideError") === "1";
  const forceFlagError = searchParams.get("flagError") === "1";
  const budgetPreview = searchParams.get("budget");

  // The agent's budget state (never its cost) from the mock store, which
  // follows the admin approving spend in another tab.
  const budgetState = useSyncExternalStore(
    subscribeMockBudgets,
    () => mockBudgetState(MOCK_AGENT.id),
    () => "ok" as const
  );
  const [pausedRun, setPausedRun] = useState<PausedRun | null>(null);
  const [continuing, setContinuing] = useState(false);
  const [continueNotice, setContinueNotice] = useState<{
    kind: "waiting" | "error";
    message: string;
  } | null>(null);

  // Preview/test hook: ?budget=ok|warned|paused sets the mock agent's spend.
  useEffect(() => {
    if (budgetPreview === "ok" || budgetPreview === "warned" || budgetPreview === "paused") {
      mockSetSpendShare(MOCK_AGENT.id, BUDGET_PREVIEW_SHARE[budgetPreview]);
    }
  }, [budgetPreview]);

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

  async function runStream(
    chatId: string,
    assistantId: string,
    events: AsyncIterable<StreamEvent>,
    userText: string | null = null
  ) {
    setIsStreaming(true);
    let preview = "";
    try {
      for await (const event of events) {
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
            patchAssistantMessage(chatId, assistantId, (m) => ({
              ...m,
              // Tokens are preview-only: if no message_complete carried
              // guarded text before the pause, the preview must not stay.
              preview: "",
              approval: {
                id: event.approval_id,
                toolName: event.tool_name,
                toolInput: event.tool_input,
                status: "pending",
              },
            }));
            break;
          case "budget_paused":
            // The run stopped on the budget. Keep what streamed so far and
            // show the paused card; Continue resumes this message.
            patchAssistantMessage(chatId, assistantId, (m) => ({
              ...m,
              preview: "",
              paused: true,
              status: "done",
            }));
            setPausedRun({ chatId, assistantId, userText });
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

    void startRun(chatId, assistantMsg.id, text);
  }

  /** Sends the user's message and streams the answer. A 409 (the agent is
   * paused, or an approval is pending) leaves the chat as it is. */
  async function startRun(chatId: string, assistantId: string, userText: string) {
    setIsStreaming(true);
    let events: AsyncIterable<StreamEvent>;
    try {
      events = await mockSendMessage(MOCK_AGENT.id, userText, { speed: streamSpeed });
    } catch (error) {
      setIsStreaming(false);
      const code = error instanceof ApiError ? error.code : "";
      if (error instanceof ApiError && error.status === 409 && code === "budget_paused") {
        // Nothing ran. The message stays, and Continue sends it once approved.
        patchAssistantMessage(chatId, assistantId, { paused: true, status: "done" });
        setPausedRun({ chatId, assistantId, userText });
        return;
      }
      patchAssistantMessage(chatId, assistantId, {
        status: "error",
        error: {
          code: code || "send_failed",
          message:
            error instanceof ApiError && error.status === 409
              ? "An approval is waiting. Decide it first, then try again."
              : "Couldn't send your message. Try again in a moment.",
        },
      });
      return;
    }
    await runStream(chatId, assistantId, events, userText);
  }

  /** Continue after a pause: a 409 means no admin approval yet. */
  async function handleContinue() {
    setContinuing(true);
    setContinueNotice(null);
    const run = pausedRun;
    try {
      const events = await mockContinueRun(MOCK_AGENT.id, run?.userText ?? null, {
        speed: streamSpeed,
      });
      setPausedRun(null);
      setContinuing(false);
      if (run && events) {
        patchAssistantMessage(run.chatId, run.assistantId, {
          text: null,
          preview: "",
          paused: false,
          status: "streaming",
        });
        await runStream(run.chatId, run.assistantId, events, run.userText);
      }
    } catch (error) {
      setContinuing(false);
      setContinueNotice(
        error instanceof ApiError && error.status === 409
          ? {
              kind: "waiting",
              message: "Still waiting for an admin to approve more. Your chat is saved.",
            }
          : {
              kind: "error",
              message: "Couldn't continue. Check your connection and try again.",
            }
      );
    }
  }

  function patchApproval(
    chatId: string,
    messageId: string,
    patch: Partial<ApprovalRequest>
  ) {
    patchAssistantMessage(chatId, messageId, (m) =>
      m.approval ? { ...m, approval: { ...m.approval, ...patch } } : m
    );
  }

  /** Sends the user's decision. Deciding is a new streaming call that
   * resumes the stopped run; its events land in a new assistant message
   * under the card. */
  async function handleDecide(
    messageId: string,
    approvalId: string,
    decision: ApprovalDecision
  ) {
    if (!activeChatId) return;
    const chatId = activeChatId;
    patchApproval(chatId, messageId, {
      status: "deciding",
      decision,
      error: undefined,
    });

    let events: AsyncIterable<StreamEvent>;
    try {
      events = await mockDecideApproval(approvalId, decision, {
        speed: streamSpeed,
        failFirstAttempt: forceDecideError,
      });
    } catch {
      patchApproval(chatId, messageId, {
        status: "pending",
        error: "Couldn't send your decision. Check your connection and try again.",
      });
      return;
    }

    patchApproval(chatId, messageId, {
      status: decision === "approve" ? "approved" : "rejected",
    });
    const continuation: ChatMessage = {
      id: localId("msg"),
      role: "assistant",
      text: null,
      preview: "",
      status: "streaming",
      createdAt: new Date().toISOString(),
    };
    setChats((prev) =>
      prev.map((c) =>
        c.id === chatId ? { ...c, messages: [...c.messages, continuation] } : c
      )
    );
    await runStream(chatId, continuation.id, events);
  }

  function setFlag(chatId: string, messageId: string, flag: FlagState) {
    patchAssistantMessage(chatId, messageId, { flag });
  }

  /** Flags an answer: the re-check streams back as a new message right
   * after the flagged one, so it clearly follows it. */
  async function handleFlag(messageId: string) {
    if (!activeChatId) return;
    const chatId = activeChatId;
    const chat = chats.find((c) => c.id === chatId);
    const index = chat?.messages.findIndex((m) => m.id === messageId) ?? -1;
    const question = index > 0 ? chat?.messages[index - 1] : undefined;
    if (!chat || !question || question.role !== "user") return;

    setFlag(chatId, messageId, { status: "flagging" });
    let events: AsyncIterable<StreamEvent>;
    try {
      // RUNTIME-PLACEHOLDER(#30): mock flag call; swap for the live flag call and its re-check stream. The ?flagError=1 switch is a mock-only test hook.
      events = await mockFlagAnswer(messageId, question.text, {
        speed: streamSpeed,
        failFirstAttempt: forceFlagError,
      });
    } catch {
      setFlag(chatId, messageId, {
        status: "error",
        error: "Couldn't send your flag. Check your connection and try again.",
      });
      return;
    }

    setFlag(chatId, messageId, { status: "rechecking" });
    const recheck: ChatMessage = {
      id: localId("msg"),
      role: "assistant",
      text: null,
      preview: "",
      status: "streaming",
      recheckOf: messageId,
      createdAt: new Date().toISOString(),
    };
    setChats((prev) =>
      prev.map((c) => {
        if (c.id !== chatId) return c;
        const at = c.messages.findIndex((m) => m.id === messageId);
        const messages = [...c.messages];
        messages.splice(at + 1, 0, recheck);
        return { ...c, messages };
      })
    );
    await runStream(chatId, recheck.id, events);
    setFlag(chatId, messageId, { status: "rechecked" });
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
      paused: false,
      error: undefined,
      toolNote: undefined,
      guardNote: undefined,
      citations: undefined,
    });
    void startRun(activeChatId, messageId, userMessage.text);
  }

  const activeMessages =
    chats.find((c) => c.id === activeChatId)?.messages ?? [];
  // The run is stopped on an approval card; nothing else can be sent in
  // this chat until the user decides.
  const awaitingDecision = activeMessages.some(
    (m) =>
      m.role === "assistant" &&
      (m.approval?.status === "pending" || m.approval?.status === "deciding")
  );

  // Paused is agent-wide: every chat stops until an admin approves more.
  // Once approved, a stopped run stays on screen with Continue.
  const showPaused = pausedRun !== null || budgetState === "paused";
  const approved = budgetState !== "paused";
  const pausedChatId = showPaused ? (pausedRun?.chatId ?? activeChatId) : null;

  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <TopNav />
      <div className="flex min-h-0 flex-1">
        <ChatSidebar
          agent={MOCK_AGENT}
          chats={chats}
          chatsState={chatsState}
          activeChatId={activeChatId}
          pausedChatId={pausedChatId}
          onSelectChat={handleSelectChat}
          onNewChat={handleNewChat}
          onRetryChats={retryLoadChats}
        />
        <main className="flex min-h-0 flex-1 flex-col">
          {budgetState === "warned" && !showPaused ? (
            <BudgetWarningBanner agentName={MOCK_AGENT.name} />
          ) : null}
          <ChatThread
            messages={activeMessages}
            threadState={threadState}
            agentName={MOCK_AGENT.name}
            onRetryMessage={handleRetryMessage}
            onFlag={handleFlag}
            onDecide={handleDecide}
            footer={
              showPaused ? (
                <BudgetPausedCard
                  agentName={MOCK_AGENT.name}
                  approved={approved}
                  continuing={continuing}
                  notice={continueNotice}
                  onContinue={() => void handleContinue()}
                />
              ) : null
            }
          />
          <Composer
            agentName={MOCK_AGENT.name}
            disabled={isStreaming || awaitingDecision || showPaused}
            placeholder={
              showPaused
                ? approved
                  ? "Approved, press Continue"
                  : "Paused, waiting for an admin"
                : awaitingDecision
                  ? "Waiting for your decision"
                  : undefined
            }
            onSend={sendMessage}
          />
        </main>
      </div>
    </div>
  );
}
