import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests.
 *
 * These run against a locally started production server with NO Supabase credentials, which
 * lets us verify the unauthenticated journeys (login rendering, protected-route redirection,
 * configuration error surfacing, health endpoint). Authenticated journeys require a live
 * Supabase project and are documented as outstanding work in docs/phase-0-acceptance.md.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3200",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npm run start -- --port 3200",
        url: "http://127.0.0.1:3200/login",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        // Deliberately valid-looking but unreachable credentials: the suite proves that the
        // application fails closed when the backend cannot be reached, and that environment
        // validation surfaces a readable error instead of a blank page.
        env: {
          NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3200",
          NEXT_PUBLIC_SUPABASE_URL: "https://placeholder.supabase.co",
          NEXT_PUBLIC_SUPABASE_ANON_KEY:
            "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.placeholder.placeholder",
          SUPABASE_SERVICE_ROLE_KEY:
            "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.placeholder-service-role.placeholder",
        },
      },
});
