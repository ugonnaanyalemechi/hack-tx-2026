"use client";

import { useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { BudgetOut, BudgetState } from "@/lib/contracts/budgets";
import { formatCost, formatCount } from "@/lib/format";
import { StatBar } from "@/components/shell/stat-bar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ApiClient } from "@/lib/api/client";

/** Whole-percent share of the current cap (cap plus approved extra) spent. */
function percentSpent(budget: BudgetOut): number {
  const total = Number(budget.cap_total);
  return total > 0 ? Math.round((Number(budget.spent) / total) * 100) : 0;
}

function StateBadge({ budget }: { budget: BudgetOut }) {
  const variant: Record<BudgetState, "success" | "warning" | "error"> = {
    ok: "success",
    warned: "warning",
    paused: "error",
  };
  const label: Record<BudgetState, string> = {
    ok: "On track",
    warned: `${percentSpent(budget)}% warning`,
    paused: "Paused",
  };
  return <Badge variant={variant[budget.state]}>{label[budget.state]}</Badge>;
}

/** Spend against the cap. The figures are in the row text, so the bar never carries a value alone. */
function Meter({ budget }: { budget: BudgetOut }) {
  const share = Math.min(percentSpent(budget), 100);
  return (
    <div className="h-2 w-40 overflow-hidden rounded-pill bg-primary-500/16" aria-hidden>
      <div
        className={`h-full rounded-r-xs ${budget.state === "warned" ? "bg-warning" : "bg-primary-500"}`}
        style={{ width: `${share}%` }}
      />
    </div>
  );
}

function BudgetRow({
  budget,
  approving,
  error,
  onApprove,
}: {
  budget: BudgetOut;
  approving: boolean;
  error: string | null;
  onApprove: () => void;
}) {
  const extra = Number(budget.extra_allowance) > 0;
  return (
    <li
      data-testid="budget-row"
      data-agent={budget.agent_name}
      data-state={budget.state}
      className="flex flex-col gap-2 border-b border-border-subtle py-4 last:border-b-0 last:pb-0 first:pt-0"
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-sm font-medium text-text-primary">
            {budget.agent_name}
          </span>
          <span className="text-xs text-text-muted tabular-nums">
            {formatCost(budget.spent, 2)} of {formatCost(budget.cap_total, 2)}
            {extra ? ` · ${formatCost(budget.extra_allowance, 2)} extra approved` : ""}
            {budget.state === "paused" ? " · every chat is paused" : ""}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {budget.state === "paused" ? (
            <>
              <StateBadge budget={budget} />
              <Button
                type="button"
                disabled={approving}
                onClick={onApprove}
                aria-label={`Approve and resume ${budget.agent_name}`}
                className="h-9 gap-2 rounded-pill bg-primary-500 px-4 text-sm font-medium text-neutral-50 hover:bg-primary-600"
              >
                {approving ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                    Approving…
                  </>
                ) : (
                  "Approve and resume"
                )}
              </Button>
            </>
          ) : (
            <>
              <Meter budget={budget} />
              <StateBadge budget={budget} />
            </>
          )}
        </div>
      </div>
      {error ? (
        <p
          role="alert"
          className="flex items-center gap-2 rounded-md border border-error/30 bg-error/10 px-3 py-2 text-sm text-error"
        >
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}
    </li>
  );
}

/**
 * The admin budgets screen body: stats and every agent's budget with its
 * state. A paused one has the one-click "Approve and resume", which grants
 * one more base cap (the endpoint's default); rows and stats update from
 * the response.
 */
export function BudgetsOverview({ api, items }: { api: ApiClient; items: BudgetOut[] }) {
  const [updated, setUpdated] = useState<Record<string, BudgetOut>>({});
  const [approving, setApproving] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const current = items.map((item) => updated[item.agent_id] ?? item);
  const paused = current.filter((b) => b.state === "paused").length;
  const warned = current.filter((b) => b.state === "warned").length;
  const spentMicros = current.reduce((sum, b) => sum + Math.round(Number(b.spent) * 1_000_000), 0);

  async function approve(agentId: string) {
    setApproving(agentId);
    setErrors((prev) => {
      const next = { ...prev };
      delete next[agentId];
      return next;
    });
    try {
      const next = await api.approveSpend(agentId);
      setUpdated((prev) => ({ ...prev, [agentId]: next }));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Couldn't approve. Try again in a moment.";
      setErrors((prev) => ({ ...prev, [agentId]: message }));
    } finally {
      setApproving(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <StatBar
        stats={[
          { label: "Agents with a budget", value: formatCount(current.length) },
          { label: "Paused at cap", value: formatCount(paused), testId: "stat-paused" },
          { label: "Near the limit", value: formatCount(warned), testId: "stat-warned" },
          {
            label: "Spent this month",
            value: formatCost((spentMicros / 1_000_000).toFixed(6), 2),
          },
        ]}
      />
      <Card>
        <CardHeader>
          <CardTitle role="heading" aria-level={2}>
            Budgets
          </CardTitle>
          <CardDescription>
            This month. A paused agent stays paused for everyone until you approve more spend.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul aria-label="Budgets" className="flex flex-col">
            {current.map((budget) => (
              <BudgetRow
                key={budget.agent_id}
                budget={budget}
                approving={approving === budget.agent_id}
                error={errors[budget.agent_id] ?? null}
                onApprove={() => void approve(budget.agent_id)}
              />
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
