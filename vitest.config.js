const { defineConfig } = require("vitest/config");

// Solo las pruebas unitarias. Los tests de Playwright están en tests/e2e.
module.exports = defineConfig({
  test: {
    include: ["tests/unit/**/*.test.js"],
  },
});
