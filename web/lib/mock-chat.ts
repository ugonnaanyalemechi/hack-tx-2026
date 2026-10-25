/**
 * Mock chat backend.
 *
 * The real streaming HTTP endpoint (owner:runtime) does not exist yet. This
 * module simulates a realistic SSE sequence for a new message using the
 * exact StreamEvent contract in lib/contracts/events.ts, plus seed data for
 * past chats, so the chat page can be built and screenshotted against the
 * real contract now and swapped to a real client later without UI changes.
 */

import type { StreamEvent } from "./contracts/events";
import type { Agent, ChatSummary } from "./chat-types";

export const MOCK_AGENT: Agent = {
  id: "agent_filings_analyst",
  name: "Filings Analyst",
  ownerName: "Priya",
};

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

let idCounter = 0;
function nextId(prefix: string) {
  idCounter += 1;
  return `${prefix}_${idCounter}`;
}

/** Seed a couple of past chats with realistic finance Q&A so loaded/empty
 * states both have something meaningful to screenshot. */
export function getSeedChats(): ChatSummary[] {
  return [
    {
      id: "chat_acme_revenue",
      title: "Acme revenue by segment",
      relativeLabel: "Today",
      updatedAt: "2026-10-25T14:00:00Z",
      messages: [
        {
          id: nextId("msg"),
          role: "user",
          text: "What was Acme's revenue by segment in fiscal 2025?",
          createdAt: "2026-10-25T13:58:00Z",
        },
        {
          id: nextId("msg"),
          role: "assistant",
          text: "Acme reported $4.2B in fiscal 2025 revenue. Cloud was $2.1B, Hardware $1.4B and Services $0.7B. Cloud grew fastest, up 18% on the year.",
          preview:
            "Acme reported $4.2B in fiscal 2025 revenue. Cloud was $2.1B, Hardware $1.4B and Services $0.7B. Cloud grew fastest, up 18% on the year.",
          toolNote: { name: "search_filings", seconds: 1.4, status: "done" },
          citations: ["10-K · p.47", "10-K · p.52"],
          status: "done",
          createdAt: "2026-10-25T13:58:04Z",
        },
        {
          id: nextId("msg"),
          role: "user",
          text: "And what about operating margin?",
          createdAt: "2026-10-25T13:59:00Z",
        },
        {
          id: nextId("msg"),
          role: "assistant",
          text: "Operating margin was 21.4%, up from 19.8% in fiscal 2024.",
          preview: "Operating margin was 21.4%, up from 19.8% in fiscal 2024.",
          toolNote: { name: "search_filings", seconds: 1.1, status: "done" },
          citations: ["10-K · p.49"],
          guardNote: "One value was removed because it looked like a secret.",
          status: "done",
          createdAt: "2026-10-25T13:59:03Z",
        },
      ],
    },
    {
      id: "chat_risk_factors",
      title: "Risk factors, last two years",
      relativeLabel: "Yesterday",
      updatedAt: "2026-10-24T10:00:00Z",
      messages: [
        {
          id: nextId("msg"),
          role: "user",
          text: "Summarize the new risk factors Acme added in the last two fiscal years.",
          createdAt: "2026-10-24T09:58:00Z",
        },
        {
          id: nextId("msg"),
          role: "assistant",
          text: "Acme added two new risk factors since fiscal 2023: concentration risk from its largest cloud customer (now 14% of segment revenue), and supply-chain exposure tied to a single hardware component vendor.",
          preview:
            "Acme added two new risk factors since fiscal 2023: concentration risk from its largest cloud customer (now 14% of segment revenue), and supply-chain exposure tied to a single hardware component vendor.",
          toolNote: { name: "search_filings", seconds: 2.1, status: "done" },
          citations: ["10-K · p.12", "10-K · p.14"],
          status: "done",
          createdAt: "2026-10-24T09:58:05Z",
        },
      ],
    },
    {
      id: "chat_debt_maturity",
      title: "Debt maturity schedule",
      relativeLabel: "Mon",
      updatedAt: "2026-10-20T16:00:00Z",
      messages: [
        {
          id: nextId("msg"),
          role: "user",
          text: "What does Acme's debt maturity schedule look like over the next five years?",
          createdAt: "2026-10-20T15:58:00Z",
        },
        {
          id: nextId("msg"),
          role: "assistant",
          text: "Acme has $600M of notes maturing in fiscal 2027 and $900M in fiscal 2029. No other long-term debt matures before fiscal 2031.",
          preview:
            "Acme has $600M of notes maturing in fiscal 2027 and $900M in fiscal 2029. No other long-term debt matures before fiscal 2031.",
          toolNote: { name: "search_filings", seconds: 1.8, status: "done" },
          citations: ["10-K · p.61"],
          status: "done",
          createdAt: "2026-10-20T15:58:04Z",
        },
      ],
    },
  ];
}

interface AnsweredContent {
  toolSeconds: number;
  previewText: string;
  finalText: string;
  citations: string[];
  guardNote?: string;
}

/** Pick a canned answer by keyword, falling back to a generic one. Some
 * answers include a value in the streamed preview that the guard removes
 * before message_complete, so the UI's "replace preview with final text"
 * behavior is actually exercised. */
