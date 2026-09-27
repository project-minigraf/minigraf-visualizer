import { expect, test } from "@playwright/test";

test("boots the engine and draws the default sample", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.locator('.g-node[data-label=":alice"]')).toBeVisible();
  await expect(page.getByText("as of tx 11")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});
