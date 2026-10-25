import { expect, test, type Page } from "@playwright/test";

async function actAs(page: Page, role: "Admin" | "Builder" | "End user") {
  const button = page
    .getByRole("group", { name: "Viewing as" })
    .getByRole("button", { name: role });
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
}

const byAgent = (page: Page) => page.getByRole("table", { name: "Spend by agent" });
const byDay = (page: Page) => page.getByRole("table", { name: "Spend by day" });

test.describe("usage", () => {
  test("an admin sees spend per agent and per day", async ({ page }) => {
    await page.goto("/admin/usage");
    await actAs(page, "Admin");

    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "Where the money goes."
    );

    // Every agent that ran, in the API's name order (Python string order,
    // so "PR" sorts before "Po").
    const agentNames = byAgent(page).locator("tbody tr td:first-child");
    await expect(agentNames).toHaveText([
      "Campaign Copy Reviewer",
      "Filings Analyst",
      "Market Summary",
      "PR Reviewer",
      "Policy Assistant",
    ]);

    // Oct 25 has the seven hand-written runs; their steps' tokens price out
    // to $0.051897 at the gateway's rates.
    const today = byDay(page).getByRole("row").filter({ hasText: "Sun, Oct 25" });
    await expect(today.locator("td").nth(1)).toHaveText("7");
    await expect(today.locator("td").nth(2)).toHaveText("$0.052");
    await expect(byDay(page).locator("tbody tr")).toHaveCount(7);

    // The day chart has one column per day, each with an accessible label.
    await expect(
      page.getByRole("img", { name: /Sun, Oct 25: 7 runs, \$0\.052/ })
    ).toBeVisible();

    await expect(page.getByTestId("stat-runs")).not.toHaveText("0");

    await page.screenshot({
      path: "tests/__screenshots__/admin-usage.png",
      fullPage: false,
    });
  });

  test("a builder sees spend only for agents they own", async ({ page }) => {
    await page.goto("/admin/usage");
    await actAs(page, "Builder");

    const agentNames = byAgent(page).locator("tbody tr td:first-child");
    await expect(agentNames).toHaveText(["Filings Analyst", "PR Reviewer"]);
  });

  test("an end user gets no usage view and no cost figures", async ({ page }) => {
    await page.goto("/admin/usage");
    await expect(page.getByText("Usage is for admins and agent owners.")).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(0);
    await expect(page.getByText(/\$\d/)).toHaveCount(0);
  });

  test("shows loading, empty and error states", async ({ page }) => {
    await page.goto("/admin/usage?mock=loading");
    await actAs(page, "Admin");
    await expect(page.getByLabel("Loading usage")).toBeVisible();

    await page.goto("/admin/usage?mock=empty");
    await expect(page.getByText("No spend yet.")).toBeVisible();

    await page.goto("/admin/usage?mock=error");
    await expect(
      page.getByRole("alert").filter({ hasText: "Couldn't load usage." })
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
  });
});
