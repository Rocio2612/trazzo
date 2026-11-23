const { test, expect } = require("@playwright/test");
const { jwtFalso, simularApi, iniciarSesionComo, llamadasA, tokensGuardados } = require("./helpers");

const yoOk = { status: 200, body: { status: "ok", usuario: { usuario: "usuario1", rol: "ADMIN" } } };
const sinSesion = { status: 401, body: { status: "error", mensaje: "Token inválido, vencido o no proporcionado" } };

// Solo las llamadas de autenticación: el dashboard hace además otras consultas (p. ej. notificaciones)
// que no son parte de lo que se prueba acá.
const llamadasDeAuth = (llamadas) => llamadas.filter((l) => l.ruta.startsWith("/auth/"));

// Espera a que el front haya hecho `cantidad` llamadas de autenticación.
const esperarLlamadas = (llamadas, cantidad) => expect.poll(() => llamadasDeAuth(llamadas).length).toBe(cantidad);

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

    const auth = llamadasDeAuth(llamadas);
    expect(auth.map((l) => l.ruta)).toEqual(["/auth/yo", "/auth/refresh", "/auth/yo"]);
    // El refresh viaja en el body, sin Authorization, y el pedido se repite con el token nuevo.
    expect(auth[1].body).toEqual({ refresh_token: "refresh-falso" });
    expect(auth[1].headers.authorization).toBeUndefined();
    expect(auth[2].headers.authorization).toBe(`Bearer ${nuevoToken}`);

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

  test("si el refresh devuelve también un refresh token nuevo, lo guarda", async ({ page }) => {
    const nuevoToken = jwtFalso("ADMIN", { jti: "nuevo" });
    await simularApi(page, {
      "GET /auth/yo": yoOk,
      "GET /datos": (vez) => (vez === 0 ? sinSesion : { status: 200, body: { status: "ok", valor: 1 } }),
      "POST /auth/refresh": { status: 200, body: { status: "ok", access_token: nuevoToken, refresh_token: "refresh-nuevo" } },
    });
    await iniciarSesionComo(page, "ADMIN");
    await page.goto("/dashboard.html");
    await page.evaluate(() => fetchAPI("/datos"));
    expect(await tokensGuardados(page)).toEqual({ access: nuevoToken, refresh: "refresh-nuevo" });
  });

  test("si el refresh no devuelve un access token, cierra la sesión", async ({ page }) => {
    await simularApi(page, {
      "GET /auth/yo": yoOk,
      "GET /datos": sinSesion,
      "POST /auth/refresh": { status: 200, body: { status: "ok" } },
    });
    await iniciarSesionComo(page, "ADMIN");
    await page.goto("/dashboard.html");
    await page.evaluate(() => { fetchAPI("/datos").catch(() => {}); });
    await expect(page).toHaveURL(/login\.html$/);
    expect(await tokensGuardados(page)).toEqual({ access: null, refresh: null });
  });

  test("si el refresh responde con error del servidor, cierra la sesión", async ({ page }) => {
    await simularApi(page, {
      "GET /auth/yo": yoOk,
      "GET /datos": sinSesion,
      "POST /auth/refresh": { status: 500, body: { status: "error", mensaje: "Error interno" } },
    });
    await iniciarSesionComo(page, "ADMIN");
    await page.goto("/dashboard.html");
    await page.evaluate(() => { fetchAPI("/datos").catch(() => {}); });
    await expect(page).toHaveURL(/login\.html$/);
    expect(await tokensGuardados(page)).toEqual({ access: null, refresh: null });
  });

  test("un 401 en el logout no intenta renovar: cierra la sesión directo", async ({ page }) => {
    const llamadas = await simularApi(page, {
      "GET /auth/yo": yoOk,
      "POST /auth/logout": sinSesion,
    });
    await iniciarSesionComo(page, "ADMIN");
    await page.goto("/dashboard.html");
    await page.evaluate(() => { fetchAPI("/auth/logout", "POST").catch(() => {}); });
    await expect(page).toHaveURL(/login\.html$/);
    expect(llamadasA(llamadas, "/auth/refresh")).toHaveLength(0);
    expect(await tokensGuardados(page)).toEqual({ access: null, refresh: null });
  });

  test("al cerrar la sesión por vencimiento borra solo lo de Trazzo, no claves ajenas", async ({ page }) => {
    await simularApi(page, { "GET /auth/yo": yoOk, "GET /datos": sinSesion });
    await iniciarSesionComo(page, "ADMIN");
    await page.evaluate(() => {
      localStorage.removeItem("trazzo_refresh_token");
      localStorage.setItem("trazzo_preferencia", "x");
      localStorage.setItem("otra_clave", "se-queda");
    });
    await page.goto("/dashboard.html");
    await page.evaluate(() => { fetchAPI("/datos").catch(() => {}); });
    await expect(page).toHaveURL(/login\.html$/);
    const guardado = await page.evaluate(() => ({
      preferencia: localStorage.getItem("trazzo_preferencia"),
      access: localStorage.getItem("trazzo_access_token"),
      ajena: localStorage.getItem("otra_clave"),
    }));
    expect(guardado).toEqual({ preferencia: null, access: null, ajena: "se-queda" });
  });
});

