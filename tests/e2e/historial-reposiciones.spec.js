const { test, expect } = require("@playwright/test");
const { iniciarSesionComo } = require("./helpers");
const { simularInventario } = require("./backend-falso-inventario");

// Pantalla Historial de reposiciones (historial-reposiciones.html). Backend falso (backend-falso-inventario.js), con 4 reposiciones:
//   1 Sifón de soda       12 u. · $ 10.200 · $ 850 c/u  · 05-11-2026 · Distribuidora Norte · admin1  · ACTIVA
//   2 Detergente 750 ml   36 u. · $ 22.320 · $ 620 c/u  · 20-10-2026 · Librería Central     · admin1  · ACTIVA
//   3 Lavandina 1 l       24 u. · $  9.120 · $ 380 c/u  · 02-09-2026 · Distribuidora Norte · admin1  · ANULADA
//   4 Yerba mate 1 kg      6 u. · $ 12.600 · $ 2.100 c/u · 15-11-2026 · Distribuidora Norte · cajero1 · ACTIVA
// El reloj se fija el 15-11-2026: "Hoy" es la 4, "Este mes" la 1 y la 4, y "Este año" las cuatro.
// El rol sale del token: el Administrador ve la columna Acciones (y puede anular), el Cajero no.

const HOY = new Date("2026-11-15T12:00:00");

let backend;

const abrir = async (page, { rol = "ADMIN", semilla, preparar, confirmar = true } = {}) => {
  await page.clock.setFixedTime(HOY);
  page.on("dialog", async (dialogo) => (confirmar ? dialogo.accept() : dialogo.dismiss()));
  backend = await simularInventario(page, { rol, semilla });
  preparar?.(backend);
  await iniciarSesionComo(page, rol);
  await page.goto("/historial-reposiciones.html");
};

const filas = (page) => page.locator("#historial-tbody tr");
const fila = (page, producto) => filas(page).filter({ hasText: producto });
const buscador = (page) => page.getByTestId("buscador");
const filtroProveedor = (page) => page.getByTestId("filtro-proveedor");
const filtroFecha = (page) => page.getByTestId("filtro-fecha");
const toast = (page) => page.locator("#toast");
const columnas = (page) => page.locator("thead th");

