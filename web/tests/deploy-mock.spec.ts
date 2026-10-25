/**
 * The deploy and eval views on the mock client (the default mode), with no
 * backend and no network fake: versions, eval reports and the deploy gate
 * come from `lib/api/mock-deploy.ts`. Screenshots are checked against
 * docs/design/owner_view_evals_and_deploy.png.
 */

import { expect, test } from "@playwright/test";
import { actAs } from "./support/deploy-api";

const FILINGS = "agt_1c7e4f0a9b2d4e6f8a1b3c5d7e9f0a2b";
const POLICY = "agt_2d8f5a1b0c3e4f7a9b2c4d6e8f0a1b3c";
const CREDIT = "agt_6b2d9e5f4a7c8d1e3f6a8b0c2d4e5f7a";

test.describe("deploy and eval views on mock data", () => {
  test("the owner sees the latest test run and deploys v4 through the gate", async ({ page }) => {
    await page.goto(`/agents/${FILINGS}/evals`);
    await actAs(page, "Builder");

    await expect(page.getByRole("heading", { level: 1, name: "Filings Analyst" })).toBeVisible();
    await expect(page.getByText("Live · v3")).toBeVisible();
    await expect(page.getByText("Eval score, v4 (needs 0.85)")).toBeVisible();
    await expect(page.getByText("11 of 12", { exact: true })).toBeVisible();
    const testRun = page.getByRole("region", { name: "Test run for v4" });
    await expect(testRun).toContainText("Deploy allowed");
    await expect(testRun.getByText("Debt maturity ladder totals correctly")).toBeVisible();
    await page.screenshot({ path: "tests/__screenshots__/deploy-mock-owner.png", fullPage: true });

    await page.getByRole("button", { name: "Deploy v4" }).click();
    await expect(page.getByRole("button", { name: "Running test cases…" })).toBeDisabled();
    await expect(page.getByText("Live · v4")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Deploy v4/ })).toHaveCount(0);
  });

  test("a blocked version shows 0.78 against 0.85 and only an admin can override it", async ({
    page,
  }) => {
    await page.goto(`/agents/${POLICY}/evals`);
    await actAs(page, "Admin");

    await expect(page.getByText("v5 blocked")).toBeVisible();
    await expect(page.getByText("Eval score, v5 (needs 0.85)")).toBeVisible();
    const gate = page.getByRole("region", { name: "Deploy gate" });
    await expect(gate).toContainText("0.78 / 0.85");

    const submit = gate.getByRole("button", { name: "Deploy v5 anyway" });
    await expect(submit).toBeDisabled();
    await gate.getByLabel("Reason for override").fill("Quarter-close demo; the gap is a grader issue.");
    await page.screenshot({ path: "tests/__screenshots__/deploy-mock-override.png", fullPage: true });
    await submit.click();

    await expect(page.getByText("Live · v5")).toBeVisible();
    await expect(page.getByRole("region", { name: "Test run for v5" })).toContainText(
      "Deployed by override"
    );
    await expect(gate).toContainText("Quarter-close demo");

    // The admin queue no longer lists the blocked deploy. Navigate in the
    // app: a full reload would reset the mock's in-memory state.
    await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Admin" }).click();
    await expect(page.getByTestId("queue-blocked")).toHaveText("0");
  });

  test("the versions tab gives every version its own score, including the blocked one", async ({
    page,
  }) => {
    await page.goto(`/agents/${POLICY}/evals`);
    await actAs(page, "Builder");
    // Policy Assistant belongs to the other builder; any signed-in user may read it.
    await page.getByRole("tab", { name: "Versions" }).click();

    const rows = page.getByRole("region", { name: "Versions" }).getByRole("row");
    await expect(rows).toHaveCount(6); // header + 5 versions
    await expect(rows.filter({ hasText: "v5" })).toContainText("Blocked");
    await expect(rows.filter({ hasText: "v5" })).toContainText("0.78 / 0.85");
    await expect(rows.filter({ hasText: "v4" })).toContainText("Live");
    await expect(rows.filter({ hasText: "v4" })).toContainText("0.88 / 0.85");
    await expect(rows.filter({ hasText: "v1" })).toContainText("0.85 / 0.85");
    await page.screenshot({ path: "tests/__screenshots__/deploy-mock-versions.png", fullPage: true });
  });

  test("a first deploy that scores under the threshold is blocked", async ({ page }) => {
    await page.goto(`/agents/${CREDIT}/evals`);
    await actAs(page, "Builder");

    await expect(page.getByText("No test run yet.")).toBeVisible();
    await page.getByRole("button", { name: "Deploy v1" }).click();

    await expect(page.getByText("v1 blocked")).toBeVisible();
    await expect(page.getByRole("region", { name: "Deploy gate" })).toContainText("0.72 / 0.85");
    // The owner cannot override; an admin has to.
    await expect(page.getByLabel("Reason for override")).toHaveCount(0);
  });

  test("shows loading, empty and error states", async ({ page }) => {
    await page.goto(`/agents/${FILINGS}/evals?mock=loading`);
    await actAs(page, "Builder");
    await expect(page.getByLabel("Loading agent")).toBeVisible();

    await page.goto(`/agents/${FILINGS}/evals?mock=empty`);
    await expect(page.getByText("No versions yet.")).toBeVisible();

    await page.goto(`/agents/${FILINGS}/evals?mock=error`);
    await expect(page.getByRole("main").getByRole("alert")).toContainText("Couldn't load this agent.");
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
  });
});
