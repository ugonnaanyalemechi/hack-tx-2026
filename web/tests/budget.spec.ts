import { expect, test, type Page } from "@playwright/test";

// The budget ladder UI (#23): the 80% warning, the paused state with the
// saved chat still visible, Continue after approval, the 409 conflict, and
// the admin's one-click approve. Chat behaviour is driven by the mock layer
// (lib/mock-chat.ts, lib/api/mock-budgets.ts); `?budget=` sets the mock
// agent's spend and "trigger: budget" makes a run hit the cap.

async function actAs(page: Page, role: "Admin" | "Builder" | "End user") {
  const button = page
    .getByRole("group", { name: "Viewing as" })
    .getByRole("button", { name: role });
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
}

async function openChat(page: Page, budget: "ok" | "warned" | "paused") {
  await page.goto(`/chat?fastStream=1&budget=${budget}`);
  await expect(page.getByRole("button", { name: /Acme revenue by segment/ })).toBeVisible();
}

async function sendMessage(page: Page, text: string) {
  await page.getByLabel("Ask Filings Analyst").fill(text);
  await page.getByRole("button", { name: "Send" }).click();
}

test.describe("budget warning (end user)", () => {
  test("shows a warning at 80% with no cost figures, and the chat still works", async ({
    page,
  }) => {
    await openChat(page, "warned");

    const banner = page.getByTestId("budget-warning");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("Filings Analyst is close to its usage limit.");
    // End users never see money or percentages of it.
    await expect(banner).not.toContainText(/\$|%|\d/);

    await expect(page.getByLabel("Ask Filings Analyst")).toBeEnabled();
    await expect(page.getByTestId("budget-paused")).toHaveCount(0);
    // The saved conversation is intact.
    await expect(page.getByText("Acme reported $4.2B in fiscal 2025 revenue")).toBeVisible();

    await page.screenshot({ path: "tests/__screenshots__/budget-warning.png" });
  });

  test("shows no banner while the agent is under its warning level", async ({ page }) => {
    await openChat(page, "ok");
    await expect(page.getByTestId("budget-warning")).toHaveCount(0);
  });
});