test.describe("Historial de reposiciones: lista", () => {
  test("el Administrador ve el título, las columnas con Acciones y todas las reposiciones", async ({ page }) => {
    await abrir(page);
    await expect(page.getByRole("heading", { name: "Historial de reposiciones", level: 1 })).toBeVisible();
    await expect(columnas(page)).toHaveText(["Producto", "Cantidad", "Monto total", "Costo unitario real", "Fecha", "Proveedor", "Registrado por", "Estado", "Acciones"]);
    await expect(filas(page)).toHaveCount(4);
  });

  test("cada fila muestra producto, cantidad, importes en pesos, fecha dd-mm-aaaa, proveedor, quién la registró y su estado", async ({ page }) => {
    await abrir(page);
    const sifon = fila(page, "Sifón de soda");
    await expect(sifon).toContainText("12");
    await expect(sifon).toContainText(/10\.200,00/);
    await expect(sifon).toContainText(/850,00/);
    await expect(sifon).toContainText("05-11-2026");
    await expect(sifon).toContainText("Distribuidora Norte");
    await expect(sifon).toContainText("admin1");
    await expect(sifon).toContainText("Activa");
    await expect(fila(page, "Lavandina")).toContainText("Anulada");
  });

  test("el Cajero ve las mismas reposiciones pero sin la columna Acciones ni botones para anular", async ({ page }) => {
    await abrir(page, { rol: "CAJERO" });
    await expect(filas(page)).toHaveCount(4);
    await expect(page.locator("thead th:visible")).toHaveText(["Producto", "Cantidad", "Monto total", "Costo unitario real", "Fecha", "Proveedor", "Registrado por", "Estado"]);
    await expect(columnas(page).filter({ hasText: "Acciones" })).toBeHidden();
    await expect(page.getByTitle("Anular")).toHaveCount(0);
  });

  test("sin reposiciones muestra 'No hay reposiciones registradas'", async ({ page }) => {
    await abrir(page, { semilla: (e) => (e.reposiciones = []) });
    await expect(page.getByText("No hay reposiciones registradas")).toBeVisible();
  });

  test("mientras llega la lista muestra 'Cargando...'", async ({ page }) => {
    await abrir(page, { preparar: (b) => b.demorar("GET /reposiciones", 700) });
    await expect(page.getByText("Cargando...")).toBeVisible();
    await expect(filas(page)).toHaveCount(4);
  });

  test("si la lista no carga, avisa con el mensaje del backend en la tabla", async ({ page }) => {
    await abrir(page, { preparar: (b) => b.fallar("GET /reposiciones", { status: 500, body: { status: "error", mensaje: "Error al listar las reposiciones" } }) });
    await expect(page.locator(".fila-mensaje.error")).toHaveText("Error al listar las reposiciones");
  });

  test("si la lista no carga y no hay mensaje, usa el texto por defecto", async ({ page }) => {
    await abrir(page, { preparar: (b) => b.fallar("GET /reposiciones", { status: 500, body: {} }) });
    await expect(page.locator(".fila-mensaje.error")).toHaveText("Error al cargar el historial");
  });

  test("sin conexión, lo avisa en español", async ({ page }) => {
    await abrir(page, { preparar: (b) => b.fallar("GET /reposiciones", { abortar: true }) });
    await expect(page.locator(".fila-mensaje.error")).toHaveText("No se pudo conectar con el servidor.");
  });

  test("sin proveedor ni quien la registró se ve un guion, nunca «null»", async ({ page }) => {
    await abrir(page, { semilla: (e) => Object.assign(e.reposiciones[0], { proveedor_nombre: null, creado_por: null }) });
    const sifon = fila(page, "Sifón de soda");
    await expect(sifon).toContainText("—");
    await expect(sifon).not.toContainText("null");
  });

  test("un nombre con HTML se muestra como texto y no se ejecuta", async ({ page }) => {
    await abrir(page, { semilla: (e) => (e.reposiciones[0].producto_nombre = '<img src=x onerror="window.__xss=1">Sifón') });
    await expect(page.getByText('<img src=x onerror="window.__xss=1">Sifón')).toBeVisible();
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  });

  test("el enlace 'Volver a Productos' lleva a Productos", async ({ page }) => {
    await abrir(page);
    await page.getByRole("link", { name: /Volver a Productos/ }).click();
    await expect(page).toHaveURL(/productos\.html$/);
  });
});

