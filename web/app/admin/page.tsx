import { redirect } from "next/navigation";

// The admin overview (budgets, approvals, tickets) is a later ticket; until
// it lands the Admin tab opens the run log.
export default function AdminHome() {
  redirect("/admin/runs");
}
