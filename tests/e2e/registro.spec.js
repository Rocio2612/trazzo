const { test, expect } = require("@playwright/test");
const { jwtFalso, llamadasA, simularApi, tokensGuardados } = require("./helpers");

const respuestaOk = {
  status: 201,
  body: {
    status: "ok",
    mensaje: "Negocio y usuario creado",
    access_token: jwtFalso("ADMIN"),
    refresh_token: "refresh-falso",
    usuario: { id: 1, rol: "ADMIN", negocio_id: 10 },
  },
};

async function completarRegistro(page, datos = {}) {
  const v = {
    negocio: "minegocio1",
    usuario: "usuario1",
    email: "admin@correo.com",
    password: "Password123!",
    ...datos,
  };
  await page.locator("#negocio").fill(v.negocio);
  await page.locator("#usuario").fill(v.usuario);
  await page.locator("#email").fill(v.email);
  await page.locator("#password").fill(v.password);
  if (v.nombre) await page.locator("#nombre").fill(v.nombre);
  if (v.rubro) await page.locator("#rubro").selectOption(v.rubro);
  if (v.otroRubro) await page.locator("#otro-rubro").fill(v.otroRubro);
  await page.getByRole("button", { name: "Registrarse" }).click();
}

test.describe("Registro", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/registro.html");
  });

  test("muestra el campo de texto solo cuando el rubro es Otro", async ({ page }) => {
    await expect(page.locator("#grupo-otro-rubro")).toBeHidden();
    await page.locator("#rubro").selectOption("otro");
    await expect(page.locator("#grupo-otro-rubro")).toBeVisible();
    await page.locator("#rubro").selectOption("indumentaria");
    await expect(page.locator("#grupo-otro-rubro")).toBeHidden();
  });

  test("tiene un atajo a Iniciar Sesión", async ({ page }) => {
    await page.getByRole("link", { name: /Iniciar Sesión/ }).click();
    await expect(page).toHaveURL(/login\.html$/);
  });

  test("los campos obligatorios están marcados y los opcionales no", async ({ page }) => {
    for (const id of ["negocio", "usuario", "email", "password"]) {
      await expect(page.locator(`#${id}`)).toHaveAttribute("required", "");
    }
    for (const id of ["nombre", "rubro", "otro-rubro"]) {
      await expect(page.locator(`#${id}`)).not.toHaveAttribute("required", "");
    }
  });

  const invalidos = [
    ["identificador con mayúsculas", { negocio: "MiNegocio" }, "error-negocio"],
    ["identificador con menos de 4 caracteres", { negocio: "abc" }, "error-negocio"],
    ["identificador con símbolos", { negocio: "mi_negocio" }, "error-negocio"],
    ["usuario con más de 20 caracteres", { usuario: "a".repeat(21) }, "error-usuario"],
    ["usuario con símbolos", { usuario: "user.name" }, "error-usuario"],
    ["correo sin dominio", { email: "correo@sinpunto" }, "error-email"],
    ["contraseña corta", { password: "Ab1!" }, "error-password"],
    ["contraseña sin mayúscula", { password: "password123!" }, "error-password"],
    ["contraseña sin número", { password: "Password!!!" }, "error-password"],
    ["contraseña sin símbolo", { password: "Password123" }, "error-password"],
    ["contraseña de más de 64 caracteres", { password: "Aa1!" + "a".repeat(61) }, "error-password"],
  ];

  for (const [nombre, datos, idError] of invalidos) {
    test(`rechaza ${nombre} junto al campo, sin llamar a la API`, async ({ page }) => {
      const llamadas = await simularApi(page);
      await completarRegistro(page, datos);
      await expect(page.locator(`#${idError}`)).toBeVisible();
      await expect(page.locator(`#${idError}`)).not.toBeEmpty();
      expect(llamadas).toHaveLength(0);
      await expect(page).toHaveURL(/registro\.html$/);
    });
  }

  test("envía los datos con los nombres del contrato", async ({ page }) => {
    const llamadas = await simularApi(page, { "POST /auth/registro": respuestaOk });
    await completarRegistro(page, { nombre: "Trazzo Store", rubro: "indumentaria" });
    await expect(page).toHaveURL(/dashboard\.html$/);
    const registro = llamadasA(llamadas, "/auth/registro");
    expect(registro).toHaveLength(1);
    expect(registro[0].body).toEqual({
      id_negocio: "minegocio1",
      usuario: "usuario1",
      correo: "admin@correo.com",
      password: "Password123!",
      nombre_negocio: "Trazzo Store",
      rubro: "indumentaria",
    });
  });

  test("si el rubro es Otro envía el texto escrito", async ({ page }) => {
    const llamadas = await simularApi(page, { "POST /auth/registro": respuestaOk });
    await completarRegistro(page, { rubro: "otro", otroRubro: "Floristería" });
    await expect(page).toHaveURL(/dashboard\.html$/);
    expect(llamadasA(llamadas, "/auth/registro")[0].body.rubro).toBe("Floristería");
  });

  test("auto-login: guarda los tokens y entra al dashboard sin pasar por login", async ({ page }) => {
    await simularApi(page, { "POST /auth/registro": respuestaOk });
    await completarRegistro(page);
    await expect(page).toHaveURL(/dashboard\.html$/);
    expect(await tokensGuardados(page)).toEqual({
      access: respuestaOk.body.access_token,
      refresh: "refresh-falso",
    });
  });

  test("no manda Authorization aunque haya un token viejo guardado", async ({ page }) => {
    const llamadas = await simularApi(page, { "POST /auth/registro": respuestaOk });
    await page.evaluate(() => localStorage.setItem("trazzo_access_token", "token-viejo"));
    await completarRegistro(page);
    await expect(page).toHaveURL(/dashboard\.html$/);
    expect(llamadasA(llamadas, "/auth/registro")[0].headers.authorization).toBeUndefined();
  });

  test("muestra junto al campo el error que devuelve el backend (409)", async ({ page }) => {
    await simularApi(page, {
      "POST /auth/registro": {
        status: 409,
        body: {
          status: "error",
          mensaje: "El identificador de negocio ya está en uso",
          campo: "id_negocio",
        },
      },
    });
    await completarRegistro(page);
    await expect(page.locator("#error-negocio")).toHaveText(
      "El identificador de negocio ya está en uso",
    );
    await expect(page).toHaveURL(/registro\.html$/);
    expect(await tokensGuardados(page)).toEqual({ access: null, refresh: null });
  });
});
