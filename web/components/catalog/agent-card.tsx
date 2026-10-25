import Link from "next/link";
import { Bot } from "lucide-react";
import type { CatalogItem } from "@/lib/contracts/api";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** One catalog entry: what the agent does, who owns it, and a way in. */
export function AgentCard({ agent, ownerName }: { agent: CatalogItem; ownerName: string }) {
  return (
    <Card data-testid="agent-card" className="h-full">
      <CardContent className="flex h-full flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <span className="flex size-10 items-center justify-center rounded-md border border-primary-400/30 bg-primary-500/16 text-primary-300">
            <Bot className="size-5" strokeWidth={1.75} aria-hidden />
          </span>
          <Badge variant="success">Live · v{agent.live_version_number}</Badge>
        </div>
        <CardTitle role="heading" aria-level={2}>
          {agent.name}
        </CardTitle>
        <CardDescription>{agent.description}</CardDescription>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="neutral">Owner: {ownerName}</Badge>
        </div>
        <div className="mt-auto pt-2">
          <Link
            href={`/chat?agent=${encodeURIComponent(agent.id)}`}
            className={cn(
              buttonVariants({ variant: "outline", size: "sm" }),
              "h-8 px-3.5"
            )}
          >
            Open chat
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