test.describe("budget paused (end user)", () => {
  test("shows the paused card under the saved chat and holds the composer", async ({ page }) => {
    await openChat(page, "paused");

    const card = page.getByTestId("budget-paused");
    await expect(card.getByRole("heading", { name: "This agent is paused" })).toBeVisible();
    await expect(card.getByText("Waiting for an admin")).toBeVisible();
    await expect(
      card.getByText(
        "Your progress is saved. An admin needs to approve before Filings Analyst can carry on, and your chat will pick up where it stopped."
      )
    ).toBeVisible();
    await expect(card.getByText("Other chats with this agent are paused too.")).toBeVisible();
    await expect(card.getByRole("button", { name: "Continue" })).toBeEnabled();
    await expect(card).not.toContainText("$");

    // The saved conversation stays on screen, and the chat is marked paused.
    await expect(page.getByText("Acme reported $4.2B in fiscal 2025 revenue")).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Acme revenue by segment/ }).getByText("Paused")
    ).toBeVisible();

    const input = page.getByLabel("Ask Filings Analyst");
    await expect(input).toBeDisabled();
    await expect(input).toHaveAttribute("placeholder", "Paused, waiting for an admin");
    await expect(page.getByTestId("budget-warning")).toHaveCount(0);

    await page.screenshot({ path: "tests/__screenshots__/budget-paused.png" });
  });

  test("Continue before approval says so and loses nothing", async ({ page }) => {
    await openChat(page, "paused");
    const card = page.getByTestId("budget-paused");

    await card.getByRole("button", { name: "Continue" }).click();

    await expect(card.getByTestId("budget-continue-notice")).toHaveText(
      "Still waiting for an admin to approve more. Your chat is saved."
    );
    await expect(card.getByRole("button", { name: "Continue" })).toBeEnabled();
    await expect(page.getByText("Acme reported $4.2B in fiscal 2025 revenue")).toBeVisible();
    await expect(page.getByLabel("Ask Filings Analyst")).toBeDisabled();
  });

  test("a run that hits the cap pauses with its message kept, then Continue resumes it once an admin approves", async ({
    page,
    context,
  }) => {
    await openChat(page, "ok");
    await page.getByRole("button", { name: "New chat" }).click();
    await sendMessage(page, "trigger: budget");

    const card = page.getByTestId("budget-paused");
    await expect(card.getByRole("heading", { name: "This agent is paused" })).toBeVisible({
      timeout: 15_000,
    });
    // The question and the unfinished tool call are still on screen.
    await expect(page.getByTestId("user-message").getByText("trigger: budget")).toBeVisible();
    await expect(page.getByText("Searching filings…")).toBeVisible();
    await expect(page.getByLabel("Ask Filings Analyst")).toBeDisabled();

    // An admin approves in another tab.
    const admin = await context.newPage();
    await admin.goto("/admin/budgets");
    await actAs(admin, "Admin");
    const row = admin.getByTestId("budget-row").filter({ hasText: "Filings Analyst" });
    await expect(row).toHaveAttribute("data-state", "paused");
    await row.getByRole("button", { name: "Approve and resume" }).click();
    await expect(row).toHaveAttribute("data-state", "ok");
    await admin.close();

    // The chat learns of it and offers Continue.
    await expect(card.getByRole("heading", { name: "More spend approved" })).toBeVisible();
    await expect(card.getByText("Ready to continue")).toBeVisible();
    await page.screenshot({ path: "tests/__screenshots__/budget-continue.png" });

    await card.getByRole("button", { name: "Continue" }).click();

    await expect(
      page.getByText("Acme's cloud revenue grew 18% in fiscal 2025, to $2.1B.", { exact: true })
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("budget-paused")).toHaveCount(0);
    await expect(page.getByTestId("user-message").getByText("trigger: budget")).toBeVisible();
    await expect(page.getByLabel("Ask Filings Analyst")).toBeEnabled();
  });

  test("a 409 on send keeps the message and the chat, and shows the paused card", async ({
    page,
  }) => {
    await openChat(page, "ok");

    // The agent hits its cap elsewhere, without this tab being told yet.
    await page.evaluate(() => {
      const key = "foundry.mock-budgets";
      const store = JSON.parse(window.localStorage.getItem(key) ?? "{}") as Record<
        string,
        { cap: number; extra: number; spent: number }
      >;
      for (const id of Object.keys(store)) {
        if (id.startsWith("agt_1c7e")) store[id].spent = store[id].cap + store[id].extra;
      }
      window.localStorage.setItem(key, JSON.stringify(store));
    });

    await sendMessage(page, "What about operating margin this quarter?");

    const card = page.getByTestId("budget-paused");
    await expect(card.getByRole("heading", { name: "This agent is paused" })).toBeVisible();
    // The message the user sent and the earlier conversation both remain.
    await expect(
      page.getByTestId("user-message").getByText("What about operating margin this quarter?")
    ).toBeVisible();
    await expect(page.getByText("Acme reported $4.2B in fiscal 2025 revenue")).toBeVisible();
    await expect(page.getByLabel("Ask Filings Analyst")).toBeDisabled();
  });
});

