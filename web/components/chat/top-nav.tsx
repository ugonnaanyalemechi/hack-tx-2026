/**
 * Shared top chrome: logo, Catalog/Build/Admin tabs, role-switcher pill.
 *
 * Ticket #19 owns wiring this up to real routing and an actual role
 * switch. For the chat page (#17) it only needs to render visually
 * consistent with the mockup — the tabs and role pill are inert here on
 * purpose.
 */

const NAV_TABS = ["Catalog", "Build", "Admin"] as const;
const ROLES = ["Admin", "Builder", "End user"] as const;

export function TopNav() {
  return (
    <header className="flex h-18 shrink-0 items-center justify-between border-b border-border-subtle px-6">
      <div className="flex items-center gap-2.5">
        <div
          className="size-6 rounded-xs bg-gradient-to-br from-primary-400 via-primary-600 to-primary-700"
          aria-hidden
        />
        <span className="text-sm font-semibold tracking-tight text-text-primary">
          Foundry
        </span>
      </div>

      <nav
        aria-label="Primary"
        className="flex items-center gap-0.5 rounded-pill border border-border-default bg-white/3 p-1"
      >
        {NAV_TABS.map((tab, i) => (
          <button
            key={tab}
            type="button"
            tabIndex={-1}
            aria-current={i === 0 ? "page" : undefined}
            className="rounded-pill px-4 py-1.5 text-sm font-medium text-text-secondary aria-[current=page]:bg-white/10 aria-[current=page]:text-text-primary"
          >
            {tab}
          </button>
        ))}
      </nav>

      <div
        role="group"
        aria-label="Viewing as"
        className="flex items-center gap-0.5 rounded-pill border border-border-default bg-white/3 p-1"
      >
        {ROLES.map((role, i) => (
          <button
            key={role}
            type="button"
            tabIndex={-1}
            aria-current={i === ROLES.length - 1 ? "page" : undefined}
            className="rounded-pill px-3.5 py-1.5 text-sm font-medium text-text-secondary aria-[current=page]:bg-white/10 aria-[current=page]:text-text-primary"
          >
            {role}
          </button>
        ))}
      </div>
    </header>
  );
}