function pickAnswer(userText: string): AnsweredContent {
  const q = userText.toLowerCase();

  if (q.includes("margin")) {
    return {
      toolSeconds: 1.1,
      previewText:
        "Operating margin was 21.4%, up from 19.8% in fiscal 2024. Internal note: acct #4471-2290-91 was referenced in the filing's margin worksheet.",
      finalText: "Operating margin was 21.4%, up from 19.8% in fiscal 2024.",
      citations: ["10-K · p.49"],
      guardNote: "One value was removed because it looked like a secret.",
    };
  }

  if (q.includes("revenue") || q.includes("segment")) {
    return {
      toolSeconds: 1.4,
      previewText:
        "Acme reported $4.2B in fiscal 2025 revenue. Cloud was $2.1B, Hardware $1.4B and Services $0.7B. Cloud grew fastest, up 18% on the year.",
      finalText:
        "Acme reported $4.2B in fiscal 2025 revenue. Cloud was $2.1B, Hardware $1.4B and Services $0.7B. Cloud grew fastest, up 18% on the year.",
      citations: ["10-K · p.47", "10-K · p.52"],
    };
  }

  if (q.includes("risk")) {
    return {
      toolSeconds: 2.1,
      previewText:
        "Acme added two new risk factors since fiscal 2023: customer concentration and supply-chain exposure to a single hardware vendor.",
      finalText:
        "Acme added two new risk factors since fiscal 2023: customer concentration and supply-chain exposure to a single hardware vendor.",
      citations: ["10-K · p.12", "10-K · p.14"],
    };
  }

  if (q.includes("debt") || q.includes("maturity")) {
    return {
      toolSeconds: 1.8,
      previewText:
        "Acme has $600M of notes maturing in fiscal 2027 and $900M in fiscal 2029. No other long-term debt matures before fiscal 2031.",
      finalText:
        "Acme has $600M of notes maturing in fiscal 2027 and $900M in fiscal 2029. No other long-term debt matures before fiscal 2031.",
      citations: ["10-K · p.61"],
    };
  }

  return {
    toolSeconds: 1.2,
    previewText:
      "I looked through Acme's most recent 10-K but didn't find a section that directly answers that. Try asking about revenue, margin, risk factors, or debt maturity.",
    finalText:
      "I looked through Acme's most recent 10-K but didn't find a section that directly answers that. Try asking about revenue, margin, risk factors, or debt maturity.",
    citations: ["10-K · p.3"],
  };
}

function tokenize(text: string): string[] {
  // Split on word boundaries, keeping the trailing space so concatenation
  // reproduces the original string exactly.
  const parts = text.match(/\S+\s*/g);
  return parts ?? [text];
}

export interface StreamOptions {
  /** Real timers slow Playwright down; tests pass a small multiplier. */
  speed?: number;
}

/**
 * Simulates the backend's SSE stream for a new user message:
 * run_started -> tokens -> tool_call -> tool_result -> tokens ->
 * guard_note? -> message_complete -> run_finished(completed).
 *
 * The special input "trigger: error" simulates the failure path instead:
 * run_started -> a couple of tokens -> error -> run_finished(failed).
 */
export async function* mockChatStream(
  userText: string,
  opts: StreamOptions = {}
): AsyncGenerator<StreamEvent> {
  const speed = opts.speed ?? 1;
  const delay = (ms: number) => wait(ms * speed);

  const runId = nextId("run");
  yield { type: "run_started", run_id: runId };
  await delay(120);

  if (userText.trim().toLowerCase() === "trigger: error") {
    for (const tok of tokenize("Looking that up")) {
      yield { type: "token", text: tok };
      await delay(40);
    }
    await delay(200);
    yield {
      type: "error",
      code: "upstream_timeout",
      message: "The model provider timed out. Try again in a moment.",
    };
    yield { type: "run_finished", status: "failed" };
    return;
  }

  const answer = pickAnswer(userText);

  // A short opening preview before the tool call, like a model thinking out
  // loud before it decides to search.
  for (const tok of tokenize("Let me check the filings for that. ")) {
    yield { type: "token", text: tok };
    await delay(25);
  }

  yield {
    type: "tool_call",
    name: "search_filings",
    input: { query: userText },
  };
  await delay(answer.toolSeconds * 120);
  yield {
    type: "tool_result",
    name: "search_filings",
    // The StreamEvent contract leaves tool_result.output as a free-form
    // dict (owner:runtime hasn't defined a dedicated citations event), so
    // the mock search tool reports its source citations here, the way a
    // real filings-search tool plausibly would.
    output: {
      duration_ms: Math.round(answer.toolSeconds * 1000),
      citations: answer.citations,
    },
  };
  await delay(60);

  for (const tok of tokenize(answer.previewText)) {
    yield { type: "token", text: tok };
    await delay(18);
  }

  if (answer.guardNote) {
    await delay(150);
    yield { type: "guard_note", note: answer.guardNote };
  }

  await delay(100);
  yield { type: "message_complete", text: answer.finalText };
  yield { type: "run_finished", status: "completed" };
}

