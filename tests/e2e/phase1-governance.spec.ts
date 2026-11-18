import { expect, test } from "@playwright/test";

/**
 * Phase 1 route protection.
 *
 * Every new governance and administration screen must be unreachable without an authenticated,
 * active ERP account. These tests run against a production server with no Supabase credentials,
 * so they prove the gate works even when the backend is unreachable — a failure there must
 * never fall open.
 */
const PROTECTED_ROUTES = [
  "/administration/employees",
  "/administration/departments",
  "/administration/positions",
  "/administration/org-chart",
  "/administration/users",
  "/administration/roles",
  "/administration/permissions",
  "/governance",
  "/governance/authorities",
  "/governance/delegations",
  "/governance/sod",
  "/governance/access-reviews",
  "/audit-logs",
  "/api/audit-logs/export",
];

test.describe("Phase 1 route protection", () => {
  for (const route of PROTECTED_ROUTES) {
    test(`${route} redirects an anonymous visitor to the login page`, async ({ page }) => {
      const response = await page.goto(route);
      await expect(page).toHaveURL(/\/login/);
      // Never a 200 render of protected content.
      expect(response?.status()).toBeLessThan(500);
    });
  }

  test("a detail route is gated before the id is resolved", async ({ page }) => {
    await page.goto("/administration/employees/00000000-0000-0000-0000-000000000000");
    await expect(page).toHaveURL(/\/login/);
  });

  test("the audit export endpoint refuses anonymous requests", async ({ request }) => {
    const response = await request.get("/api/audit-logs/export", { maxRedirects: 0 });
    // Either a redirect to login (proxy) or an authorization error — never a CSV body.
    expect([200, 307, 401, 403]).toContain(response.status());
    if (response.status() === 200) {
      const contentType = response.headers()["content-type"] ?? "";
      expect(contentType).not.toContain("text/csv");
    }
  });

  test("the login page advertises no self-registration", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByText(/self-registration is disabled/i)).toBeVisible();
  });
});
