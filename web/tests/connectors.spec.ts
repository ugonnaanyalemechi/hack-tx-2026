/** The admin Connectors view: pending requests, approve/deny, active grants. */

import { expect, test, type Page } from "@playwright/test";

async function actAs(page: Page, role: "Admin" | "Builder" | "End user") {
  const button = page
    .getByRole("group", { name: "Viewing as" })
    .getByRole("button", { name: role });
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
}

test.describe("admin connectors", () => {
  test("lists pending requests and active grants", async ({ page }) => {
    await page.goto("/admin/connectors");
    await actAs(page, "Admin");

    await expect(page.getByRole("heading", { level: 1 })).toContainText("Who can reach what.");
    await expect(page.getByRole("link", { name: "Connectors" })).toHaveAttribute(
      "href",
      "/admin/connectors"
    );

    const requests = page.getByRole("region", { name: "Connector requests" });
    const rows = requests.getByTestId("connector-request");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText("Style guide wiki");
    await expect(rows.nth(0)).toContainText("Campaign Copy Reviewer · read only");
    await expect(rows.nth(0)).toContainText("owner Cleo Builder");
    await expect(rows.nth(1)).toContainText("GitHub");
    await expect(rows.nth(1)).toContainText("PR Reviewer · read only");

    const grants = page.getByRole("region", { name: "Active grants" });
    const grantRows = grants.getByTestId("connector-grant");
    await expect(grantRows).toHaveCount(2);
    await expect(grantRows.nth(0)).toContainText("Jira");
    await expect(grantRows.nth(0)).toContainText("create_issue");
    await expect(grantRows.nth(0)).toContainText("Changes things");
    await expect(grantRows.nth(1)).toContainText("Policy library");
    await expect(grantRows.nth(1)).not.toContainText("Changes things");

    await page.screenshot({ path: "tests/__screenshots__/admin-connectors.png", fullPage: true });
  });

  test("approving moves a request into the active grants", async ({ page }) => {
    await page.goto("/admin/connectors");
    await actAs(page, "Admin");
    const requests = page.getByRole("region", { name: "Connector requests" });

    await requests.getByRole("button", { name: "Approve Style guide wiki for Campaign Copy Reviewer" }).click();
    await expect(requests.getByTestId("connector-request")).toHaveCount(1);

    const grants = page.getByRole("region", { name: "Active grants" });
    await expect(grants.getByTestId("connector-grant")).toHaveCount(3);
    await expect(grants.getByTestId("connector-grant").first()).toContainText("Style guide wiki");
    await expect(grants.getByTestId("connector-grant").first()).toContainText("Ada Admin");

    // The admin queue no longer lists it.
    await page.getByRole("link", { name: "Overview" }).click();
    await expect(page.getByTestId("queue-connectors")).toHaveText("1");
    await page.screenshot({ path: "tests/__screenshots__/admin-connectors-approved.png", fullPage: true });
  });

  test("denying with a reason removes the request and grants nothing", async ({ page }) => {
    await page.goto("/admin/connectors");
    await actAs(page, "Admin");
    const requests = page.getByRole("region", { name: "Connector requests" });

    await requests.getByLabel(/Reason for denying GitHub/).fill("Use the read-only mirror instead");
    await requests.getByRole("button", { name: "Deny GitHub for PR Reviewer" }).click();
    await expect(requests.getByTestId("connector-request")).toHaveCount(1);
    await expect(requests).not.toContainText("GitHub");
    await expect(
      page.getByRole("region", { name: "Active grants" }).getByTestId("connector-grant")
    ).toHaveCount(2);
  });

  test("a failed decision puts the request back with an error", async ({ page }) => {
    await page.goto("/admin/connectors?mock=decide-error");
    await actAs(page, "Admin");
    const requests = page.getByRole("region", { name: "Connector requests" });

    await requests.getByRole("button", { name: "Approve GitHub for PR Reviewer" }).click();
    await expect(requests.getByRole("alert")).toContainText("Couldn't approve GitHub for PR Reviewer");
    await expect(requests.getByTestId("connector-request")).toHaveCount(2);
    await page.screenshot({ path: "tests/__screenshots__/admin-connectors-error.png", fullPage: true });
  });

  test("the admin queue shows connector requests as a fourth section", async ({ page }) => {
    await page.goto("/admin");
    await actAs(page, "Admin");
    await expect(page.getByTestId("queue-connectors")).toHaveText("2");
    const section = page.getByRole("region", { name: "Connector requests" });
    await expect(section).toContainText("Style guide wiki");
    await expect(section.getByRole("link", { name: "Review" }).first()).toHaveAttribute(
      "href",
      "/admin/connectors"
    );
  });

  test("builders and end users do not get the connectors", async ({ page }) => {
    await page.goto("/admin/connectors");
    await actAs(page, "Builder");
    await expect(page.getByText("Connectors are for admins.").first()).toBeVisible();
    await expect(page.getByTestId("connector-request")).toHaveCount(0);
    await actAs(page, "End user");
    await expect(page.getByText("Connectors are for admins.").first()).toBeVisible();
  });

  test("shows loading, empty and error states", async ({ page }) => {
    await page.goto("/admin/connectors?mock=loading");
    await actAs(page, "Admin");
    await expect(page.getByLabel("Loading connectors")).toBeVisible();

    await page.goto("/admin/connectors?mock=empty");
    await expect(page.getByText("No requests waiting.")).toBeVisible();
    await expect(page.getByText("No connectors granted yet.")).toBeVisible();

    await page.goto("/admin/connectors?mock=error");
    await expect(page.getByRole("alert").filter({ hasText: "Retry" })).toContainText(
      "Couldn't load connectors."
    );
  });
});
