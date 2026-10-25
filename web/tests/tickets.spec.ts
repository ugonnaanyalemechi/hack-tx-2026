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
