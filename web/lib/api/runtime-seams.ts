/**
 * Runtime seams: every call the UI makes that needs the agent runtime
 * (streaming chat, approvals, budget resume, flag re-check), behind one
 * typed interface.
 *
 * Two bindings share it. `createMockRuntime` (the default) plays the scripted
 * events in `lib/mock-chat.ts`. `createLiveRuntime` is a stub: each call
 * rejects with `RuntimeNotAvailableError` until the runtime ticket it names
 * lands, and the chat page turns that into its normal error state, so
 * `?api=live` degrades to a readable message rather than a crash.
 *
 * To go live, implement the method in `createLiveRuntime`, delete its
 * `RUNTIME-PLACEHOLDER` marker, and keep the mock binding for Playwright.
 * See web/RUNTIME-HANDOFF.md.
 */

import type { StreamEvent } from "@/lib/contracts/events";
import type { ApprovalDecision } from "@/lib/chat-types";
import type { ApiMode } from "@/lib/api/config";
import {
  mockContinueRun,
  mockDecideApproval,
  mockFlagAnswer,
  mockSendMessage,
} from "@/lib/mock-chat";

/** Thrown by a live seam whose runtime ticket has not landed. */
export class RuntimeNotAvailableError extends Error {
  readonly ticket: number;

  /** `what` reads as a sentence start, e.g. "Live chat streaming isn't available yet". */
  constructor(what: string, ticket: number) {
    super(`${what}, needs runtime #${ticket}`);
    this.name = "RuntimeNotAvailableError";
    this.ticket = ticket;
  }
}

export interface StreamOptions {
  /** Playwright runs the mock stream faster; the live binding ignores it. */
  speed?: number;
}

export interface FlagInput {
  agentId: string;
  /** The flagged assistant message. */
  messageId: string;
  /** The user message it answered. */
  question: string;
  /** The flagged answer text. */
  answer: string;
  /** Who flagged it (the role switcher's user). */
  userId: string;
}

export interface RuntimeApi {
  /** Send a user message and stream the run. 409 `budget_paused` or
   * `approval_pending` reject as `ApiError`. (#15) */
  sendMessage(
    agentId: string,
    text: string,
    opts?: StreamOptions
  ): Promise<AsyncIterable<StreamEvent>>;

  /** Decide a pending approval; the stream resumes the stopped run. (#24) */
  decideApproval(
    approvalId: string,
    decision: ApprovalDecision,
    opts?: StreamOptions & { failFirstAttempt?: boolean }
  ): Promise<AsyncIterable<StreamEvent>>;

  /** Continue a run that stopped on the budget once an admin approved more.
   * 409 `budget_paused` while still paused. Resolves null when there is no
   * stopped message to pick up. (#22) */
  continueRun(
    agentId: string,
    userText: string | null,
    opts?: StreamOptions
  ): Promise<AsyncIterable<StreamEvent> | null>;

  /** Flag an answer: files a ticket and streams the re-check run. (#30) */
  flagAnswer(
    input: FlagInput,
    opts?: StreamOptions & { failFirstAttempt?: boolean }
  ): Promise<AsyncIterable<StreamEvent>>;
}

/** The current binding: scripted events from `lib/mock-chat.ts`. */
export function createMockRuntime(): RuntimeApi {
  return {
    sendMessage: (agentId, text, opts) => mockSendMessage(agentId, text, opts),
    decideApproval: (approvalId, decision, opts) =>
      mockDecideApproval(approvalId, decision, opts),
    continueRun: (agentId, userText, opts) => mockContinueRun(agentId, userText, opts),
    flagAnswer: (input, opts) =>
      mockFlagAnswer(input.messageId, input.question, {
        ...opts,
        ticket: { agentId: input.agentId, answer: input.answer, userId: input.userId },
      }),
  };
}

/** The live binding: every call rejects until its runtime ticket lands. */
export function createLiveRuntime(): RuntimeApi {
  return {
    // RUNTIME-PLACEHOLDER(#15): replace with the streaming chat endpoint (SSE); the UI already consumes the StreamEvent contract.
    sendMessage: () =>
      Promise.reject(new RuntimeNotAvailableError("Live chat streaming isn't available yet", 15)),
    // RUNTIME-PLACEHOLDER(#24): replace with the approval decide route (route and body not settled, see #62) that streams the resumed run.
    decideApproval: () =>
      Promise.reject(new RuntimeNotAvailableError("Deciding an approval isn't available yet", 24)),
    // RUNTIME-PLACEHOLDER(#22): replace with the resume endpoint for a budget-paused run (route and body not settled, see #62).
    continueRun: () =>
      Promise.reject(
        new RuntimeNotAvailableError("Continuing a paused chat isn't available yet", 22)
      ),
    // RUNTIME-PLACEHOLDER(#30): replace with the flag route (files the ticket) and the SSE stream of the re-check run.
    flagAnswer: () =>
      Promise.reject(new RuntimeNotAvailableError("Flagging an answer isn't available yet", 30)),
  };
}

export function createRuntime(mode: ApiMode): RuntimeApi {
  return mode === "live" ? createLiveRuntime() : createMockRuntime();
}

/** A readable line for the UI from any error a seam call can throw. */
export function runtimeErrorMessage(error: unknown, fallback: string): string {
  return error instanceof RuntimeNotAvailableError ? `${error.message}.` : fallback;
}
