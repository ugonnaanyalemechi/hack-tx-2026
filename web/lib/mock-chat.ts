/**
 * Mock chat backend.
 *
 * The real streaming HTTP endpoint (owner:runtime) does not exist yet. This
 * module simulates a realistic SSE sequence for a new message using the
 * exact StreamEvent contract in lib/contracts/events.ts, plus seed data for
 * past chats, so the chat page can be built and screenshotted against the
 * real contract now and swapped to a real client later without UI changes.
 */

import { ApiError } from "./api/client";
import { mockBudgetState, mockPauseAtCap } from "./api/mock-budgets";
import { MOCK_AGENTS, MOCK_USERS } from "./api/mock-data";
import { mockFileFlagTicket } from "./api/mock-tickets";
import type { StreamEvent } from "./contracts/events";
import type { Agent, ApprovalDecision, ChatSummary } from "./chat-types";

const FILINGS_ANALYST = MOCK_AGENTS.find((a) => a.slug === "filings-analyst") ?? MOCK_AGENTS[0];

function toChatAgent(agent: (typeof MOCK_AGENTS)[number]): Agent {
  return {
    // The API's id, so the chat and the admin budget view share one budget
    // (lib/api/mock-budgets.ts).
    id: agent.id,
    name: agent.name,
    ownerName: MOCK_USERS.find((u) => u.id === agent.owner_id)?.name ?? agent.owner_id,
  };
}

/** The agent shown when `/chat` has no (or an unknown) `?agent=`. */
export const MOCK_AGENT: Agent = toChatAgent(FILINGS_ANALYST);

/**
 * The agent named by `/chat?agent=<id>`, with its name and owner from the
 * mock catalog. Falls back to Filings Analyst for a missing or unknown id.
 */
// RUNTIME-PLACEHOLDER(#15): resolves the agent from the mock catalog fixtures. Replace with the agent read (`GET /v1/agents/{id}`) once the chat page talks to the real thread API.
export function getMockChatAgent(agentId: string | null): Agent {
  const found = agentId ? MOCK_AGENTS.find((a) => a.id === agentId) : undefined;
  return found ? toChatAgent(found) : MOCK_AGENT;
}

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

let idCounter = 0;
function nextId(prefix: string) {
  idCounter += 1;
  return `${prefix}_${idCounter}`;
}

/** Seed a couple of past chats with realistic finance Q&A so loaded/empty
 * states both have something meaningful to screenshot. Only the Filings
 * Analyst has history; any other agent starts with an empty chat list. */
