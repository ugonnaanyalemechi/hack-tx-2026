# CLAUDE.md

## Project

Agent Platform: a platform where a single YAML agent spec (model, instructions, MCP connectors, context, evals, budget) defines an agent that can be run, metered, tested and shared. Main use case is the financial domain, for both developers and non-developers.

Read these before starting any task:
- `docs/design-system.md` and `docs/design/` for the target UI (mockups and tokens)

If these docs disagree with a ticket, stop and flag it on the ticket instead of picking one.

## Stack

- Backend: Python, FastAPI, LangGraph, Postgres, managed with `uv`
- Frontend: Next.js, TypeScript, Tailwind, shadcn/ui, in `web/`
- Models: Gemini API (`gemini/gemini-3.8-flash` through LiteLLM), always called through our wrapper that meters tokens and cost
- Monitoring: Postgres run log, plus Langfuse (stretch)
- Local services: Postgres via `docker compose`

## Commands

- Start the database: `docker compose up -d`
- Apply migrations: `uv run alembic upgrade head`
- New migration: `uv run alembic revision --autogenerate -m "<message>"`
- Backend tests: `uv run pytest`
- The check command (lint, types, tests — run this before every commit): `uv run check`
- Add a backend dependency: `uv add <package>` (dev tools: `uv add --dev <package>`)
- Run the backend app: `uv run hack-tx-2026`
- Frontend (run in `web/`): `npm install`, `npm run dev`, `npm test`
- Browser/screenshot checks: Playwright (`npx playwright test`)

Run the relevant tests, plus type checks and lint, before every commit. Do not commit with failing tests.

## How to work

- Work one ticket at a time. Read the ticket and its blocking tickets first.
- Use `/tdd` for backend work: write a failing test, make it pass, then refactor.
- Test through the HTTP API and the end-to-end flows, not internal functions. Test external behavior, not implementation details.
- Keep changes inside the ticket's scope. Put anything extra you notice in a new issue instead of fixing it.
- Do not change shared contracts (agent YAML schema, API types, streaming events, database tables) unless the ticket says to. If a contract seems wrong, stop and flag it.
- Never hardcode secrets. Read all settings from environment variables. Keep `.env.example` updated with every new variable, using placeholders for secrets.
- Never commit `.env`.
- Small, focused commits with clear messages. Open a PR per ticket and close the issue it resolves.

## When blocked

Do not stop and wait if a key, account or external service is missing.

1. Use the fake or fixture for that dependency.
2. Leave a short note on the ticket saying what is faked and what is needed.
3. Continue with the rest of the ticket.

Stop and ask only for a real decision that the docs do not answer, or a change to a frozen contract.

## Frontend rules

- Use shadcn/ui components and Tailwind. Do not add other UI libraries without asking.
- All colors, fonts, spacing and radii come from theme tokens defined in one place (see `docs/design-system.md`). Never hardcode color values, font names or one-off pixel sizes in components.
- Reuse shared components for cards, buttons, forms, tables and layouts. Do not restyle the same element differently on different pages.
- Match the mockups in `docs/design/` for layout and hierarchy. Build only what is in MVP scope, even if a mockup shows more.
- Every UI ticket needs a Playwright screenshot of the screens it touched, checked against the matching mockup, before it is done.
- Handle loading, empty and error states on every screen.

## MVP priorities

Never cut: the key end-to-end flows, the budget ladder (warning at 80%, cheaper model at 100%) and the flag button. Stretch goals (MCP server access, setup agent, Vultr provisioning, file upload, Langfuse) only start after the core flows work.

## Do not

- Skip or delete tests to make a build pass
- Add features, endpoints or tables that are not in the spec or ticket
- Call a model directly instead of through the metering wrapper
- Enable autonomous deploys. A person must always approve.

## Agent skills

### Issue tracker

Issues live in GitHub Issues (`gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-label vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

## Team and ownership

Three people, three agents. Work only tickets labelled with your owner label, and edit only the folders and tables you own. If a ticket needs a change in someone else's area, open a separate ticket for them.

| Owner label | Owns |
| --- | --- |
| `owner:frontend` | `web/`: catalog, chat page, approval card, paused state, flag button, admin and builder views, role switcher, Playwright screenshots. Builds against the API contract and mocks until the backend lands. |
| `owner:runtime` | Model gateway, recorder, agent runtime, output guard, chat and API layer (threads, messages, streaming, approve, resume, invoke, flag and re-check), the scripted fake model. Writes tables: threads, runs, run steps, approvals. |
| `owner:platform` | Repo scaffold and infrastructure (dependencies, migrations tooling, settings, check command, CI, seeded users), registry, connector layer and grants, fake MCP server and demo connector, budget service, eval runner and deploy gate, admin layer, identity header and cost-field omission, seed data. Writes tables: users, agents, agent versions, connectors, grants, budgets, eval cases, eval reports, tickets. |

Seams between owners (platform owns the definitions, runtime calls them): loading an agent's tools, checking an agent's budget, creating a ticket, reading an agent version. Platform's eval runner calls the runtime's run entry point; runtime owns its behavior.

The first ticket is a contracts commit done by all three: typed models for the agent spec, stream events, API types and run/step records; all table migrations; the seam stubs; an app that boots with each owner's empty routers registered. After it merges, nobody changes a contract without a ticket.

Start every ticket with `git pull --rebase origin main`. If every ticket you own is blocked, stop and report instead of picking up another owner's work.
