"use client";

import { TopNav, type NavRole } from "@/components/chat/top-nav";
import { useCurrentUserStandIn, type CurrentUser } from "@/lib/current-user-stand-in";

const ROLE_LABEL: Record<CurrentUser["role"], NavRole> = {
  admin: "Admin",
  builder: "Builder",
  end_user: "End user",
};

/**
 * STAND-IN (see lib/current-user-stand-in.ts): highlights the role the page
 * is acting as until #19's role switcher replaces the inert TopNav pill.
 */
export function StandInTopNav() {
  const user = useCurrentUserStandIn();
  return <TopNav activeTab="Build" activeRole={ROLE_LABEL[user.role]} />;
}
