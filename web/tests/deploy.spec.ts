import { expect, test } from "@playwright/test";
import {
  AGENT_ID,
  actAs,
  agentDetail,
  apiError,
  blockedReport,
  deployedResponse,
  fakePlatformApi,
  LIVE,
  passingReport,
  version,
} from "./support/deploy-api";

const PAGE = `/agents/${AGENT_ID}/evals${LIVE}`;

test.describe("deploy and eval views", () => {
  test("a blocked version is marked with its score and threshold", async ({ page }) => {
    await fakePlatformApi(page, {
      agent: agentDetail([version(1, "deployed"), version(2, "blocked")], 1),
      report: blockedReport(2),
    });

    await page.goto(PAGE);
    await actAs(page, "Builder");

    await expect(page.getByRole("heading", { level: 1, name: "Filings Analyst" })).toBeVisible();
    await expect(page.getByText("v2 blocked")).toBeVisible();
    await expect(page.getByText("Eval score, v2 (needs 0.80)")).toBeVisible();

    const testRun = page.getByRole("region", { name: "Test run for v2" });
    await expect(testRun.getByText("Deploy blocked")).toBeVisible();

    const gate = page.getByRole("region", { name: "Deploy gate" });
    await expect(gate.getByText("0.67 / 0.80")).toBeVisible();
    await expect(gate).toContainText("v2 is blocked");
  });

  test("each test case shows its result and why it failed", async ({ page }) => {
    await fakePlatformApi(page, {
      agent: agentDetail([version(1, "deployed"), version(2, "blocked")], 1),
      report: blockedReport(2),
    });

    await page.goto(PAGE);
    await actAs(page, "Builder");

    const rows = page.getByRole("region", { name: "Test run for v2" }).getByRole("row");
    await expect(rows).toHaveCount(7); // header + 6 cases

    const passing = rows.filter({ hasText: "What revenue did Larkspur Widget Co. report" });
    await expect(passing.getByText("Pass", { exact: true })).toBeVisible();

    const missingFigure = rows.filter({ hasText: "Bramblewood Robotics' net income" });
    await expect(missingFigure.getByText("Fail", { exact: true })).toBeVisible();
    await expect(missingFigure.getByText("Missing “net loss”")).toBeVisible();

    const uncited = rows.filter({ hasText: "full-year revenue guidance" });
    await expect(uncited.getByText("Fail", { exact: true })).toBeVisible();
    await expect(uncited.getByText("No citation")).toBeVisible();

    await expect(page.getByText("4 of 6", { exact: true })).toBeVisible();
  });

  test("an admin overrides a blocked deploy only after giving a reason", async ({ page }) => {
    const agent = agentDetail([version(1, "deployed"), version(2, "blocked")], 1);
    const calls = await fakePlatformApi(page, {
      agent,
      report: blockedReport(2),
      deploy: ({ versionNumber, body }) => ({
        status: 200,
        body: deployedResponse(agent, versionNumber, {
          ...blockedReport(versionNumber),
          override_reason: body?.override_reason ?? null,
        }),
      }),
    });

    await page.goto(PAGE);
    await actAs(page, "Admin");

    const gate = page.getByRole("region", { name: "Deploy gate" });
    const submit = gate.getByRole("button", { name: "Deploy v2 anyway" });
    await expect(submit).toBeDisabled();

    const reason = gate.getByLabel("Reason for override");
    await reason.fill("   ");
    await expect(submit).toBeDisabled();

    const why = "Needed for the quarter-close demo; the uncited case is a known grader gap.";
    await reason.fill(why);
    await submit.click();

    await expect(page.getByText("Live · v2")).toBeVisible();
    await expect(page.getByRole("region", { name: "Test run for v2" })).toContainText(
      "Deployed by override"
    );
    await expect(gate).toContainText("an admin deployed v2 anyway");
    await expect(gate).toContainText(why);

    const deploys = calls.filter((c) => c.method === "POST");
    expect(deploys).toHaveLength(1);
    expect(deploys[0].path).toBe(`/v1/agents/${AGENT_ID}/versions/2/deploy`);
    expect(deploys[0].body).toEqual({ override_reason: why });
    expect(deploys[0].headers["x-user-id"]).toBe("usr_admin");
  });

  test("a failed override keeps the reason and says why", async ({ page }) => {
    await fakePlatformApi(page, {
      agent: agentDetail([version(1, "deployed"), version(2, "blocked")], 1),
      report: blockedReport(2),
      deploy: () =>
        apiError(409, "version_not_blocked", "Only a blocked version can be overridden"),
    });

    await page.goto(PAGE);
    await actAs(page, "Admin");

    const gate = page.getByRole("region", { name: "Deploy gate" });
    const reason = gate.getByLabel("Reason for override");
    await reason.fill("Ship it for the demo.");
    await gate.getByRole("button", { name: "Deploy v2 anyway" }).click();

    await expect(gate.getByRole("alert")).toHaveText("Only a blocked version can be overridden");
    await expect(reason).toHaveValue("Ship it for the demo.");
    await expect(gate.getByRole("button", { name: "Deploy v2 anyway" })).toBeEnabled();
    await expect(page.getByText("Live · v1")).toBeVisible();
  });

  test("the owner sees the block but cannot override it", async ({ page }) => {
    await fakePlatformApi(page, {
      agent: agentDetail([version(1, "deployed"), version(2, "blocked")], 1),
      report: blockedReport(2),
    });

    await page.goto(PAGE);
    await actAs(page, "Builder");

    const gate = page.getByRole("region", { name: "Deploy gate" });
    await expect(gate).toContainText("An admin can deploy it anyway with a written reason.");
    await expect(gate.getByLabel("Reason for override")).toHaveCount(0);
  });

  test("the owner deploys a draft and sees the gate block it", async ({ page }) => {
    const agent = agentDetail([version(1, "deployed"), version(2, "draft")], 1);
    const calls = await fakePlatformApi(page, {
      agent,
      report: passingReport(1),
      deploy: ({ versionNumber }) => ({
        status: 200,
        // RUNTIME-PLACEHOLDER(#26): stands in for the time a real eval run takes.
        delayMs: 400,
        body: {
          ...agent,
          versions: [version(1, "deployed"), version(2, "blocked")],
          eval_report: blockedReport(versionNumber),
        },
      }),
    });

    await page.goto(PAGE);
    await actAs(page, "Builder");
    await expect(page.getByText("v2 draft")).toBeVisible();
    await expect(page.getByRole("region", { name: "Test run for v1" })).toBeVisible();

    await page.getByRole("button", { name: "Deploy v2" }).click();
    await expect(page.getByRole("button", { name: "Running test cases…" })).toBeDisabled();

    await expect(page.getByText("v2 blocked")).toBeVisible();
    await expect(page.getByRole("region", { name: "Test run for v2" })).toContainText(
      "Deploy blocked"
    );
    await expect(page.getByRole("region", { name: "Deploy gate" })).toContainText("0.67 / 0.80");

    const deploys = calls.filter((c) => c.method === "POST");
    expect(deploys).toHaveLength(1);
    expect(deploys[0].path).toBe(`/v1/agents/${AGENT_ID}/versions/2/deploy`);
    expect(deploys[0].body).toEqual({});
    expect(deploys[0].headers["x-user-id"]).toBe("usr_builder");
  });

  test("the versions tab lists every version with its status", async ({ page }) => {
    await fakePlatformApi(page, {
      agent: agentDetail(
        [
          version(1, "deployed"),
          version(2, "deployed"),
          version(3, "blocked"),
          version(4, "draft"),
        ],
        2
      ),
      report: blockedReport(3),
    });

    await page.goto(PAGE);
    await actAs(page, "Builder");
    await page.getByRole("tab", { name: "Versions" }).click();

    const rows = page.getByRole("region", { name: "Versions" }).getByRole("row");
    await expect(rows).toHaveCount(5); // header + 4 versions

    const v3 = rows.filter({ hasText: "v3" });
    await expect(v3.getByText("Blocked", { exact: true })).toBeVisible();
    await expect(v3.getByText("0.67 / 0.80")).toBeVisible();

    await expect(rows.filter({ hasText: "v4" }).getByText("Draft", { exact: true })).toBeVisible();
    await expect(rows.filter({ hasText: "v2" }).getByText("Live", { exact: true })).toBeVisible();
    await expect(
      rows.filter({ hasText: "v1" }).getByText("Deployed", { exact: true })
    ).toBeVisible();
  });

  test("shows a loading state while the agent loads", async ({ page }) => {
    await fakePlatformApi(page, {
      agent: {
        status: 200,
        delayMs: 1_000,
        body: agentDetail([version(1, "deployed"), version(2, "blocked")], 1),
      },
      report: blockedReport(2),
    });

    await page.goto(PAGE);
    await actAs(page, "Builder");

    await expect(page.getByLabel("Loading agent")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Filings Analyst" })).toBeVisible();
    await expect(page.getByLabel("Loading agent")).toHaveCount(0);
  });

  test("shows an empty state before the first test run", async ({ page }) => {
    await fakePlatformApi(page, {
      agent: agentDetail([version(1, "draft")], null),
      report: null,
    });

    await page.goto(PAGE);
    await actAs(page, "Builder");

    await expect(page.getByText("Not live", { exact: true })).toBeVisible();
    await expect(page.getByText("No test run yet.")).toBeVisible();
    await expect(page.getByRole("region", { name: "Deploy gate" })).toContainText(
      "v1 needs 0.80 to go live"
    );
    await expect(page.getByRole("button", { name: "Deploy v1" })).toBeVisible();
  });

  test("shows an error state with a working retry", async ({ page }) => {
    let serverDown = true;
    await fakePlatformApi(page, {
      agent: () =>
        serverDown
          ? apiError(500, "internal_error", "Something went wrong on our side.")
          : agentDetail([version(1, "deployed"), version(2, "blocked")], 1),
      report: blockedReport(2),
    });

    await page.goto(PAGE);
    await actAs(page, "Builder");

    const alert = page.getByRole("main").getByRole("alert");
    await expect(alert).toContainText("Couldn't load this agent.");
    await expect(alert).toContainText("Something went wrong on our side.");

    serverDown = false;
    await alert.getByRole("button", { name: "Retry" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Filings Analyst" })).toBeVisible();
  });
});

// Screenshots checked against docs/design/owner_view_evals_and_deploy.png.
test.describe("deploy and eval views: screenshots", () => {
  test("owner view of a passing test run", async ({ page }) => {
    await fakePlatformApi(page, {
      agent: agentDetail([version(1, "deployed"), version(2, "draft")], 1),
      report: passingReport(1),
    });

    await page.goto(PAGE);
    await actAs(page, "Builder");
    await expect(page.getByRole("region", { name: "Test run for v1" })).toContainText(
      "Deploy allowed"
    );
    await page.screenshot({ path: "tests/__screenshots__/deploy-evals.png", fullPage: true });
  });

  test("admin view of a blocked deploy with an override reason", async ({ page }) => {
    await fakePlatformApi(page, {
      agent: agentDetail([version(1, "deployed"), version(2, "blocked")], 1),
      report: blockedReport(2),
    });

    await page.goto(PAGE);
    await actAs(page, "Admin");
    await page
      .getByLabel("Reason for override")
      .fill("Needed for the quarter-close demo; the uncited case is a known grader gap.");
    await expect(page.getByRole("button", { name: "Deploy v2 anyway" })).toBeEnabled();
    await page.screenshot({ path: "tests/__screenshots__/deploy-override.png", fullPage: true });
  });

  test("versions tab", async ({ page }) => {
    await fakePlatformApi(page, {
      agent: agentDetail(
        [version(1, "deployed"), version(2, "deployed"), version(3, "blocked")],
        2
      ),
      report: blockedReport(3),
    });

    await page.goto(PAGE);
    await actAs(page, "Builder");
    await page.getByRole("tab", { name: "Versions" }).click();
    await expect(page.getByRole("region", { name: "Versions" })).toBeVisible();
    await page.screenshot({ path: "tests/__screenshots__/deploy-versions.png", fullPage: true });
  });
});
