"use client";

import { useMemo } from "react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Hammer } from "lucide-react";
import { AppShell } from "@/components/shell/app-shell";
import { PageBody, PageHero } from "@/components/shell/page-hero";
import { EmptyState, ErrorState, NoAccessState } from "@/components/shell/states";
import { BuildAgentCard } from "@/components/build/build-agent-card";
import { Skeleton } from "@/components/ui/skeleton";
import { canOpenAdmin, useIdentity } from "@/lib/identity";
import { useApiQuery } from "@/lib/use-api-query";

/**
 * The Build tab: the owner's agents, each linking to its evals and deploy
 * page (docs/design/owner_view_evals_and_deploy.png). The new-agent form of
 * docs/design/build_an_agent.png (setup assistant, YAML editor) is out of
 * MVP scope; agents are still created from a YAML file in the repository.
 */
export default function BuildPage() {
  const { users, role, currentUser } = useIdentity();
  const allowed = canOpenAdmin(role);
  const agents = useApiQuery(allowed ? "build-agents" : null, (api) =>
    api.listAgents({ limit: 100 })
  );

  const ownerNames = useMemo(() => {
    const list = users.status === "ready" ? users.users : [];
    return new Map(list.map((u) => [u.id, u.name]));
  }, [users]);

  // Builders see their own agents; admins see everyone's.
  const mine =
    agents.status === "ready"
      ? agents.data.items.filter((a) => role === "admin" || a.owner_id === currentUser?.id)
      : [];

  return (
    <AppShell>
      <PageHero
        overline={role === "admin" ? "Build · Every agent" : "Build · Your agents"}
        title="Test it, then ship it."
        subtitle="A person always approves."
        lead="Open an agent to see its latest test run, its versions and the deploy gate. Edit the agent's YAML file in your repository and deploy again."
        aside={
          allowed ? (
            <Link href="/build/new" className={cn(buttonVariants({ variant: "default" }), "h-11 px-5 text-sm")}>
              New agent
            </Link>
          ) : undefined
        }
      />
      <PageBody>
        {!allowed ? (
          <NoAccessState title="Building is for builders and admins.">
            Switch to Builder or Admin in the top right to see your agents.
          </NoAccessState>
        ) : agents.status === "loading" || !currentUser ? (
          <div
            aria-busy="true"
            aria-label="Loading your agents"
            className="grid gap-6 md:grid-cols-2 lg:grid-cols-3"
          >
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-60 rounded-xl" />
            ))}
          </div>
        ) : agents.status === "error" ? (
          <ErrorState
            title="Couldn't load your agents."
            message={agents.error.message}
            onRetry={agents.retry}
          />
        ) : mine.length === 0 ? (
          <EmptyState icon={Hammer} title="No agents yet.">
            Agents you own show up here once their first version is deployed from a YAML file.
          </EmptyState>
        ) : (
          <ul aria-label="Agents" className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {mine.map((agent) => (
              <li key={agent.id}>
                <BuildAgentCard
                  agent={agent}
                  ownerName={
                    role === "admin" ? (ownerNames.get(agent.owner_id) ?? agent.owner_id) : undefined
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </PageBody>
    </AppShell>
  );
}
