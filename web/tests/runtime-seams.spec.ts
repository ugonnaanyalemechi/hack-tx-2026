import { expect, test } from "@playwright/test";

// With ?api=live, runtime-dependent calls hit the live seams, which throw
// RuntimeNotAvailableError until the runtime lands (web/lib/api/runtime-seams.ts).
// The chat must show a readable error instead of crashing. Only the users
// list is stubbed at the network boundary, so the page can load.

const USERS = [
  { id: "usr_admin", name: "Ada Admin", role: "admin" },
  { id: "usr_builder", name: "Ben Builder", role: "builder" },
  { id: "usr_end_user", name: "Eli End User", role: "end_user" },
];

test.describe("runtime seams in live mode", () => {
  test.beforeEach(async ({ page }) => {
    await page.route(
      (url) => url.pathname === "/api/v1/users",
      (route) => route.fulfill({ json: USERS })
    );
  });

  test("sending a message says the live runtime isn't available", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await page.goto("/chat?api=live");
    await expect(page.getByRole("button", { name: /Acme revenue by segment/ })).toBeVisible();
    await page.getByRole("button", { name: "New chat" }).click();
    await page.getByLabel("Ask Filings Analyst").fill("What was Acme's revenue?");
    await page.getByRole("button", { name: "Send" }).click();

    await expect(page.getByText("Live chat streaming isn't available yet, needs runtime #15.")).toBeVisible();
    expect(errors).toEqual([]);
    await page.screenshot({ path: "tests/__screenshots__/demo-live-degraded.png" });
  });

  test("flagging says the live runtime isn't available and can be retried", async ({ page }) => {
    await page.goto("/chat?api=live");
    const flagged = page
      .getByTestId("assistant-message")
      .filter({ hasText: "Operating margin was 21.4%" })
      .first();
    await flagged.getByRole("button", { name: "Flag" }).click();
    await expect(flagged.getByRole("alert")).toContainText(
      "Flagging an answer isn't available yet, needs runtime #30."
    );
    await expect(flagged.getByRole("button", { name: "Flag" })).toBeEnabled();
  });
});
