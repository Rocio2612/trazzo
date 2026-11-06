const { test, expect } = require("@playwright/test");
const { simularApi, iniciarSesionComo } = require("./helpers");

// Datos simulados de la pantalla (mocks/gastos.js): 7 gastos, total $ 995.051,25.
const TOTAL_INICIAL = /995\.051,25/;
const MEDIOS = [
  { id: 1, nombre: "Efectivo" },
  { id: 2, nombre: "Transferencia" },
];

// `medios`: lo que responde la API de medios de pago. `guardados`: los medios que la pantalla de Configuración
// dejó guardados en el navegador (se usan mientras no exista la API). Sin ninguno de los dos, hay Efectivo y Transferencia.
const abrirGastos = async (page, rol = "ADMIN", { medios = null, guardados = null } = {}) => {
  if (guardados !== null) {
    await page.addInitScript((lista) => {
      localStorage.setItem("trazzo_mock_listas", JSON.stringify({ categorias: [], medios_pago: lista }));
    }, guardados);
  }
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
    await expect(page.getByTestId("gastos-total-titulo")).toHaveText("Total acumulado");
    await expect(page.getByTestId("gastos-total-detalle")).toHaveText("7 gastos");
    await page.getByTestId("gastos-filtro-fecha").selectOption("hoy");
    await expect(page.getByTestId("gastos-total-titulo")).toHaveText("Total de hoy");
    await expect(page.getByTestId("gastos-total-detalle")).toHaveText("0 gastos");
    await page.getByTestId("gastos-filtro-fecha").selectOption("mes");
    await expect(page.getByTestId("gastos-total-titulo")).toHaveText("Total de este mes");
    await page.getByTestId("gastos-filtro-fecha").selectOption("anio");
    await expect(page.getByTestId("gastos-total-titulo")).toHaveText("Total de este año");
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

  test("sin medios de pago el mensaje va dentro del desplegable", async ({ page }) => {
    await abrirGastos(page, "ADMIN", { guardados: [] });
    await page.getByTestId("gastos-nuevo").click();
    await expect(page.locator("#medio_pago_id")).toBeDisabled();
    await expect(page.locator("#medio_pago_id option")).toHaveText("Sin medios de pago. Creá uno en Configuración > Medios de pago");
  });

  test("con medios de pago el select se activa y se guarda el elegido", async ({ page }) => {
    await abrirGastos(page, "ADMIN", { medios: MEDIOS });
    await page.getByTestId("gastos-nuevo").click();
    await expect(page.locator("#medio_pago_id")).toBeEnabled();
    await expect(page.locator("#medio_pago_id option")).toHaveText(["Sin especificar", "Efectivo", "Transferencia"]);
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

  test("el desplegable se alimenta con los medios de pago creados en Configuración", async ({ page }) => {
    await abrirGastos(page, "PROPIETARIO");
    await page.goto("/configuracion.html#medios-pago");
    await page.getByTestId("medios_pago-nombre").fill("Débito");
    await page.getByTestId("medios_pago-agregar").click();
    await expect(page.getByTestId("medios_pago-lista")).toContainText("Débito");

    await page.goto("/gastos.html");
    await page.getByTestId("gastos-nuevo").click();
    await expect(page.locator("#medio_pago_id option")).toHaveText(["Sin especificar", "Efectivo", "Transferencia", "Débito"]);
    await page.locator("#fecha").fill("10-05-2026");
    await page.locator("#concepto").fill("Comisión bancaria");
    await page.locator("#monto").fill("900");
    await page.locator("#medio_pago_id").selectOption({ label: "Débito" });
    await page.getByTestId("modal-guardar").click();
    await expect(page.getByRole("row", { name: /Comisión bancaria/ })).toContainText("Débito", { timeout: 5000 });
  });

  test("cancelar y la cruz cierran el modal sin preguntar aunque se haya cargado algo", async ({ page }) => {
    await abrirGastos(page);
    await page.getByTestId("gastos-nuevo").click();
    await page.locator("#concepto").fill("Algo a medias");
    await page.getByTestId("modal-cancelar").click();
    await expect(page.getByTestId("modal")).toHaveCount(0);

    await page.getByTestId("gastos-nuevo").click();
    await page.locator("#concepto").fill("Otra vez");
    await page.getByTestId("modal").getByRole("button", { name: "Cerrar", exact: true }).click();
    await expect(page.getByTestId("modal")).toHaveCount(0);
    await expect(page.getByTestId("gastos-total-detalle")).toHaveText("7 gastos");
  });
});
