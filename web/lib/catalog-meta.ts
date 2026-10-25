/**
 * Catalog extras the contract does not carry yet: a category for the filter
 * chips, how the agent was built, and an icon. Keyed by agent slug.
 *
 * RUNTIME-PLACEHOLDER(#57): fixture metadata for the catalog view
 * (docs/design/foundry/catalog.png). The registry has no category or
 * built-with field; once it does, read them from `CatalogItem` and delete
 * this table. Unknown slugs fall back to "Other" / "CLI".
 */

import { FileText, GitPullRequest, ListChecks, BarChart3, ShieldCheck, Bot } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type CatalogCategory = "Finance" | "Policy" | "Engineering";

export const CATALOG_CATEGORIES: CatalogCategory[] = ["Finance", "Policy", "Engineering"];

export interface CatalogMeta {
  category: CatalogCategory | "Other";
  builtWith: "CLI" | "Form";
  icon: LucideIcon;
}

const META: Record<string, CatalogMeta> = {
  "filings-analyst": { category: "Finance", builtWith: "CLI", icon: FileText },
  "policy-assistant": { category: "Policy", builtWith: "Form", icon: ShieldCheck },
  "market-summary": { category: "Finance", builtWith: "CLI", icon: BarChart3 },
  "pr-reviewer": { category: "Engineering", builtWith: "CLI", icon: GitPullRequest },
  "campaign-copy-reviewer": { category: "Policy", builtWith: "Form", icon: ListChecks },
};

export function getCatalogMeta(slug: string): CatalogMeta {
  return META[slug] ?? { category: "Other", builtWith: "CLI", icon: Bot };
}
