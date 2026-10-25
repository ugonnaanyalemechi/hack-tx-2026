import { expect, test } from "@playwright/test";

// The second seeded answer is the operating margin one, as in
// docs/design/chat_with_flag.png.
const MARGIN_ANSWER = "Operating margin was 21.4%, up from 19.8% in fiscal 2024.";

function marginMessage(page: import("@playwright/test").Page) {
  return page
    .getByTestId("assistant-message")
    .filter({ hasText: MARGIN_ANSWER })
    .first();
}

test.describe("flag and re-check", () => {
  test("flagging an answer streams a re-check right after it", async ({ page }) => {
    // Real stream speed on purpose: the "re-check in progress" state has to
    // last long enough to assert on and screenshot.
    await page.goto("/chat");
    const flagged = marginMessage(page);
    await expect(flagged).toBeVisible();
    const before = await page.getByTestId("assistant-message").count();

    await flagged.getByRole("button", { name: "Flag" }).click();

    // The flagged answer shows it is flagged and that a re-check is running.
    await expect(flagged.getByRole("button", { name: "Flagged" })).toBeDisabled();
    await expect(flagged.getByText("Re-checking", { exact: true })).toBeVisible();
    await expect(
      flagged.getByText(
        "Your flag was sent to the builder with this run attached. Re-check in progress."
      )
    ).toBeVisible();

    await page.screenshot({
      path: "tests/__screenshots__/chat-flag.png",
      fullPage: true,
    });

    // The re-check is a new message directly after the flagged one.
    await expect(page.getByTestId("assistant-message")).toHaveCount(before + 1);
    const recheck = flagged.locator("xpath=following-sibling::div[1]");
    await expect(recheck.getByText("Re-checked answer")).toBeVisible();
    await expect(recheck.getByText(/I checked this against the filing again/)).toBeVisible({
      timeout: 15_000,
    });
    // A re-check answer has its own Flag button, in case the re-check is wrong too.
    await expect(recheck.getByRole("button", { name: "Flag" })).toBeVisible();

    await expect(flagged.getByText("Re-check done", { exact: true })).toBeVisible();
    await expect(flagged.getByText(/The re-checked answer is below/)).toBeVisible();
    // The original answer is kept above the re-check.
    await expect(flagged.getByText(MARGIN_ANSWER)).toBeVisible();

    await page.screenshot({
      path: "tests/__screenshots__/chat-flag-rechecked.png",
      fullPage: true,
    });
  });

  test("a failed flag shows an error and can be retried", async ({ page }) => {
    await page.goto("/chat?fastStream=1&flagError=1");
    const flagged = marginMessage(page);
    await flagged.getByRole("button", { name: "Flag" }).click();

    await expect(flagged.getByRole("alert")).toContainText("Couldn't send your flag");
    const retry = flagged.getByRole("button", { name: "Flag" });
    await expect(retry).toBeEnabled();

    await retry.click();
    await expect(flagged.getByText("Re-check done", { exact: true })).toBeVisible({
      timeout: 15_000,
    });
  });
});
