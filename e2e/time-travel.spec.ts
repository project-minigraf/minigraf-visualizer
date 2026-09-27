import { expect, test, type Page } from "@playwright/test";

async function fresh(page: Page, hash = "") {
  await page.goto(`/${hash}`);
  // A hash-only change does not reload the page; a shared link always opens fresh.
  if (hash) await page.reload();
  await expect(page.locator(".g-node").first()).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  // Each test starts from the default sample, not a saved workspace.
  await page.goto("/");
  await page.evaluate(() => indexedDB.deleteDatabase("minigraf-visualizer"));
});

test("stepping back shows what a retraction removed", async ({ page }) => {
  await fresh(page);
  await page.locator('.tx-head:has-text("tx 8")').click();
  await expect(page.getByText("as of tx 8")).toBeVisible();
  await expect(page.locator(".tx-item.current .tx-changes .del")).toContainText(":works-at");
  await expect(page.locator(".g-edge.s-removed")).toHaveCount(1);
});

test("inspector shows the corrected salary history", async ({ page }) => {
  await fresh(page);
  await page.locator('.g-node[data-label=":alice"]').click();
  const history = page.locator(".attr-history", { hasText: ":salary" });
  await expect(history.locator(".version")).toHaveCount(2);
  await expect(history.locator(".version").first()).toContainText("retracted at tx 6");
  // Jump to where the wrong value was visible.
  await history.locator(".version").first().click();
  await expect(page.getByText("as of tx 5")).toBeVisible();
  await expect(history.locator(".version").first()).toContainText("visible");
});

test("dragging on the bitemporal map moves both cursors", async ({ page }) => {
  await fresh(page);
  await page.getByRole("tab", { name: "Bitemporal map" }).click();
  const svg = page.locator(".map-canvas svg");
  const box = await svg.boundingBox();
  if (!box) throw new Error("map not rendered");
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.8);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.75);
  await page.mouse.up();
  await expect(page.getByRole("radio", { name: "At date" })).toHaveAttribute("aria-checked", "true");
  await expect(page.locator(".readout strong").first()).not.toContainText("tx 11");
});

test("console writes become new transactions and survive a reload", async ({ page }) => {
  await fresh(page);
  await page.getByRole("tab", { name: "Query" }).click();
  await page.locator("#datalog-input").fill('(transact [[:dave :person/name "Dave"] [:dave :works-at :techcorp]])');
  await page.getByRole("button", { name: /Run/ }).click();
  await expect(page.getByText("as of tx 12")).toBeVisible();
  await expect(page.locator('.g-node[data-label=":dave"]')).toBeVisible();
  await page.reload();
  await expect(page.locator('.g-node[data-label=":dave"]')).toBeVisible();
  await expect(page.locator(".brand")).toContainText("(edited)");
});

test("queries run at the time cursor", async ({ page }) => {
  await fresh(page);
  await page.locator('.tx-head:has-text("tx 5")').click();
  await page.getByRole("tab", { name: "Query" }).click();
  await page.locator("#datalog-input").fill("(query [:find ?s :any-valid-time :where [:alice :salary ?s]])");
  await page.getByRole("button", { name: /Run/ }).click();
  await expect(page.locator(".result td")).toHaveText(["75000"]);
  await expect(page.locator(".result pre")).toContainText(":as-of 5");
});

test("shared links restore the sample, cursor and selection", async ({ page }) => {
  await fresh(page, "#sample=order-fsm&tx=4&vt=any&e=:order-42");
  await expect(page.locator(".brand")).toContainText("Order state machine");
  await expect(page.getByText("as of tx 4")).toBeVisible();
  await expect(page.getByRole("radio", { name: "Any" })).toHaveAttribute("aria-checked", "true");
  await expect(page.locator(".inspector h2")).toHaveText(":order-42");
});

test("exported .graph files open again", async ({ page }) => {
  await fresh(page);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save .graph" }).click();
  const file = await (await download).path();
  await page.selectOption(".topbar select", "catalog");
  await expect(page.locator(".brand")).toContainText("Corestore catalog");
  await page.locator('input[type="file"]').setInputFiles(file);
  await expect(page.getByText("as of tx 11")).toBeVisible();
  await expect(page.locator('.g-node[data-label=":alice"]')).toBeVisible();
});
