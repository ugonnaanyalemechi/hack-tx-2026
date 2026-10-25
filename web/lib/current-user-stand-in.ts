"use client";

/**
 * STAND-IN for the app-wide role switcher and identity header (#19).
 *
 * #19 owns the real switcher. Until it lands, the deploy and eval views read
 * the current user from `?as=admin|builder|end_user` (default: the demo
 * agent's owner, Ben Builder). To swap in #19's version, replace
 * `useCurrentUserStandIn` with its hook and `IDENTITY_HEADER` with its
 * constant; nothing else in the deploy views reads the role directly.
 *
 * The ids and names are the seeded users in `src/hack_tx_2026/seed.py`; the
 * header name is the backend default `IDENTITY_HEADER_NAME`.
 */

import { useSearchParams } from "next/navigation";

export const IDENTITY_HEADER = "X-User-Id";

/** Mirrors `UserPublic` in `src/hack_tx_2026/models/api.py`. */
export interface CurrentUser {
  id: string;
  name: string;
  role: "admin" | "builder" | "end_user";
}

const SEEDED_USERS: Record<CurrentUser["role"], CurrentUser> = {
  admin: { id: "usr_admin", name: "Ada Admin", role: "admin" },
  builder: { id: "usr_builder", name: "Ben Builder", role: "builder" },
  end_user: { id: "usr_end_user", name: "Eli End User", role: "end_user" },
};

function isRole(value: string | null): value is CurrentUser["role"] {
  return value !== null && Object.hasOwn(SEEDED_USERS, value);
}

export function useCurrentUserStandIn(): CurrentUser {
  const as = useSearchParams().get("as");
  return isRole(as) ? SEEDED_USERS[as] : SEEDED_USERS.builder;
}
