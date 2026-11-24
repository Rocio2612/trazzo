const { test, expect } = require("@playwright/test");
const { iniciarSesionComo } = require("./helpers");
const { simularCatalogo } = require("./backend-falso-catalogo");

// Campana de notificaciones (alertas de stock). La arma js/layout.js en todas las pantallas y su lógica está en
// js/notificaciones.js; se prueba desde productos.html. Backend falso (backend-falso-catalogo.js), con estas alertas:
//   7 Collar (quedan 2)      8 Correa (quedan 0)
// Pide GET /notificaciones/contador al cargar (y cada 45 segundos), GET /notificaciones al abrir el panel y
// PATCH /notificaciones/<id>/eliminar-vista para descartar una alerta. Los errores al descartar se avisan con alert().

let backend;
let avisos;

const abrir = async (page, { rol = "ADMIN", semilla, preparar, antes } = {}) => {
  avisos = [];
  page.on("dialog", async (dialogo) => {
    avisos.push(dialogo.message());
    await dialogo.accept();
  });
  backend = await simularCatalogo(page, { rol, semilla });
  preparar?.(backend);
  await antes?.();
  await iniciarSesionComo(page, rol);
  await page.goto("/productos.html");
};

const campana = (page) => page.getByTestId("campana");
const contador = (page) => page.getByTestId("campana-contador");
const panel = (page) => page.getByTestId("panel-alertas");
const eliminar = (page) => panel(page).getByRole("button", { name: "Eliminar" });

const abrirPanel = async (page) => {
  await campana(page).click();
  await expect(panel(page)).toBeVisible();
};

test.describe("Notificaciones: contador de la campana", () => {
  test("muestra la campana y la cantidad de alertas", async ({ page }) => {
    await abrir(page);
    await expect(campana(page)).toBeVisible();
    await expect(contador(page)).toHaveText("2");
    expect(backend.enviados("GET", "/notificaciones/contador")).toHaveLength(1);
  });

  test("sin alertas el contador queda oculto", async ({ page }) => {
    await abrir(page, { semilla: (e) => (e.alertas = []) });
    await expect(campana(page)).toBeVisible();
    await expect(contador(page)).toBeHidden();
  });

  test("con 99 alertas muestra 99", async ({ page }) => {
    await abrir(page, { semilla: (e) => (e.alertas = Array.from({ length: 99 }, (_, i) => ({ id: i + 1, producto_nombre: `P${i}`, stock_actual: 1 }))) });
    await expect(contador(page)).toHaveText("99");
  });

  test("con más de 99 alertas muestra 99+", async ({ page }) => {
    await abrir(page, { semilla: (e) => (e.alertas = Array.from({ length: 150 }, (_, i) => ({ id: i + 1, producto_nombre: `P${i}`, stock_actual: 1 }))) });
    await expect(contador(page)).toHaveText("99+");
  });

  test("si falla el pedido del contador, no rompe la pantalla y el contador queda oculto", async ({ page }) => {
    await abrir(page, { preparar: (b) => b.fallar("GET /notificaciones/contador", { status: 500, body: { mensaje: "Error interno del servidor" } }) });
    await expect(page.getByRole("heading", { name: "Productos", level: 1 })).toBeVisible();
    await expect(contador(page)).toBeHidden();
    expect(avisos).toEqual([]);
  });

  test("sin conexión tampoco rompe la pantalla", async ({ page }) => {
    await abrir(page, { preparar: (b) => b.fallar("GET /notificaciones/contador", { abortar: true }) });
    await expect(page.getByRole("heading", { name: "Productos", level: 1 })).toBeVisible();
    await expect(contador(page)).toBeHidden();
  });

  test("vuelve a consultar el contador cada 45 segundos", async ({ page }) => {
    await abrir(page, { antes: () => page.clock.install() });
    await expect(contador(page)).toHaveText("2");
    backend.estado.alertas.push({ id: 9, producto_nombre: "Pecera", stock_actual: 1 });
    await page.clock.runFor(45000);
    await expect(contador(page)).toHaveText("3");
    expect(backend.enviados("GET", "/notificaciones/contador").length).toBeGreaterThanOrEqual(2);
  });

  test("si el contador falla en una consulta posterior, conserva el último número", async ({ page }) => {
    await abrir(page, { antes: () => page.clock.install() });
    await expect(contador(page)).toHaveText("2");
    backend.fallar("GET /notificaciones/contador", { status: 500, body: {} });
    await page.clock.runFor(45000);
    await expect(contador(page)).toHaveText("2");
  });

  test("al volver a la pestaña consulta de nuevo el contador", async ({ page }) => {
    await abrir(page);
    await expect(contador(page)).toHaveText("2");
    backend.estado.alertas.push({ id: 9, producto_nombre: "Pecera", stock_actual: 1 });
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(contador(page)).toHaveText("3");
  });
});

