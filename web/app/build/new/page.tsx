"use client";

import { AppShell } from "@/components/shell/app-shell";
import { PageBody, PageHero } from "@/components/shell/page-hero";
import { NoAccessState } from "@/components/shell/states";
import { NewAgentView } from "@/components/build/new-agent-view";
import { canOpenAdmin, useIdentity } from "@/lib/identity";

/**
 * Build a new agent from a web form (docs/design/build_an_agent.png). View
 * only: the setup assistant, connector approvals and saving run on mock data
 * (see the RUNTIME-PLACEHOLDER marks in lib/api/mock*.ts) until the backend
 * and runtime tickets land.
 */
export default function NewAgentPage() {
  const { role } = useIdentity();
  return (
    <AppShell>
      <PageHero
        overline="New agent · Web form"
        title="Describe it first."
        subtitle="Then check the details."
      />
      <PageBody>
        {canOpenAdmin(role) ? (
          <NewAgentView />
        ) : (
          <NoAccessState title="Building is for builders and admins.">
            Switch to Builder or Admin in the top right to build an agent.
          </NoAccessState>
        )}
      </PageBody>
    </AppShell>
  );
}
