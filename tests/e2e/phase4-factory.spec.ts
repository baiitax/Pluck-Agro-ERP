import { expect, test } from "@playwright/test";

/**
 * Phase 4 — inventory and production workspaces, unauthenticated surface.
 *
 * Same discipline as the Phase 3 suite: prove the part that can be proven without a live backend. Every
 * inventory and production route is gated before a query runs, a deep link is gated before its identifier is
 * trusted, and no stock, hold or yield figure reaches an anonymous visitor.
 *
 * The authenticated journeys — receive stock, restrict and release, count and post a variance, transfer
 * between warehouses, plan and run a batch, close it and read the yield — need a deployed Supabase project
 * and are recorded as outstanding in docs/phase-4-report.md. They are not simulated here, because a
 * simulated pass is not evidence. The behaviours underneath them are covered by tests/database/inventory.test.ts.
 */

const INVENTORY_ROUTES = [
  "/inventory",
  "/inventory/stock",
  "/inventory/lots",
  "/inventory/lots/new",
  "/inventory/movements",
  "/inventory/transfers",
  "/inventory/transfers/new",
  "/inventory/counts",
  "/inventory/counts/new",
  "/inventory/adjustments",
  "/inventory/adjustments/new",
  "/inventory/restrictions",
  "/inventory/reservations",
  "/inventory/reports",
];

const PRODUCTION_ROUTES = [
  "/production",
  "/production/plans",
  "/production/plans/new",
  "/production/batches",
  "/production/batches/new",
  "/production/configuration",
  "/production/reports",
];

const ID = "00000000-0000-0000-0000-000000000000";

const DEEP_LINKS = [
  `/inventory/lots/${ID}`,
  `/inventory/transfers/${ID}`,
  `/inventory/counts/${ID}`,
  `/inventory/adjustments/${ID}`,
  `/production/plans/${ID}`,
  `/production/batches/${ID}`,
];

test.describe("Phase 4 factory route protection", () => {
  for (const route of [...INVENTORY_ROUTES, ...PRODUCTION_ROUTES]) {
    test(`${route} redirects an anonymous visitor to the login page`, async ({ page }) => {
      const response = await page.goto(route);
      await expect(page).toHaveURL(/\/login/);
      expect(response?.status()).toBeLessThan(500);
    });
  }

  for (const route of DEEP_LINKS) {
    test(`${route} is gated before the identifier is used`, async ({ page }) => {
      const response = await page.goto(route);
      await expect(page).toHaveURL(/\/login/);
      expect(response?.status()).toBeLessThan(500);
    });
  }

  test("the login page does not disclose the factory workspaces to anonymous visitors", async ({ page }) => {
    await page.goto("/login");
    const body = (await page.locator("body").innerText()).toLowerCase();
    expect(body).not.toContain("stock on hand");
    expect(body).not.toContain("quarantine");
    expect(body).not.toContain("production plan");
    expect(body).not.toContain("yield");
  });

  test("no stock, hold or yield figure is rendered on an anonymous response", async ({ page }) => {
    for (const route of ["/inventory", "/inventory/stock", "/inventory/reports", "/production", "/production/reports"]) {
      await page.goto(route);
      const body = (await page.locator("body").innerText()).toLowerCase();
      expect(body).not.toContain("on hand");
      expect(body).not.toContain("recorded yield");
      expect(body).not.toContain("available quantity");
    }
  });

  test("a lot deep link does not produce a lot for an anonymous visitor", async ({ page }) => {
    await page.goto(`/inventory/lots/${ID}`);
    await expect(page).toHaveURL(/\/login/);
    const body = (await page.locator("body").innerText()).toLowerCase();
    expect(body).not.toContain("lot reference");
  });
});
