import { test, expect } from "@playwright/test";

test.describe("Módulo 7: Clientes", () => {
  test("Cajero NO ve datos sensibles en el DOM", async ({ page }) => {
    // Simulamos login de Cajero
    await page.addInitScript(() => {
      localStorage.setItem("trazzo_access_token", "token-cajero");
      localStorage.setItem("trazzo_rol", "CAJERO");
    });

    // Mock del backend devolviendo solo nombre e ID (privacidad)
    await page.route("**/api/clientes", (route) => {
      route.fulfill({
        json: { items: [{ id: 1, nombre: "Cliente Cajero" }] },
      });
    });
    await page.route("**/api/clientes/1", (route) => {
      route.fulfill({
        json: { id: 1, nombre: "Cliente Cajero" },
      });
    });

    await page.goto("/clientes.html");

    // Abrimos la ficha
    await page.click('button[title="Ver ficha"]');

    // Verificamos que los datos sensibles NO existan en el DOM
    const ficha = page.locator("#ficha-contenido");
    await expect(ficha).toContainText("Cliente Cajero");
    await expect(ficha).not.toContainText("CUIT");
    await expect(ficha).not.toContainText("Teléfono");
    await expect(ficha).not.toContainText("Correo");
    await expect(ficha).not.toContainText("Domicilio");
  });

  test("Intentar eliminar un cliente con historial muestra el error 409", async ({
    page,
  }) => {
    // Simulamos login de Admin
    await page.addInitScript(() => {
      localStorage.setItem("trazzo_access_token", "token-admin");
      localStorage.setItem("trazzo_rol", "ADMIN");
    });

    // Mock de la lista de ocultos
    await page.route("**/api/clientes?ocultos=true", (route) => {
      route.fulfill({
        json: {
          items: [
            {
              id: 2,
              nombre: "Cliente con Ventas",
              documento: "CUIT 20-12345678-9",
            },
          ],
        },
      });
    });

    // Mock del DELETE devolviendo 409
    await page.route("**/api/clientes/2", (route) => {
      if (route.request().method() === "DELETE") {
        route.fulfill({
          status: 409,
          json: {
            message:
              "No se puede eliminar el cliente porque tiene ventas registradas o saldo en cuenta corriente.",
          },
        });
      }
    });

    await page.goto("/clientes.html");

    // Activamos "Ver ocultos"
    await page.click("#btn-ver-ocultos");

    // Hacemos clic en el botón de eliminar (la papelera)
    page.on("dialog", (dialog) => dialog.accept()); // Aceptamos el confirm()
    await page.click('button[title="Eliminar"]');

    // Verificamos que aparezca el modal de bloqueo con el mensaje exacto
    const modalError = page.locator("#modal-error-eliminar");
    await expect(modalError).toBeVisible();
    await expect(modalError).toContainText(
      "No se puede eliminar el cliente porque tiene ventas registradas o saldo en cuenta corriente.",
    );
  });
});
