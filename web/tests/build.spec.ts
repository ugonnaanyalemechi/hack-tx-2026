/** The Build tab: the owner's agents, each linking to its evals and deploy page. */

import { expect, test, type Page } from "@playwright/test";

async function actAs(page: Page, role: "Admin" | "Builder" | "End user") {
  const button = page
    .getByRole("group", { name: "Viewing as" })
    .getByRole("button", { name: role });
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
}

test.describe("build", () => {
  test("a builder sees only their agents and opens one's evals and deploy page", async ({
    page,
  }) => {
    await page.goto("/build");
    await actAs(page, "Builder");

    await expect(page.getByRole("heading", { level: 1 })).toContainText("Test it, then ship it.");
    const cards = page.getByTestId("build-agent-card");
    await expect(cards).toHaveCount(3); // Ben Builder owns Filings, PR Reviewer, Credit Memo
    await expect(cards.filter({ hasText: "Policy Assistant" })).toHaveCount(0);
    await expect(cards.filter({ hasText: "Filings Analyst" })).toContainText("v4 not live yet");
    await expect(cards.filter({ hasText: "Credit Memo Drafter" })).toContainText("Not live");

    await page.screenshot({ path: "tests/__screenshots__/build.png", fullPage: true });

    await cards
      .filter({ hasText: "Filings Analyst" })
      .getByRole("link", { name: "Evals and deploy" })
      .click();
    await expect(page).toHaveURL(/\/agents\/agt_.*\/evals$/);
    await expect(page.getByRole("heading", { level: 1, name: "Filings Analyst" })).toBeVisible();
  });

  test("the Build tab opens it, and an admin sees every agent with its owner", async ({ page }) => {
    await page.goto("/catalog");
    await actAs(page, "Admin");
    await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Build" }).click();

    await expect(page).toHaveURL(/\/build$/);
    const cards = page.getByTestId("build-agent-card");
    await expect(cards).toHaveCount(6);
    await expect(cards.filter({ hasText: "Policy Assistant" })).toContainText("Owner: Cleo Builder");
  });

  test("an end user gets a no-access note", async ({ page }) => {
    await page.goto("/build");
    await expect(page.getByText("Building is for builders and admins.")).toBeVisible();
    await expect(page.getByTestId("build-agent-card")).toHaveCount(0);
  });

  test("shows loading, empty and error states", async ({ page }) => {
    await page.goto("/build?mock=loading");
    await actAs(page, "Builder");
    await expect(page.getByLabel("Loading your agents")).toBeVisible();

    await page.goto("/build?mock=empty");
    await expect(page.getByText("No agents yet.")).toBeVisible();

    await page.goto("/build?mock=error");
    await expect(page.getByRole("alert").filter({ hasText: "Retry" })).toContainText(
      "Couldn't load your agents."
    );
  });
});
