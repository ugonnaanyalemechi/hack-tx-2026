# Runtime handoff

Every place the UI fakes the agent runtime, and what swaps in when it lands. Tracked in #57; the live pass is #33. Regenerate the full marker list with `npm run placeholders` (`-- --check` exits 1 while any marker is left).

All runtime calls from the chat go through the `RuntimeApi` seam in `lib/api/runtime-seams.ts`. The mock binding is the default; `?api=live` binds the live stubs, which reject with `RuntimeNotAvailableError("<what>, needs runtime #<n>")`. The chat shows that message in its normal error state. To go live: implement the method in `createLiveRuntime`, delete its marker, keep the mock binding for Playwright.

| Placeholder | File | What replaces it | Unblocked by | How to verify |
| --- | --- | --- | --- | --- |
| Send message and chat stream (incl. 409 `budget_paused` / `approval_pending`) | `lib/api/runtime-seams.ts` (`sendMessage`), mock in `lib/mock-chat.ts` | Streaming chat endpoint (SSE) consumed as `StreamEvent` | #15 | `tests/chat.spec.ts`, `tests/demo-rehearsal.spec.ts` (a) against mocks; live: send a message with `?api=live` bound to the backend |
| Approval decide | `lib/api/runtime-seams.ts` (`decideApproval`), `mockDecideApproval` | Decide route and body (open question, see #62), streaming the resumed run; confirm `message_complete` precedes `approval_required` | #24 | `tests/approval.spec.ts`, demo spec (a) approve and reject; live: approve a `save_note` call and see the note recorded |
| Continue after budget approval | `lib/api/runtime-seams.ts` (`continueRun`), `mockContinueRun`, `pauseAtBudget` | Resume endpoint for a paused run; real 409 `budget_paused` while still paused | #22 (#62) | `tests/budget.spec.ts`, demo spec (b); live: run to the cap, admin approves, Continue resumes the same run |
| End-user budget warning signal | `lib/api/mock-budgets.ts` (`mockBudgetState`) | End-user-safe signal at 80% (stream event or safe field, #61) | #22 (#61) | `tests/budget.spec.ts` (warning), demo spec (b) |
| Flag and re-check stream | `lib/api/runtime-seams.ts` (`flagAnswer`), `mockFlagAnswer`, `recheckStream`, `lib/chat-types.ts` (`FlagState`, `recheckOf`) | Flag route that files the ticket and streams the re-check run; real event shape and thread storage of the re-check | #30 | `tests/flag.spec.ts`, demo spec (d); live: flag an answer, the re-check streams, the ticket is in `/admin/tickets` with `recheck_run_id` |
| Tickets filed by the mock flag | `lib/api/mock-tickets.ts` (`mockFileFlagTicket`) | Platform ticket service called by the flag route | #30 | demo spec (d) ends on the ticket in `/admin/tickets` |
| Deploy and eval reports | `lib/deploy-api.ts`, `tests/support/deploy-api.ts` | Real eval runner and its runtime entry point (no mock-mode path today) | #26 (#27) | `tests/deploy.spec.ts`, demo spec (c); live: block a version, admin overrides with a reason |

## Live checks (#33)

Run the four flows against the backend by hand with `NEXT_PUBLIC_API_MODE=live` and compare each step with the matching screenshot in `tests/__screenshots__/demo-*.png`. The Playwright fake stays as the hermetic path.
