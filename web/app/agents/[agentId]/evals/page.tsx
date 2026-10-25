import { Suspense } from "react";
import { TopNav } from "@/components/chat/top-nav";
import { DeployView, DeployViewSkeleton } from "@/components/deploy/deploy-view";
import { StandInTopNav } from "@/components/deploy/stand-in-top-nav";

/** Owner view of an agent's eval results and deploy gate (mockup: owner_view_evals_and_deploy). */
export default function AgentEvalsPage({ params }: PageProps<"/agents/[agentId]/evals">) {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <Suspense fallback={<TopNav activeTab="Build" activeRole="Builder" />}>
        <StandInTopNav />
      </Suspense>
      <Suspense fallback={<DeployViewSkeleton />}>
        {params.then(({ agentId }) => (
          <DeployView agentId={agentId} />
        ))}
      </Suspense>
    </div>
  );
}