test.describe("Historial de reposiciones: búsqueda y filtros", () => {
  test("el buscador filtra por producto sin distinguir mayúsculas", async ({ page }) => {
    await abrir(page);
    await buscador(page).fill("DETERGENTE");
    await expect(filas(page)).toHaveCount(1);
    await expect(fila(page, "Detergente 750 ml")).toBeVisible();
  });

  test("el buscador también filtra por proveedor", async ({ page }) => {
    await abrir(page);
    await buscador(page).fill("librería");
    await expect(filas(page)).toHaveCount(1);
    await buscador(page).fill("norte");
    await expect(filas(page)).toHaveCount(3);
  });

  test("sin coincidencias dice 'No hay reposiciones registradas' y al borrar el texto vuelve la lista", async ({ page }) => {
    await abrir(page);
    await buscador(page).fill("zzzz");
    await expect(page.getByText("No hay reposiciones registradas")).toBeVisible();
    await buscador(page).fill("");
    await expect(filas(page)).toHaveCount(4);
  });

  test("el filtro de proveedores lista cada proveedor una sola vez, ordenados", async ({ page }) => {
    await abrir(page);
    await expect(filtroProveedor(page).locator("option")).toHaveText(["Todos los proveedores", "Distribuidora Norte", "Librería Central"]);
  });

  test("filtrar por proveedor muestra solo sus reposiciones", async ({ page }) => {
    await abrir(page);
    await filtroProveedor(page).selectOption("Librería Central");
    await expect(filas(page)).toHaveCount(1);
    await expect(fila(page, "Detergente 750 ml")).toBeVisible();
    await filtroProveedor(page).selectOption("");
    await expect(filas(page)).toHaveCount(4);
  });

  test("los proveedores vacíos no aparecen como opción del filtro", async ({ page }) => {
    await abrir(page, { semilla: (e) => (e.reposiciones[1].proveedor_nombre = null) });
    await expect(filtroProveedor(page).locator("option")).toHaveText(["Todos los proveedores", "Distribuidora Norte"]);
  });

  test("el filtro de fecha tiene las cuatro opciones", async ({ page }) => {
    await abrir(page);
    await expect(filtroFecha(page).locator("option")).toHaveText(["Todas las fechas", "Hoy", "Este mes", "Este año"]);
  });

  test("'Hoy' muestra solo las de hoy", async ({ page }) => {
    await abrir(page);
    await filtroFecha(page).selectOption("hoy");
    await expect(filas(page)).toHaveCount(1);
    await expect(fila(page, "Yerba mate")).toBeVisible();
  });

  test("'Este mes' muestra las de noviembre", async ({ page }) => {
    await abrir(page);
    await filtroFecha(page).selectOption("mes");
    await expect(filas(page)).toHaveCount(2);
    await expect(fila(page, "Sifón de soda")).toBeVisible();
    await expect(fila(page, "Yerba mate")).toBeVisible();
  });

  test("'Este año' muestra las de 2026 y deja afuera las de otro año", async ({ page }) => {
    await abrir(page, { semilla: (e) => (e.reposiciones[2].fecha_adquisicion = "2025-09-02") });
    await filtroFecha(page).selectOption("año");
    await expect(filas(page)).toHaveCount(3);
    await expect(fila(page, "Lavandina")).toHaveCount(0);
    await filtroFecha(page).selectOption("todas");
    await expect(filas(page)).toHaveCount(4);
  });

  test("una reposición sin fecha no entra en ningún período, pero sí en 'Todas las fechas'", async ({ page }) => {
    await abrir(page, { semilla: (e) => (e.reposiciones[0].fecha_adquisicion = null) });
    await expect(fila(page, "Sifón de soda")).toContainText("—");
    await filtroFecha(page).selectOption("año");
    await expect(fila(page, "Sifón de soda")).toHaveCount(0);
  });

  test("los filtros se combinan: proveedor, fecha y texto", async ({ page }) => {
    await abrir(page);
    await filtroProveedor(page).selectOption("Distribuidora Norte");
    await filtroFecha(page).selectOption("mes");
    await expect(filas(page)).toHaveCount(2);
    await buscador(page).fill("yerba");
    await expect(filas(page)).toHaveCount(1);
    await expect(fila(page, "Yerba mate")).toBeVisible();
  });
});

