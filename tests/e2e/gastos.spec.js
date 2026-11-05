const { test, expect } = require("@playwright/test");
const { simularApi, iniciarSesionComo } = require("./helpers");

// Datos simulados de la pantalla (mocks/gastos.js): 7 gastos, total $ 995.051,25.
const TOTAL_INICIAL = /995\.051,25/;
const MEDIOS = [
  { id: 1, nombre: "Efectivo" },
  { id: 2, nombre: "Transferencia" },
];

const abrirGastos = async (page, rol = "ADMIN", { medios = null } = {}) => {
  await simularApi(page, { "GET /auth/yo": { status: 200, body: {} } });
  // Se intercepta por ruta (sin importar el host) para no depender de la IP que tenga config.js.
  await page.route("**/api/medios-pago", (route) =>
    medios
      ? route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(medios) })
      : route.fulfill({ status: 404, headers: { "access-control-allow-origin": "*" }, body: "{}" }),
  );
  await iniciarSesionComo(page, rol);
  await page.goto("/gastos.html");
};

test.describe("Gastos operativos", () => {
  test("solo permite editar y eliminar (sin ocultar)", async ({ page }) => {
    await abrirGastos(page);
    await expect(page.getByTestId("gastos-tabla").locator("tbody tr")).toHaveCount(7);
    await expect(page.getByTestId("gastos-editar-1")).toBeVisible();
    await expect(page.getByTestId("gastos-eliminar-1")).toBeVisible();
    await expect(page.getByTestId("gastos-ocultar-1")).toHaveCount(0);
    await expect(page.getByTestId("gastos-ver-ocultos")).toHaveCount(0);
  });

  test("muestra el total del período arriba y lo recalcula al cambiar el período", async ({ page }) => {
    await abrirGastos(page);
    await expect(page.getByTestId("gastos-total")).toHaveText(TOTAL_INICIAL);
    await expect(page.getByTestId("gastos-total-detalle")).toHaveText("7 gastos");
    await page.getByTestId("gastos-filtro-fecha").selectOption("hoy");
    await expect(page.getByTestId("gastos-total-detalle")).toHaveText("0 gastos");
  });

  test("editar el monto cambia el total", async ({ page }) => {
    await abrirGastos(page);
    await page.getByTestId("gastos-editar-2").click(); // Luz: 38.250,50
    await page.locator("#monto").fill("50000");
    await page.getByTestId("modal-guardar").click();
    await expect(page.getByTestId("gastos-total")).toHaveText(/1\.006\.800,75/, { timeout: 5000 });
  });

  test("eliminar pide confirmación y baja el total", async ({ page }) => {
    await abrirGastos(page);
    await page.getByTestId("gastos-eliminar-2").click();
    await page.getByTestId("modal-cancelar").click();
    await expect(page.getByTestId("gastos-total-detalle")).toHaveText("7 gastos");

    await page.getByTestId("gastos-eliminar-2").click();
    await page.getByTestId("modal-confirmar").click();
    await expect(page.getByTestId("gastos-total-detalle")).toHaveText("6 gastos");
    await expect(page.getByTestId("gastos-total")).toHaveText(/956\.800,75/);
  });

  test("acepta una fecha futura", async ({ page }) => {
    await abrirGastos(page);
    await page.getByTestId("gastos-nuevo").click();
    await page.locator("#fecha").fill("01-01-2099");
    await page.locator("#concepto").fill("Seguro anual");
    await page.locator("#monto").fill("1000");
    await page.getByTestId("modal-guardar").click();
    await expect(page.getByTestId("gastos-total-detalle")).toHaveText("8 gastos", { timeout: 5000 });
  });

  test("sin medios de pago el select queda deshabilitado con el mensaje", async ({ page }) => {
    await abrirGastos(page);
    await page.getByTestId("gastos-nuevo").click();
    await expect(page.locator("#medio_pago_id")).toBeDisabled();
    await expect(page.getByTestId("gastos-sin-medios-pago")).toBeVisible();
  });

  test("con medios de pago el select se activa y se guarda el elegido", async ({ page }) => {
    await abrirGastos(page, "ADMIN", { medios: MEDIOS });
    await page.getByTestId("gastos-nuevo").click();
    await expect(page.locator("#medio_pago_id")).toBeEnabled();
    await expect(page.getByTestId("gastos-sin-medios-pago")).toHaveCount(0);
    await page.locator("#fecha").fill("10-05-2026");
    await page.locator("#concepto").fill("Fletes de mayo");
    await page.locator("#monto").fill("2500");
    await page.locator("#medio_pago_id").selectOption("2");
    await page.getByTestId("modal-guardar").click();
    await expect(page.getByRole("row", { name: /Fletes de mayo/ })).toContainText("Transferencia", { timeout: 5000 });
  });

  test("el Cajero no entra a Gastos", async ({ page }) => {
    await abrirGastos(page, "CAJERO");
    await expect(page).toHaveURL(/dashboard\.html$/);
  });
});
