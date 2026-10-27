const { test, expect } = require("@playwright/test");
const { jwtFalso, simularApi, iniciarSesionComo, llamadasA, tokensGuardados } = require("./helpers");

const yoOk = { status: 200, body: { status: "ok", usuario: { usuario: "usuario1", rol: "ADMIN" } } };
const sinSesion = { status: 401, body: { status: "error", mensaje: "Token inválido, vencido o no proporcionado" } };

// Espera a que el front haya hecho `cantidad` llamadas a la API.
const esperarLlamadas = (llamadas, cantidad) => expect.poll(() => llamadas.length).toBe(cantidad);

test.describe("Sesión vencida: renovar con el refresh token", () => {
  test("ante un 401 renueva el access token, repite el pedido y sigue en la pantalla", async ({ page }) => {
    const nuevoToken = jwtFalso("ADMIN", { jti: "token-renovado" });
    const llamadas = await simularApi(page, {
      "GET /auth/yo": (vez) => (vez === 0 ? sinSesion : yoOk),
      "POST /auth/refresh": { status: 200, body: { status: "ok", access_token: nuevoToken } },
    });
    await iniciarSesionComo(page, "ADMIN");
    await page.goto("/dashboard.html");
    await esperarLlamadas(llamadas, 3);

    expect(llamadas.map((l) => l.ruta)).toEqual(["/auth/yo", "/auth/refresh", "/auth/yo"]);
    // El refresh viaja en el body, sin Authorization, y el pedido se repite con el token nuevo.
    expect(llamadas[1].body).toEqual({ refresh_token: "refresh-falso" });
    expect(llamadas[1].headers.authorization).toBeUndefined();
    expect(llamadas[2].headers.authorization).toBe(`Bearer ${nuevoToken}`);

    await expect(page).toHaveURL(/dashboard\.html$/);
    expect((await tokensGuardados(page)).access).toBe(nuevoToken);
  });

  test("si el refresh token tampoco sirve, limpia todo y va al login", async ({ page }) => {
    await simularApi(page, {
      "GET /auth/yo": sinSesion,
      "POST /auth/refresh": { status: 401, body: { status: "error", mensaje: "Refresh token inválido o vencido" } },
    });
    await iniciarSesionComo(page, "ADMIN");
    await page.goto("/dashboard.html");

    await expect(page).toHaveURL(/login\.html$/);
    expect(await tokensGuardados(page)).toEqual({ access: null, refresh: null });
  });

  test("si no hay refresh token ni lo intenta: va directo al login", async ({ page }) => {
    const llamadas = await simularApi(page, { "GET /auth/yo": sinSesion });
    await iniciarSesionComo(page, "ADMIN");
    await page.evaluate(() => localStorage.removeItem("trazzo_refresh_token"));
    await page.goto("/dashboard.html");

    await expect(page).toHaveURL(/login\.html$/);
    expect(llamadasA(llamadas, "/auth/refresh")).toHaveLength(0);
  });

  test("varios pedidos vencidos a la vez renuevan el token una sola vez", async ({ page }) => {
    const llamadas = await simularApi(page, {
      "GET /auth/yo": yoOk,
      "GET /datos": (vez) => (vez < 2 ? sinSesion : { status: 200, body: { status: "ok", valor: 1 } }),
      // La demora asegura que el segundo pedido vencido llegue mientras se renueva.
      "POST /auth/refresh": { status: 200, demora: 300, body: { status: "ok", access_token: jwtFalso("ADMIN", { jti: "otro" }) } },
    });
    await iniciarSesionComo(page, "ADMIN");
    await page.goto("/dashboard.html");

    const resultados = await page.evaluate(() => Promise.all([fetchAPI("/datos"), fetchAPI("/datos")]));
    expect(resultados.map((r) => r.valor)).toEqual([1, 1]);
    expect(llamadasA(llamadas, "/auth/refresh")).toHaveLength(1);
  });

  test("un error del servidor al verificar la sesión no la cierra", async ({ page }) => {
    await simularApi(page, {
      "GET /auth/yo": { status: 500, body: { status: "error", mensaje: "Error interno" } },
    });
    await iniciarSesionComo(page, "ADMIN");
    await page.goto("/dashboard.html");

    await expect(page.getByRole("heading", { name: /Bienvenido/ })).toBeVisible();
    await expect(page).toHaveURL(/dashboard\.html$/);
    expect((await tokensGuardados(page)).access).not.toBeNull();
  });

  test("si el backend no responde al verificar la sesión, tampoco la cierra", async ({ page }) => {
    await simularApi(page, { "GET /auth/yo": { abortar: true } });
    await iniciarSesionComo(page, "ADMIN");
    await page.goto("/dashboard.html");

    await expect(page.getByRole("heading", { name: /Bienvenido/ })).toBeVisible();
    expect((await tokensGuardados(page)).access).not.toBeNull();
  });
});

test.describe("403: sin permiso", () => {
  const prohibido = { status: 403, body: { status: "error", mensaje: "Acceso denegado: solo el administrador puede ver los gastos" } };

  test("avisa con el mensaje del Backend y vuelve al Panel sin cerrar la sesión", async ({ page }) => {
    await simularApi(page, { "GET /auth/yo": yoOk, "GET /gastos": prohibido });
    await iniciarSesionComo(page, "CAJERO");
    await page.goto("/productos.html");

    let mensaje = "";
    page.once("dialog", (dialog) => {
      mensaje = dialog.message();
      dialog.accept();
    });
    // No se espera el resultado: el aviso cambia de página.
    await page.evaluate(() => {
      fetchAPI("/gastos").catch(() => {});
    });

    await expect(page).toHaveURL(/dashboard\.html$/);
    expect(mensaje).toBe("Acceso denegado: solo el administrador puede ver los gastos");
    expect((await tokensGuardados(page)).access).not.toBeNull();
  });

  test("si ya está en el Panel avisa pero no recarga la página", async ({ page }) => {
    await simularApi(page, { "GET /auth/yo": yoOk, "GET /gastos": prohibido });
    await iniciarSesionComo(page, "CAJERO");
    await page.goto("/dashboard.html");

    const aviso = page.waitForEvent("dialog");
    await page.evaluate(() => {
      fetchAPI("/gastos").catch(() => {});
    });
    const dialog = await aviso;
    await dialog.accept();

    await expect(page).toHaveURL(/dashboard\.html$/);
    await expect(page.getByRole("heading", { name: /Bienvenido/ })).toBeVisible();
  });

  test("el error conserva el estado HTTP para que la pantalla decida", async ({ page }) => {
    await simularApi(page, { "GET /auth/yo": yoOk, "GET /gastos": { status: 404, body: { status: "error", mensaje: "No encontrado", campo: "id" } } });
    await iniciarSesionComo(page, "ADMIN");
    await page.goto("/dashboard.html");

    const error = await page.evaluate(() => fetchAPI("/gastos").catch((e) => ({ status: e.status, campo: e.campo, mensaje: e.message })));
    expect(error).toEqual({ status: 404, campo: "id", mensaje: "No encontrado" });
  });
});
