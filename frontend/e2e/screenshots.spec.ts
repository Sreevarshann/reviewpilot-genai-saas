/**
 * Real screenshots of the running stack seeded by backend/scripts/seed-demo.mjs (live
 * Ollama model, real worker). Not part of CI:
 *   SCREENSHOT_BASE_URL=http://localhost:3103 npx playwright test
 */
import { expect, type Page, test } from "@playwright/test";
import path from "node:path";

const out = (n: string) => path.join(__dirname, "..", "..", "docs", "screenshots", `${n}.png`);
const PASSWORD = process.env.DEMO_PASSWORD ?? "reviewpilot-demo-only";
const ORG = "/o/acme-engineering";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/o\/[\w-]+$/);
}
const settle = (page: Page, ms = 900) => page.waitForTimeout(ms);

test("capture", async ({ page, browser }) => {
  test.setTimeout(600_000);
  await page.goto("/login");
  await settle(page);
  await page.screenshot({ path: out("01-sign-in") });

  await login(page, "maya@acme.test");
  await expect(page.getByRole("region", { name: "Review list" }).getByText("Orders: item listing and discount endpoint (revised)")).toBeVisible();
  await settle(page);
  await page.screenshot({ path: out("02-reviews-dashboard") });

  // the original review (v1), reviewed by the live model; select a model finding
  await page.getByRole("region", { name: "Review list" }).getByText("Orders: item listing and discount endpoint", { exact: true }).last().click();
  await expect(page.getByRole("list", { name: "Review pipeline progress" }).getByText(/kept/)).toBeVisible();
  await settle(page, 1200);
  await page.screenshot({ path: out("03-review-detail") });
  const sql = page.locator("article", { has: page.getByRole("heading", { name: "SQL built from untrusted values" }) });
  await sql.getByRole("button", { name: /SQL built from untrusted values/ }).click();
  await settle(page, 1200);
  await page.screenshot({ path: out("04-finding-evidence-triage") });
  await page.getByText(/model suggestions? discarded by grounding checks/).click().catch(() => undefined);
  await settle(page, 600);
  await page.getByRole("list", { name: "Review pipeline progress" }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: out("05-grounding-discarded"), clip: { x: 240, y: 0, width: 1200, height: 420 } });

  // version 2 after fixes, compared with v1
  await page.goto(ORG);
  await page.getByText("Orders: item listing and discount endpoint (revised)").click();
  await page.getByRole("button", { name: "Compare with v1" }).click();
  await expect(page.getByText(/Resolved since v1/)).toBeVisible();
  await settle(page, 1200);
  await page.screenshot({ path: out("06-version-compare") });

  // live submission: capture the SSE timeline mid-run, then wait for completion
  await page.goto(`${ORG}/reviews/new`);
  await page.getByRole("button", { name: "Load sample diff" }).click();
  await page.getByLabel("Title").fill("Orders: discount endpoint follow-up");
  await settle(page, 500);
  await page.screenshot({ path: out("07-new-review") });
  await page.getByRole("button", { name: "Run review" }).click();
  await expect(page.getByText("Running…").first()).toBeVisible({ timeout: 30_000 });
  await settle(page, 1500);
  await page.screenshot({ path: out("08-live-progress"), clip: { x: 240, y: 0, width: 1200, height: 420 } });
  await expect(page.getByRole("list", { name: "Review pipeline progress" }).getByText(/kept/)).toBeVisible({ timeout: 240_000 });

  await page.goto(`${ORG}/settings`);
  await page.getByRole("tab", { name: "Members" }).click();
  await settle(page);
  await page.screenshot({ path: out("10-members") });
  await page.request.post(`/api/orgs/acme-engineering/api-tokens`, { data: { name: "ci-pipeline" }, headers: { "X-Requested-With": "reviewpilot" } });
  await page.reload();
  await page.getByRole("tab", { name: "API tokens" }).click();
  await settle(page);
  await page.screenshot({ path: out("11-api-tokens") });
  await page.getByRole("tab", { name: "Plan & usage" }).click();
  await settle(page);
  await page.screenshot({ path: out("12-plan-usage") });
  await page.getByRole("tab", { name: "Audit log" }).click();
  await settle(page, 1200);
  await page.screenshot({ path: out("13-audit-log") });

  // dark theme
  await page.goto(ORG);
  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  await page.getByRole("region", { name: "Review list" }).getByText("Orders: item listing and discount endpoint", { exact: true }).last().click();
  await expect(page.getByRole("list", { name: "Review pipeline progress" }).getByText(/kept/)).toBeVisible();
  await settle(page, 1500);
  await page.screenshot({ path: out("14-review-dark") });
  await page.getByRole("button", { name: "Switch to light theme" }).click();

  // tenant isolation: a member of another organization
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const other = await ctx.newPage();
  await login(other, "sam@globex.test");
  await other.goto(ORG);
  await expect(other.getByRole("heading", { name: "Organization not found" })).toBeVisible();
  await settle(other);
  await other.screenshot({ path: out("15-tenant-isolation") });
  await ctx.close();

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const m = await phone.newPage();
  await login(m, "leo@acme.test");
  await settle(m, 1200);
  await m.screenshot({ path: out("16-mobile-dashboard") });
  await phone.close();
});

// separate so it can be re-captured alone (-g analytics) without submitting another live review
test("analytics", async ({ page }) => {
  await login(page, "maya@acme.test");
  await page.goto(`${ORG}/analytics`);
  await expect(page.getByRole("img", { name: "Findings by severity" })).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1330 });
  await settle(page, 2500);
  await page.screenshot({ path: out("09-analytics") });
  await page.setViewportSize({ width: 1440, height: 900 });

});
