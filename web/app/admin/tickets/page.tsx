"use client";

import { AdminFrame } from "@/components/admin/admin-frame";
import { TicketList } from "@/components/tickets/ticket-list";
import { useIdentity } from "@/lib/identity";

export default function TicketsPage() {
  // Switching role starts the list over, so nothing from another user shows.
  const { currentUser } = useIdentity();
  return (
    <AdminFrame
      section="Flag tickets"
      title="Wrong answers, flagged."
      subtitle="Fix them, then test for them."
      noAccess="Flag tickets are for admins and agent owners."
    >
      <TicketList key={currentUser?.id ?? "nobody"} />
    </AdminFrame>
  );
}