test.describe("Historial de reposiciones: anular", () => {
  test("solo las reposiciones activas tienen botón para anular; las anuladas muestran un guion", async ({ page }) => {
    await abrir(page);
    await expect(page.getByTitle("Anular")).toHaveCount(3);
    await expect(fila(page, "Lavandina").getByTitle("Anular")).toHaveCount(0);
    await expect(fila(page, "Lavandina").locator("td").last()).toHaveText("—");
  });

  test("pide confirmación con el aviso del stock, anula la reposición y avisa", async ({ page }) => {
    const mensajes = [];
    await abrir(page);
    page.on("dialog", (d) => mensajes.push(d.message()));
    await fila(page, "Sifón de soda").getByTitle("Anular").click();
    await expect(toast(page)).toHaveText("Reposición anulada");
    expect(mensajes).toContain("¿Estás seguro de anular esta reposición? Se restará el stock correspondiente al producto.");
    expect(backend.llamadas.some((l) => l.metodo === "PATCH" && l.ruta === "/reposiciones/1/anular")).toBe(true);
    await expect(fila(page, "Sifón de soda")).toContainText("Anulada");
    await expect(fila(page, "Sifón de soda").getByTitle("Anular")).toHaveCount(0);
  });

  test("si se cancela la confirmación no anula nada", async ({ page }) => {
    await abrir(page, { confirmar: false });
    await fila(page, "Sifón de soda").getByTitle("Anular").click();
    await expect(fila(page, "Sifón de soda")).toContainText("Activa");
    expect(backend.llamadas.some((l) => l.metodo === "PATCH")).toBe(false);
    await expect(toast(page)).not.toHaveClass(/mostrar/);
  });

  test("al anular, la lista se recarga y conserva el filtro de proveedor elegido", async ({ page }) => {
    await abrir(page);
    await filtroProveedor(page).selectOption("Distribuidora Norte");
    await expect(filas(page)).toHaveCount(3);
    await fila(page, "Sifón de soda").getByTitle("Anular").click();
    await expect(toast(page)).toHaveText("Reposición anulada");
    await expect(filtroProveedor(page)).toHaveValue("Distribuidora Norte");
    await expect(filas(page)).toHaveCount(3);
    await expect(filtroProveedor(page).locator("option")).toHaveCount(3); // no se duplican las opciones al recargar
  });

  test("si el stock ya no alcanza (409) avisa con el motivo y la reposición sigue activa", async ({ page }) => {
    await abrir(page, { preparar: (b) => b.fallar("PATCH /reposiciones/:id/anular", { status: 409, body: { status: "error", mensaje: "Stock insuficiente" } }) });
    await fila(page, "Sifón de soda").getByTitle("Anular").click();
    await expect(toast(page)).toHaveText("No se puede anular: el stock actual del producto es menor a la cantidad que se intenta restar.");
    await expect(toast(page)).toHaveClass(/error/);
    await expect(fila(page, "Sifón de soda")).toContainText("Activa");
  });

  test("otro error del backend se avisa con su mensaje", async ({ page }) => {
    await abrir(page, { preparar: (b) => b.fallar("PATCH /reposiciones/:id/anular", { status: 404, body: { status: "error", mensaje: "Reposición no encontrada" } }) });
    await fila(page, "Sifón de soda").getByTitle("Anular").click();
    await expect(toast(page)).toHaveText("Reposición no encontrada");
    await expect(toast(page)).toHaveClass(/error/);
  });

  test("un error sin mensaje usa el texto por defecto", async ({ page }) => {
    await abrir(page, { preparar: (b) => b.fallar("PATCH /reposiciones/:id/anular", { status: 500, body: {} }) });
    await fila(page, "Sifón de soda").getByTitle("Anular").click();
    await expect(toast(page)).toHaveText("No se pudo anular la reposición.");
  });

  test("un clic fuera del botón de anular no hace nada", async ({ page }) => {
    await abrir(page);
    await fila(page, "Sifón de soda").locator("td").first().click();
    expect(backend.llamadas.some((l) => l.metodo === "PATCH")).toBe(false);
  });
});

test.describe("Historial de reposiciones: acceso", () => {
  test("el Propietario también ve las acciones", async ({ page }) => {
    await abrir(page, { rol: "PROPIETARIO" });
    await expect(page.getByTitle("Anular")).toHaveCount(3);
  });

  test("sin sesión iniciada manda al login", async ({ page }) => {
    await page.goto("/historial-reposiciones.html");
    await expect(page).toHaveURL(/login\.html$/);
  });

  test("usar la pantalla de punta a punta no produce errores de JavaScript", async ({ page }) => {
    const errores = [];
    page.on("pageerror", (e) => errores.push(e.message));
    await abrir(page);
    await buscador(page).fill("sifón");
    await filtroProveedor(page).selectOption("Distribuidora Norte");
    await filtroFecha(page).selectOption("mes");
    await fila(page, "Sifón de soda").getByTitle("Anular").click();
    await expect(toast(page)).toHaveText("Reposición anulada");
    expect(errores).toEqual([]);
  });
});
