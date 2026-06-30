import { expect, test } from "@playwright/test";

test("home redirects to the mine hub", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/mine$/);
});

test("holodeck route renders its canvas and controls", async ({ page }) => {
  await page.goto("/holodeck");
  await expect(page.locator("canvas")).toBeVisible();
  await expect(page.getByLabel("Scenario")).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to mine" })).toBeVisible();
});
