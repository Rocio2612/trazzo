const { test, expect } = require("@playwright/test");
const { jwtFalso, simularApi, llamadasA, tokensGuardados } = require("./helpers");

const registroOk = {
  status: 201,
  body: { status: "ok", access_token: jwtFalso("ADMIN"), refresh_token: "refresh-falso" },
};

async function completarRegistro(page) {
  await page.locator("#negocio").fill("minegocio1");
  await page.locator("#usuario").fill("usuario1");
  await page.locator("#email").fill("admin@correo.com");
  await page.locator("#password").fill("Password123!");
  await page.getByRole("button", { name: "Registrarse" }).click();
}

async function completarLogin(page) {
  await page.locator("#negocio").fill("minegocio1");
  await page.locator("#usuario").fill("usuario1");
  await page.locator("#password").fill("Password123!");
  await page.getByRole("button", { name: "Ingresar" }).click();
}

test.describe("Errores del Backend junto a cada campo", () => {
  test("registro: { errores: { campo: mensaje } } se muestra en cada campo", async ({ page }) => {
    await simularApi(page, {
      "POST /auth/registro": {
        status: 400,
        body: {
          errores: {
            usuario: "El usuario ya existe en este negocio",
            correo: "El correo no es válido",
          },
        },
      },
    });
    await page.goto("/registro.html");
    await completarRegistro(page);

    await expect(page.locator("#error-usuario")).toHaveText("El usuario ya existe en este negocio");
    await expect(page.locator("#error-email")).toHaveText("El correo no es válido");
    await expect(page.locator("#error-negocio")).toBeHidden();
    await expect(page).toHaveURL(/registro\.html$/);
  });

  test("registro: usa el campo que indica el Backend aunque el mensaje no lo nombre", async ({ page }) => {
    await simularApi(page, {
      "POST /auth/registro": {
        status: 409,
        body: { status: "error", mensaje: "Ya está en uso", campo: "id_negocio" },
      },
    });
    await page.goto("/registro.html");
    await completarRegistro(page);

    await expect(page.locator("#error-negocio")).toHaveText("Ya está en uso");
  });

  test("recuperar: el error del correo aparece junto al campo, sin ventana emergente", async ({ page }) => {
    await simularApi(page, {
      "POST /auth/recuperar": {
        status: 400,
        body: { errores: { correo: "El formato del correo electrónico no es válido" } },
      },
    });
    let hubo = false;
    page.on("dialog", (dialog) => {
      hubo = true;
      dialog.dismiss();
    });
    await page.goto("/recuperar.html");
    await page.locator("#email").fill("admin@correo.com");
    await page.getByRole("button", { name: "Enviar Enlace" }).click();

    await expect(page.locator("#error-email")).toHaveText("El formato del correo electrónico no es válido");
    expect(hubo).toBe(false);
  });

  test("restablecer: el error de la contraseña aparece junto al campo", async ({ page }) => {
    await simularApi(page, {
      "POST /auth/restablecer": {
        status: 400,
        body: { errores: { nueva_password: "La contraseña no puede ser igual a la anterior" } },
      },
    });
    await page.goto("/restablecer.html?token=abc123");
    await page.locator("#password").fill("NuevaPassword123!");
    await page.locator("#password-confirm").fill("NuevaPassword123!");
    await page.getByRole("button", { name: "Guardar Nueva Contraseña" }).click();

    await expect(page.locator("#error-password")).toHaveText("La contraseña no puede ser igual a la anterior");
  });
});

