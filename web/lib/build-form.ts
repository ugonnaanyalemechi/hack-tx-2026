/**
 * The new-agent form's state, its field validation and the YAML it makes.
 * Pure functions, shared by the page, the YAML panel and the mock client.
 */

import { slugify, toYaml, type YamlValue } from "@/lib/agent-yaml";

export const MODEL_ID = "meta/muse-spark-1.3";

export interface BuildForm {
  name: string;
  description: string;
  instructions: string;
  connectors: string[];
  /** Tool names the user must approve every time (side-effect tools). */
  sideEffectTools: string[];
  monthlyUsd: string;
  warnAt: string;
  onCap: "pause" | "downgrade";
  minScore: string;
  requireCitation: boolean;
  stripSecrets: boolean;
}

export const EMPTY_FORM: BuildForm = {
  name: "",
  description: "",
  instructions: "",
  connectors: [],
  sideEffectTools: [],
  monthlyUsd: "50",
  warnAt: "0.8",
  onCap: "pause",
  minScore: "0.85",
  requireCitation: true,
  stripSecrets: true,
};

export type ConnectorStatus = "approved" | "waiting" | "none";

export interface BuildConnector {
  id: string;
  label: string;
  status: ConnectorStatus;
  /** Tools the connector offers, for the side-effect marks. */
  tools: string[];
}

export type FormErrors = Partial<Record<keyof BuildForm, string>>;

export function validateForm(form: BuildForm): FormErrors {
  const errors: FormErrors = {};
  if (!form.name.trim()) errors.name = "Name is required. Give the agent a short name.";
  if (!form.instructions.trim()) {
    errors.instructions = "Instructions are required. Say what the agent should do.";
  }
  const monthly = Number(form.monthlyUsd);
  if (form.monthlyUsd.trim() === "" || !Number.isFinite(monthly) || monthly <= 0) {
    errors.monthlyUsd = "Monthly USD must be a number above 0.";
  }
  const warn = Number(form.warnAt);
  if (form.warnAt.trim() === "" || !Number.isFinite(warn) || warn <= 0 || warn >= 1) {
    errors.warnAt = "Warn at must be a number between 0 and 1.";
  }
  const min = Number(form.minScore);
  if (form.minScore.trim() === "" || !Number.isFinite(min) || min < 0 || min > 1) {
    errors.minScore = "Min score must be a number between 0 and 1.";
  }
  return errors;
}

/** Fields that exist in the agent file as `field: value` pairs, for error mapping. */
export const FIELD_LABELS: Record<keyof BuildForm, string> = {
  name: "Name",
  description: "Description",
  instructions: "Instructions",
  connectors: "Connectors",
  sideEffectTools: "Side-effect tools",
  monthlyUsd: "Monthly USD",
  warnAt: "Warn at",
  onCap: "On cap",
  minScore: "Min score",
  requireCitation: "Require citation",
  stripSecrets: "Strip secrets",
};

/** The agent file for the form. `trigger: null`: nothing starts it but a person. */
export function formToYaml(
  form: BuildForm,
  connectors: BuildConnector[],
  owner: string
): string {
  const spec: { [key: string]: YamlValue } = {
    name: slugify(form.name) || "",
    owner,
    model: MODEL_ID,
    instructions: form.instructions,
    connectors: form.connectors,
  };
  if (form.sideEffectTools.length > 0) spec.approval_required = form.sideEffectTools;
  spec.monthly_usd = Number(form.monthlyUsd) || 0;
  spec.warn_at = Number(form.warnAt) || 0;
  spec.on_cap = form.onCap;
  spec.evals = { min_score: Number(form.minScore) || 0 };
  spec.guardrails = {
    require_citation: form.requireCitation,
    strip_secrets: form.stripSecrets,
  };
  spec.trigger = null;

  const comments: Record<string, string> = {};
  for (const c of connectors) {
    if (form.connectors.includes(c.id) && c.status === "waiting") {
      comments[`connectors.${c.id}`] = "waiting for admin";
    }
  }
  return toYaml(spec, comments);
}
