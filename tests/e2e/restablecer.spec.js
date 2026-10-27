const { test, expect } = require("@playwright/test");
const { simularApi } = require("./helpers");

test.describe("Restablecer contraseña", () => {
  test("sin token en la URL avisa y vuelve al login", async ({ page }) => {
    let mensaje = "";
    page.once("dialog", (dialog) => {
      mensaje = dialog.message();
      dialog.accept();
    });
    await page.goto("/restablecer.html");
    await expect(page).toHaveURL(/login\.html$/);
    expect(mensaje).toMatch(/inválido|expirado/i);
  });

  test.describe("con token en la URL", () => {
    test.beforeEach(async ({ page }) => {
      await page.goto("/restablecer.html?token=abc123xyz");
    });

    test("rechaza una contraseña débil", async ({ page }) => {
      const llamadas = await simularApi(page);
      await page.locator("#password").fill("debil");
      await page.locator("#password-confirm").fill("debil");
      await page.getByRole("button", { name: "Guardar Nueva Contraseña" }).click();
      await expect(page.locator("#error-password")).toBeVisible();
      expect(llamadas).toHaveLength(0);
    });

    test("rechaza contraseñas que no coinciden", async ({ page }) => {
      const llamadas = await simularApi(page);
      await page.locator("#password").fill("Password123!");
      await page.locator("#password-confirm").fill("Password123?");
      await page.getByRole("button", { name: "Guardar Nueva Contraseña" }).click();
      await expect(page.locator("#error-password-confirm")).toHaveText("Las contraseñas no coinciden.");
      expect(llamadas).toHaveLength(0);
    });

    test("envía el token de la URL y la nueva contraseña con los nombres del contrato", async ({ page }) => {
      const llamadas = await simularApi(page, {
        "POST /auth/restablecer": {
          status: 200,
          body: { status: "ok", mensaje: "Contraseña actualizada correctamente" },
        },
      });
      page.once("dialog", (dialog) => dialog.accept());
      await page.locator("#password").fill("NuevaPassword123!");
      await page.locator("#password-confirm").fill("NuevaPassword123!");
      await page.getByRole("button", { name: "Guardar Nueva Contraseña" }).click();
      await expect(page).toHaveURL(/login\.html$/);
      expect(llamadas[0].body).toEqual({
        token_recuperacion: "abc123xyz",
        nueva_password: "NuevaPassword123!",
      });
    });

    test("si el token ya no sirve (400) avisa y se queda en la pantalla", async ({ page }) => {
      await simularApi(page, {
        "POST /auth/restablecer": {
          status: 400,
          body: { status: "error", mensaje: "El token de recuperación es inválido, venció o ya fue utilizado" },
        },
      });
      const aviso = page.waitForEvent("dialog");
      await page.locator("#password").fill("NuevaPassword123!");
      await page.locator("#password-confirm").fill("NuevaPassword123!");
      await page.getByRole("button", { name: "Guardar Nueva Contraseña" }).click();
      const dialog = await aviso;
      expect(dialog.message()).toMatch(/inválido|utilizado/i);
      await dialog.accept();
      await expect(page).toHaveURL(/restablecer\.html/);
    });
  });
});
