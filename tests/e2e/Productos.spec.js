import { test, expect } from "@playwright/test";
import { simularApi, jwtFalso } from "./helpers.js"; // Ajustá la ruta si es necesario

test.describe("Módulo de Productos", () => {
  test.beforeEach(async ({ page }) => {
    // Simulamos un token de Admin
    await page.addInitScript((token) => {
      localStorage.setItem("trazzo_access_token", token);
    }, jwtFalso("ADMIN"));

    // Mockeamos los endpoints
    await simularApi(page, {
      "GET /api/productos*": {
        items: [
          {
            id: 1,
            nombre: "Producto Normal",
            cantidad: 10,
            stock_minimo: 2,
            precio_compra: 100,
            precio_venta: 200,
          },
          {
            id: 2,
            nombre: "Producto Bajo",
            cantidad: 1,
            stock_minimo: 5,
            precio_compra: 100,
            precio_venta: 200,
          },
          {
            id: 3,
            nombre: "Producto Sin Stock",
            cantidad: 0,
            stock_minimo: 2,
            precio_compra: 100,
            precio_venta: 200,
          },
        ],
      },
      "GET /api/proveedores*": [
        { id: 1, nombre: "Proveedor 1" },
        { id: 2, nombre: "Proveedor 2" },
      ],
    });
  });

  test("Debe listar los productos con sus insignias de stock", async ({
    page,
  }) => {
    await page.goto("/productos.html");

    const filas = page.locator("#productos-tbody tr");
    await expect(filas).toHaveCount(3);

    await expect(page.locator(".badge-ambar")).toHaveText("Stock bajo");
    await expect(page.locator(".badge-rojo")).toHaveText("Sin stock");
  });

  test("Debe crear un producto correctamente", async ({ page }) => {
    await page.route("**/api/productos", (route) => {
      if (route.request().method() === "POST") {
        route.fulfill({
          status: 201,
          json: { status: "ok", producto: { id: 99 } },
        });
      }
    });

    await page.goto("/productos.html");
    await page.click("#btn-nuevo-producto");

    await page.fill("#nombre", "Producto de Prueba");
    await page.fill("#precio_compra", "100");
    await page.fill("#precio_venta", "150");
    await page.fill("#cantidad", "10");
    await page.fill("#stock_minimo", "2");

    // Seleccionamos el primer proveedor
    await page.selectOption("#proveedor_id", { index: 1 });

    await page.click('button[type="submit"]');

    await expect(page.locator(".toast")).toContainText("Producto creado");
  });

  test("Debe mostrar aviso si el precio de venta es menor al costo", async ({
    page,
  }) => {
    await page.goto("/productos.html");
    await page.click("#btn-nuevo-producto");

    await page.fill("#precio_compra", "1000");
    await page.fill("#precio_venta", "500");

    const banner = page.locator("#banner-precio-menor");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(
      "El precio de venta es menor al costo unitario.",
    );
  });

  test("Debe calcular el monto automáticamente al abrir modal de reposición", async ({
    page,
  }) => {
    await page.goto("/productos.html");
    await page.click('button[title="Reponer stock"]');

    await page.fill("#repo-cantidad", "5");

    const montoInput = page.locator("#monto_total");
    await expect(montoInput).toHaveValue("750"); // 5 * 150 (precio_compra mockeado)
  });

  test("Un cajero NO debe ver los botones de admin (Editar/Ocultar/Eliminar)", async ({
    page,
  }) => {
    // Cambiamos el token a Cajero
    await page.addInitScript((token) => {
      localStorage.setItem("trazzo_access_token", token);
    }, jwtFalso("CAJERO"));

    await page.goto("/productos.html");

    await expect(page.locator('button[title="Reponer stock"]')).toBeVisible();
    await expect(page.locator('button[title="Dar de baja"]')).toBeVisible();
    await expect(page.locator('button[title="Editar"]')).toHaveCount(0);
    await expect(page.locator('button[title="Ocultar"]')).toHaveCount(0);
    await expect(page.locator('button[title="Eliminar"]')).toHaveCount(0);
  });
});
