/**
 * The new-agent page on mock data (docs/design/build_an_agent.png): setup
 * assistant, form to YAML, field errors, connector approval and saving a
 * draft. Also checks the hand-written YAML serializer's output.
 */

import { expect, test, type Page } from "@playwright/test";
import { slugify, toYaml } from "../lib/agent-yaml";
import { EMPTY_FORM, formToYaml } from "../lib/build-form";

async function actAs(page: Page, role: "Admin" | "Builder" | "End user") {
  const button = page
    .getByRole("group", { name: "Viewing as" })
    .getByRole("button", { name: role });
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
}

async function openAsBuilder(page: Page) {
  await page.goto("/build/new");
  await actAs(page, "Builder");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Describe it first.");
}

test.describe("agent-yaml serializer", () => {
  test("writes maps, lists, scalars, null and block text", () => {
    const out = toYaml(
      {
        name: "reviewer",
        instructions: "Line one.\nLine two.",
        connectors: ["a", "b"],
        none: [],
        limit: 0.8,
        flag: true,
        quoted: "yes",
        nested: { x: 1 },
        trigger: null,
      },
      { "connectors.b": "waiting for admin" }
    );
    expect(out).toBe(
      [
        "name: reviewer",
        "instructions: |-",
        "  Line one.",
        "  Line two.",
        "connectors:",
        "  - a",
        "  - b   # waiting for admin",
        "none: []",
        "limit: 0.8",
        "flag: true",
        'quoted: "yes"',
        "nested:",
        "  x: 1",
        "trigger: null",
        "",
      ].join("\n")
    );
    expect(slugify("Campaign Copy Reviewer!")).toBe("campaign-copy-reviewer");

    // Long one-line text folds at word breaks and keeps every word.
    const long = "Review the copy the user pastes. For each line that breaks a wording rule, quote it.";
    const folded = toYaml({ instructions: long });
    expect(folded.startsWith("instructions: >-\n  Review the copy")).toBe(true);
    expect(
      folded
        .split("\n")
        .slice(1)
        .map((l) => l.trim())
        .join(" ")
        .trim()
    ).toBe(long);
  });

  test("the form's file ends with trigger: null", () => {
    const yaml = formToYaml({ ...EMPTY_FORM, name: "My Agent" }, [], "dana");
    expect(yaml).toContain("name: my-agent");
    expect(yaml).toContain("model: meta/muse-spark-1.3");
    expect(yaml.trimEnd().endsWith("trigger: null")).toBe(true);
  });
});

test.describe("new agent page", () => {
  test("the setup assistant fills the form, the file follows, and a draft saves", async ({
    page,
  }) => {
    await openAsBuilder(page);
    await expect(page.getByText("New agent · Web form", { exact: false })).toBeVisible();
    const yaml = page.getByTestId("agent-yaml");

    await page
      .getByLabel("What should the agent do?")
      .fill("Check marketing copy against our compliance wording rules.");
    await page.getByRole("button", { name: "Fill in the form" }).click();
    await expect(page.getByRole("button", { name: /Filling in the form/ })).toBeDisabled();

    await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Campaign Copy Reviewer");
    await expect(page.getByLabel("Description")).toHaveValue(/compliance wording rules/);
    await expect(page.getByText("/agents/campaign-copy-reviewer")).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "Policy library" })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: "Style guide wiki" })).toBeChecked();
    await expect(yaml).toContainText("name: campaign-copy-reviewer");
    await expect(yaml).toContainText("- style-guide-wiki   # waiting for admin");
    await expect(yaml).toContainText("trigger: null");
    await expect(page.getByText("Built with form")).toBeVisible();

    await page.screenshot({ path: "tests/__screenshots__/build-new.png", fullPage: true });

    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByRole("button", { name: "Saving draft…" })).toBeDisabled();
    const saved = page.getByRole("status").filter({ hasText: "Draft saved" });
    await expect(saved).toBeVisible();
    await expect(saved).toContainText("deploy from there");
    await expect(saved.getByRole("link", { name: "Open evals and deploy" })).toHaveAttribute(
      "href",
      /^\/agents\/agt_[0-9a-f]{32}\/evals$/
    );
    await page.screenshot({ path: "tests/__screenshots__/build-new-saved.png", fullPage: true });
  });

  test("editing the form changes the agent file", async ({ page }) => {
    await openAsBuilder(page);
    const yaml = page.getByTestId("agent-yaml");

    await page.getByLabel("Name", { exact: true }).fill("Rate Watcher");
    await page.getByLabel("Instructions").fill("Watch rates.\nTell me when they move.");
    await page.getByLabel("Monthly USD").fill("75");
    await page.getByLabel("On cap").selectOption("downgrade");
    await page.getByRole("checkbox", { name: "Strip secrets" }).click();
    await page.getByRole("checkbox", { name: "Jira" }).click();

    await expect(yaml).toContainText("name: rate-watcher");
    await expect(yaml).toContainText("instructions: |-");
    await expect(yaml).toContainText("  Tell me when they move.");
    await expect(yaml).toContainText("monthly_usd: 75");
    await expect(yaml).toContainText("on_cap: downgrade");
    await expect(yaml).toContainText("strip_secrets: false");
    await expect(yaml).toContainText("- jira");

    // Side-effect marks appear for approved, checked connectors.
    await page.getByRole("checkbox", { name: "create_issue" }).click();
    await expect(yaml).toContainText("approval_required:");
    await expect(yaml).toContainText("- create_issue");
  });

  test("validation errors name the field", async ({ page }) => {
    await openAsBuilder(page);
    await page.getByRole("button", { name: "Save draft" }).click();

    await expect(page.locator("#agent-name-error")).toBeVisible();
    await expect(
      page.locator("#agent-instructions-error")
    ).toBeVisible();
    await expect(page.getByLabel("Name", { exact: true })).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByRole("link", { name: "Open evals and deploy" })).toHaveCount(0);
    await page.screenshot({ path: "tests/__screenshots__/build-new-errors.png", fullPage: true });

    // Typing clears that field's error.
    await page.getByLabel("Name", { exact: true }).fill("Ok");
    await expect(page.getByLabel("Name", { exact: true })).not.toHaveAttribute("aria-invalid", "true");

    await page.getByLabel("Instructions").fill("Do it.");
    await page.getByRole("button", { name: "Validate" }).click();
    await expect(page.getByText("The agent file is valid.")).toBeVisible();
  });

  test("Request approval flips the pill to Waiting for admin", async ({ page }) => {
    await openAsBuilder(page);
    const list = page.getByRole("list", { name: "Connectors" });
    await expect(list.getByText("Approved")).toHaveCount(2);
    await expect(list.getByText("Waiting for admin")).toHaveCount(1);

    await list.getByRole("button", { name: "Request approval for GitHub" }).click();
    await expect(list.getByText("Waiting for admin")).toHaveCount(2);
    await expect(list.getByRole("button", { name: /Request approval/ })).toHaveCount(0);
  });

  test("an end user gets the no-access note", async ({ page }) => {
    await page.goto("/build/new");
    await expect(page.getByText("Building is for builders and admins.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save draft" })).toHaveCount(0);
  });

  test("the landing and catalog link to it, and it shows an error state", async ({ page }) => {
    await page.goto("/build");
    await actAs(page, "Builder");
    await page.getByRole("link", { name: "New agent" }).click();
    await expect(page).toHaveURL(/\/build\/new$/);

    await page.goto("/build/new?mock=error");
    await expect(page.getByRole("alert").filter({ hasText: "Retry" }).first()).toBeVisible();
  });
});
