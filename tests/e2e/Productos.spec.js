import { test, expect } from "@playwright/test";
import { iniciarSesionComo } from "./helpers.js";

// Simula la API con page.route (mismo formato del contrato). Las rutas pueden cambiar: ver RUTAS en js/productos.js.
const simular = async (page, capturas) => {
  const productos = [
    {
      id: 1,
      nombre: "Collar",
      costo_unitario: 100,
      precio_venta: 150,
      iva: 21,
      stock_actual: 5,
      stock_minimo: 2,
      oculto: false,
    },
  ];
  await page.route("**/*", (route) => {
    const req = route.request();
    if (!["fetch", "xhr"].includes(req.resourceType())) return route.fallback();
    const { pathname } = new URL(req.url());
    const json = (body, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (pathname.endsWith("/auth/yo")) return json({});
    if (pathname.endsWith("/notificaciones")) return json([]);
    if (pathname.endsWith("/categorias") || pathname.endsWith("/proveedores"))
      return json([]);
    if (pathname.endsWith("/productos") && req.method() === "GET")
      return json({ items: productos });
    if (pathname.endsWith("/productos") && req.method() === "POST") {
      capturas.crear = req.postDataJSON();
      return json({ id: 2, ...capturas.crear }, 201);
    }
    if (pathname.endsWith("/productos/1/reposiciones")) {
      capturas.reposicion = req.postDataJSON();
      return json({ ok: true }, 201);
    }
    return route.fallback();
  });
};

test("crear producto con precio sugerido (costo 1000, rentabilidad 30 %, IVA 21 %)", async ({
  page,
}) => {
  const capturas = {};
  await iniciarSesionComo(page, "ADMIN");
  await simular(page, capturas);
  await page.goto("/productos.html");

  await page.getByTestId("productos-nuevo").click();
  await page.locator("#nombre").fill("Cinturón");
  await page.locator("#costo_unitario").fill("1000");
  await page.locator("#rentabilidad").fill("30");
  await expect(page.locator("#iva")).toHaveValue("21");
  await expect(page.locator("#precio_venta")).toHaveValue("1573");
  await page.locator("#stock_actual").fill("10");
  await page.locator("#stock_minimo").fill("2");
  await page.getByTestId("modal-guardar").click();

  await expect
    .poll(() => capturas.crear)
    .toMatchObject({
      nombre: "Cinturón",
      costo_unitario: 1000,
      rentabilidad: 30,
      iva: 21,
      precio_venta: 1573,
    });
});

test("el precio editado a mano no se pisa al cambiar la rentabilidad", async ({
  page,
}) => {
  await iniciarSesionComo(page, "ADMIN");
  await simular(page, {});
  await page.goto("/productos.html");
  await page.getByTestId("productos-nuevo").click();
  await page.locator("#costo_unitario").fill("1000");
  await page.locator("#precio_venta").fill("2000");
  await page.locator("#rentabilidad").fill("50");
  await expect(page.locator("#precio_venta")).toHaveValue("2000");
});

test("reponer con el monto editado a mano", async ({ page }) => {
  const capturas = {};
  await iniciarSesionComo(page, "CAJERO");
  await simular(page, capturas);
  await page.goto("/productos.html");

  await page.getByTestId("productos-reponer-1").click();
  await page.locator("#repo-cantidad").fill("10");
  await expect(page.locator("#repo-monto")).toHaveValue("1000"); // 10 × costo 100
  await page.locator("#repo-monto").fill("950");
  await page.locator("#repo-cantidad").fill("20");
  await expect(page.locator("#repo-monto")).toHaveValue("950"); // editado: no se recalcula
  await page.getByTestId("repo-guardar").click();

  await expect
    .poll(() => capturas.reposicion)
    .toMatchObject({ cantidad: 20, monto_total: 950 });
});