test.describe("admin budgets", () => {
  test("lists every agent's budget and approves a paused one in one click", async ({ page }) => {
    await page.goto("/admin/budgets");
    await actAs(page, "Admin");

    await expect(page.getByRole("heading", { level: 1 })).toContainText("Who is near the limit.");
    const rows = page.getByTestId("budget-row");
    await expect(rows).toHaveCount(5);

    const market = rows.filter({ hasText: "Market Summary" });
    await expect(market).toHaveAttribute("data-state", "paused");
    await expect(market).toContainText("$50.00 of $50.00 · every chat is paused");
    await expect(rows.filter({ hasText: "Filings Analyst" })).toContainText("82% warning");
    await expect(rows.filter({ hasText: "PR Reviewer" })).toContainText("On track");
    await expect(page.getByTestId("stat-paused")).toHaveText("1");
    await expect(page.getByTestId("stat-warned")).toHaveText("1");

    await page.screenshot({ path: "tests/__screenshots__/admin-budgets.png" });

    await market.getByRole("button", { name: "Approve and resume Market Summary" }).click();

    await expect(market).toHaveAttribute("data-state", "ok");
    await expect(market).toContainText("$50.00 of $100.00 · $50.00 extra approved");
    await expect(market).toContainText("On track");
    await expect(market.getByRole("button")).toHaveCount(0);
    await expect(page.getByTestId("stat-paused")).toHaveText("0");

    await page.screenshot({ path: "tests/__screenshots__/admin-budgets-approved.png" });
  });

  test("is not for builders or end users", async ({ page }) => {
    await page.goto("/admin/budgets");
    await actAs(page, "Builder");
    await expect(page.getByText("Budgets are for admins.").first()).toBeVisible();
    await expect(page.getByTestId("budget-row")).toHaveCount(0);

    await actAs(page, "End user");
    await expect(page.getByText("Budgets are for admins.").first()).toBeVisible();
  });

  test("shows loading, empty and error states", async ({ page }) => {
    await page.goto("/admin/budgets?mock=loading");
    await actAs(page, "Admin");
    await expect(page.getByLabel("Loading budgets")).toBeVisible();

    await page.goto("/admin/budgets?mock=empty");
    await expect(page.getByText("No budgets yet.")).toBeVisible();

    await page.goto("/admin/budgets?mock=error");
    await expect(page.getByRole("alert").filter({ hasText: "Couldn't load budgets." })).toBeVisible();
  });
});

test.describe("budget endpoints through the live client", () => {
  test("approve posts to the agent's budget endpoint as the admin and updates the row", async ({
    page,
  }) => {
    const users = [
      { id: "usr_admin", name: "Ada Admin", role: "admin" },
      { id: "usr_end_user", name: "Eli End User", role: "end_user" },
    ];
    const budget = (state: "paused" | "ok", extra: string) => ({
      agent_id: "agt_live",
      agent_name: "Filings Analyst",
      period_start: "2026-10-01T00:00:00Z",
      cap: "50.000000",
      warning_fraction: 0.8,
      extra_allowance: extra,
      cap_total: state === "paused" ? "50.000000" : "100.000000",
      spent: "50.000000",
      state,
      updated_at: "2026-10-25T12:00:00Z",
    });
    const posts: { userId: string | undefined; body: string | null }[] = [];

    await page.route(
      (url) => url.pathname === "/api/v1/users",
      (route) => route.fulfill({ json: users })
    );
    await page.route(
      (url) => url.pathname === "/api/v1/admin/budgets",
      (route) => route.fulfill({ json: { items: [budget("paused", "0.000000")] } })
    );
    await page.route(
      (url) => url.pathname === "/api/v1/agents/agt_live/budget/approve",
      (route) => {
        posts.push({
          userId: route.request().headers()["x-user-id"],
          body: route.request().postData(),
        });
        return route.fulfill({ json: budget("ok", "50.000000") });
      }
    );

    await page.goto("/admin/budgets?api=live");
    await actAs(page, "Admin");
    const row = page.getByTestId("budget-row");
    await expect(row).toHaveAttribute("data-state", "paused");
    await row.getByRole("button", { name: "Approve and resume" }).click();

    await expect(row).toHaveAttribute("data-state", "ok");
    expect(posts).toHaveLength(1);
    expect(posts[0].userId).toBe("usr_admin");
    expect(JSON.parse(posts[0].body ?? "{}")).toEqual({});
  });
});
