import { expect, test } from "@playwright/test";

/**
 * Phase 5 — quality management workspace, unauthenticated surface.
 *
 * Same discipline as the Phase 3 and Phase 4 suites: prove the part that can be proven without a live backend. Every
 * quality route is gated before a query runs, a deep link is gated before its identifier is trusted, and no
 * inspection, hold, certificate or conformance figure reaches an anonymous visitor.
 *
 * The authenticated journeys — raise a specification, approve it, inspect a lot, record results, decide and
 * disposition it, place and release a hold, raise and close an NCR with corrective actions, issue a certificate and
 * read traceability — need a deployed Supabase project and are recorded as outstanding in docs/phase-5-report.md.
 * They are not simulated here, because a simulated pass is not evidence. The behaviours underneath them are covered
 * by tests/database/quality.test.ts.
 */

const QUALITY_ROUTES = [
  "/quality",
  "/quality/specifications",
  "/quality/specifications/new",
  "/quality/inspections",
  "/quality/inspections/new",
  "/quality/dispositions",
  "/quality/holds",
  "/quality/ncr",
  "/quality/ncr/new",
  "/quality/certificates",
  "/quality/traceability",
  "/quality/reports",
];

const ID = "00000000-0000-0000-0000-000000000000";

const DEEP_LINKS = [
  `/quality/specifications/${ID}`,
  `/quality/inspections/${ID}`,
  `/quality/ncr/${ID}`,
  `/quality/certificates/${ID}`,
];

/**
 * Phrases that only exist inside the quality workspace. If any of these appear on an anonymous response, a query ran
 * before authorisation and the page is leaking the shape of the business.
 */
const QUALITY_VOCABULARY = [
  "moisture",
  "conformance",
  "disposition",
  "certificate of analysis",
  "non-conformance",
  "corrective action",
  "on hold",
  "traceability",
  "specification limit",
];

test.describe("Phase 5 quality route protection", () => {
  for (const route of QUALITY_ROUTES) {
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

  test("the login page does not disclose the quality workspace", async ({ page }) => {
    await page.goto("/login");
    const body = (await page.locator("body").innerText()).toLowerCase();
    for (const phrase of QUALITY_VOCABULARY) {
      expect(body, phrase).not.toContain(phrase);
    }
  });

  test("no inspection, hold or conformance figure is rendered on an anonymous response", async ({ page }) => {
    for (const route of ["/quality", "/quality/inspections", "/quality/holds", "/quality/reports"]) {
      await page.goto(route);
      const body = (await page.locator("body").innerText()).toLowerCase();
      expect(body).not.toContain("pending inspection");
      expect(body).not.toContain("restricted quantity");
      expect(body).not.toContain("non-conforming");
      expect(body).not.toContain("accreditation");
    }
  });

  test("a certificate deep link does not produce a certificate for an anonymous visitor", async ({ page }) => {
    await page.goto(`/quality/certificates/${ID}`);
    await expect(page).toHaveURL(/\/login/);
    const body = (await page.locator("body").innerText()).toLowerCase();
    expect(body).not.toContain("certificate number");
    expect(body).not.toContain("certificate status");
    expect(body).not.toContain("specification version");
  });

  test("an inspection deep link does not produce test results for an anonymous visitor", async ({ page }) => {
    await page.goto(`/quality/inspections/${ID}`);
    await expect(page).toHaveURL(/\/login/);
    const body = (await page.locator("body").innerText()).toLowerCase();
    expect(body).not.toContain("measured value");
    expect(body).not.toContain("sample");
  });

  test("no quality route answers 500 when the backend is unreachable", async ({ page }) => {
    // The suite runs against deliberately unreachable credentials. A 500 means an unhandled exception escaped a page
    // instead of the application failing closed at the auth boundary.
    for (const route of ["/quality", "/quality/inspections/new", "/quality/traceability"]) {
      const response = await page.goto(route);
      expect(response?.status(), route).toBeLessThan(500);
    }
  });
});
