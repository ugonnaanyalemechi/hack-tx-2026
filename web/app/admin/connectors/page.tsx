"use client";

import { AdminFrame } from "@/components/admin/admin-frame";
import { ConnectorsView } from "@/components/connectors/connectors-view";
import { NoAccessState } from "@/components/shell/states";
import { useIdentity } from "@/lib/identity";

/** Connector requests and active grants. Admin only. */
export default function ConnectorsPage() {
  const { role, currentUser } = useIdentity();
  return (
    <AdminFrame
      section="Connectors"
      title="Who can reach what."
      subtitle="Approve a connector, or say why not."
      noAccess="Connectors are for admins."
    >
      {role !== "admin" ? (
        <NoAccessState title="Connectors are for admins.">
          Switch to Admin in the top right to approve connector requests.
        </NoAccessState>
      ) : (
        <ConnectorsView key={currentUser?.id ?? "nobody"} />
      )}
    </AdminFrame>
  );
}
