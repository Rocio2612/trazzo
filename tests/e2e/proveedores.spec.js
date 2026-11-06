const { test, expect } = require("@playwright/test");
const { simularApi, iniciarSesionComo } = require("./helpers");

// Datos simulados (mocks/proveedores.js): 3 visibles (Envases del Sur, Bebidas Don Raúl, Marta Giménez)
// y 2 ocultos (Cooperativa La Esperanza, sin movimientos; Librería Central, con movimientos).

const abrir = async (page, rol = "ADMIN") => {
  await simularApi(page, { "GET /auth/yo": { status: 200, body: {} } });
  await iniciarSesionComo(page, rol);
  await page.goto("/proveedores.html");
};

const filas = (page) => page.getByTestId("proveedores-tabla").locator("tbody tr");

test.describe("Proveedores", () => {
  test("lista los proveedores visibles con su documento y categoría impositiva", async ({ page }) => {
    await abrir(page);
    await expect(filas(page)).toHaveCount(3);
    await expect(page.getByTestId("proveedores-fila-1")).toContainText("CUIT 30-71234567-1");
    await expect(page.getByTestId("proveedores-fila-1")).toContainText("Resp. Inscripto");
    await expect(page.getByTestId("proveedores-fila-3")).toContainText("CUIL 20-12345678-6");
    await expect(page.getByTestId("proveedores-fila-3")).toContainText("Monotributista");
    await expect(page.getByTestId("proveedores-fila-1")).toContainText("admin1"); // Creado por
    await expect(page.getByTestId("proveedores-fila-4")).toHaveCount(0); // oculto
  });

  test("el Empleado no entra a Proveedores", async ({ page }) => {
    await abrir(page, "CAJERO");
    await expect(page).toHaveURL(/dashboard\.html$/);
  });

  test("el alta vacía avisa qué falta y por qué", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("proveedores-nuevo").click();
    await page.getByTestId("modal-guardar").click();
    await expect(page.locator("#error-nombre")).toHaveText("Rellene el nombre o razón social.");
    await expect(page.locator("#error-numero_documento")).toHaveText("Rellene el número de CUIT.");
    await expect(page.locator("#error-categoria_impositiva")).toHaveText("Elija la categoría impositiva.");
    await expect(page.locator("#error-telefono")).toBeHidden(); // opcional
    await expect(page.locator("#error-correo")).toBeHidden(); // opcional
  });

  test("valida el dígito verificador del CUIT", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("proveedores-nuevo").click();
    await page.locator("#numero_documento").fill("30-71234567-2");
    await page.getByTestId("modal-guardar").click();
    await expect(page.locator("#error-numero_documento")).toHaveText("El CUIT no es válido: el dígito verificador no coincide.");
  });

  test("un documento repetido se avisa junto al campo", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("proveedores-nuevo").click();
    await page.locator("#nombre").fill("Otra empresa");
    await page.locator("#numero_documento").fill("30712345671");
    await page.locator("#categoria_impositiva").selectOption("EXENTO");
    await page.getByTestId("modal-guardar").click();
    await expect(page.locator("#error-numero_documento")).toContainText("Ya hay un proveedor con ese CUIT (30-71234567-1)");
  });

  test("da de alta un proveedor con descripción de compra", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("proveedores-nuevo").click();
    await page.locator("#nombre").fill("Distribuidora Norte");
    await page.locator("#numero_documento").fill("20-11111111-2");
    await page.locator("#categoria_impositiva").selectOption("RESPONSABLE_INSCRIPTO");
    await page.locator("#descripcion_compra").fill("Gaseosas y aguas saborizadas");
    await page.getByTestId("modal-guardar").click();
    const fila = page.getByRole("row", { name: /Distribuidora Norte/ });
    await expect(fila).toContainText("CUIT 20-11111111-2");
    await expect(fila).toContainText("Gaseosas y aguas saborizadas");
    await expect(fila).toContainText("usuario1"); // quién lo creó, tomado de la sesión
    await expect(filas(page)).toHaveCount(4);
  });

  test("el buscador filtra por nombre, documento o descripción", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("proveedores-buscador").fill("don raul");
    await expect(filas(page)).toHaveCount(1);
    await page.getByTestId("proveedores-buscador").fill("20-12345678-6");
    await expect(page.getByTestId("proveedores-fila-3")).toBeVisible();
    await page.getByTestId("proveedores-buscador").fill("cartón");
    await expect(page.getByTestId("proveedores-fila-1")).toBeVisible();
    await page.getByTestId("proveedores-buscador").fill("zzz");
    await expect(page.getByTestId("proveedores-vacio")).toHaveText("Sin resultados");
  });

  test("editar muestra la ficha completa y avisa si cambia la categoría impositiva", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("proveedores-editar-1").click();
    await expect(page.locator("#nombre")).toHaveValue("Envases del Sur S.A.");
    await expect(page.locator("#numero_documento")).toHaveValue("30-71234567-1");
    await expect(page.locator("#descripcion_compra")).toHaveValue("Distribuidor de envases y cajas de cartón");
    await expect(page.getByTestId("modal")).not.toContainText("afecta cómo se registra el IVA");
    await page.locator("#categoria_impositiva").selectOption("MONOTRIBUTISTA");
    await expect(page.getByTestId("modal")).toContainText("afecta cómo se registra el IVA de las próximas reposiciones");
    await page.getByTestId("modal-guardar").click();
    await expect(page.getByTestId("proveedores-fila-1")).toContainText("Monotributista");
  });

  test("ocultar saca al proveedor de la lista y se puede restaurar desde Ver ocultos", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("proveedores-ocultar-3").click();
    await page.getByTestId("modal-cancelar").click();
    await expect(page.getByTestId("proveedores-fila-3")).toBeVisible();

    await page.getByTestId("proveedores-ocultar-3").click();
    await page.getByTestId("modal-confirmar").click();
    await expect(page.getByTestId("proveedores-fila-3")).toHaveCount(0);

    await page.getByTestId("proveedores-ver-ocultos").click();
    await expect(page.getByTestId("proveedores-fila-3")).toBeVisible();
    await page.getByTestId("proveedores-ocultar-3").click(); // en la vista de ocultos es "Restaurar"
    await page.getByTestId("proveedores-ver-ocultos").click();
    await expect(page.getByTestId("proveedores-fila-3")).toBeVisible();
  });

  test("con movimientos solo se puede ocultar: Eliminar queda deshabilitado", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("proveedores-ver-ocultos").click();
    await expect(filas(page)).toHaveCount(2);
    const conMovimientos = page.getByTestId("proveedores-eliminar-5");
    await expect(conMovimientos).toBeDisabled();
    await expect(conMovimientos).toHaveAttribute("title", /reposiciones o insumos asociados/);
    await expect(page.getByTestId("proveedores-eliminar-4")).toBeEnabled();
  });

  test("un proveedor oculto y sin movimientos se elimina al confirmar", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("proveedores-ver-ocultos").click();
    await page.getByTestId("proveedores-eliminar-4").click();
    await page.getByTestId("modal-cancelar").click();
    await expect(page.getByTestId("proveedores-fila-4")).toBeVisible();

    await page.getByTestId("proveedores-eliminar-4").click();
    await page.getByTestId("modal-confirmar").click();
    await expect(page.getByTestId("proveedores-fila-4")).toHaveCount(0);
    await expect(filas(page)).toHaveCount(1);
  });

  test("cancelar y la cruz cierran el modal sin preguntar aunque se haya cargado algo", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("proveedores-nuevo").click();
    await page.locator("#nombre").fill("A medias");
    await page.getByTestId("modal-cancelar").click();
    await expect(page.getByTestId("modal")).toHaveCount(0);

    await page.getByTestId("proveedores-nuevo").click();
    await page.locator("#nombre").fill("Otra vez");
    await page.getByTestId("modal").getByRole("button", { name: "Cerrar", exact: true }).click();
    await expect(page.getByTestId("modal")).toHaveCount(0);
    await expect(filas(page)).toHaveCount(3);
  });
});
