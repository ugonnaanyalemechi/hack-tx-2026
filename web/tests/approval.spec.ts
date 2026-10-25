import { expect, test, type Page } from "@playwright/test";

// The mock agent asks to run its side-effect tool (save_note) whenever the
// user asks it to save a note; see lib/mock-chat.ts.
const SAVE_NOTE_REQUEST = "Save a note that Acme's cloud revenue grew 18%";

async function askForSideEffect(page: Page, query = "fastStream=1") {
  await page.goto(`/chat?${query}`);
  await expect(
    page.getByRole("button", { name: /Acme revenue by segment/ })
  ).toBeVisible();
  await page.getByRole("button", { name: "New chat" }).click();
  await page.getByLabel("Ask Filings Analyst").fill(SAVE_NOTE_REQUEST);
  await page.getByRole("button", { name: "Send" }).click();
  const card = page.getByRole("region", { name: "Save a note?" });
  await expect(card).toBeVisible({ timeout: 15_000 });
  return card;
}

test.describe("approval card", () => {
  test("shows the side-effect tool and its inputs, and holds the chat until a decision", async ({
    page,
  }) => {
    const card = await askForSideEffect(page);

    // The agent's guarded explanation sits above the card.
    await expect(
      page.getByText(
        "Acme's cloud revenue grew 18% in fiscal 2025, to $2.1B. I'd like to save that as a note for you."
      )
    ).toBeVisible();

    await expect(card.getByText("Approval needed")).toBeVisible();
    await expect(card.getByText("Run paused")).toBeVisible();
    await expect(
      card.getByText(
        "Filings Analyst wants to run a tool that changes something outside this chat. Nothing happens until you decide."
      )
    ).toBeVisible();

    // Exactly what the agent wants to do: the tool name and every input.
    const call = card.getByTestId("approval-tool-call");
    await expect(call.getByText("save_note", { exact: true })).toBeVisible();
    await expect(
      call.getByText(
        "text: Acme cloud revenue grew 18% in fiscal 2025, to $2.1B (10-K · p.47)."
      )
    ).toBeVisible();

    await expect(card.getByRole("button", { name: "Reject" })).toBeEnabled();
    await expect(
      card.getByRole("button", { name: "Approve and save" })
    ).toBeEnabled();
    await expect(
      card.getByText(
        "If you reject, the agent is told this was declined and carries on without it."
      )
    ).toBeVisible();

    // Nothing else can be sent while the run waits on this decision.
    const input = page.getByLabel("Ask Filings Analyst");
    await expect(input).toBeDisabled();
    await expect(input).toHaveAttribute("placeholder", "Waiting for your decision");

    await page.screenshot({
      path: "tests/__screenshots__/approval.png",
      fullPage: false,
    });
  });

  test("approving runs the tool and continues the stream", async ({ page }) => {
    const card = await askForSideEffect(page);
    const messagesBefore = await page.getByTestId("assistant-message").count();

    await card.getByRole("button", { name: "Approve and save" }).click();

    // The decision is recorded on the card and its buttons are gone.
    await expect(card.getByText("Approved", { exact: true })).toBeVisible();
    await expect(card.getByRole("button")).toHaveCount(0);

    // The run continues in a new message: the tool runs, then the answer.
    await expect(page.getByTestId("assistant-message")).toHaveCount(
      messagesBefore + 1
    );
    const continuation = page.getByTestId("assistant-message").last();
    await expect(continuation.getByText("Saved note (0.3s)")).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      continuation.getByText(
        "Done. I saved the note about Acme's 18% cloud revenue growth.",
        { exact: true }
      )
    ).toBeVisible();
    await expect(continuation.getByRole("button", { name: "Flag" })).toBeVisible();

    // The chat is open again.
    const input = page.getByLabel("Ask Filings Analyst");
    await expect(input).toBeEnabled();
    await expect(input).toHaveAttribute("placeholder", "Ask Filings Analyst");
  });

  test("rejecting tells the agent it was declined and continues the stream", async ({
    page,
  }) => {
    const card = await askForSideEffect(page);
    const messagesBefore = await page.getByTestId("assistant-message").count();

    await card.getByRole("button", { name: "Reject" }).click();

    await expect(card.getByText("Rejected", { exact: true })).toBeVisible();
    await expect(card.getByRole("button")).toHaveCount(0);

    await expect(page.getByTestId("assistant-message")).toHaveCount(
      messagesBefore + 1
    );
    const continuation = page.getByTestId("assistant-message").last();
    await expect(
      continuation.getByText(
        "Okay, I didn't save the note. The figures above are still here if you need them.",
        { exact: true }
      )
    ).toBeVisible({ timeout: 15_000 });
    // The side-effect tool never ran.
    await expect(page.getByText(/Saved note|Saving note/)).toHaveCount(0);

    await expect(page.getByLabel("Ask Filings Analyst")).toBeEnabled();
  });

  test("shows the decision as in flight until the decide call answers", async ({
    page,
  }) => {
    // Control the page's clock so the decide call stays in flight for as
    // long as the assertions need, then let it answer.
    await page.clock.install();
    const card = await askForSideEffect(page);
    await page.clock.pauseAt(Date.now() + 60_000);

    await card.getByRole("button", { name: "Approve and save" }).click();

    const inFlight = card.getByRole("button", { name: "Approving…" });
    await expect(inFlight).toBeVisible();
    await expect(inFlight).toBeDisabled();
    await expect(card.getByRole("button", { name: "Reject" })).toBeDisabled();
    await expect(card).toHaveAttribute("aria-busy", "true");
    await expect(page.getByLabel("Ask Filings Analyst")).toBeDisabled();

    await page.clock.resume();
    await expect(card.getByText("Approved", { exact: true })).toBeVisible();
    await expect(card).not.toHaveAttribute("aria-busy", "true");
  });

  test("keeps the card open with an error when the decide call fails, and a retry goes through", async ({
    page,
  }) => {
    // decideError=1 makes the mock fail the first decide call.
    const card = await askForSideEffect(page, "fastStream=1&decideError=1");
    const messagesBefore = await page.getByTestId("assistant-message").count();

    await card.getByRole("button", { name: "Approve and save" }).click();

    await expect(card.getByRole("alert")).toHaveText(
      "Couldn't send your decision. Check your connection and try again."
    );
    // Nothing ran: the run is still paused and both choices are open again.
    await expect(card.getByText("Run paused")).toBeVisible();
    await expect(card.getByRole("button", { name: "Reject" })).toBeEnabled();
    await expect(page.getByTestId("assistant-message")).toHaveCount(messagesBefore);
    await expect(page.getByLabel("Ask Filings Analyst")).toBeDisabled();

    await card.getByRole("button", { name: "Approve and save" }).click();

    await expect(card.getByText("Approved", { exact: true })).toBeVisible();
    await expect(card.getByRole("alert")).toHaveCount(0);
    await expect(
      page
        .getByTestId("assistant-message")
        .last()
        .getByText("Done. I saved the note about Acme's 18% cloud revenue growth.", {
          exact: true,
        })
    ).toBeVisible({ timeout: 15_000 });
  });
});
