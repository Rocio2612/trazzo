const { defineConfig } = require("@playwright/test");

// Los tests levantan el frontend estático y simulan la API (ver tests/helpers.js),
// así que no necesitan el backend corriendo.
module.exports = defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:4173",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: "npx http-server frontend -p 4173 -c-1 --silent",
    url: "http://localhost:4173/login.html",
    reuseExistingServer: true,
  },
});
