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

  test("el mensaje de correo inválido es el esperado", async ({ page }) => {
    await simularApi(page);
    await page.locator("#email").fill("correo@sinpunto");
    await page.getByRole("button", { name: "Enviar Enlace" }).click();
    await expect(page.locator("#error-email")).toHaveText("Ingresá un correo válido.");
  });

  // El navegador deja pasar algunos formatos que el script rechaza; se quita su validación para probar la del script.
  const invalidosDelScript = [
    ["sin punto en el dominio", "correo@sinpunto"],
    ["sin arroba", "correo.com"],
    ["sin usuario antes de la arroba", "@correo.com"],
    ["con espacios en el medio", "admin @correo.com"],
    ["con el dominio empezando en punto", "correo@.com"],
    ["con dos arrobas", "a@b@correo.com"],
  ];

  for (const [nombre, correo] of invalidosDelScript) {
    test(`rechaza un correo ${nombre} (validación del script)`, async ({ page }) => {
      const llamadas = await simularApi(page);
      await page.evaluate(() => document.getElementById("recuperar-form").setAttribute("novalidate", ""));
      await page.locator("#email").fill(correo);
      await page.getByRole("button", { name: "Enviar Enlace" }).click();
      await expect(page.locator("#error-email")).toHaveText("Ingresá un correo válido.");
      expect(llamadas).toHaveLength(0);
      await expect(page).toHaveURL(/recuperar\.html$/);
    });
  }

  test("el campo es obligatorio y con el campo vacío el navegador bloquea el envío", async ({ page }) => {
    const llamadas = await simularApi(page);
    await expect(page.locator("#email")).toHaveAttribute("required", "");
    await page.getByRole("button", { name: "Enviar Enlace" }).click();
    await expect(page).toHaveURL(/recuperar\.html$/);
    expect(llamadas).toHaveLength(0);
  });

  test("un correo sin arroba lo bloquea el navegador por type=email", async ({ page }) => {
    const llamadas = await simularApi(page);
    await expect(page.locator("#email")).toHaveAttribute("type", "email");
    await page.locator("#email").fill("correo.com");
    await page.getByRole("button", { name: "Enviar Enlace" }).click();
    await expect(page).toHaveURL(/recuperar\.html$/);
    expect(llamadas).toHaveLength(0);
  });

  test("envía el correo con el nombre del contrato y vuelve al login", async ({ page }) => {
    const llamadas = await simularApi(page, {
      "POST /auth/recuperar": {
        status: 200,
        body: { status: "ok", mensaje: "Si el correo existe, recibirás un mensaje" },
      },
    });
    let mensaje = "";
    page.once("dialog", (dialog) => {
      mensaje = dialog.message();
      dialog.accept();
    });
    await page.locator("#email").fill("admin@correo.com");
    await page.getByRole("button", { name: "Enviar Enlace" }).click();
    await expect(page).toHaveURL(/login\.html$/);
    expect(mensaje).toBe("Si el correo existe, recibirás un mensaje con las instrucciones.");
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0].body).toEqual({ correo: "admin@correo.com" });
  });

  test("quita los espacios alrededor del correo antes de enviarlo", async ({ page }) => {
    const llamadas = await simularApi(page, {
      "POST /auth/recuperar": { status: 200, body: { status: "ok", mensaje: "ok" } },
    });
    page.once("dialog", (dialog) => dialog.accept());
    await page.locator("#email").fill("  admin@correo.com  ");
    await page.getByRole("button", { name: "Enviar Enlace" }).click();
    await expect(page).toHaveURL(/login\.html$/);
    expect(llamadas[0].body).toEqual({ correo: "admin@correo.com" });
  });

  test("si la API falla sin indicar campo, avisa con un mensaje genérico y se queda en la pantalla", async ({ page }) => {
    await simularApi(page, {
      "POST /auth/recuperar": { status: 500, body: { status: "error", mensaje: "Error interno" } },
    });
    const aviso = page.waitForEvent("dialog");
    await page.locator("#email").fill("admin@correo.com");
    await page.getByRole("button", { name: "Enviar Enlace" }).click();
    const dialog = await aviso;
    expect(dialog.message()).toBe("Ocurrió un error. Intentá de nuevo más tarde.");
    await dialog.accept();
    await expect(page).toHaveURL(/recuperar\.html$/);
  });

  test("tiene un enlace para volver al login", async ({ page }) => {
    await page.getByRole("link", { name: "Volver al Login" }).click();
    await expect(page).toHaveURL(/login\.html$/);
  });
});
