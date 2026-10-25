import { AlertTriangle } from "lucide-react";

/**
 * Shown to end users once an agent reaches its warning fraction (80%).
 * Deliberately has no figures: end users never see cost.
 */
export function BudgetWarningBanner({ agentName }: { agentName: string }) {
  return (
    <div
      role="status"
      data-testid="budget-warning"
      className="flex shrink-0 items-start gap-3 border-b border-warning/28 bg-warning/12 px-6 py-3 text-sm"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
      <p className="text-text-secondary">
        <span className="font-medium text-warning">{agentName} is close to its usage limit.</span>{" "}
        If it reaches the limit, it pauses until an admin approves more. Your chats are saved.
      </p>
    </div>
  );
}
