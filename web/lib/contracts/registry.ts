/**
 * Agent registry bodies.
 *
 * Mirrors `src/hack_tx_2026/models/registry.py` field-for-field. Datetimes
 * arrive as ISO 8601 strings. Version `status` is a plain string in the
 * contract; the database comment in `db/orm.py` names the three values the
 * backend writes, listed in `VersionStatus`.
 */

/** `AgentVersion.status` values written by the registry (db/orm.py). */
export type VersionStatus = "draft" | "deployed" | "blocked";

export interface AgentListItem {
  id: string;
  slug: string;
  name: string;
  description: string;
  owner_id: string;
  live_version_number: number | null;
  latest_version_number: number | null;
}

export interface AgentVersionOut {
  version_number: number;
  status: VersionStatus | (string & {});
  created_at: string;
  /** The parsed agent spec as stored (`AgentSpec.model_dump(mode="json")`). */
  spec: Record<string, unknown>;
}

export interface AgentDetail extends AgentListItem {
  versions: AgentVersionOut[];
}
