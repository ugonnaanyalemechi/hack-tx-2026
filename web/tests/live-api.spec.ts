/**
 * The live API client, against a stubbed backend at the HTTP boundary
 * (`page.route`). `?api=live` switches this page load from the mock client
 * to the live one. Response bodies are shaped exactly as FastAPI sends
 * them (decimals as strings, cost keys absent for public shapes).
 */

import { expect, test, type Page, type Route } from "@playwright/test";

const USERS = [
  { id: "usr_admin", name: "Ada Admin", role: "admin" },
  { id: "usr_builder", name: "Ben Builder", role: "builder" },
  { id: "usr_builder_2", name: "Cleo Builder", role: "builder" },
  { id: "usr_end_user", name: "Eli End User", role: "end_user" },
];

const AGENT = {
  id: "agt_live",
  slug: "filings-analyst",
  name: "Filings Analyst",
  description: "Answers questions about the quarterly filings of demo companies.",
  owner_id: "usr_builder",
  live_version_number: 1,
  latest_version_number: 1,
};

const RUN_PUBLIC = {
  id: "run_live0001",
  agent_id: "agt_live",
  user_id: "usr_end_user",
  entry_point: "chat",
  status: "completed",
  duration_ms: 2400,
  created_at: "2026-10-25T12:00:00Z",
};

const STEP_PUBLIC = {
  id: "stp_live0001",
  sequence: 1,
  kind: "model",
  name: "gemini/gemini-3.8-flash",
  latency_ms: 900,
  error: null,
  approval: null,
};

const IDENTITY_HEADER = "x-user-id";

type Handler = (route: Route, userId: string | undefined) => Promise<void> | void;

/** Stub one GET endpoint and record the identity header of each call. */
async function stub(page: Page, path: string, handler: Handler, seen?: (string | undefined)[]) {
  await page.route(
    (url) => url.pathname === `/api/v1${path}`,
    async (route) => {
      const userId = route.request().headers()[IDENTITY_HEADER];
      seen?.push(userId);
      await handler(route, userId);
    }
  );
}

async function actAs(page: Page, role: "Admin" | "Builder" | "End user") {
  const button = page
    .getByRole("group", { name: "Viewing as" })
    .getByRole("button", { name: role });
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
}

test.describe("live API client", () => {
  test.beforeEach(async ({ page }) => {
    await stub(page, "/users", (route) => route.fulfill({ json: USERS }));
    await stub(page, "/agents", (route) =>
      route.fulfill({ json: { items: [AGENT], next_cursor: null } })
    );
  });

  test("names the user picked in the role switcher in the identity header", async ({
    page,
  }) => {
    const seen: (string | undefined)[] = [];
    await stub(
      page,
      "/catalog",
      (route) =>
        route.fulfill({
          json: { items: [{ ...AGENT, live_version_number: 1 }], next_cursor: null },
        }),
      seen
    );

    await page.goto("/catalog?api=live");
    await expect(page.getByTestId("agent-card")).toHaveCount(1);
    expect(seen.at(-1)).toBe("usr_end_user");

    await actAs(page, "Admin");
    await expect.poll(() => seen.at(-1)).toBe("usr_admin");

    await actAs(page, "Builder");
    await expect.poll(() => seen.at(-1)).toBe("usr_builder");
    await expect(page.getByTestId("agent-card")).toContainText("Owner: Ben Builder");
  });

  test("shows no cost anywhere when the API omits the cost keys", async ({ page }) => {
    await stub(page, "/runs", (route) =>
      route.fulfill({ json: { items: [RUN_PUBLIC], next_cursor: null } })
    );
    await stub(page, `/runs/${RUN_PUBLIC.id}`, (route) =>
      route.fulfill({ json: { run: RUN_PUBLIC, steps: [STEP_PUBLIC] } })
    );

    await page.goto("/admin/runs?api=live");
    await actAs(page, "Builder");

    const table = page.getByRole("table", { name: "Runs" });
    await expect(table.getByRole("row").filter({ hasText: "run_live" })).toContainText(
      "Completed"
    );
    await expect(table.getByRole("columnheader", { name: "Cost" })).toHaveCount(0);

    const detail = page.getByRole("region", { name: "Run run_live" });
    await expect(detail.getByRole("listitem")).toContainText("Model call");
    await expect(page.getByText(/\$\d/)).toHaveCount(0);
  });

  test("shows cost when the API sends it", async ({ page }) => {
    await stub(page, "/runs", (route) =>
      route.fulfill({
        json: { items: [{ ...RUN_PUBLIC, cost_total: "0.012345" }], next_cursor: null },
      })
    );
    await stub(page, `/runs/${RUN_PUBLIC.id}`, (route) =>
      route.fulfill({
        json: {
          run: { ...RUN_PUBLIC, cost_total: "0.012345" },
          steps: [
            {
              ...STEP_PUBLIC,
              cost: "0.012345",
              input_tokens: 812,
              cached_input_tokens: 0,
              output_tokens: 64,
            },
          ],
        },
      })
    );

    await page.goto("/admin/runs?api=live");
    await actAs(page, "Admin");

    const table = page.getByRole("table", { name: "Runs" });
    await expect(table.getByRole("columnheader", { name: "Cost" })).toBeVisible();
    await expect(table.getByRole("row").filter({ hasText: "run_live" })).toContainText(
      "$0.012"
    );
    await expect(
      page.getByRole("region", { name: "Run run_live" }).getByRole("listitem")
    ).toContainText("812 in · 64 out");
  });

  test("reports the API's error message and recovers on retry", async ({ page }) => {
    let calls = 0;
    await stub(page, "/usage", (route) => {
      calls += 1;
      if (calls === 1) {
        return route.fulfill({
          status: 500,
          json: { error: { code: "internal_error", message: "The ledger is unavailable." } },
        });
      }
      return route.fulfill({
        json: {
          by_agent: [
            { agent_id: "agt_live", agent_name: "Filings Analyst", runs: 3, cost: "0.030000" },
          ],
          by_day: [{ day: "2026-10-25", runs: 3, cost: "0.030000" }],
        },
      });
    });

    await page.goto("/admin/usage?api=live");
    await actAs(page, "Admin");

    const alert = page.getByRole("alert").filter({ hasText: "Couldn't load usage." });
    await expect(alert).toContainText("The ledger is unavailable.");
    await alert.getByRole("button", { name: "Retry" }).click();

    await expect(
      page.getByRole("table", { name: "Spend by agent" }).getByRole("row", {
        name: /Filings Analyst/,
      })
    ).toContainText("$0.030");
  });

  test("an end user never asks for the run log", async ({ page }) => {
    const seen: (string | undefined)[] = [];
    await stub(page, "/runs", (route) => route.fulfill({ status: 403, json: {} }), seen);
    await page.goto("/admin/runs?api=live");
    await expect(
      page.getByText("The run log is for admins and agent owners.")
    ).toBeVisible();
    expect(seen).toHaveLength(0);
  });
});
