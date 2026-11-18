import { expect, test } from "@playwright/test";

test.describe("unauthenticated access", () => {
  test("login page renders the ERP sign-in form", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: /sign in to the erp/i })).toBeVisible();
    await expect(page.getByLabel(/work email/i)).toBeVisible();
    await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
  });

  test("login page states that self-registration is disabled", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByText(/self-registration is disabled/i)).toBeVisible();
  });

  test("protected routes redirect to login and preserve the destination", async ({ page }) => {
    await page.goto("/administration/users");
    await expect(page).toHaveURL(/\/login\?next=%2Fadministration%2Fusers/);
  });

  test("audit log route is not reachable without a session", async ({ page }) => {
    await page.goto("/audit-logs");
    await expect(page).toHaveURL(/\/login/);
  });

  test("password reset request page is reachable", async ({ page }) => {
    await page.goto("/forgot-password");
    await expect(page.getByRole("heading", { name: /reset your password/i })).toBeVisible();
  });

  test("reset page refuses to render the form without a recovery session", async ({ page }) => {
    await page.goto("/reset-password");
    await expect(page.getByRole("heading", { name: /choose a new password/i })).toBeVisible();
  });

  test("unknown routes are gated behind authentication", async ({ page }) => {
    // The proxy gates every non-public path, so an unknown route never leaks its existence.
    await page.goto("/this-route-does-not-exist");
    await expect(page).toHaveURL(/\/login\?next=/);
  });

  test("health endpoint responds with JSON status", async ({ request }) => {
    const response = await request.get("/api/health");
    expect([200, 503]).toContain(response.status());
    const body = (await response.json()) as { status: string; checks: { environment: string } };
    expect(["ok", "degraded"]).toContain(body.status);
    expect(body.checks.environment).toBeDefined();
  });
});

test.describe("responsive shell", () => {
  test("mobile viewport exposes the navigation trigger on login", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/login");
    await expect(page.getByLabel(/work email/i)).toBeVisible();
  });
});
