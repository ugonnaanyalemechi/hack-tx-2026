"use client";

import { useEffect, useRef } from "react";
import { MessageSquare } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { AssistantMessage, UserBubble } from "@/components/chat/message-row";
import type { ApprovalDecision, ChatMessage } from "@/lib/chat-types";

interface ChatThreadProps {
  messages: ChatMessage[];
  threadState: "loading" | "ready";
  agentName: string;
  onRetryMessage: (messageId: string) => void;
  onDecide: (
    messageId: string,
    approvalId: string,
    decision: ApprovalDecision
  ) => void;
}

export function ChatThread({
  messages,
  threadState,
  agentName,
  onRetryMessage,
  onDecide,
}: ChatThreadProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  if (threadState === "loading") {
    return (
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-6">
        <Skeleton className="ml-auto h-9 w-2/5 rounded-2xl" />
        <Skeleton className="h-20 w-3/5 rounded-2xl" />
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <MessageSquare className="size-8 text-text-disabled" aria-hidden />
        <p className="text-sm text-text-muted">
          Ask {agentName} a question about Acme&apos;s filings to get started.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-6">
      {messages.map((message) => (
        <div
          key={message.id}
          data-testid={
            message.role === "user" ? "user-message" : "assistant-message"
          }
          data-message-id={message.id}
        >
          {message.role === "user" ? (
            <UserBubble text={message.text} />
          ) : (
            <AssistantMessage
              message={message}
              agentName={agentName}
              onRetry={() => onRetryMessage(message.id)}
              onDecide={(decision) => {
                if (message.approval) {
                  onDecide(message.id, message.approval.id, decision);
                }
              }}
            />
          )}
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
