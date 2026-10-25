/**
 * Shared loading, empty, error and no-access blocks, so every screen
 * reports these states the same way.
 */

import { AlertTriangle, Lock, RotateCcw, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ErrorState({
  title,
  message,
  onRetry,
  className,
}: {
  title: string;
  message?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-start gap-3 rounded-lg border border-error/28 bg-error/12 p-5 text-sm",
        className
      )}
    >
      <div className="flex items-start gap-2 text-error">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
        <div className="flex flex-col gap-1">
          <p className="font-medium">{title}</p>
          {message ? <p className="text-text-secondary">{message}</p> : null}
        </div>
      </div>
      {onRetry ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onRetry}
          className="gap-1.5 rounded-pill"
        >
          <RotateCcw className="size-3.5" aria-hidden />
          Retry
        </Button>
      ) : null}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  children,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-2 rounded-xl border border-dashed border-border-default p-10 text-center",
        className
      )}
    >
      {Icon ? <Icon className="mb-1 size-6 text-text-disabled" aria-hidden /> : null}
      <p className="text-sm font-medium text-text-primary">{title}</p>
      {children ? <div className="max-w-measure text-sm text-text-muted">{children}</div> : null}
    </div>
  );
}

/** For screens a role may not open. Says why, never shows the data. */
export function NoAccessState({ title, children }: { title: string; children: ReactNode }) {
  return (
    <EmptyState icon={Lock} title={title}>
      {children}
    </EmptyState>
  );
}
