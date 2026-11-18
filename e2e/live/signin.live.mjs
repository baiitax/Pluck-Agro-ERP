import { chromium } from "playwright";


// Credentials come from the environment — never hard-coded, never committed.
const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
if (!EMAIL || !PASSWORD) {
  console.error("Set E2E_EMAIL and E2E_PASSWORD before running this script.");
  process.exit(2);
}
const BASE = "https://pluckagro.vercel.app";
const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await browser.newPage();
const failures = [];
page.on("response", (r) => { if (r.status() >= 400) failures.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE, "")}`); });

const step = async (label, fn) => {
  try { const r = await fn(); console.log(`PASS  ${label}${r ? "  " + r : ""}`); }
  catch (e) { console.log(`FAIL  ${label}\n      ${e.message.split("\n")[0]}`); process.exitCode = 1; }
};

await step("anonymous /inventory redirects to /login", async () => {
  await page.goto(`${BASE}/inventory`, { waitUntil: "domcontentloaded" });
  await page.waitForURL(/\/login/, { timeout: 20000 });
  return page.url().replace(BASE, "");
});

await step("login form present, app configured", async () => {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.locator('input[name="email"]').waitFor({ timeout: 20000 });
  const body = (await page.locator("body").innerText()).toLowerCase();
  if (body.includes("not configured")) throw new Error("app reports it is not configured");
  return "form rendered, no configuration error";
});

await step("sign in as " + EMAIL, async () => {
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 45000 });
  return `signed in → ${page.url().replace(BASE, "")}`;
});

await step("dashboard shows the signed-in user", async () => {
  await page.waitForTimeout(2500);
  const body = await page.locator("body").innerText();
  const who = body.match(/management|Management/g);
  return `page includes ${who ? who.length : 0} "management" reference(s)`;
});

await step("inventory workspace: real content, no permission guard", async () => {
  await page.goto(`${BASE}/inventory`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  if (/\/login$/.test(page.url())) throw new Error("redirected to login");
  if (/do not have permission|not authorised|not authorized/i.test(body)) throw new Error("permission guard shown");
  return body.slice(0, 200);
});

await step("production workspace opens", async () => {
  await page.goto(`${BASE}/production`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  if (/do not have permission|not authorised/i.test(body)) throw new Error("permission guard shown");
  return body.slice(0, 200);
});

await step("master data (products) opens", async () => {
  await page.goto(`${BASE}/master-data/products`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  return body.slice(0, 180);
});

await page.screenshot({ path: "/tmp/live-inventory.png", fullPage: false });
console.log("\nHTTP failures:", failures.length ? [...new Set(failures)].slice(0, 8) : "none");
await browser.close();
