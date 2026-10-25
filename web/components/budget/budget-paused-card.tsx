"use client";

import { useId } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/**
 * The "this agent is paused" card at the end of the saved conversation
 * (docs/design/budget_paused.png). Waiting until an admin approves more
 * spend; once approved, Continue picks the run up where it stopped. Continue
 * is always offered: pressing it before approval answers with a 409, which
 * the card reports without losing anything. No cost figures: end users never
 * see them.
 */
export function BudgetPausedCard({
  agentName,
  approved,
  continuing,
  notice,
  onContinue,
}: {
  agentName: string;
  /** An admin has approved more spend, so the run can carry on. */
  approved: boolean;
  /** The continue call is in flight. */
  continuing: boolean;
  /** Plain-language result of the last Continue attempt, if it did not go through. */
  notice: { kind: "waiting" | "error"; message: string } | null;
  onContinue: () => void;
}) {
  const titleId = useId();

  return (
    <section
      aria-labelledby={titleId}
      aria-busy={continuing || undefined}
      data-testid="budget-paused"
      className="mt-2 flex w-full max-w-2xl flex-col gap-5 rounded-xl border border-border-default bg-surface-1 p-6 shadow-e2"
    >
      <div className="flex items-center justify-between gap-3">
        <span
          className={`font-mono text-overline font-medium tracking-overline uppercase ${
            approved ? "text-success" : "text-text-brand"
          }`}
        >
          {approved ? "Approved" : "Paused"}
        </span>
        <Badge variant={approved ? "success" : "warning"}>
          {approved ? "Ready to continue" : "Waiting for an admin"}
        </Badge>
      </div>

      <div className="flex flex-col gap-2">
        <h3 id={titleId} className="text-2xl font-semibold tracking-tight text-text-primary">
          {approved ? "More spend approved" : "This agent is paused"}
        </h3>
        <p className="text-sm leading-relaxed text-text-secondary">
          {approved
            ? `An admin approved more spend. Continue and ${agentName} will pick up where it stopped.`
            : `Your progress is saved. An admin needs to approve before ${agentName} can carry on, and your chat will pick up where it stopped.`}
        </p>
      </div>

      <div className="flex flex-col gap-3 border-t border-border-subtle pt-5">
        {notice ? (
          <p
            role={notice.kind === "error" ? "alert" : "status"}
            data-testid="budget-continue-notice"
            className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${
              notice.kind === "error"
                ? "border-error/30 bg-error/10 text-error"
                : "border-warning/28 bg-warning/12 text-warning"
            }`}
          >
            <AlertTriangle className="size-4 shrink-0" aria-hidden />
            {notice.message}
          </p>
        ) : null}
        <div className="flex items-center justify-between gap-4">
          <p className="text-xs text-text-muted">Other chats with this agent are paused too.</p>
          <Button
            type="button"
            disabled={continuing}
            onClick={onContinue}
            variant={approved ? "default" : "outline"}
            className={
              approved
                ? "h-10 gap-2 bg-primary-500 px-4.5 text-sm font-medium text-neutral-50 hover:bg-primary-600"
                : "h-10 gap-2 border-border-default bg-transparent px-4.5 text-sm text-text-primary hover:border-border-strong hover:bg-white/6"
            }
          >
            {continuing ? (
              <>
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                Continuing…
              </>
            ) : (
              "Continue"
            )}
          </Button>
        </div>
        <p className="text-xs text-text-muted">
          If the admin has not approved yet, this will tell you so.
        </p>
      </div>
    </section>
  );
}
