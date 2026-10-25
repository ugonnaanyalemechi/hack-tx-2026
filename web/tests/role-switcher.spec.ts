import { expect, test } from "@playwright/test";

test.describe("role switcher", () => {
  test("starts as an end user, who gets no Admin tab", async ({ page }) => {
    await page.goto("/catalog");
    const roles = page.getByRole("group", { name: "Viewing as" });

    await expect(roles.getByRole("button", { name: "End user" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    const primary = page.getByRole("navigation", { name: "Primary" });
    await expect(primary.getByRole("link", { name: "Catalog" })).toHaveAttribute(
      "aria-current",
      "page"
    );
    await expect(primary.getByRole("link", { name: "Admin" })).toHaveCount(0);
  });

  test("switching role shows the Admin tab and survives a reload", async ({ page }) => {
    await page.goto("/catalog");
    const roles = page.getByRole("group", { name: "Viewing as" });
    const primary = page.getByRole("navigation", { name: "Primary" });

    await roles.getByRole("button", { name: "Admin" }).click();
    await expect(roles.getByRole("button", { name: "Admin" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    await expect(roles.getByRole("button", { name: "End user" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
    await expect(primary.getByRole("link", { name: "Admin" })).toBeVisible();

    await page.reload();
    await expect(roles.getByRole("button", { name: "Admin" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );

    await roles.getByRole("button", { name: "Builder" }).click();
    await expect(primary.getByRole("link", { name: "Admin" })).toBeVisible();

    await roles.getByRole("button", { name: "End user" }).click();
    await expect(primary.getByRole("link", { name: "Admin" })).toHaveCount(0);
  });

  test("the Admin tab opens the run log", async ({ page }) => {
    await page.goto("/catalog");
    await page
      .getByRole("group", { name: "Viewing as" })
      .getByRole("button", { name: "Admin" })
      .click();
    await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Admin" }).click();

    await expect(page).toHaveURL(/\/admin\/runs/);
    await expect(
      page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Admin" })
    ).toHaveAttribute("aria-current", "page");
  });
});
