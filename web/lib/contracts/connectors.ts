/**
 * Connector request and grant shapes the admin Connectors view reads.
 *
 * RUNTIME-PLACEHOLDER(#56): none of these shapes exist on the backend yet.
 * `ConnectorOut` / `GrantOut` in `src/hack_tx_2026/models/connector_api.py`
 * cover the catalog and a grant row, but there is no request record, no
 * tool descriptions, and no admin endpoint that lists active grants with
 * agent names. These types are the proposal; replace them with the real
 * models once platform #55 and #56 land.
 */

import type { IsoDateTime } from "@/lib/contracts/api";

/** What an agent asks to do with a connector, in plain words. */
export type ConnectorScope = "read_only" | "can_change";

export interface ConnectorTool {
  name: string;
  /** True when calling it changes something outside the platform (needs approval at run time). */
  side_effect: boolean;
}

export interface ConnectorRequest {
  id: string;
  connector_id: string;
  connector_name: string;
  agent_id: string;
  agent_name: string;
  owner_id: string;
  owner_name: string;
  scope: ConnectorScope;
  /** What the agent wants it for, e.g. "read pull requests". */
  detail: string;
  tools: ConnectorTool[];
  requested_at: IsoDateTime;
}

export type ConnectorDecision = "approve" | "deny";

export interface ConnectorGrantRow {
  id: string;
  connector_id: string;
  connector_name: string;
  agent_id: string;
  agent_name: string;
  tools: ConnectorTool[];
  status: "active" | "revoked";
  granted_by_name: string;
  granted_at: IsoDateTime;
}

export interface DecideConnectorResult {
  request: ConnectorRequest;
  decision: ConnectorDecision;
  /** The new grant when approved, null when denied. */
  grant: ConnectorGrantRow | null;
}
