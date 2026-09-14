import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  workers: 1,
  use: { baseURL: "http://127.0.0.1:8876", viewport: { width: 1280, height: 900 } },
  webServer: {
    command: "node tests/serve-fixture.js",
    url: "http://127.0.0.1:8876",
    timeout: 30000,
  },
});
