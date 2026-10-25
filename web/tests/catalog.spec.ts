import { expect, test } from "@playwright/test";

test.describe("catalog", () => {
  test("lists live agents with owner, live version and a chat link", async ({
    page,
  }) => {
    await page.goto("/catalog");

    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "Find an agent and ask it."
    );

    const cards = page.getByTestId("agent-card");
    await expect(cards).toHaveCount(5);

    const filings = cards.filter({ hasText: "Filings Analyst" });
    await expect(
      filings.getByText(
        "Answers questions about company filings and cites the page."
      )
    ).toBeVisible();
    await expect(filings.getByText("Owner: Ben Builder")).toBeVisible();
    await expect(filings.getByText("Live · v3")).toBeVisible();
    await expect(
      filings.getByRole("link", { name: "Open chat" })
    ).toHaveAttribute("href", /^\/chat\?agent=agt_/);

    await page.screenshot({
      path: "tests/__screenshots__/catalog.png",
      fullPage: false,
    });
  });

  test("filters agents by the search box", async ({ page }) => {
    await page.goto("/catalog");
    await expect(page.getByTestId("agent-card")).toHaveCount(5);

    await page.getByLabel("Search agents").fill("policy");

    await expect(page.getByTestId("agent-card")).toHaveCount(1);
    await expect(page.getByTestId("agent-card")).toContainText(
      "Policy Assistant"
    );

    await page.getByLabel("Search agents").fill("nothing matches this");
    await expect(page.getByTestId("agent-card")).toHaveCount(0);
    await expect(page.getByText("No agents match")).toBeVisible();
  });

  test("shows a loading state while the catalog loads", async ({ page }) => {
    await page.goto("/catalog?mock=loading");
    await expect(page.getByLabel("Loading agents")).toBeVisible();
  });

  test("shows an empty state when no agent is live", async ({ page }) => {
    await page.goto("/catalog?mock=empty");
    await expect(page.getByText("No agents are live yet.")).toBeVisible();
  });

  test("shows an error state with a retry", async ({ page }) => {
    await page.goto("/catalog?mock=error");
    await expect(
      page.getByRole("alert").filter({ hasText: "Couldn't load the catalog." })
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
  });
});
