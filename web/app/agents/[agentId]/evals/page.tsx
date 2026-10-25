import { Suspense } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { DeployView, DeployViewSkeleton } from "@/components/deploy/deploy-view";

/**
 * Owner view of an agent's eval results and deploy gate (mockup:
 * owner_view_evals_and_deploy). The shell reads the pathname, which is only
 * known per request on this dynamic route, so it sits inside a Suspense
 * boundary with the page body.
 */
export default function AgentEvalsPage({ params }: PageProps<"/agents/[agentId]/evals">) {
  return (
    <Suspense fallback={<DeployViewSkeleton />}>
      <AppShell>
        {params.then(({ agentId }) => (
          <DeployView agentId={agentId} />
        ))}
      </AppShell>
    </Suspense>
  );
}
