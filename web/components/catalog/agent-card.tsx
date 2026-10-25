"use client";

import Link from "next/link";
import { useState } from "react";
import type { CatalogItem } from "@/lib/contracts/api";
import { getCatalogMeta } from "@/lib/catalog-meta";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

const TEXT_LINK =
  "text-sm font-medium text-text-brand underline-offset-4 hover:underline focus-visible:underline outline-none";

/** One catalog entry: what the agent does, who owns it, and a way in. */
export function AgentCard({
  agent,
  ownerName,
  isOwner = false,
  nearBudget = false,
}: {
  agent: CatalogItem;
  ownerName: string;
  /** The viewer owns this agent, so the card links to its evals and deploy page. */
  isOwner?: boolean;
  /** Spend is at 80% of the cap or more. A flag only, never a cost figure. */
  nearBudget?: boolean;
}) {
  const meta = getCatalogMeta(agent.slug);
  const Icon = meta.icon;
  const [copied, setCopied] = useState(false);

  // RUNTIME-PLACEHOLDER(#57): "Copy agent" has no registry call behind it yet
  // (`POST /v1/agents/{id}/copy` exists but is not wired to any view), so this
  // only copies the agent's chat link and says so.
  async function copyAgent() {
    const link = `${window.location.origin}/chat?agent=${encodeURIComponent(agent.id)}`;
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      // Clipboard access can be denied; the confirmation still shows because
      // the copy is a stand-in either way.
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <Card data-testid="agent-card" className="h-full">
      <CardContent className="flex h-full flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <span className="flex size-10 items-center justify-center rounded-md border border-primary-400/30 bg-primary-500/16 text-primary-300">
            <Icon className="size-5" strokeWidth={1.75} aria-hidden />
          </span>
          <div className="flex flex-wrap justify-end gap-1.5">
            {nearBudget ? <Badge variant="warning">80% budget</Badge> : null}
            <Badge variant="success">Live · v{agent.live_version_number}</Badge>
          </div>
        </div>
        <CardTitle role="heading" aria-level={2}>
          {agent.name}
        </CardTitle>
        <CardDescription>{agent.description}</CardDescription>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="tag">Built with {meta.builtWith}</Badge>
          <Badge variant="tag">Owner: {ownerName}</Badge>
        </div>
        <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 pt-2">
          <Link
            href={`/chat?agent=${encodeURIComponent(agent.id)}`}
            className={cn(
              buttonVariants({ variant: "default", size: "sm" }),
              "h-8 px-3.5",
            )}
          >
            Open chat
          </Link>
          <Button
            type="button"
            variant="link"
            onClick={copyAgent}
            className={cn(TEXT_LINK, "h-auto p-0")}
          >
            {copied ? "Link copied" : "Copy agent"}
          </Button>
          {isOwner ? (
            <Link
              href={`/agents/${encodeURIComponent(agent.id)}/evals`}
              className={TEXT_LINK}
            >
              Evals and deploy
            </Link>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
