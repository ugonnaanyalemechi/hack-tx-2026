import { expect, test, type Page } from "@playwright/test";

async function actAs(page: Page, role: "Admin" | "Builder" | "End user") {
  const button = page
    .getByRole("group", { name: "Viewing as" })
    .getByRole("button", { name: role });
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
}

const runsTable = (page: Page) => page.getByRole("table", { name: "Runs" });
const runRow = (page: Page, shortRunId: string) =>
  runsTable(page).getByRole("row").filter({ hasText: shortRunId });
const detail = (page: Page) => page.getByRole("region", { name: /^Run run_/ });

test.describe("run log", () => {
  test("an admin sees every run with its agent, user, entry point, status, time and cost", async ({
    page,
  }) => {
    await page.goto("/admin/runs");
    await actAs(page, "Admin");

    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "Every call, in order."
    );
    await expect(
      runsTable(page).getByRole("columnheader", { name: "Cost" })
    ).toBeVisible();

    const row = runRow(page, "run_8f2a");
    await expect(row).toContainText("Filings Analyst");
    await expect(row).toContainText("Eli End User");
    await expect(row).toContainText("Chat");
    await expect(row).toContainText("Completed");
    await expect(row).toContainText("4.1s");
    // 2,140 in + 96 out, then 9,840 in + 2,048 cached + 312 out, at
    // $0.75 / $0.075 / $3.75 per million tokens: $0.010669.
    await expect(row).toContainText("$0.011");

    await expect(runRow(page, "run_8f29")).toContainText("Awaiting approval");
    await expect(runRow(page, "run_8f28")).toContainText("Paused");
    await expect(runRow(page, "run_8f25")).toContainText("Failed");
    await expect(runRow(page, "run_8f27")).toContainText("API");
  });

  test("opening a run lists its steps in order with timing, tokens and cost", async ({
    page,
  }) => {
    await page.goto("/admin/runs");
    await actAs(page, "Admin");

    await runRow(page, "run_8f2a").click();
    await expect(page).toHaveURL(/[?&]run=run_8f2a/);
    await expect(runRow(page, "run_8f2a")).toHaveAttribute("aria-current", "true");

    const panel = detail(page);
    await expect(panel.getByRole("heading", { name: "run_8f2a" })).toBeVisible();
    const steps = panel.getByRole("listitem");
    await expect(steps).toHaveCount(4);

    await expect(steps.nth(0)).toContainText("Model call");
    await expect(steps.nth(0)).toContainText("2,140 in · 96 out");
    await expect(steps.nth(0)).toContainText("0.9s");
    await expect(steps.nth(0)).toContainText("$0.002");

    await expect(steps.nth(1)).toContainText("Tool: lookup_filing");
    await expect(steps.nth(1)).toContainText("1.1s");

    await expect(steps.nth(2)).toContainText("9,840 in · 2,048 cached · 312 out");
    await expect(steps.nth(2)).toContainText("$0.009");

    await expect(steps.nth(3)).toContainText("Guardrail: strip_secrets");

    await page.screenshot({
      path: "tests/__screenshots__/admin-run-log.png",
      fullPage: false,
    });
  });

  test("approval steps show who decided and when", async ({ page }) => {
    await page.goto("/admin/runs");
    await actAs(page, "Admin");
    await runRow(page, "run_8f26").click();

    const approval = detail(page)
      .getByRole("listitem")
      .filter({ hasText: "Approval: save_note" });
    await expect(approval).toContainText("Approved by Eli End User");
    await expect(approval).toContainText("Oct 25, 09:18 UTC");

    await runRow(page, "run_8f29").click();
    await expect(
      detail(page).getByRole("listitem").filter({ hasText: "Approval: create_issue" })
    ).toContainText("Waiting for a decision");
  });

  test("a failed step shows its error", async ({ page }) => {
    await page.goto("/admin/runs");
    await actAs(page, "Admin");
    await runRow(page, "run_8f25").click();
    await expect(detail(page)).toContainText(
      "upstream_timeout: the model provider timed out"
    );
  });

  test("a run can be opened from a link", async ({ page }) => {
    await page.goto("/admin/runs");
    await actAs(page, "Admin");
    await page.goto("/admin/runs?run=run_8f27c1e7a3d9b5f2c4e6a8d0b1f3c5e7");
    await expect(detail(page).getByRole("heading", { name: "run_8f27" })).toBeVisible();
    await expect(detail(page)).toContainText("Policy Assistant");
  });

  test("filters by agent and to errors only", async ({ page }) => {
    await page.goto("/admin/runs");
    await actAs(page, "Admin");
    await expect(runRow(page, "run_8f27")).toBeVisible();

    await page.getByRole("button", { name: "PR Reviewer", exact: true }).click();
    await expect(runRow(page, "run_8f29")).toBeVisible();
    const agentCells = runsTable(page).getByRole("row").locator("td:nth-child(2)");
    await expect(agentCells.first()).toHaveText("PR Reviewer");
    for (const text of await agentCells.allTextContents()) {
      expect(text).toBe("PR Reviewer");
    }

    await page.getByRole("button", { name: "All agents" }).click();
    await page.getByRole("button", { name: "Errors only" }).click();
    await expect(runRow(page, "run_8f25")).toBeVisible();
    for (const text of await runsTable(page)
      .getByRole("row")
      .locator("td:nth-child(5)")
      .allTextContents()) {
      expect(text).toBe("Failed");
    }
  });

  test("pages through older runs", async ({ page }) => {
    await page.goto("/admin/runs");
    await actAs(page, "Admin");
    const bodyRows = runsTable(page).locator("tbody tr");
    await expect(bodyRows).toHaveCount(20);
    await page.getByRole("button", { name: "Load more" }).click();
    await expect.poll(() => bodyRows.count()).toBeGreaterThan(20);
  });

  test("a builder sees only the runs of agents they own", async ({ page }) => {
    await page.goto("/admin/runs");
    await actAs(page, "Builder");

    await expect(runRow(page, "run_8f2a")).toContainText("Filings Analyst");
    await expect(runRow(page, "run_8f29")).toContainText("PR Reviewer");
    await expect(runsTable(page)).not.toContainText("Policy Assistant");
    await expect(runsTable(page)).not.toContainText("Market Summary");
    await expect(
      runsTable(page).getByRole("columnheader", { name: "Cost" })
    ).toBeVisible();
  });

  test("an end user gets no run log and no cost figures", async ({ page }) => {
    await page.goto("/admin/runs");
    await expect(
      page.getByText("The run log is for admins and agent owners.")
    ).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(0);
    await expect(page.getByText(/\$\d/)).toHaveCount(0);
  });

  test("shows loading, empty and error states", async ({ page }) => {
    await page.goto("/admin/runs?mock=loading");
    await actAs(page, "Admin");
    await expect(page.getByLabel("Loading runs")).toBeVisible();

    await page.goto("/admin/runs?mock=empty");
    await expect(page.getByText("No runs yet.")).toBeVisible();

    await page.goto("/admin/runs?mock=error");
    await expect(
      page.getByRole("alert").filter({ hasText: "Couldn't load the run log." })
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
  });
});
