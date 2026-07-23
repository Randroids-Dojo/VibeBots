import { expect, test } from "@playwright/test";
import { ciCase } from "./support/ci-case";

test(
  "home redirects to the mine hub",
  ciCase("E2E-ROUTES-0001", "@functional"),
  async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/mine$/);
  },
);

test(
  "holodeck route renders its canvas and controls",
  ciCase("E2E-ROUTES-0002", "@functional"),
  async ({ page }) => {
    await page.goto("/holodeck");
    await expect(page.locator("canvas")).toBeVisible();
    await expect(page.getByLabel("Scenario")).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Back to mine" }),
    ).toBeVisible();
  },
);
