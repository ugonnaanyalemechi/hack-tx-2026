/**
 * Mock data for the new-agent page: connector approvals, the setup
 * assistant's canned answers, and spec validation / draft saving.
 *
 * RUNTIME-PLACEHOLDER(#57): everything here is in memory. Connector status
 * comes from the connector grants (platform) and the setup assistant needs a
 * model call (runtime); validate and save map onto the registry routes in
 * `src/hack_tx_2026/routers/platform.py`.
 */

import { ApiError } from "@/lib/api/client";
import type { AgentDetail } from "@/lib/contracts/registry";
import { slugify } from "@/lib/agent-yaml";
import type { BuildConnector, BuildForm } from "@/lib/build-form";

export interface SpecError {
  field: string;
  message: string;
}

export interface ValidateResult {
  valid: boolean;
  errors: SpecError[];
}

/** What the setup assistant fills in; the form keeps anything it leaves out. */
export type AssistantSuggestion = Pick<
  BuildForm,
  "name" | "description" | "instructions" | "connectors"
>;

const CONNECTORS: BuildConnector[] = [
  {
    id: "policy-library",
    label: "Policy library",
    status: "approved",
    tools: ["search_policies", "get_policy"],
  },
  { id: "jira", label: "Jira", status: "approved", tools: ["search_issues", "create_issue"] },
  {
    id: "style-guide-wiki",
    label: "Style guide wiki",
    status: "waiting",
    tools: ["search_pages"],
  },
  { id: "code-host", label: "GitHub", status: "none", tools: ["read_pr", "comment_on_pr"] },
];

// Per-session approval requests, so one survives leaving the page.
const requested = new Set<string>();

export function mockListBuildConnectors(): BuildConnector[] {
  return CONNECTORS.map((c) =>
    requested.has(c.id) && c.status === "none" ? { ...c, status: "waiting" } : { ...c }
  );
}

export function mockRequestConnectorApproval(connectorId: string): BuildConnector {
  const found = CONNECTORS.find((c) => c.id === connectorId);
  if (!found) {
    throw new ApiError(404, { code: "connector_not_found", message: "Connector not found" });
  }
  if (found.status === "none") requested.add(connectorId);
  return mockListBuildConnectors().find((c) => c.id === connectorId)!;
}

const SUGGESTIONS: { words: string[]; result: AssistantSuggestion }[] = [
  {
    words: ["copy", "marketing", "wording", "compliance"],
    result: {
      name: "Campaign Copy Reviewer",
      description: "Checks marketing copy against compliance wording rules.",
      instructions:
        "Review the copy the user pastes. For each line that breaks a wording rule, quote the line, name the rule and suggest a fix. Always cite the rule.",
      connectors: ["policy-library", "style-guide-wiki"],
    },
  },
  {
    words: ["pull request", "code review"],
    result: {
      name: "PR Reviewer",
      description: "Reviews pull requests against the team's checklist.",
      instructions:
        "Read the pull request the user links. List risks first, then style issues. Quote the changed line for every comment.",
      connectors: ["code-host", "jira"],
    },
  },
  {
    words: ["filing", "10-k", "earnings", "debt"],
    result: {
      name: "Filings Analyst",
      description: "Answers questions about public filings with cited passages.",
      instructions:
        "Answer from the filing text only. Quote the passage you used and give its section. If the filing does not say, say so.",
      connectors: ["policy-library"],
    },
  },
];

const FALLBACK: AssistantSuggestion = {
  name: "Policy Helper",
  description: "Answers questions from the policy library.",
  instructions: "Answer using the policy library only. Cite the policy you used.",
  connectors: ["policy-library"],
};

export function mockSuggestAgentForm(description: string): AssistantSuggestion {
  const text = description.toLowerCase();
  const hit = SUGGESTIONS.find((s) => s.words.some((w) => text.includes(w)));
  return { ...(hit?.result ?? FALLBACK) };
}

export function mockValidateSpec(specYaml: string): ValidateResult {
  const errors: SpecError[] = [];
  const name = /^name: (.*)$/m.exec(specYaml)?.[1]?.trim();
  if (!name || name === '""') errors.push({ field: "name", message: "Name is required." });
  const instructions = /^instructions: (.*)$/m.exec(specYaml)?.[1]?.trim();
  if (!instructions || instructions === '""') {
    errors.push({ field: "instructions", message: "Instructions are required." });
  }
  return { valid: errors.length === 0, errors };
}

export function mockCreateAgent(specYaml: string, ownerId: string): AgentDetail {
  const result = mockValidateSpec(specYaml);
  if (!result.valid) {
    throw new ApiError(422, {
      code: "invalid_spec",
      message: result.errors.map((e) => `${e.field}: ${e.message}`).join(" "),
    });
  }
  const slug = /^name: (.*)$/m.exec(specYaml)![1].trim();
  const hex = Array.from(slugify(slug))
    .map((ch) => ch.charCodeAt(0).toString(16))
    .join("")
    .padEnd(32, "0")
    .slice(0, 32);
  return {
    id: `agt_${hex}`,
    slug,
    name: slug,
    description: "",
    owner_id: ownerId,
    live_version_number: null,
    latest_version_number: 1,
    versions: [
      { version_number: 1, status: "draft", created_at: new Date().toISOString(), spec: {} },
    ],
  };
}
