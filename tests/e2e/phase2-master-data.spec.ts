import { expect, test } from "@playwright/test";

/**
 * Phase 2 — master data workspace, unauthenticated surface.
 *
 * These journeys run against a production build with no Supabase credentials. They verify the part
 * of the master data workspace that can be proven without a live backend: every route is gated
 * before any query runs, deep links are gated before an id is trusted, and no master data (least of
 * all banking or credit data) can leak to an anonymous visitor.
 *
 * The authenticated journeys (create a supplier, submit it for review, stage and execute a CSV
 * import, review a duplicate candidate, convert a quantity in the UI) require a deployed Supabase
 * project and are recorded as outstanding in docs/phase-2-report.md. They are deliberately not
 * simulated here, because a simulated pass would not be evidence.
 */

const MASTER_DATA_ROUTES = [
  "/master-data",
  "/master-data/suppliers",
  "/master-data/suppliers/new",
  "/master-data/supplier-categories",
  "/master-data/customers",
  "/master-data/customers/new",
  "/master-data/customer-categories",
  "/master-data/products",
  "/master-data/products/new",
  "/master-data/products/categories",
  "/master-data/units",
  "/master-data/sites",
  "/master-data/warehouses",
  "/master-data/currencies",
  "/master-data/exchange-rates",
  "/master-data/payment-terms",
  "/master-data/delivery-terms",
  "/master-data/tax-categories",
  "/master-data/duplicates",
  "/master-data/quality",
  "/master-data/imports",
  "/master-data/history",
];

test.describe("Phase 2 master data route protection", () => {
  for (const route of MASTER_DATA_ROUTES) {
    test(`${route} redirects an anonymous visitor to the login page`, async ({ page }) => {
      const response = await page.goto(route);
      await expect(page).toHaveURL(/\/login/);
      expect(response?.status()).toBeLessThan(500);
    });
  }

  test("a supplier deep link is gated before the id is resolved", async ({ page }) => {
    await page.goto("/master-data/suppliers/00000000-0000-0000-0000-000000000000");
    await expect(page).toHaveURL(/\/login/);
  });

  test("a warehouse deep link is gated before the id is resolved", async ({ page }) => {
    await page.goto("/master-data/warehouses/00000000-0000-0000-0000-000000000000");
    await expect(page).toHaveURL(/\/login/);
  });

  test("an import job deep link is gated before the job is read", async ({ page }) => {
    await page.goto("/master-data/imports/00000000-0000-0000-0000-000000000000");
    await expect(page).toHaveURL(/\/login/);
  });

  test("the login page does not disclose the master data workspace to anonymous visitors", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByText(/master data/i)).toHaveCount(0);
  });

  test("no banking or credit field is rendered on any anonymous response", async ({ page }) => {
    for (const route of ["/master-data/suppliers", "/master-data/customers", "/master-data/currencies"]) {
      await page.goto(route);
      const body = (await page.locator("body").innerText()).toLowerCase();
      expect(body).not.toContain("account number");
      expect(body).not.toContain("credit limit");
    }
  });
});
