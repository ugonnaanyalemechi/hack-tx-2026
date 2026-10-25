"use client";

import { Wallet } from "lucide-react";
import { AdminFrame } from "@/components/admin/admin-frame";
import { BudgetsOverview } from "@/components/budget/budget-list";
import { EmptyState, ErrorState, NoAccessState } from "@/components/shell/states";
import { Skeleton } from "@/components/ui/skeleton";
import { useIdentity } from "@/lib/identity";
import { useApiQuery } from "@/lib/use-api-query";

export default function BudgetsPage() {
  const { role, api } = useIdentity();
  // Budgets are admin only, so no other role's screen asks for them.
  const budgets = useApiQuery(role === "admin" ? "budgets" : null, (client) =>
    client.listBudgets()
  );

  return (
    <AdminFrame
      section="Budgets"
      title="Who is near the limit."
      subtitle="Approve more spend in one click."
      noAccess="Budgets are for admins."
    >
      {role !== "admin" ? (
        <NoAccessState title="Budgets are for admins.">
          Switch to Admin in the top right to approve spend.
        </NoAccessState>
      ) : budgets.status === "loading" || !api ? (
        <div aria-busy="true" aria-label="Loading budgets" className="flex flex-col gap-6">
          <Skeleton className="h-28 rounded-xl" />
          <Skeleton className="h-72 rounded-xl" />
        </div>
      ) : budgets.status === "error" ? (
        <ErrorState
          title="Couldn't load budgets."
          message={budgets.error.message}
          onRetry={budgets.retry}
        />
      ) : budgets.data.items.length === 0 ? (
        <EmptyState icon={Wallet} title="No budgets yet.">
          Every agent with a version gets a monthly budget from its spec. They show up here.
        </EmptyState>
      ) : (
        <BudgetsOverview api={api} items={budgets.data.items} />
      )}
    </AdminFrame>
  );
}
