import Link from "next/link";
import { Bot } from "lucide-react";
import type { AgentListItem } from "@/lib/contracts/registry";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** One agent in the Build list: its state, who owns it, and the way into its evals and deploy page. */
export function BuildAgentCard({
  agent,
  ownerName,
}: {
  agent: AgentListItem;
  /** Shown to admins, who see every builder's agents. */
  ownerName?: string;
}) {
  const live = agent.live_version_number;
  const latest = agent.latest_version_number;
  const pending = latest !== null && latest !== live;

  return (
    <Card data-testid="build-agent-card" className="h-full">
      <CardContent className="flex h-full flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <span className="flex size-10 items-center justify-center rounded-md border border-primary-400/30 bg-primary-500/16 text-primary-300">
            <Bot className="size-5" strokeWidth={1.75} aria-hidden />
          </span>
          {live !== null ? (
            <Badge variant="success">Live · v{live}</Badge>
          ) : (
            <Badge variant="neutral">Not live</Badge>
          )}
        </div>
        <CardTitle role="heading" aria-level={2}>
          {agent.name}
        </CardTitle>
        <CardDescription>{agent.description}</CardDescription>
        <div className="flex flex-wrap gap-1.5">
          {pending ? <Badge variant="info">v{latest} not live yet</Badge> : null}
          {ownerName ? <Badge variant="neutral">Owner: {ownerName}</Badge> : null}
        </div>
        <div className="mt-auto flex flex-wrap gap-2 pt-2">
          <Link
            href={`/agents/${encodeURIComponent(agent.id)}/evals`}
            className={cn(buttonVariants({ variant: "default", size: "sm" }), "h-8 px-3.5")}
          >
            Evals and deploy
          </Link>
          {live !== null ? (
            <Link
              href={`/chat?agent=${encodeURIComponent(agent.id)}`}
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-8 px-3.5")}
            >
              Open chat
            </Link>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
