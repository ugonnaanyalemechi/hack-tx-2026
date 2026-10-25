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

  test("filters by category chip and links to build", async ({ page }) => {
    await page.goto("/catalog");
    await expect(page.getByTestId("agent-card")).toHaveCount(5);

    const chips = page.getByRole("group", { name: "Filter by category" });
    await chips.getByRole("button", { name: "Finance" }).click();
    await expect(page.getByTestId("agent-card")).toHaveCount(2);
    await chips.getByRole("button", { name: "Engineering" }).click();
    await expect(page.getByTestId("agent-card")).toHaveCount(1);
    await expect(page.getByTestId("agent-card")).toContainText("PR Reviewer");
    await chips.getByRole("button", { name: "All" }).click();
    await expect(page.getByTestId("agent-card")).toHaveCount(5);

    await expect(page.getByRole("link", { name: "Build an agent" })).toHaveAttribute("href", "/build");
    await expect(page.getByRole("link", { name: "Start a build" })).toHaveAttribute("href", "/build");
    await expect(page.getByText("Need one that is not here?")).toBeVisible();
  });

  test("tags cards with how they were built and an 80% budget badge", async ({ page }) => {
    await page.goto("/catalog");
    const cards = page.getByTestId("agent-card");
    await expect(cards).toHaveCount(5);

    await expect(cards.filter({ hasText: "Filings Analyst" }).getByText("Built with CLI")).toBeVisible();
    await expect(cards.filter({ hasText: "Policy Assistant" }).getByText("Built with Form")).toBeVisible();
    // Filings Analyst (82% spent) and Market Summary (at cap) carry the badge; no cost shows.
    await expect(page.getByText("80% budget")).toHaveCount(2);
    await expect(cards.filter({ hasText: "Policy Assistant" }).getByText("80% budget")).toHaveCount(0);
    await expect(page.getByText(/\$\d/)).toHaveCount(0);
  });

  test("copy agent confirms, and only the owner sees the evals link", async ({ page }) => {
    await page.goto("/catalog");
    const filings = page.getByTestId("agent-card").filter({ hasText: "Filings Analyst" });
    await filings.getByRole("button", { name: "Copy agent" }).click();
    await expect(filings.getByRole("button", { name: "Link copied" })).toBeVisible();

    await expect(page.getByRole("link", { name: "Evals and deploy" })).toHaveCount(0);
    await page
      .getByRole("group", { name: "Viewing as" })
      .getByRole("button", { name: "Builder" })
      .click();
    // Ben Builder owns Filings Analyst and PR Reviewer.
    await expect(page.getByRole("link", { name: "Evals and deploy" })).toHaveCount(2);
    await expect(filings.getByRole("link", { name: "Evals and deploy" })).toHaveAttribute(
      "href",
      /\/agents\/agt_.*\/evals$/
    );
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