test.describe("Notificaciones: panel de alertas", () => {
  test("la campana abre el panel con las alertas de stock", async ({ page }) => {
    await abrir(page);
    await expect(panel(page)).toBeHidden();
    await abrirPanel(page);
    await expect(panel(page)).toContainText("Collar, quedan 2");
    await expect(panel(page)).toContainText("Correa, quedan 0");
    await expect(eliminar(page)).toHaveCount(2);
    expect(backend.enviados("GET", "/notificaciones")).toHaveLength(1);
  });

  test("con la misma campana se cierra", async ({ page }) => {
    await abrir(page);
    await abrirPanel(page);
    await campana(page).click();
    await expect(panel(page)).toBeHidden();
  });

  test("un clic afuera lo cierra y un clic adentro no", async ({ page }) => {
    await abrir(page);
    await abrirPanel(page);
    await panel(page).getByText("Collar, quedan 2").click();
    await expect(panel(page)).toBeVisible();
    await page.getByRole("heading", { name: "Productos", level: 1 }).click();
    await expect(panel(page)).toBeHidden();
  });

  test("sin alertas dice 'Sin alertas'", async ({ page }) => {
    await abrir(page, { semilla: (e) => (e.alertas = []) });
    await abrirPanel(page);
    await expect(panel(page)).toContainText("Sin alertas");
    await expect(eliminar(page)).toHaveCount(0);
  });

  test("una alerta con mensaje propio lo muestra tal cual", async ({ page }) => {
    await abrir(page, { semilla: (e) => (e.alertas = [{ id: 1, mensaje: "Quedan pocas unidades de Yerba" }]) });
    await abrirPanel(page);
    await expect(panel(page)).toContainText("Quedan pocas unidades de Yerba");
  });

  test("acepta los nombres 'producto', 'nombre' y 'cantidad' que pueda mandar el backend", async ({ page }) => {
    await abrir(page, {
      semilla: (e) =>
        (e.alertas = [
          { id: 1, producto: "Jabón", cantidad: 4 },
          { id: 2, nombre: "Esponja", cantidad: 0 },
        ]),
    });
    await abrirPanel(page);
    await expect(panel(page)).toContainText("Jabón, quedan 4");
    await expect(panel(page)).toContainText("Esponja, quedan 0");
  });

  test("una alerta sin cantidad muestra solo el nombre del producto", async ({ page }) => {
    await abrir(page, { semilla: (e) => (e.alertas = [{ id: 1, producto_nombre: "Collar" }]) });
    await abrirPanel(page);
    await expect(panel(page)).toContainText("Collar");
    await expect(panel(page)).not.toContainText("quedan");
  });

  test("una alerta sin nombre dice 'Producto'", async ({ page }) => {
    await abrir(page, { semilla: (e) => (e.alertas = [{ id: 1, stock_actual: 3 }]) });
    await abrirPanel(page);
    await expect(panel(page)).toContainText("Producto, quedan 3");
  });

  test("el nombre del producto con código HTML se muestra como texto y no se ejecuta", async ({ page }) => {
    const peligroso = '<img src=x onerror="window.__xss=1">Collar';
    await abrir(page, { semilla: (e) => (e.alertas = [{ id: 1, producto_nombre: peligroso, stock_actual: 1 }]) });
    await abrirPanel(page);
    await expect(panel(page)).toContainText(peligroso);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  });

  test("cada vez que se abre vuelve a pedir las alertas", async ({ page }) => {
    await abrir(page);
    await abrirPanel(page);
    await expect(panel(page)).not.toContainText("Pecera");
    await campana(page).click();
    backend.estado.alertas.push({ id: 9, producto_nombre: "Pecera", stock_actual: 1 });
    await abrirPanel(page);
    await expect(panel(page)).toContainText("Pecera, quedan 1");
    expect(backend.enviados("GET", "/notificaciones")).toHaveLength(2);
  });

  test("si no cargan las alertas, lo avisa en el panel", async ({ page }) => {
    await abrir(page, { preparar: (b) => b.fallar("GET /notificaciones", { status: 500, body: { mensaje: "Error interno del servidor" } }) });
    await abrirPanel(page);
    await expect(panel(page)).toHaveText("Error al cargar alertas.");
  });

  test("sin conexión, el panel también avisa que no cargaron", async ({ page }) => {
    await abrir(page, { preparar: (b) => b.fallar("GET /notificaciones", { abortar: true }) });
    await abrirPanel(page);
    await expect(panel(page)).toHaveText("Error al cargar alertas.");
  });
});

