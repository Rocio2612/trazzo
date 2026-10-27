const { test, expect } = require("@playwright/test");
const { simularApi } = require("./helpers");

test.describe("Recuperar contraseña", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/recuperar.html");
  });

  test("solo pide el correo", async ({ page }) => {
    await expect(page.locator("form input")).toHaveCount(1);
    await expect(page.locator("#email")).toBeVisible();
  });

  test("rechaza un correo con formato inválido sin llamar a la API", async ({ page }) => {
    const llamadas = await simularApi(page);
    await page.locator("#email").fill("correo@sinpunto");
    await page.getByRole("button", { name: "Enviar Enlace" }).click();
    await expect(page.locator("#error-email")).toBeVisible();
    expect(llamadas).toHaveLength(0);
  });

  test("envía el correo con el nombre del contrato y vuelve al login", async ({ page }) => {
    const llamadas = await simularApi(page, {
      "POST /auth/recuperar": {
        status: 200,
        body: { status: "ok", mensaje: "Si el correo existe, recibirás un mensaje" },
      },
    });
    page.once("dialog", (dialog) => dialog.accept());
    await page.locator("#email").fill("admin@correo.com");
    await page.getByRole("button", { name: "Enviar Enlace" }).click();
    await expect(page).toHaveURL(/login\.html$/);
    expect(llamadas[0].body).toEqual({ correo: "admin@correo.com" });
  });

  test("tiene un enlace para volver al login", async ({ page }) => {
    await page.getByRole("link", { name: "Volver al Login" }).click();
    await expect(page).toHaveURL(/login\.html$/);
  });
});
