"use client";

/**
 * The demo role switcher (story 64): Admin, Builder or End user. Picking
 * one acts as the first seeded user with that role, which changes the
 * identity header on every API call.
 */

import { ROLES, useIdentity } from "@/lib/identity";
import { PillButton, PillGroup } from "@/components/shell/pill-group";

export function RoleSwitcher() {
  const { users, role, currentUser, selectRole } = useIdentity();
  const list = users.status === "ready" ? users.users : [];

  return (
    <PillGroup role="group" aria-label="Viewing as">
      {ROLES.map((option) => {
        const user = list.find((u) => u.role === option.role);
        const selected = option.role === role;
        return (
          <PillButton
            key={option.role}
            aria-pressed={selected}
            disabled={!user}
            title={user ? `Act as ${user.name}` : undefined}
            onClick={() => selectRole(option.role)}
            className="px-3.5"
          >
            {option.label}
          </PillButton>
        );
      })}
      <span className="sr-only" aria-live="polite">
        {currentUser ? `Viewing as ${currentUser.name}` : ""}
      </span>
    </PillGroup>
  );
}