test.describe("Login: demasiados intentos (429)", () => {
  test("muestra el bloqueo temporal con el tiempo de espera del Backend", async ({ page }) => {
    await simularApi(page, {
      "POST /auth/login": {
        status: 429,
        headers: { "retry-after": "120" },
        body: { status: "error", mensaje: "Demasiados intentos" },
      },
    });
    await page.goto("/login.html");
    await completarLogin(page);

    await expect(page.locator("#error-password")).toHaveText(
      "Demasiados intentos fallidos. Esperá 2 minutos antes de volver a intentar.",
    );
    await expect(page).toHaveURL(/login\.html$/);
    expect(await tokensGuardados(page)).toEqual({ access: null, refresh: null });
  });

  test("con menos de un minuto lo dice en segundos", async ({ page }) => {
    await simularApi(page, {
      "POST /auth/login": { status: 429, headers: { "retry-after": "45" }, body: { status: "error", mensaje: "Demasiados intentos" } },
    });
    await page.goto("/login.html");
    await completarLogin(page);

    await expect(page.locator("#error-password")).toHaveText(
      "Demasiados intentos fallidos. Esperá 45 segundos antes de volver a intentar.",
    );
  });

  test("si el Backend no indica el tiempo, da un mensaje general", async ({ page }) => {
    await simularApi(page, {
      "POST /auth/login": { status: 429, body: { status: "error", mensaje: "Demasiados intentos" } },
    });
    await page.goto("/login.html");
    await completarLogin(page);

    await expect(page.locator("#error-password")).toHaveText(
      "Demasiados intentos fallidos. Esperá unos minutos antes de volver a intentar.",
    );
  });

  test("las credenciales incorrectas siguen mostrando el mensaje genérico", async ({ page }) => {
    await simularApi(page, {
      "POST /auth/login": { status: 401, body: { status: "error", mensaje: "Negocio, usuario o contraseña incorrectos" } },
    });
    await page.goto("/login.html");
    await completarLogin(page);

    await expect(page.locator("#error-password")).toHaveText("Negocio, usuario o contraseña incorrectos");
  });
});

test.describe("Botón de envío mientras se procesa", () => {
  test("login: se deshabilita durante el pedido y vuelve a habilitarse si falla", async ({ page }) => {
    await simularApi(page, {
      "POST /auth/login": { status: 401, demora: 400, body: { status: "error", mensaje: "Negocio, usuario o contraseña incorrectos" } },
    });
    await page.goto("/login.html");
    await completarLogin(page);

    const boton = page.getByRole("button", { name: "Ingresar" });
    await expect(boton).toBeDisabled();
    await expect(page.locator("#error-password")).toBeVisible();
    await expect(boton).toBeEnabled();
  });

  test("registro: un doble clic envía un solo pedido", async ({ page }) => {
    const llamadas = await simularApi(page, { "POST /auth/registro": { ...registroOk, demora: 400 } });
    await page.goto("/registro.html");
    await page.locator("#negocio").fill("minegocio1");
    await page.locator("#usuario").fill("usuario1");
    await page.locator("#email").fill("admin@correo.com");
    await page.locator("#password").fill("Password123!");

    const boton = page.getByRole("button", { name: "Registrarse" });
    await boton.dblclick();
    await expect(boton).toBeDisabled();
    await expect(page).toHaveURL(/dashboard\.html$/);
    expect(llamadasA(llamadas, "/auth/registro")).toHaveLength(1);
  });

  test("registro: también se puede reintentar tras un error", async ({ page }) => {
    const llamadas = await simularApi(page, {
      "POST /auth/registro": (vez) =>
        vez === 0
          ? { status: 409, demora: 200, body: { status: "error", mensaje: "Ya está en uso", campo: "id_negocio" } }
          : registroOk,
    });
    await page.goto("/registro.html");
    await completarRegistro(page);
    await expect(page.locator("#error-negocio")).toBeVisible();

    await page.getByRole("button", { name: "Registrarse" }).click();
    await expect(page).toHaveURL(/dashboard\.html$/);
    expect(llamadasA(llamadas, "/auth/registro")).toHaveLength(2);
  });

  test("recuperar: se deshabilita mientras se envía", async ({ page }) => {
    await simularApi(page, {
      "POST /auth/recuperar": { status: 200, demora: 400, body: { status: "ok", mensaje: "Si el correo existe, recibirás un mensaje" } },
    });
    page.once("dialog", (dialog) => dialog.accept());
    await page.goto("/recuperar.html");
    await page.locator("#email").fill("admin@correo.com");
    const boton = page.getByRole("button", { name: "Enviar Enlace" });
    await boton.click();
    await expect(boton).toBeDisabled();
    await expect(page).toHaveURL(/login\.html$/);
  });

  test("restablecer: se deshabilita mientras se envía", async ({ page }) => {
    await simularApi(page, {
      "POST /auth/restablecer": { status: 200, demora: 400, body: { status: "ok", mensaje: "Contraseña actualizada correctamente" } },
    });
    page.once("dialog", (dialog) => dialog.accept());
    await page.goto("/restablecer.html?token=abc123");
    await page.locator("#password").fill("NuevaPassword123!");
    await page.locator("#password-confirm").fill("NuevaPassword123!");
    const boton = page.getByRole("button", { name: "Guardar Nueva Contraseña" });
    await boton.click();
    await expect(boton).toBeDisabled();
    await expect(page).toHaveURL(/login\.html$/);
  });
});
