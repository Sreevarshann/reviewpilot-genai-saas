import { expect, type Page, test } from "@playwright/test";

/**
 * The 12-step product demo as one serial journey against the isolated stack (fixture LLM,
 * real BullMQ worker + SSE). Every step asserts persisted state visible in the UI or API.
 */
test.describe.configure({ mode: "serial" });

const PASSWORD = "e2e-password-not-secret";
const OWNER = { name: "Maya Chen", email: "maya@acme-e2e.test" };
const REVIEWER = { name: "Leo Park", email: "leo@acme-e2e.test" };
const OUTSIDER = { name: "Sam Rivera", email: "sam@globex-e2e.test" };
let reviewUrl = "";

async function register(page: Page, u: { name: string; email: string }, org?: string, next?: string) {
  await page.goto(next ? `/register?next=${encodeURIComponent(next)}` : "/register");
  await page.getByLabel("Name").fill(u.name);
  await page.getByLabel("Work email").fill(u.email);
  await page.getByLabel("Password").fill(PASSWORD);
  if (org) await page.getByLabel("Organization").fill(org);
  await page.getByRole("button", { name: "Create account" }).click();
}

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/o\/[\w-]+$/);
}

test("1. owner signs up and lands in a new organization", async ({ page }) => {
  await register(page, OWNER, "Acme Engineering");
  await expect(page).toHaveURL(/\/o\/acme-engineering$/);
  await expect(page.getByRole("heading", { name: "Reviews", exact: true })).toBeVisible();
  await expect(page.getByText("No reviews yet")).toBeVisible();
});