// RUNTIME-PLACEHOLDER(#15): fixture chat history. Replace with the thread list read (`GET` threads for the agent and user) once the chat API exists.
export function getSeedChats(agentId: string = MOCK_AGENT.id): ChatSummary[] {
  if (agentId !== MOCK_AGENT.id) return [];
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

/** The demo agent's one side-effect tool (src/hack_tx_2026/demo/filings.py:
 * save_note(text)). It only runs when the user asks for a note to be saved. */
const SIDE_EFFECT_TOOL = "save_note";

function wantsSavedNote(userText: string): boolean {
  const q = userText.toLowerCase();
  return q.includes("save") && q.includes("note");
}

/**
 * The approval path of the chat stream: the agent looks the figure up,
 * explains what it wants to do, then asks to run save_note.
 * run_started -> tokens -> tool_call -> tool_result -> tokens ->
 * message_complete -> approval_required -> run_finished(awaiting_approval).
 */
async function* saveNoteUntilApproval(
  userText: string,
  runId: string,
  delay: (ms: number) => Promise<void>
): AsyncGenerator<StreamEvent> {
  for (const tok of tokenize("Let me check the filings for that. ")) {
    yield { type: "token", text: tok };
    await delay(25);
  }
  yield { type: "tool_call", name: "search_filings", input: { query: userText } };
  await delay(1.4 * 120);
  yield {
    type: "tool_result",
    name: "search_filings",
    output: { duration_ms: 1400, citations: ["10-K · p.47"] },
  };
  await delay(60);

  const explanation =
    "Acme's cloud revenue grew 18% in fiscal 2025, to $2.1B. I'd like to save that as a note for you.";
  for (const tok of tokenize(explanation)) {
    yield { type: "token", text: tok };
    await delay(18);
  }
  await delay(100);
  yield { type: "message_complete", text: explanation };

  const approval: PendingApproval = {
    runId,
    toolName: SIDE_EFFECT_TOOL,
    toolInput: {
      text: "Acme cloud revenue grew 18% in fiscal 2025, to $2.1B (10-K · p.47).",
    },
  };
  const approvalId = nextId("apr");
  pendingApprovals.set(approvalId, approval);
  yield {
    type: "approval_required",
    approval_id: approvalId,
    tool_name: approval.toolName,
    tool_input: approval.toolInput,
  };
  yield { type: "run_finished", status: "awaiting_approval" };
}

/** What the mock backend remembers about a run stopped on an approval, so
 * the decide call can resume it. */
interface PendingApproval {
  runId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
}

const pendingApprovals = new Map<string, PendingApproval>();
const failedDecisions = new Set<string>();

export interface DecideOptions extends StreamOptions {
  /** Fail the first decide call for each approval, to exercise the card's
   * error state; the retry then goes through. */
  failFirstAttempt?: boolean;
}

/**
 * Simulates the decide call (POST, owner:runtime #24, not built yet). Like
 * a real fetch, it rejects if the request fails and resolves once the
 * response stream opens. The stream resumes the same run:
 *
 * approve: run_started -> tool_call -> tool_result -> tokens ->
 *   message_complete -> run_finished(completed).
 * reject: run_started -> tokens -> message_complete ->
 *   run_finished(completed). The tool never runs; the agent is told it was
 *   declined and carries on without it.
 */
// RUNTIME-PLACEHOLDER(#24): fakes the approval decision call and the resumed run's stream (approve runs the tool, reject skips it). Replace with the real decide endpoint, which resumes the stopped run and streams StreamEvents.
export async function mockDecideApproval(
  approvalId: string,
  decision: ApprovalDecision,
  opts: DecideOptions = {}
): Promise<AsyncIterable<StreamEvent>> {
  const speed = opts.speed ?? 1;
  const delay = (ms: number) => wait(ms * speed);

  await delay(800);
  if (opts.failFirstAttempt && !failedDecisions.has(approvalId)) {
    failedDecisions.add(approvalId);
    throw new Error("network_error");
  }
  const approval = pendingApprovals.get(approvalId);
  if (!approval) throw new Error("approval_not_found");
  pendingApprovals.delete(approvalId);

  return decisionStream(approval, decision, delay);
}

async function* decisionStream(
  approval: PendingApproval,
  decision: ApprovalDecision,
  delay: (ms: number) => Promise<void>
): AsyncGenerator<StreamEvent> {
  yield { type: "run_started", run_id: approval.runId };
  await delay(60);

  let answer: string;
  if (decision === "approve") {
    yield { type: "tool_call", name: approval.toolName, input: approval.toolInput };
    await delay(0.3 * 120);
    yield {
      type: "tool_result",
      name: approval.toolName,
      output: { duration_ms: 300, status: "recorded", note_id: nextId("note") },
    };
    await delay(60);
    answer = "Done. I saved the note about Acme's 18% cloud revenue growth.";
  } else {
    answer = "Okay, I didn't save the note. The figures above are still here if you need them.";
  }

  for (const tok of tokenize(answer)) {
    yield { type: "token", text: tok };
    await delay(18);
  }
  await delay(100);
  yield { type: "message_complete", text: answer };
  yield { type: "run_finished", status: "completed" };
}

const failedFlags = new Set<string>();

export interface FlagOptions extends StreamOptions {
  /** Fail the first flag call for each answer, to exercise the error state;
   * the retry then goes through. */
  failFirstAttempt?: boolean;
  /** Who flagged which answer; the mock backend files a ticket from it. */
  ticket?: { agentId: string; answer: string; userId: string };
}

/**
 * Simulates the flag call (POST, owner:runtime, not built yet; no flag
 * route or event exists in the contract). Like a real fetch it rejects if
 * the request fails and resolves once the response stream opens. The stream
 * is the immediate re-check run: run_started -> tool_call -> tool_result ->
 * tokens -> message_complete -> run_finished(completed).
 */
// RUNTIME-PLACEHOLDER(#30): fakes the flag call (POST that files a ticket and streams the re-check). Replace with the live flag call behind `flagAnswer` in web/lib/api/runtime-seams.ts; the mock files the ticket itself (mock-tickets.ts), the real flag route must too.
export async function mockFlagAnswer(
  flaggedMessageId: string,
  userText: string,
  opts: FlagOptions = {}
): Promise<AsyncIterable<StreamEvent>> {
  const speed = opts.speed ?? 1;
  const delay = (ms: number) => wait(ms * speed);

  await delay(600);
  if (opts.failFirstAttempt && !failedFlags.has(flaggedMessageId)) {
    failedFlags.add(flaggedMessageId);
    throw new Error("network_error");
  }
  const recheckRunId = `run_recheck_${nextId("r")}`;
  if (opts.ticket) {
    const agent = MOCK_AGENTS.find((a) => a.id === opts.ticket?.agentId);
    mockFileFlagTicket({
      agentId: opts.ticket.agentId,
      agentName: agent?.name ?? MOCK_AGENT.name,
      question: userText,
      answer: opts.ticket.answer,
      userId: opts.ticket.userId,
      userName: MOCK_USERS.find((u) => u.id === opts.ticket?.userId)?.name ?? null,
      runId: `run_flagged_${flaggedMessageId}`,
      recheckRunId,
    });
  }
  return recheckStream(userText, delay, recheckRunId);
}

// RUNTIME-PLACEHOLDER(#30): scripted re-check events (canned answer built from the question). Replace with the SSE stream of the real re-check run.
async function* recheckStream(
  userText: string,
  delay: (ms: number) => Promise<void>,
  runId: string
): AsyncGenerator<StreamEvent> {
  const answer = pickAnswer(userText);
  yield { type: "run_started", run_id: runId };
  await delay(120);

  yield { type: "tool_call", name: "search_filings", input: { query: userText } };
  await delay(answer.toolSeconds * 120);
  yield {
    type: "tool_result",
    name: "search_filings",
    output: {
      duration_ms: Math.round(answer.toolSeconds * 1000),
      citations: answer.citations,
    },
  };
  await delay(60);

  const text = `I checked this against the filing again. ${answer.finalText} The figures match the cited pages.`;
  for (const tok of tokenize(text)) {
    yield { type: "token", text: tok };
    await delay(18);
  }
  await delay(100);
  yield { type: "message_complete", text };
  yield { type: "run_finished", status: "completed" };
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
 *
 * Asking to save a note takes the approval path (saveNoteUntilApproval),
 * which ends with run_finished(awaiting_approval).
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

  if (wantsSavedNote(userText)) {
    yield* saveNoteUntilApproval(userText, runId, delay);
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

/** The input that makes the mock agent run out of budget mid-run. */
const BUDGET_TRIGGER = "trigger: budget";

function isBudgetTrigger(userText: string): boolean {
  return userText.trim().toLowerCase() === BUDGET_TRIGGER;
}

/**
 * The budget-pause path of the chat stream: the run starts, a tool call is
 * in flight, then the agent's spend reaches its cap.
 * run_started -> tokens -> tool_call -> budget_paused ->
 * run_finished(paused). The connection closes; nothing else follows.
 */
// RUNTIME-PLACEHOLDER(#22): fakes the budget pause (spend crossing the cap flips the shared mock store). Replaced by the real gateway budget hook ending the run with budget_paused.
async function* pauseAtBudget(
  agentId: string,
  delay: (ms: number) => Promise<void>
): AsyncGenerator<StreamEvent> {
  for (const tok of tokenize("Let me check the filings for that. ")) {
    yield { type: "token", text: tok };
    await delay(25);
  }
  yield { type: "tool_call", name: "search_filings", input: { query: "budget" } };
  await delay(200);
  mockPauseAtCap(agentId);
  yield { type: "budget_paused", agent_id: agentId };
  yield { type: "run_finished", status: "paused" };
}

/**
 * Simulates sending a message (the chat POST, owner:runtime #15, not built
 * yet). Like the real endpoint it answers 409 `budget_paused` while the
 * agent is paused, before any stream opens, so the UI keeps the chat.
 * The input "trigger: budget" streams a run that pauses at the cap.
 */
// RUNTIME-PLACEHOLDER(#15): fakes the chat send call and its SSE stream, including the 409 `budget_paused` answer while paused. Replaced by the streaming chat endpoint; the UI already consumes the StreamEvent contract.
export async function mockSendMessage(
  agentId: string,
  userText: string,
  opts: StreamOptions = {}
): Promise<AsyncIterable<StreamEvent>> {
  const speed = opts.speed ?? 1;
  const delay = (ms: number) => wait(ms * speed);
  await delay(300);
  // RUNTIME-PLACEHOLDER(#15): the real 409 comes from the send endpoint's resume checks.
  if (mockBudgetState(agentId) === "paused") {
    throw new ApiError(409, {
      code: "budget_paused",
      message: "This agent is paused until an admin approves more spend.",
    });
  }
  if (isBudgetTrigger(userText)) {
    return (async function* () {
      yield { type: "run_started", run_id: nextId("run") } as StreamEvent;
      await delay(120);
      yield* pauseAtBudget(agentId, delay);
    })();
  }
  return mockChatStream(userText, opts);
}

/**
 * Simulates Continue on a paused chat: 409 `budget_paused` until an admin
 * has approved more spend, then the stopped run picks up from the saved
 * message. Resolves null when there is no stopped message to pick up.
 */
// RUNTIME-PLACEHOLDER(#22): fakes Continue, a 409 `budget_paused` until an admin approves, then resuming the stopped run. Replaced by the real resume endpoint (name and body not defined yet).
export async function mockContinueRun(
  agentId: string,
  userText: string | null,
  opts: StreamOptions = {}
): Promise<AsyncIterable<StreamEvent> | null> {
  const speed = opts.speed ?? 1;
  const delay = (ms: number) => wait(ms * speed);
  await delay(300);
  // RUNTIME-PLACEHOLDER(#22): the real 409 comes from the resume endpoint while the budget is still paused.
  if (mockBudgetState(agentId) === "paused") {
    throw new ApiError(409, {
      code: "budget_paused",
      message: "An admin hasn't approved more spend yet.",
    });
  }
  if (userText === null) return null;
  if (!isBudgetTrigger(userText)) return mockChatStream(userText, opts);
  return (async function* () {
    yield { type: "run_started", run_id: nextId("run") } as StreamEvent;
    await delay(120);
    yield { type: "tool_result", name: "search_filings", output: { duration_ms: 900, citations: ["10-K · p.47"] } } as StreamEvent;
    const answer = "Acme's cloud revenue grew 18% in fiscal 2025, to $2.1B.";
    for (const tok of tokenize(answer)) {
      yield { type: "token", text: tok };
      await delay(18);
    }
    await delay(100);
    yield { type: "message_complete", text: answer };
    yield { type: "run_finished", status: "completed" };
  })();
}
