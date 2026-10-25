import { expect, test, type Page } from "@playwright/test";
import {
  AGENT_ID,
  actAs as actAsDeploy,
  agentDetail,
  blockedReport,
  deployedResponse,
  fakePlatformApi,
  version,
} from "./support/deploy-api";

// Demo rehearsal (#33) in mock mode: the four flows the demo shows, run end
// to end against the mock layer, with a screenshot at each step
// (tests/__screenshots__/demo-*.png) to check against docs/design/ and
// docs/design/foundry/. When the runtime lands (#57), the same flows are
// rehearsed live by pointing the app at the backend; see web/RUNTIME-HANDOFF.md.
//
// RUNTIME-PLACEHOLDER(#26): flow (c) fakes the eval-report and deploy endpoints with the Playwright network fake, as the deploy spec does.

const SHOT = (name: string) => ({ path: `tests/__screenshots__/demo-${name}.png` });

async function actAs(page: Page, role: "Admin" | "Builder" | "End user") {
  const button = page
    .getByRole("group", { name: "Viewing as" })
    .getByRole("button", { name: role });
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
}

async function openChat(page: Page, query: string) {
  await page.goto(`/chat?fastStream=1&${query}`);
  await expect(page.getByRole("button", { name: /Acme revenue by segment/ })).toBeVisible();
}

async function ask(page: Page, text: string) {
  await page.getByLabel("Ask Filings Analyst").fill(text);
  await page.getByRole("button", { name: "Send" }).click();
}