test("2-3. submits the sample diff and follows the live pipeline to completion", async ({ page }) => {
  await login(page, OWNER.email);
  await page.getByRole("link", { name: "New review" }).first().click();
  await expect(page).toHaveURL(/\/reviews\/new$/);
  await page.getByPlaceholder("First project name").fill("orders-service");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Project", exact: true })).toHaveValue(/.+/);
  await page.getByRole("button", { name: "Load sample diff" }).click();
  await expect(page.getByLabel("Diff")).toHaveValue(/diff --git a\/src\/orders\/orders.repository.ts/);
  await page.getByRole("button", { name: "Run review" }).click();
  await expect(page).toHaveURL(/\/reviews\/(?!new$)\w+$/);
  reviewUrl = new URL(page.url()).pathname;
  const pipeline = page.getByRole("list", { name: "Review pipeline progress" });
  await expect(pipeline.getByText("Parse diff")).toBeVisible();
  await expect(pipeline.getByText(/\d+ kept · \d+ discarded/)).toBeVisible({ timeout: 60_000 });
  await expect(pipeline.locator("li").last().getByText(/\d+ findings/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "SQL built from untrusted values" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Diff of src/orders/orders.repository.ts" })).toBeVisible();
});

test("4-5. triages findings from the diff gutter and discusses one", async ({ page }) => {
  await login(page, OWNER.email);
  await page.goto(reviewUrl);
  await page.getByRole("button", { name: /finding.* on line 6: SQL built from untrusted values/ }).click();
  const card = page.locator("article", { has: page.getByRole("heading", { name: "SQL built from untrusted values" }) });
  await expect(card.getByText("Evidence")).toBeVisible();
  await card.getByLabel("Triage note").fill("Confirmed: concatenated id");
  await card.getByRole("button", { name: "Accept" }).click();
  await expect(card.getByRole("button", { name: "Reopen" })).toBeVisible();
  await card.getByLabel("Comment").fill("Switching to a bound parameter.");
  await card.getByRole("button", { name: "Post" }).click();
  await expect(card.getByText("Switching to a bound parameter.")).toBeVisible();
  // the triage note is kept in the discussion alongside the comment
  await expect(card.getByText("Discussion (2)")).toBeVisible();
  await expect(card.getByText("Confirmed: concatenated id")).toBeVisible();
  const todo = page.locator("article", { has: page.getByRole("heading", { name: "Unresolved TODO added" }) });
  await todo.getByRole("button", { name: /Unresolved TODO added/ }).click();
  await todo.getByRole("button", { name: "Dismiss" }).click();
  await expect(todo.getByText("Dismissed")).toBeVisible();
  await page.getByLabel("State").selectOption("ACCEPTED");
  await expect(page.locator("aside[aria-label=Findings] article")).toHaveCount(1);
});

test("6-7. re-runs as v2, compares versions and exports SARIF", async ({ page }) => {
  await login(page, OWNER.email);
  await page.goto(reviewUrl);
  await page.getByRole("button", { name: "Re-run as v2" }).click();
  await expect(page.getByText("v2", { exact: true })).toBeVisible();
  await expect(page.getByRole("list", { name: "Review pipeline progress" }).locator("li").last().getByText(/\d+ findings/)).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Compare with v1" }).click();
  await expect(page.getByText("Still present")).toBeVisible();
  const id = new URL(page.url()).pathname.split("/").pop();
  const sarif = await page.request.get(`/api/orgs/acme-engineering/reviews/${id}/export?format=sarif`);
  expect(sarif.ok()).toBe(true);
  const doc = await sarif.json();
  expect(doc.version).toBe("2.1.0");
  expect(doc.runs[0].results.length).toBeGreaterThan(0);
});

test("8. invites a reviewer who accepts through the development mailbox", async ({ page, browser }) => {
  await login(page, OWNER.email);
  await page.goto("/o/acme-engineering/settings");
  await page.getByRole("tab", { name: "Members" }).click();
  await page.getByLabel("Invite email").fill(REVIEWER.email);
  await page.getByRole("button", { name: "Send invite" }).click();
  await expect(page.getByText(REVIEWER.email)).toBeVisible();

  const ctx = await browser.newContext();
  const rp = await ctx.newPage();
  await rp.goto(`/mailbox?email=${encodeURIComponent(REVIEWER.email)}`);
  const link = rp.getByRole("link", { name: /\/invite\?token=/ });
  const href = await link.getAttribute("href");
  await register(rp, REVIEWER, undefined, href!);
  await expect(rp).toHaveURL(/\/invite\?token=/);
  await rp.getByRole("button", { name: "Accept invitation" }).click();
  await expect(rp).toHaveURL(/\/o\/acme-engineering$/);
  await expect(rp.getByText("Orders: item listing and discount endpoint").first()).toBeVisible();
  await rp.goto("/o/acme-engineering/settings");
  await expect(rp.getByRole("tab", { name: "Members" })).toBeVisible();
  await expect(rp.getByRole("tab", { name: "API tokens" })).toHaveCount(0);
  await ctx.close();
});

test("9. creates an API token that is shown exactly once", async ({ page, playwright, baseURL }) => {
  await login(page, OWNER.email);
  await page.goto("/o/acme-engineering/settings");
  await page.getByRole("tab", { name: "API tokens" }).click();
  await page.getByLabel("Token name").fill("ci-pipeline");
  await page.getByRole("button", { name: "Create" }).click();
  const code = page.locator("code", { hasText: /^rpk_[\w-]{40,}$/ });
  const token = (await code.textContent())!;
  // a cookie-less client: only the bearer token authenticates
  const machine = await playwright.request.newContext({ baseURL });
  expect((await machine.get("/api/orgs/acme-engineering/reviews")).status()).toBe(401);
  const res = await machine.get("/api/orgs/acme-engineering/reviews", { headers: { Authorization: `Bearer ${token}` } });
  expect(res.ok()).toBe(true);
  expect((await res.json()).length).toBe(2);
  expect((await machine.get("/api/orgs/acme-engineering/api-tokens", { headers: { Authorization: `Bearer ${token}` } })).status()).toBe(403);
  await machine.dispose();
  await page.reload();
  await page.getByRole("tab", { name: "API tokens" }).click();
  await expect(page.getByText("ci-pipeline")).toBeVisible();
  await expect(page.locator("code", { hasText: /^rpk_[\w-]{20,}$/ })).toHaveCount(0);
});

test("10. analytics reflect stored reviews and triage", async ({ page }) => {
  await login(page, OWNER.email);
  await page.goto("/o/acme-engineering/analytics");
  await expect(page.getByText("Reviews", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("img", { name: "Findings by severity" })).toBeVisible();
  await expect(page.getByText("Acceptance (triaged)")).toBeVisible();
  await expect(page.getByText(/rules 50%/)).toBeVisible();
});

test("11. mock plan change never charges", async ({ page }) => {
  await login(page, OWNER.email);
  await page.goto("/o/acme-engineering/settings");
  await page.getByRole("tab", { name: "Plan & usage" }).click();
  await expect(page.getByText(/nothing is charged/)).toBeVisible();
  await page.getByRole("button", { name: "Switch (demo)" }).first().click();
  await expect(page.getByText(/nothing was charged/)).toBeVisible();
});

test("12. another organization cannot see Acme's data", async ({ page }) => {
  await register(page, OUTSIDER, "Globex Labs");
  await expect(page).toHaveURL(/\/o\/globex-labs$/);
  await page.goto("/o/acme-engineering");
  await expect(page.getByRole("heading", { name: "Organization not found" })).toBeVisible();
  await page.goto(reviewUrl);
  await expect(page.getByRole("heading", { name: "Organization not found" })).toBeVisible();
  const api = await page.request.get(`/api${reviewUrl.replace("/o/", "/orgs/")}`);
  expect(api.status()).toBe(404);
});
