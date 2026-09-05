import { defineConfig, devices } from "@playwright/test";

/** Which app directory to serve: the pristine sample app, or a breakage
 *  variant materialised under .breakage-build/ by breakages/apply.mjs. */
const appDir = process.env.FORMIC_APP_DIR ?? "sample-app";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: "http://app.localhost:4173",
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: `npx --yes http-server ${appDir} -p 4173 -c-1 --silent`,
    url: "http://app.localhost:4173",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
