import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";

/** A labelled form field with a hint and an error that names the field. */
export function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-error">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Mono, uppercase section label used above panels. */
export function Overline({ children }: { children: ReactNode }) {
  return (
    <p className="font-mono text-overline font-medium tracking-overline text-text-brand uppercase">
      {children}
    </p>
  );
}
