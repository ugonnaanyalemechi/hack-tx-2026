import { expect, test, type Page } from "@playwright/test";

async function actAs(page: Page, role: "Admin" | "Builder" | "End user") {
  const button = page
    .getByRole("group", { name: "Viewing as" })
    .getByRole("button", { name: role });
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
}

const ticketRow = (page: Page, question: string) =>
  page.getByRole("listitem", { name: question });

test.describe("flag tickets", () => {
  test("an admin sees every ticket with its status and actions", async ({ page }) => {
    await page.goto("/admin/tickets");
    await actAs(page, "Admin");

    await expect(page.getByRole("heading", { level: 1 })).toContainText("Wrong answers, flagged.");
    await expect(page.getByTestId("ticket-row")).toHaveCount(5);

    const margin = ticketRow(page, "Operating margin wrong for 2024");
    await expect(margin).toContainText("Filings Analyst · from Eli End User");
    await expect(margin).toContainText("Re-check done");
    await expect(margin.getByRole("button", { name: "Save as test case" })).toBeVisible();
    await expect(margin.getByRole("button", { name: "Resolve" })).toBeVisible();
    await expect(margin.getByRole("link", { name: "View run" })).toHaveAttribute(
      "href",
      /\/admin\/runs\?run=run_8f24/
    );

    await expect(ticketRow(page, "Missing citation on debt table")).toContainText("Open");
    const done = ticketRow(page, "Fiscal year label off by one");
    await expect(done).toContainText("Resolved");
    await expect(done.getByRole("button", { name: "Resolve" })).toHaveCount(0);
    await expect(done.getByRole("button", { name: "Save as test case" })).toHaveCount(0);

    await page.screenshot({
      path: "tests/__screenshots__/admin-tickets.png",
      fullPage: true,
    });
  });

  test("resolving a ticket marks it resolved", async ({ page }) => {
    await page.goto("/admin/tickets");
    await actAs(page, "Admin");

    const row = ticketRow(page, "Duplicate Jira issue created");
    await row.getByRole("button", { name: "Resolve" }).click();
    await expect(row).toContainText("Resolved");
    await expect(row.getByRole("button", { name: "Resolve" })).toHaveCount(0);

    // The Open filter no longer lists it.
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await expect(page.getByTestId("ticket-row")).toHaveCount(3);
    await expect(ticketRow(page, "Duplicate Jira issue created")).toHaveCount(0);

    await page.screenshot({
      path: "tests/__screenshots__/admin-tickets-resolved.png",
      fullPage: true,
    });
  });

  test("saving a ticket as a test case", async ({ page }) => {
    await page.goto("/admin/tickets");
    await actAs(page, "Admin");

    const row = ticketRow(page, "Operating margin wrong for 2024");
    await row.getByRole("button", { name: "Save as test case" }).click();
    const form = row.getByRole("form", { name: "Save as test case" });
    await expect(form).toContainText("Operating margin wrong for 2024");

    await form.getByLabel("Answer must contain").fill("21.4%\n19.8%");
    await form.getByLabel("Rubric (optional)").fill("Gives the margin for fiscal 2024");

    await page.screenshot({
      path: "tests/__screenshots__/admin-tickets-save-case.png",
      fullPage: true,
    });

    await form.getByRole("button", { name: "Save test case" }).click();
    await expect(row.getByText("Saved as test case")).toBeVisible();
    await expect(form).toHaveCount(0);
  });

  test("a builder sees and acts on only their own agents' tickets", async ({ page }) => {
    await page.goto("/admin/tickets");
    await actAs(page, "Builder");

    // Policy Assistant belongs to the other builder.
    await expect(page.getByTestId("ticket-row")).toHaveCount(4);
    await expect(ticketRow(page, "Clause quoted from the wrong policy")).toHaveCount(0);
    await expect(
      ticketRow(page, "Missing citation on debt table").getByRole("button", { name: "Resolve" })
    ).toBeVisible();
  });

  test("a builder who does not own the agent gets no actions", async ({ page }) => {
    // The mock only lists a builder their own tickets, so fake the API: the
    // server may show a builder a ticket on another builder's agent.
    const ticket = (id: string, agent_id: string, question: string) => ({
      id,
      agent_id,
      agent_name: agent_id === "agt_mine" ? "My Agent" : "Their Agent",
      run_id: "run_1",
      recheck_run_id: null,
      question,
      status: "open",
      created_by: "usr_end_user",
      created_at: "2026-10-25T12:00:00Z",
      resolved_at: null,
    });
    const agent = (id: string, owner_id: string) => ({
      id,
      slug: id,
      name: id,
      description: "",
      owner_id,
      live_version_number: 1,
      latest_version_number: 1,
    });
    await page.route("**/api/v1/**", (route) => {
      const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
      const bodies: Record<string, unknown> = {
        "/users": [
          { id: "usr_admin", name: "Ada Admin", role: "admin" },
          { id: "usr_builder", name: "Ben Builder", role: "builder" },
          { id: "usr_end_user", name: "Eli End User", role: "end_user" },
        ],
        "/agents": {
          items: [agent("agt_mine", "usr_builder"), agent("agt_theirs", "usr_builder_2")],
          next_cursor: null,
        },
        "/tickets": {
          items: [
            ticket("tkt_a", "agt_mine", "On my agent"),
            ticket("tkt_b", "agt_theirs", "On their agent"),
          ],
          next_cursor: null,
        },
      };
      return route.fulfill({ json: bodies[path] ?? { error: { code: "not_found", message: path } } });
    });

    await page.goto("/admin/tickets?api=live");
    await actAs(page, "Builder");

    await expect(page.getByTestId("ticket-row")).toHaveCount(2);
    await expect(
      ticketRow(page, "On my agent").getByRole("button", { name: "Resolve" })
    ).toBeVisible();
    await expect(
      ticketRow(page, "On their agent").getByRole("button", { name: "Resolve" })
    ).toHaveCount(0);
    await expect(
      ticketRow(page, "On their agent").getByRole("button", { name: "Save as test case" })
    ).toHaveCount(0);
    await expect(ticketRow(page, "On their agent").getByRole("link", { name: "View run" })).toBeVisible();
  });

  test("an end user cannot see or act on tickets", async ({ page }) => {
    await page.goto("/admin/tickets");
    await actAs(page, "End user");

    await expect(page.getByText("Flag tickets are for admins and agent owners.")).toBeVisible();
    await expect(page.getByTestId("ticket-row")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Resolve" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Save as test case" })).toHaveCount(0);

    await page.screenshot({
      path: "tests/__screenshots__/admin-tickets-no-access.png",
      fullPage: true,
    });
  });

  test("shows loading, empty and error states", async ({ page }) => {
    await page.goto("/admin/tickets?mock=loading");
    await actAs(page, "Admin");
    await expect(page.getByLabel("Loading tickets")).toBeVisible();

    await page.goto("/admin/tickets?mock=empty");
    await expect(page.getByText("No flag tickets.")).toBeVisible();

    await page.goto("/admin/tickets?mock=error");
    await expect(page.getByRole("alert").filter({ hasText: "Retry" })).toContainText(
      "Couldn't load the tickets."
    );
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
  });
});
