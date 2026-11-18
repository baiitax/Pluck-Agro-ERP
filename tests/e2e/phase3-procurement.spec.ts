import { expect, test } from "@playwright/test";

/**
 * Phase 3 — procurement workspace, unauthenticated surface.
 *
 * These journeys run against a production build with no Supabase credentials. They prove the part of
 * the procurement workspace that can be proven without a live backend: every route is gated before any
 * query runs, deep links are gated before an id is trusted, and no procurement document, amount or
 * banking detail reaches an anonymous visitor.
 *
 * The authenticated journeys — raise a requisition, record quotations, compare and select, convert to
 * an order, amend it, receive and post a delivery, pay and apply an advance, prepare a reconciliation,
 * run each report as the roles that may see it — require a deployed Supabase project. They are recorded
 * as outstanding in docs/phase-3-report.md and are not simulated here, because a simulated pass would
 * not be evidence.
 */

const PROCUREMENT_ROUTES = [
  "/procurement",
  "/procurement/requisitions",
  "/procurement/requisitions/new",
  "/procurement/quotations",
  "/procurement/quotations/new",
  "/procurement/quotations/comparisons",
  "/procurement/purchase-orders",
  "/procurement/purchase-orders/new",
  "/procurement/goods-receipts",
  "/procurement/goods-receipts/new",
  "/procurement/supplier-advances",
  "/procurement/supplier-advances/new",
  "/procurement/suppliers",
  "/procurement/approvals",
  "/procurement/documents",
  "/procurement/reports",
  "/procurement/legacy",
];

const ID = "00000000-0000-0000-0000-000000000000";

const DEEP_LINKS = [
  `/procurement/requisitions/${ID}`,
  `/procurement/requisitions/${ID}/edit`,
  `/procurement/quotations/${ID}`,
  `/procurement/quotations/comparisons/${ID}`,
  `/procurement/purchase-orders/${ID}`,
  `/procurement/goods-receipts/${ID}`,
  `/procurement/supplier-advances/${ID}`,
  `/procurement/suppliers/${ID}`,
  "/procurement/reports/requisition-register",
];

test.describe("Phase 3 procurement route protection", () => {
  for (const route of PROCUREMENT_ROUTES) {
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

  test("the login page does not disclose the procurement workspace to anonymous visitors", async ({ page }) => {
    await page.goto("/login");
    const body = (await page.locator("body").innerText()).toLowerCase();
    expect(body).not.toContain("purchase order");
    expect(body).not.toContain("goods receipt");
    expect(body).not.toContain("supplier advance");
  });

  test("no document, amount or banking detail is rendered on an anonymous response", async ({ page }) => {
    for (const route of [
      "/procurement/purchase-orders",
      "/procurement/supplier-advances",
      "/procurement/suppliers",
      "/procurement/documents",
    ]) {
      await page.goto(route);
      const body = (await page.locator("body").innerText()).toLowerCase();
      expect(body).not.toContain("account number");
      expect(body).not.toContain("treasury reference");
      expect(body).not.toContain("bank transfer");
    }
  });

  test("a report route does not produce a report for an anonymous visitor", async ({ page }) => {
    await page.goto("/procurement/reports/supplier-balance-position");
    await expect(page).toHaveURL(/\/login/);
    const body = (await page.locator("body").innerText()).toLowerCase();
    expect(body).not.toContain("confirmed payable");
  });
});
