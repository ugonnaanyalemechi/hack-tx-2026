import Link from "next/link";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Overline } from "@/components/build/field";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { ErrorState } from "@/components/shell/states";
import { cn } from "@/lib/utils";
import type { SpecError } from "@/lib/api/mock-build";

export type SaveState =
  | { status: "idle" }
  | { status: "validating" }
  | { status: "valid" }
  | { status: "invalid"; errors: SpecError[] }
  | { status: "saving" }
  | { status: "saved"; agentId: string; name: string }
  | { status: "error"; message: string };

/**
 * The sticky right column: the agent file made from the form, the Validate
 * and Save draft actions and what happened when you pressed them.
 */
export function YamlPanel({
  yaml,
  state,
  onValidate,
  onSave,
}: {
  yaml: string;
  state: SaveState;
  onValidate: () => void;
  onSave: () => void;
}) {
  const busy = state.status === "validating" || state.status === "saving";
  return (
    <aside aria-label="Agent file" className="flex flex-col gap-3 lg:sticky lg:top-6">
      <div className="flex items-center justify-between gap-3">
        <Overline>Agent file (YAML)</Overline>
        <StatusBadge tone="brand">Built with form</StatusBadge>
      </div>
      <pre
        data-testid="agent-yaml"
        tabIndex={0}
        aria-label="Agent file contents"
        className="max-h-[32rem] overflow-auto rounded-lg border border-border-default bg-surface-0 p-4 font-mono text-xs leading-relaxed text-text-primary"
      >
        {yaml}
      </pre>
      <p className="text-xs text-text-muted">
        Saved as the same file the command line makes. You edit it here because you built it here.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" disabled={busy} onClick={onValidate}>
          {state.status === "validating" ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : null}
          Validate
        </Button>
        <Button type="button" disabled={busy} onClick={onSave}>
          {state.status === "saving" ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : null}
          {state.status === "saving" ? "Saving draft…" : "Save draft"}
        </Button>
      </div>

      {state.status === "valid" ? (
        <p role="status" className="flex items-center gap-1.5 text-sm text-success">
          <CheckCircle2 className="size-4" aria-hidden /> The agent file is valid.
        </p>
      ) : null}
      {state.status === "invalid" ? (
        <ErrorState
          title="Fix these fields before saving."
          message={state.errors.map((e) => `${e.field}: ${e.message}`).join(" ")}
        />
      ) : null}
      {state.status === "error" ? (
        <ErrorState title="Couldn't save the draft." message={state.message} onRetry={onSave} />
      ) : null}
      {state.status === "saved" ? (
        <div
          role="status"
          className="flex flex-col gap-2 rounded-lg border border-success/28 bg-success/12 p-4 text-sm"
        >
          <p className="flex items-center gap-1.5 font-medium text-success">
            <CheckCircle2 className="size-4" aria-hidden /> Draft saved as {state.name}.
          </p>
          <p className="text-text-secondary">
            Test it, then deploy from there. A person always approves a deploy.
          </p>
          <Link
            href={`/agents/${state.agentId}/evals`}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "w-fit")}
          >
            Open evals and deploy
          </Link>
        </div>
      ) : null}
    </aside>
  );
}
