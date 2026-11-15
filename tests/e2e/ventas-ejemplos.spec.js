const { test, expect } = require("@playwright/test");
const { iniciarSesionComo } = require("./helpers");

// Sin Backend: las pantallas de Ventas usan los datos de ejemplo de frontend/js/mocks/ventas.js
// (15 productos, 4 clientes y 4 ventas de ejemplo; la próxima venta es la 00001-00000455).
test.describe("Ventas con datos de ejemplo (sin Backend)", () => {
  test("Nueva venta muestra los productos de ejemplo y cobra sin Backend", async ({ page }) => {
    await iniciarSesionComo(page, "ADMIN");
    await page.goto("/ventas.html");
    await expect(page.getByTestId("venta-producto-1")).toBeVisible();
    await expect(page.locator("[data-testid^=venta-producto-]")).toHaveCount(15);

    await page.getByTestId("venta-producto-3").click();
    await page.getByTestId("venta-cobrar").click();
    await page.getByTestId("venta-medio-pago").selectOption("1");
    await page.getByTestId("venta-confirmar").click();
    await expect(page.getByTestId("venta-confirmada")).toContainText("00001-00000455");
  });

  test("la venta recién hecha aparece en el Historial", async ({ page }) => {
    await iniciarSesionComo(page, "ADMIN");
    await page.goto("/ventas.html");
    await page.getByTestId("venta-producto-4").click();
    await page.getByTestId("venta-cobrar").click();
    await page.getByTestId("venta-medio-pago").selectOption("1");
    await page.getByTestId("venta-confirmar").click();
    await expect(page.getByTestId("venta-confirmada")).toBeVisible();

    await page.goto("/historial-ventas.html");
    await expect(page.getByTestId("ventas-fila-5")).toContainText("00001-00000455");
    await expect(page.getByTestId("ventas-fila-2")).toBeVisible();
  });

  test("el Cajero también ve los productos de ejemplo", async ({ page }) => {
    await iniciarSesionComo(page, "CAJERO");
    await page.goto("/ventas.html");
    await expect(page.locator("[data-testid^=venta-producto-]")).toHaveCount(15);
  });
});
