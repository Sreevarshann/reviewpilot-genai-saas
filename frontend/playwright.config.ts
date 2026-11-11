import { defineConfig, devices } from "@playwright/test";

// E2E: isolated API (fresh DB, real BullMQ worker, fixture LLM) + production web build.
// Screenshots: SCREENSHOT_BASE_URL=http://localhost:3103 npx playwright test (running stack, live model).
const E2E = !process.env.SCREENSHOT_BASE_URL;
const API = "http://127.0.0.1:8193";

export default defineConfig({
  testDir: "./e2e",
  testMatch: E2E ? /.*\.e2e\.ts/ : /screenshots\.spec\.ts/,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL: process.env.SCREENSHOT_BASE_URL ?? "http://127.0.0.1:3193", trace: "retain-on-failure", colorScheme: "light" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: E2E
    ? [
        { command: "../backend/scripts/e2e-api.sh", url: `${API}/api/health`, timeout: 180_000, reuseExistingServer: false },
        { command: `NEXT_DIST_DIR=.next-e2e REVIEWPILOT_API_ORIGIN=${API} npm run build && NEXT_DIST_DIR=.next-e2e REVIEWPILOT_API_ORIGIN=${API} npx next start --port 3193 --hostname 127.0.0.1`, url: "http://127.0.0.1:3193/login", timeout: 300_000, reuseExistingServer: false },
      ]
    : undefined,
});
