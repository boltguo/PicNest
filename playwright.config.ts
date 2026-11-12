import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  workers: 1,
  use: {
    baseURL: "http://localhost:5173",
    browserName: "chromium",
    locale: "en-US",
    viewport: { width: 1280, height: 900 },
    permissions: ["clipboard-read", "clipboard-write"],
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: "node --import tsx tests/serve.ts",
      port: 8787,
      timeout: 60_000,
    },
    {
      command: "pnpm -F @picnest/web dev --host 127.0.0.1",
      port: 5173,
      timeout: 60_000,
    },
  ],
});
