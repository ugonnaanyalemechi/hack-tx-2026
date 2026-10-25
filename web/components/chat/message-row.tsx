"use client";

import { useState } from "react";
import { AlertTriangle, Check, Copy, Flag, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ApprovalCard } from "@/components/chat/approval-card";
import type { ApprovalDecision, ChatMessage } from "@/lib/chat-types";

const TOOL_LABELS: Record<string, { running: string; done: string }> = {
  search_filings: { running: "Searching filings", done: "Searched filings" },
  save_note: { running: "Saving note", done: "Saved note" },
};

function toolLabel(name: string, status: "running" | "done"): string {
  const known = TOOL_LABELS[name];
  if (known) return known[status];
  return name;
}

export function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[70%] rounded-2xl rounded-tr-sm bg-primary-500 px-4 py-2.5 text-sm text-neutral-50">
        {text}
      </div>
    </div>
  );
}

export function AssistantMessage({
  message,
  agentName,
  onRetry,
  onDecide,
  onFlag,
}: {
  message: Extract<ChatMessage, { role: "assistant" }>;
  agentName: string;
  onRetry: () => void;
  onDecide: (decision: ApprovalDecision) => void;
  onFlag: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const displayText = message.text ?? message.preview;
  const isLive = message.status === "streaming" && message.text === null;
  const flagStatus = message.flag?.status;
  const flagged = flagStatus !== undefined;

  async function handleCopy() {
    if (!message.text) return;
    try {
      await navigator.clipboard.writeText(message.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be denied by the browser; copy is a courtesy
      // action, so fail quietly rather than surface an error state for it.
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {message.recheckOf ? (
        <Badge variant="brand" className="w-fit">
          Re-checked answer
        </Badge>
      ) : null}
      {message.toolNote ? (
        <div className="flex items-center gap-1.5 text-sm text-text-muted">
          {message.toolNote.status === "running" ? (
            <Loader2 className="size-3.5 animate-spin text-text-muted" aria-hidden />
          ) : (
            <Check className="size-3.5 text-success" aria-hidden />
          )}
          <span>
            {toolLabel(message.toolNote.name, message.toolNote.status)}
            {message.toolNote.status === "done" && message.toolNote.seconds
              ? ` (${message.toolNote.seconds}s)`
              : "…"}
          </span>
        </div>
      ) : null}

      {message.status === "error" && message.error ? (
        <div className="flex max-w-[75%] flex-col gap-3 rounded-2xl border border-error/30 bg-error/10 p-4">
          <div className="flex items-center gap-2 text-sm text-error">
            <AlertTriangle className="size-4 shrink-0" aria-hidden />
            <span>{message.error.message}</span>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onRetry}
            className="w-fit gap-1.5 rounded-pill"
          >
            <RotateCcw className="size-3.5" aria-hidden />
            Try again
          </Button>
        </div>
      ) : (
        <>
          <p className="max-w-[75%] text-sm leading-relaxed text-text-primary">
            {displayText}
            {isLive ? (
              <span
                className="ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 animate-pulse bg-text-muted"
                aria-hidden
              />
            ) : null}
          </p>

          {!isLive && message.citations && message.citations.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {message.citations.map((citation) => (
                <Badge
                  key={citation}
                  variant="outline"
                  className="rounded-pill border-primary-500/30 bg-primary-500/15 px-2.5 py-1 text-text-brand"
                >
                  {citation}
                </Badge>
              ))}
            </div>
          ) : null}

          {!isLive && message.guardNote ? (
            <p className="max-w-[75%] text-xs text-warning">
              {message.guardNote}
            </p>
          ) : null}

          {message.approval ? (
            <ApprovalCard
              approval={message.approval}
              agentName={agentName}
              onDecide={onDecide}
            />
          ) : null}

          {/* A run that stopped for approval hasn't answered yet, so there is
           * nothing to flag or copy; the continuation message has the row. */}
          {!isLive && !message.approval ? (
            <div className="flex items-center gap-1 text-text-muted">
              {message.recheckOf ? null : (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={onFlag}
                  disabled={flagged && flagStatus !== "error"}
                  className="h-7 gap-1.5 rounded-pill px-2.5 text-xs text-text-muted hover:text-text-primary"
                >
                  <Flag className="size-3.5" aria-hidden />
                  {flagged && flagStatus !== "error" ? "Flagged" : "Flag"}
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleCopy}
                disabled={!message.text}
                className="h-7 gap-1.5 rounded-pill px-2.5 text-xs text-text-muted hover:text-text-primary"
              >
                <Copy className="size-3.5" aria-hidden />
                {copied ? "Copied" : "Copy"}
              </Button>
              {flagStatus === "flagging" || flagStatus === "rechecking" ? (
                <Badge variant="info">Re-checking</Badge>
              ) : null}
              {flagStatus === "rechecked" ? <Badge variant="success">Re-check done</Badge> : null}
            </div>
          ) : null}

          {flagStatus === "flagging" || flagStatus === "rechecking" || flagStatus === "rechecked" ? (
            <p
              role="status"
              className="max-w-[75%] rounded-lg border border-border-default bg-white/4 px-4 py-3 text-sm text-text-secondary"
            >
              {flagStatus === "rechecked"
                ? "Your flag was sent to the builder with this run attached. The re-checked answer is below."
                : "Your flag was sent to the builder with this run attached. Re-check in progress."}
            </p>
          ) : null}
          {flagStatus === "error" ? (
            <p role="alert" className="max-w-[75%] text-sm text-error">
              {message.flag?.error ?? "Couldn't send your flag. Try again."}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