test.describe("Pedidos a la API: cabeceras y rutas públicas", () => {
  test("una ruta protegida manda el access token en Authorization", async ({ page }) => {
    const llamadas = await simularApi(page, {
      "GET /auth/yo": yoOk,
      "GET /datos": { status: 200, body: { status: "ok", valor: 1 } },
    });
    await iniciarSesionComo(page, "ADMIN");
    await page.goto("/dashboard.html");
    const { access } = await tokensGuardados(page);
    await page.evaluate(() => fetchAPI("/datos"));
    expect(llamadasA(llamadas, "/datos")[0].headers.authorization).toBe(`Bearer ${access}`);
  });

  test("un 401 en una ruta pública no renueva ni cierra la sesión, y no manda Authorization", async ({ page }) => {
    const llamadas = await simularApi(page, {
      "GET /auth/yo": yoOk,
      "POST /auth/login": { status: 401, body: { status: "error", mensaje: "Credenciales incorrectas" } },
    });
    await iniciarSesionComo(page, "ADMIN");
    await page.goto("/dashboard.html");
    const estado = await page.evaluate(() => fetchAPI("/auth/login", "POST", {}).catch((e) => e.status));
    expect(estado).toBe(401);
    expect(llamadasA(llamadas, "/auth/refresh")).toHaveLength(0);
    expect(llamadasA(llamadas, "/auth/login")[0].headers.authorization).toBeUndefined();
    await expect(page).toHaveURL(/dashboard\.html$/);
    expect((await tokensGuardados(page)).access).not.toBeNull();
  });

  test("un 403 en una ruta pública no muestra el aviso de acceso denegado", async ({ page }) => {
    await simularApi(page, {
      "GET /auth/yo": yoOk,
      "POST /auth/login": { status: 403, body: { status: "error", mensaje: "Cuenta bloqueada" } },
    });
    let hubo = false;
    page.on("dialog", (dialog) => {
      hubo = true;
      dialog.dismiss();
    });
    await iniciarSesionComo(page, "ADMIN");
    await page.goto("/dashboard.html");
    const error = await page.evaluate(() => fetchAPI("/auth/login", "POST", {}).catch((e) => ({ status: e.status, mensaje: e.message })));
    expect(error).toEqual({ status: 403, mensaje: "Cuenta bloqueada" });
    expect(hubo).toBe(false);
  });
});

test.describe("Errores de la API: qué datos conserva el error", () => {
  const errorDe = (page) =>
    page.evaluate(() =>
      fetchAPI("/datos").catch((e) => ({ status: e.status, mensaje: e.message, errores: e.errores, espera: e.esperaSegundos })),
    );

  test("toma el tiempo de espera de la cabecera Retry-After", async ({ page }) => {
    await simularApi(page, {
      "GET /auth/yo": yoOk,
      "GET /datos": { status: 429, headers: { "retry-after": "30" }, body: { status: "error", mensaje: "Demasiados intentos" } },
    });
    await iniciarSesionComo(page, "ADMIN");
    await page.goto("/dashboard.html");
    expect(await errorDe(page)).toMatchObject({ status: 429, espera: 30 });
  });

  test("si no hay cabecera, toma el tiempo de espera del cuerpo", async ({ page }) => {
    await simularApi(page, {
      "GET /auth/yo": yoOk,
      "GET /datos": { status: 429, body: { status: "error", mensaje: "Demasiados intentos", espera_segundos: 90 } },
    });
    await iniciarSesionComo(page, "ADMIN");
    await page.goto("/dashboard.html");
    expect(await errorDe(page)).toMatchObject({ status: 429, espera: 90 });
  });

  test("sin mensaje, usa el primero de los errores por campo", async ({ page }) => {
    await simularApi(page, {
      "GET /auth/yo": yoOk,
      "GET /datos": { status: 400, body: { errores: { nombre: "El nombre es obligatorio", precio: "Precio inválido" } } },
    });
    await iniciarSesionComo(page, "ADMIN");
    await page.goto("/dashboard.html");
    expect(await errorDe(page)).toMatchObject({
      status: 400,
      mensaje: "El nombre es obligatorio",
      errores: { nombre: "El nombre es obligatorio", precio: "Precio inválido" },
    });
  });

  test("sin mensaje ni errores, usa el texto por defecto", async ({ page }) => {
    await simularApi(page, { "GET /auth/yo": yoOk, "GET /datos": { status: 400, body: {} } });
    await iniciarSesionComo(page, "ADMIN");
    await page.goto("/dashboard.html");
    expect(await errorDe(page)).toMatchObject({ status: 400, mensaje: "Error en la petición" });
  });

  test("si la respuesta de error no es JSON, igual lanza un error con su estado", async ({ page }) => {
    await simularApi(page, { "GET /auth/yo": yoOk });
    // Esta ruta se registra después, así que tiene prioridad sobre la de simularApi.
    await page.route("**/datos", (route) => {
      const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,OPTIONS" };
      if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
      return route.fulfill({ status: 500, headers: { ...cors, "content-type": "text/html" }, body: "<html>Error</html>" });
    });
    await iniciarSesionComo(page, "ADMIN");
    await page.goto("/dashboard.html");
    expect(await errorDe(page)).toMatchObject({ status: 500, mensaje: "Error en la petición" });
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