test.describe("demo rehearsal (mock mode)", () => {
  test("a. chat with an approval: approve path", async ({ page }) => {
    await openChat(page, "");
    await page.screenshot(SHOT("a1-chat"));

    await page.getByRole("button", { name: "New chat" }).click();
    await ask(page, "Save a note that Acme's cloud revenue grew 18%");
    const card = page.getByRole("region", { name: "Save a note?" });
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card.getByTestId("approval-tool-call")).toContainText("save_note");
    await page.screenshot(SHOT("a2-approval-card"));

    await card.getByRole("button", { name: "Approve and save" }).click();
    await expect(card.getByText("Approved", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Done. I saved the note about Acme's 18% cloud revenue growth.", {
        exact: true,
      })
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByLabel("Ask Filings Analyst")).toBeEnabled();
    await page.screenshot(SHOT("a3-approved"));
  });

  test("a. chat with an approval: reject path", async ({ page }) => {
    await openChat(page, "");
    await page.getByRole("button", { name: "New chat" }).click();
    await ask(page, "Save a note that Acme's cloud revenue grew 18%");
    const card = page.getByRole("region", { name: "Save a note?" });
    await expect(card).toBeVisible({ timeout: 15_000 });

    await card.getByRole("button", { name: "Reject" }).click();
    await expect(card.getByText("Rejected", { exact: true })).toBeVisible();
    await expect(
      page.getByText(
        "Okay, I didn't save the note. The figures above are still here if you need them.",
        { exact: true }
      )
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Saved note|Saving note/)).toHaveCount(0);
    await page.screenshot(SHOT("a4-rejected"));
  });

  test("b. budget ladder: 80% warning, pause, admin approve, Continue", async ({
    page,
    context,
  }) => {
    await openChat(page, "budget=warned");
    const banner = page.getByTestId("budget-warning");
    await expect(banner).toContainText("Filings Analyst is close to its usage limit.");
    await expect(banner).not.toContainText(/\$|%|\d/);
    await page.screenshot(SHOT("b1-warning"));

    // The next run crosses the cap and the agent pauses.
    await page.getByRole("button", { name: "New chat" }).click();
    await ask(page, "trigger: budget");
    const paused = page.getByTestId("budget-paused");
    await expect(paused.getByRole("heading", { name: "This agent is paused" })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByLabel("Ask Filings Analyst")).toBeDisabled();
    await page.screenshot(SHOT("b2-paused"));

    // An admin approves more spend in another tab.
    const admin = await context.newPage();
    await admin.goto("/admin/budgets");
    await actAs(admin, "Admin");
    const row = admin.getByTestId("budget-row").filter({ hasText: "Filings Analyst" });
    await expect(row).toHaveAttribute("data-state", "paused");
    await admin.screenshot({ ...SHOT("b3-admin-budgets-paused"), fullPage: true });
    await row.getByRole("button", { name: "Approve and resume" }).click();
    await expect(row).toHaveAttribute("data-state", "ok");
    await admin.screenshot({ ...SHOT("b4-admin-budgets-approved"), fullPage: true });
    await admin.close();

    await expect(paused.getByRole("heading", { name: "More spend approved" })).toBeVisible();
    await paused.getByRole("button", { name: "Continue" }).click();
    await expect(
      page.getByText("Acme's cloud revenue grew 18% in fiscal 2025, to $2.1B.", { exact: true })
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("budget-paused")).toHaveCount(0);
    await expect(page.getByLabel("Ask Filings Analyst")).toBeEnabled();
    await page.screenshot(SHOT("b5-continued"));
  });

  test("c. blocked deploy: an admin overrides it only with a reason", async ({ page }) => {
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

    await page.goto(`/agents/${AGENT_ID}/evals`);
    await actAsDeploy(page, "Admin");
    const gate = page.getByRole("region", { name: "Deploy gate" });
    await expect(gate).toContainText("v2 is blocked");
    await page.screenshot({ ...SHOT("c1-blocked"), fullPage: true });

    const submit = gate.getByRole("button", { name: "Deploy v2 anyway" });
    await expect(submit).toBeDisabled();
    const why = "Needed for the quarter-close demo; the uncited case is a known grader gap.";
    await gate.getByLabel("Reason for override").fill(why);
    await expect(submit).toBeEnabled();
    await page.screenshot({ ...SHOT("c2-override-reason"), fullPage: true });

    await submit.click();
    await expect(page.getByText("Live · v2")).toBeVisible();
    await expect(gate).toContainText(why);
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
    await page.screenshot({ ...SHOT("c3-deployed"), fullPage: true });
  });

  test("d. flag: streamed re-check, then the ticket shows up for the admin", async ({
    page,
  }) => {
    // Real stream speed so the "re-checking" state lasts long enough to see.
    await page.goto("/chat");
    const flagged = page
      .getByTestId("assistant-message")
      .filter({ hasText: "Operating margin was 21.4%, up from 19.8% in fiscal 2024." })
      .first();
    await expect(flagged).toBeVisible();
    await page.screenshot(SHOT("d1-chat-before-flag"));

    await flagged.getByRole("button", { name: "Flag" }).click();
    await expect(flagged.getByText("Re-checking", { exact: true })).toBeVisible();
    await page.screenshot(SHOT("d2-rechecking"));

    const recheck = flagged.locator("xpath=following-sibling::div[1]");
    await expect(recheck.getByText(/I checked this against the filing again/)).toBeVisible({
      timeout: 15_000,
    });
    await expect(flagged.getByText("Re-check done", { exact: true })).toBeVisible();
    await page.screenshot(SHOT("d3-rechecked"));

    // The flag filed a ticket: the admin sees it, with its re-check attached.
    await page.goto("/admin/tickets");
    await actAs(page, "Admin");
    const ticket = page.getByRole("listitem", { name: "And what about operating margin?" });
    await expect(ticket).toBeVisible();
    await expect(ticket).toContainText("Filings Analyst · from Eli End User");
    await expect(ticket).toContainText("Re-check done");
    await expect(ticket.getByRole("button", { name: "Resolve" })).toBeVisible();
    await expect(ticket.getByRole("button", { name: "Save as test case" })).toBeVisible();
    await page.screenshot({ ...SHOT("d4-admin-tickets"), fullPage: true });
  });
});
