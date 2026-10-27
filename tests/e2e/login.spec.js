const { test, expect } = require("@playwright/test");
const { jwtFalso, llamadasA, simularApi, tokensGuardados } = require("./helpers");

const loginOk = {
  status: 200,
  body: {
    status: "ok",
    access_token: jwtFalso("ADMIN"),
    refresh_token: "refresh-falso",
    usuario: { id: 1, rol: "ADMIN", nombre: "Rocío" },
  },
};

async function completarLogin(page, datos = {}) {
  const v = { negocio: "minegocio1", usuario: "usuario1", password: "Password123!", ...datos };
  await page.locator("#negocio").fill(v.negocio);
  await page.locator("#usuario").fill(v.usuario);
  await page.locator("#password").fill(v.password);
  await page.getByRole("button", { name: "Ingresar" }).click();
}

test.describe("Login", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login.html");
  });

  test("pide identificador del negocio, usuario y contraseña", async ({ page }) => {
    for (const id of ["negocio", "usuario", "password"]) {
      await expect(page.locator(`#${id}`)).toHaveAttribute("required", "");
    }
  });

  test("tiene enlaces a registro y a recuperar contraseña", async ({ page }) => {
    await expect(page.getByRole("link", { name: "Registrar negocio" })).toHaveAttribute("href", "registro.html");
    await expect(page.getByRole("link", { name: "Olvidé mi contraseña" })).toHaveAttribute("href", "recuperar.html");
  });

  test("valida el largo del identificador sin llamar a la API", async ({ page }) => {
    const llamadas = await simularApi(page);
    await completarLogin(page, { negocio: "abc" });
    await expect(page.locator("#error-negocio")).toBeVisible();
    expect(llamadas).toHaveLength(0);
  });

  test("envía los datos con los nombres del contrato", async ({ page }) => {
    const llamadas = await simularApi(page, { "POST /auth/login": loginOk });
    await completarLogin(page);
    await expect(page).toHaveURL(/dashboard\.html$/);
    const login = llamadasA(llamadas, "/auth/login");
    expect(login).toHaveLength(1);
    expect(login[0].body).toEqual({
      id_negocio: "minegocio1",
      usuario: "usuario1",
      password: "Password123!",
    });
  });

  test("login exitoso guarda access y refresh token en localStorage", async ({ page }) => {
    await simularApi(page, { "POST /auth/login": loginOk });
    await completarLogin(page);
    await expect(page).toHaveURL(/dashboard\.html$/);
    expect(await tokensGuardados(page)).toEqual({
      access: loginOk.body.access_token,
      refresh: "refresh-falso",
    });
  });

  test("credenciales incorrectas muestran un mensaje genérico y no sacan de la pantalla", async ({ page }) => {
    await simularApi(page, {
      "POST /auth/login": {
        status: 401,
        body: { status: "error", mensaje: "Negocio, usuario o contraseña incorrectos" },
      },
    });
    await completarLogin(page);
    await expect(page.locator("#error-password")).toHaveText(
      "Negocio, usuario o contraseña incorrectos",
    );
    await expect(page).toHaveURL(/login\.html$/);
    expect(await tokensGuardados(page)).toEqual({ access: null, refresh: null });
  });

  test("si ya hay sesión iniciada, salta directo al dashboard", async ({ page }) => {
    await page.evaluate((t) => localStorage.setItem("trazzo_access_token", t), jwtFalso("ADMIN"));
    await page.goto("/login.html");
    await expect(page).toHaveURL(/dashboard\.html$/);
  });
});
