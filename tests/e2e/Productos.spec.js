import { test, expect } from "@playwright/test";

// Simulamos el token de un Admin para que la UI muestre los botones correctos
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("trazzo_access_token", "fake-token-admin");
    localStorage.setItem("trazzo_rol", "ADMIN");
  });
});

test.describe("Módulo de Productos", () => {
  test("Debe listar los productos con sus insignias de stock", async ({
    page,
  }) => {
    // Interceptamos la llamada del backend y devolvemos productos de prueba
    await page.route("**/api/productos*", async (route) => {
      const json = {
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
      };
      await route.fulfill({ json });
    });

    await page.goto("/productos.html");

    // Verificamos que la tabla tenga 3 filas
    const filas = page.locator("#productos-tbody tr");
    await expect(filas).toHaveCount(3);

    // Verificamos las insignias
    await expect(page.locator(".badge-ambar")).toHaveText("Stock bajo");
    await expect(page.locator(".badge-rojo")).toHaveText("Sin stock");
  });

  test("Debe crear un producto correctamente", async ({ page }) => {
    // Mock de la lista vacía inicial
    await page.route("**/api/productos*", (route) =>
      route.fulfill({ json: { items: [] } }),
    );
    // Mock de la creación exitosa
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

    // Llenamos el formulario
    await page.fill("#nombre", "Producto de Prueba");
    await page.fill("#precio_compra", "100");
    await page.fill("#precio_venta", "150");
    await page.fill("#cantidad", "10");
    await page.fill("#stock_minimo", "2");

    // El selector de proveedor depende de que el back lo tenga implementado
    // await page.selectOption('#proveedor_id', { index: 1 });

    // Hacemos clic en guardar
    await page.click('button[type="submit"]');

    // Verificamos que aparezca el Toast de éxito
    await expect(page.locator(".toast")).toContainText("Producto creado");
  });

  test("Debe mostrar aviso si el precio de venta es menor al costo", async ({
    page,
  }) => {
    await page.goto("/productos.html");
    await page.click("#btn-nuevo-producto");

    // Llenamos con precio de venta menor al costo
    await page.fill("#precio_compra", "1000");
    await page.fill("#precio_venta", "500");

    // El banner amarillo debe aparecer
    const banner = page.locator("#banner-precio-menor");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(
      "El precio de venta es menor al costo unitario.",
    );
  });

  test("Debe calcular el monto automáticamente al abrir modal de reposición", async ({
    page,
  }) => {
    // Mockeamos un producto
    await page.route("**/api/productos*", (route) => {
      route.fulfill({
        json: {
          items: [
            {
              id: 1,
              nombre: "Test",
              cantidad: 10,
              stock_minimo: 2,
              precio_compra: 150,
              precio_venta: 200,
            },
          ],
        },
      });
    });

    await page.goto("/productos.html");

    // Hacemos clic en el botón de reponer (la cruz)
    await page.click('button[title="Reponer stock"]');

    // Escribimos cantidad 5
    await page.fill("#repo-cantidad", "5");

    // El monto total debe ser 5 * 150 = 750
    const montoInput = page.locator("#monto_total");
    await expect(montoInput).toHaveValue("750");
  });

  test("Un cajero NO debe ver los botones de admin (Editar/Ocultar/Eliminar)", async ({
    page,
  }) => {
    // Cambiamos el rol a Cajero
    await page.addInitScript(() => {
      localStorage.setItem("trazzo_rol", "CAJERO");
    });

    await page.route("**/api/productos*", (route) => {
      route.fulfill({
        json: {
          items: [{ id: 1, nombre: "Test", cantidad: 10, stock_minimo: 2 }],
        },
      });
    });

    await page.goto("/productos.html");

    // Debería ver "Reponer" y "Baja"
    await expect(page.locator('button[title="Reponer stock"]')).toBeVisible();
    await expect(page.locator('button[title="Dar de baja"]')).toBeVisible();

    // NO debería ver "Editar", "Ocultar", "Eliminar" (ya que están comentados en el código por falta de backend)
    await expect(page.locator('button[title="Editar"]')).toHaveCount(0);
  });
});
