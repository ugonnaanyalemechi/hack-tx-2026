/**
 * The top band of a product screen: overline, a two-tone H1 (the claim in
 * white, the second line muted, P4), an optional lead paragraph, and a
 * slot on the right (section tabs). Carries the view's single cobalt glow.
 */

import type { ReactNode } from "react";

export function PageHero({
  overline,
  title,
  subtitle,
  lead,
  aside,
  children,
}: {
  overline: string;
  title: string;
  subtitle?: string;
  lead?: ReactNode;
  aside?: ReactNode;
  /** Rendered under the headline, e.g. filters. */
  children?: ReactNode;
}) {
  return (
    <section className="relative">
      <div className="pointer-events-none absolute inset-x-0 -top-18 h-120 bg-glow opacity-60" aria-hidden />
      <div className="relative mx-auto flex w-full max-w-wide flex-col gap-10 px-6 pt-16 pb-10 lg:px-12">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="flex flex-col gap-4">
            <p className="font-mono text-overline font-medium tracking-overline text-text-brand uppercase">
              {overline}
            </p>
            <h1 className="text-h1-sm text-text-primary md:text-h1">
              {title}
              {subtitle ? (
                <>
                  <br />
                  <span className="text-text-muted">{subtitle}</span>
                </>
              ) : null}
            </h1>
            {lead ? (
              <p className="mt-2 max-w-measure text-base text-text-secondary">{lead}</p>
            ) : null}
          </div>
          {aside}
        </div>
        {children}
      </div>
    </section>
  );
}

/** The page body under a hero, aligned to the same margins. */
export function PageBody({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-wide flex-1 px-6 pb-24 lg:px-12">{children}</div>
  );
}