test.describe("Notificaciones: descartar alertas", () => {
  test("'Eliminar' saca la alerta del panel y baja el contador", async ({ page }) => {
    await abrir(page);
    await abrirPanel(page);
    await eliminar(page).first().click();
    await expect(panel(page)).not.toContainText("Collar");
    await expect(panel(page)).toContainText("Correa, quedan 0");
    await expect(contador(page)).toHaveText("1");
    expect(backend.llamadas.find((l) => l.metodo === "PATCH").ruta).toBe("/notificaciones/7/eliminar-vista");
  });

  test("al descartar la última, el contador desaparece y el panel dice 'Sin alertas'", async ({ page }) => {
    await abrir(page, { semilla: (e) => (e.alertas = [{ id: 7, producto_nombre: "Collar", stock_actual: 2 }]) });
    await expect(contador(page)).toHaveText("1");
    await abrirPanel(page);
    await eliminar(page).click();
    await expect(contador(page)).toBeHidden();
    await expect(panel(page)).toContainText("Sin alertas");
  });

  test("lo descartado no vuelve a aparecer al reabrir el panel", async ({ page }) => {
    await abrir(page);
    await abrirPanel(page);
    await eliminar(page).first().click();
    await expect(contador(page)).toHaveText("1");
    await campana(page).click();
    await abrirPanel(page);
    await expect(panel(page)).not.toContainText("Collar");
    await expect(eliminar(page)).toHaveCount(1);
  });

  test("descartar una alerta no cierra el panel", async ({ page }) => {
    await abrir(page);
    await abrirPanel(page);
    await eliminar(page).first().click();
    await expect(contador(page)).toHaveText("1");
    await expect(panel(page)).toBeVisible();
  });

  test("si el backend falla al descartar, avisa y la alerta sigue en el panel", async ({ page }) => {
    await abrir(page, { preparar: (b) => b.fallar("PATCH /notificaciones/:id/eliminar-vista", { status: 500, body: { mensaje: "Error interno del servidor" } }) });
    await abrirPanel(page);
    await eliminar(page).first().click();
    await expect.poll(() => avisos).toContain("Error al eliminar la alerta");
    await expect(panel(page)).toContainText("Collar, quedan 2");
    await expect(contador(page)).toHaveText("2");
  });
});

test.describe("Notificaciones: roles y acceso", () => {
  test("el Cajero también ve la campana, el contador y puede descartar alertas", async ({ page }) => {
    await abrir(page, { rol: "CAJERO" });
    await expect(contador(page)).toHaveText("2");
    await abrirPanel(page);
    await eliminar(page).first().click();
    await expect(contador(page)).toHaveText("1");
  });

  test("un rol sin permiso no ve la campana ni consulta las alertas", async ({ page }) => {
    await abrir(page, { rol: "EMPLEADO" });
    await expect(page.getByTestId("btn-cerrar-sesion")).toBeVisible();
    await expect(campana(page)).toBeHidden();
    expect(backend.enviados("GET", "/notificaciones/contador")).toHaveLength(0);
  });

  test("sin sesión iniciada manda al login", async ({ page }) => {
    await page.goto("/productos.html");
    await expect(page).toHaveURL(/login\.html/);
  });

  test("usar la campana de punta a punta no produce errores de JavaScript", async ({ page }) => {
    const errores = [];
    page.on("pageerror", (e) => errores.push(e.message));
    await abrir(page);
    await abrirPanel(page);
    await eliminar(page).first().click();
    await expect(contador(page)).toHaveText("1");
    await campana(page).click();
    expect(errores).toEqual([]);
  });
});
