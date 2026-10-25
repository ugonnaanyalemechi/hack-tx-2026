/** The admin landing: what is waiting on an admin, each row linking to its page. */

import { expect, test, type Page } from "@playwright/test";

async function actAs(page: Page, role: "Admin" | "Builder" | "End user") {
  const button = page
    .getByRole("group", { name: "Viewing as" })
    .getByRole("button", { name: role });
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
}

test.describe("admin queue", () => {
  test("lists paused budgets, blocked deploys and open tickets", async ({ page }) => {
    await page.goto("/admin");
    await actAs(page, "Admin");

    await expect(page.getByRole("heading", { level: 1 })).toContainText("Everything else is running.");
    await expect(page.getByTestId("queue-pauses")).toHaveText("1");
    await expect(page.getByTestId("queue-blocked")).toHaveText("1");
    await expect(page.getByTestId("queue-tickets")).toHaveText("4");

    const pauses = page.getByRole("region", { name: "Budget pauses" });
    await expect(pauses).toContainText("Market Summary");
    await expect(pauses.getByRole("link", { name: "Approve spend" })).toHaveAttribute(
      "href",
      "/admin/budgets"
    );

    const blocked = page.getByRole("region", { name: "Blocked deploys" });
    await expect(blocked).toContainText("Policy Assistant v5");
    await expect(blocked).toContainText("Scored 0.78, needs 0.85");
    await expect(blocked.getByRole("link", { name: "Review" })).toHaveAttribute(
      "href",
      /\/agents\/agt_.*\/evals$/
    );

    const tickets = page.getByRole("region", { name: "Open flag tickets" });
    await expect(tickets).toContainText("Operating margin wrong for 2024");

    await page.screenshot({ path: "tests/__screenshots__/admin-queue.png", fullPage: true });

    await blocked.getByRole("link", { name: "Review" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Policy Assistant" })).toBeVisible();
  });

  test("approving spend clears the budget pause from the queue", async ({ page }) => {
    await page.goto("/admin/budgets");
    await actAs(page, "Admin");
    await page
      .getByTestId("budget-row")
      .filter({ hasText: "Market Summary" })
      .getByRole("button", { name: /Approve/ })
      .click();
    await expect(page.getByTestId("budget-row").filter({ hasText: "Market Summary" })).toContainText(
      "extra approved"
    );

    await page.getByRole("link", { name: "Overview" }).click();
    await expect(page.getByTestId("queue-pauses")).toHaveText("0");
  });

  test("a builder cannot open the queue and an end user gets no Admin tab", async ({ page }) => {
    await page.goto("/admin");
    await actAs(page, "Builder");
    await expect(page.getByText("The admin queue is for admins.").first()).toBeVisible();
    await expect(page.getByTestId("queue-row")).toHaveCount(0);
  });

  test("shows loading, empty and error states", async ({ page }) => {
    await page.goto("/admin?mock=loading");
    await actAs(page, "Admin");
    await expect(page.getByLabel("Loading the queue")).toBeVisible();

    await page.goto("/admin?mock=empty");
    await expect(page.getByText("Nothing is waiting on you.")).toBeVisible();

    await page.goto("/admin?mock=error");
    await expect(page.getByRole("alert").filter({ hasText: "Retry" })).toContainText(
      "Couldn't load the queue."
    );
  });
});
