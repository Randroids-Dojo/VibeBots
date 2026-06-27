import { expect, test } from "@playwright/test";

test("home redirects to the mine hub", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/mine$/);
});
