import { expect, test } from "@playwright/test";

test.describe("chat page", () => {
  test("?agent= opens that agent's chat with its name and owner", async ({ page }) => {
    // Policy Assistant, owned by Cleo Builder in the mock catalog.
    await page.goto("/chat?agent=agt_2d8f5a1b0c3e4f7a9b2c4d6e8f0a1b3c");
    await expect(page.getByRole("heading", { level: 1, name: "Policy Assistant" })).toBeVisible();
    await expect(page.getByText("Owner: Cleo Builder")).toBeVisible();
    await expect(page.getByLabel("Ask Policy Assistant")).toBeVisible();
    // Only the Filings Analyst has seeded history.
    await expect(page.getByText("Acme revenue by segment")).toHaveCount(0);
    await page.screenshot({ path: "tests/__screenshots__/chat-agent-param.png", fullPage: true });

    await page.goto("/chat");
    await expect(page.getByRole("heading", { level: 1, name: "Filings Analyst" })).toBeVisible();
    await expect(page.getByText("Owner: Ben Builder")).toBeVisible();
  });

  test("streams a new message and replaces the preview with final guarded text", async ({
    page,
  }) => {
    await page.goto("/chat?fastStream=1");

    // Loaded state: seeded past chats are visible and the first one is
    // selected with its history shown.
    await expect(
      page.getByRole("button", { name: /Acme revenue by segment/ })
    ).toBeVisible();
    await expect(
      page.getByText("Acme reported $4.2B in fiscal 2025 revenue")
    ).toBeVisible();

    const messageCountBefore = await page
      .getByTestId("assistant-message")
      .count();

    // Ask a new question whose canned answer exercises the guard: the
    // streamed preview contains a secret-looking value that the final
    // guarded text must not contain.
    const input = page.getByLabel("Ask Filings Analyst");
    await input.fill("What about operating margin this quarter?");
    await page.getByRole("button", { name: "Send" }).click();

    // A new assistant message bubble is appended for this run — scope every
    // following assertion to it specifically, not to any seeded message
    // that happens to share the same canned text.
    await expect(page.getByTestId("assistant-message")).toHaveCount(
      messageCountBefore + 1
    );
    const newMessage = page.getByTestId("assistant-message").last();

    // While streaming, the tool-use note appears, and the live token
    // preview (not yet the final guarded text) is visible.
    await expect(newMessage.getByText(/Searching filings|Searched filings/)).toBeVisible();
    await expect(newMessage.getByText(/Let me check the filings/)).toBeVisible();

    // The run finishes and the final guarded answer replaces the preview.
    await expect(
      newMessage.getByText(
        "Operating margin was 21.4%, up from 19.8% in fiscal 2024.",
        { exact: true }
      )
    ).toBeVisible({ timeout: 15_000 });

    // The raw streamed preview text (including the secret-looking value the
    // guard removed) must be gone now that the final text has arrived.
    await expect(newMessage.getByText(/Let me check the filings/)).toHaveCount(0);
    await expect(newMessage.getByText(/acct #4471-2290-91/)).toHaveCount(0);

    // The tool note settled into its "done" form.
    await expect(newMessage.getByText("Searched filings (1.1s)")).toBeVisible();

    // The guard note, citations and flag/copy row render under the answer.
    await expect(
      newMessage.getByText("One value was removed because it looked like a secret.")
    ).toBeVisible();
    await expect(newMessage.getByText("10-K · p.49")).toBeVisible();
    await expect(newMessage.getByRole("button", { name: "Flag" })).toBeVisible();
    await expect(newMessage.getByRole("button", { name: "Copy" })).toBeVisible();

    await page.screenshot({
      path: "tests/__screenshots__/chat.png",
      fullPage: false,
    });
  });

  test("handles a failed run with a retry affordance", async ({ page }) => {
    await page.goto("/chat?fastStream=1&empty=1");

    const input = page.getByLabel("Ask Filings Analyst");
    await input.fill("trigger: error");
    await page.getByRole("button", { name: "Send" }).click();

    await expect(
      page.getByText("The model provider timed out. Try again in a moment.")
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  });

  test("shows an empty state for the past-chats sidebar", async ({ page }) => {
    await page.goto("/chat?empty=1");
    await expect(page.getByText("No past chats yet.")).toBeVisible();
    await expect(
      page.getByText("Ask Filings Analyst a question about Acme's filings to get started.")
    ).toBeVisible();
  });

  test("shows an error state for the past-chats sidebar with a working retry", async ({
    page,
  }) => {
    await page.goto("/chat?chatsError=1");
    await expect(page.getByText("Couldn't load your past chats.")).toBeVisible();

    const retry = page.getByRole("button", { name: "Retry" });
    await expect(retry).toBeVisible();
  });
});
