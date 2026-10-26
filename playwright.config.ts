import { defineConfig, devices } from "@playwright/test";

// End-to-end tests run against the production build: `npm run build && npm run test:e2e`.
export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: "http://localhost:4173", trace: "retain-on-failure" },
  projects: [{ name: "mobile", use: { ...devices["Pixel 7"] } }],
  webServer: {
    command: "node scripts/serve.mjs out 4173",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
  },
});
