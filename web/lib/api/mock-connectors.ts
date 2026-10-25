/**
 * Fixture connector requests and grants for the mock API client. In-memory
 * module state, so deciding a request in the Connectors view sticks for the
 * rest of the page session (client-side navigation to /admin shows it gone).
 *
 * RUNTIME-PLACEHOLDER(#56): the whole store is fake. Requests, tool
 * descriptions and the admin grants listing are not built on the platform
 * yet. Replaced by the admin endpoints named in `ApiClient` once #55/#56 land.
 *
 * Seeded to match docs/design/admin_budgets_approvals_tickets.png
 * ("Connector requests": Style guide wiki and GitHub pending), plus Jira and
 * Policy library as already approved.
 *
 * All data is synthetic.
 */

import type {
  ConnectorDecision,
  ConnectorGrantRow,
  ConnectorRequest,
  DecideConnectorResult,
} from "@/lib/contracts/connectors";
import { MOCK_AGENTS, MOCK_USERS } from "@/lib/api/mock-data";

function agentBySlug(slug: string) {
  const agent = MOCK_AGENTS.find((a) => a.slug === slug);
  if (!agent) throw new Error(`mock agent missing: ${slug}`);
  const owner = MOCK_USERS.find((u) => u.id === agent.owner_id);
  return { id: agent.id, name: agent.name, ownerId: agent.owner_id, ownerName: owner?.name ?? "" };
}

function seedRequests(): ConnectorRequest[] {
  const copy = agentBySlug("campaign-copy-reviewer");
  const pr = agentBySlug("pr-reviewer");
  return [
    {
      id: "creq_style_guide_copy",
      connector_id: "con_style_guide",
      connector_name: "Style guide wiki",
      agent_id: copy.id,
      agent_name: copy.name,
      owner_id: copy.ownerId,
      owner_name: copy.ownerName,
      scope: "read_only",
      detail: "read style pages",
      tools: [
        { name: "search_pages", side_effect: false },
        { name: "read_page", side_effect: false },
      ],
      requested_at: "2026-10-25T13:05:00Z",
    },
    {
      id: "creq_github_pr",
      connector_id: "con_github",
      connector_name: "GitHub",
      agent_id: pr.id,
      agent_name: pr.name,
      owner_id: pr.ownerId,
      owner_name: pr.ownerName,
      scope: "read_only",
      detail: "read pull requests",
      tools: [
        { name: "list_pull_requests", side_effect: false },
        { name: "get_pull_request_diff", side_effect: false },
      ],
      requested_at: "2026-10-25T11:40:00Z",
    },
  ];
}

function seedGrants(): ConnectorGrantRow[] {
  const pr = agentBySlug("pr-reviewer");
  const policy = agentBySlug("policy-assistant");
  return [
    {
      id: "grant_jira_pr",
      connector_id: "con_jira",
      connector_name: "Jira",
      agent_id: pr.id,
      agent_name: pr.name,
      tools: [
        { name: "search_issues", side_effect: false },
        { name: "create_issue", side_effect: true },
      ],
      status: "active",
      granted_by_name: "Ada Admin",
      granted_at: "2026-10-20T09:15:00Z",
    },
    {
      id: "grant_policy_library",
      connector_id: "con_policy_library",
      connector_name: "Policy library",
      agent_id: policy.id,
      agent_name: policy.name,
      tools: [
        { name: "search_policies", side_effect: false },
        { name: "read_clause", side_effect: false },
      ],
      status: "active",
      granted_by_name: "Ada Admin",
      granted_at: "2026-10-18T16:30:00Z",
    },
  ];
}

let requests = seedRequests();
let grants = seedGrants();

export function mockListConnectorRequests(): ConnectorRequest[] {
  return requests.map((r) => ({ ...r }));
}

export function mockListConnectorGrants(): ConnectorGrantRow[] {
  return grants.map((g) => ({ ...g }));
}

export function mockDecideConnectorRequest(
  requestId: string,
  decision: ConnectorDecision,
  adminName: string
): DecideConnectorResult | null {
  const request = requests.find((r) => r.id === requestId);
  if (!request) return null;
  requests = requests.filter((r) => r.id !== requestId);
  let grant: ConnectorGrantRow | null = null;
  if (decision === "approve") {
    grant = {
      id: `grant_${request.id}`,
      connector_id: request.connector_id,
      connector_name: request.connector_name,
      agent_id: request.agent_id,
      agent_name: request.agent_name,
      tools: request.tools,
      status: "active",
      granted_by_name: adminName,
      granted_at: new Date().toISOString(),
    };
    grants = [grant, ...grants];
  }
  return { request, decision, grant };
}
