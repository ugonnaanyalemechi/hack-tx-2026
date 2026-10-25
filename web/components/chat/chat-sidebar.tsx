"use client";

import { ArrowLeft, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { Agent, ChatSummary } from "@/lib/chat-types";

interface ChatSidebarProps {
  agent: Agent;
  chats: ChatSummary[];
  chatsState: "loading" | "error" | "ready";
  activeChatId: string | null;
  /** The chat that stopped on the agent's budget, marked "Paused". */
  pausedChatId?: string | null;
  onSelectChat: (chatId: string) => void;
  onNewChat: () => void;
  onRetryChats: () => void;
}

export function ChatSidebar({
  agent,
  chats,
  chatsState,
  activeChatId,
  pausedChatId = null,
  onSelectChat,
  onNewChat,
  onRetryChats,
}: ChatSidebarProps) {
  return (
    <aside className="flex w-70 shrink-0 flex-col gap-6 border-r border-border-subtle bg-surface-1 p-5">
      <a
        href="/catalog"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-text-secondary transition-colors hover:text-text-primary"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        All agents
      </a>

      <div className="flex flex-col gap-0.5">
        <h1 className="text-lg font-semibold text-text-primary">
          {agent.name}
        </h1>
        <p className="text-sm text-text-muted">Owner: {agent.ownerName}</p>
      </div>

      <Button
        type="button"
        onClick={onNewChat}
        className="h-10 w-full justify-center gap-1.5 rounded-pill bg-steel text-sm font-medium text-text-inverse hover:brightness-110"
      >
        <Plus className="size-4" aria-hidden />
        New chat
      </Button>

      <div className="flex min-h-0 flex-1 flex-col gap-2">
        <h2 className="font-mono text-overline font-medium tracking-overline text-text-brand uppercase">
          Your chats
        </h2>

        <ChatList
          chats={chats}
          chatsState={chatsState}
          activeChatId={activeChatId}
          pausedChatId={pausedChatId}
          onSelectChat={onSelectChat}
          onRetryChats={onRetryChats}
        />
      </div>
    </aside>
  );
}

function ChatList({
  chats,
  chatsState,
  activeChatId,
  pausedChatId,
  onSelectChat,
  onRetryChats,
}: {
  pausedChatId: string | null;
  chats: ChatSummary[];
  chatsState: "loading" | "error" | "ready";
  activeChatId: string | null;
  onSelectChat: (chatId: string) => void;
  onRetryChats: () => void;
}) {
  if (chatsState === "loading") {
    return (
      <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading chats">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-13 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (chatsState === "error") {
    return (
      <div
        role="alert"
        className="flex flex-col gap-3 rounded-lg border border-error/30 bg-error/10 p-3 text-sm text-text-secondary"
      >
        <p>Couldn&apos;t load your past chats.</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onRetryChats}
          className="w-fit rounded-pill"
        >
          Retry
        </Button>
      </div>
    );
  }

  if (chats.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border-default p-4 text-sm text-text-muted">
        No past chats yet. Start one with the button above.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-1 overflow-y-auto">
      {chats.map((chat) => {
        const isActive = chat.id === activeChatId;
        return (
          <li key={chat.id}>
            <button
              type="button"
              onClick={() => onSelectChat(chat.id)}
              aria-current={isActive ? "true" : undefined}
              className="flex w-full flex-col gap-0.5 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-white/5 aria-[current=true]:bg-white/8"
            >
              <span className="truncate text-sm text-text-primary">
                {chat.title}
              </span>
              <span
                className={`text-xs ${
                  chat.id === pausedChatId ? "text-warning" : "text-text-muted"
                }`}
              >
                {chat.id === pausedChatId ? "Paused" : chat.relativeLabel}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
