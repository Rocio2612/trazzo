const { test, expect } = require("@playwright/test");
const { iniciarSesionComo } = require("./helpers");
const { simularInventario } = require("./backend-falso-inventario");

// Pantalla Equipamiento (bienes-uso.html, bienes de uso). Backend falso (backend-falso-inventario.js), con estos datos:
//   1 Heladera exhibidora   $ 850.000 × 1 = $ 850.000   (12-02-2026)
//   2 Estantes metálicos    $  95.000 × 2 = $ 190.000   (03-03-2026)
//   3 Balanza vieja         $  30.000 × 1 = $  30.000   (05-11-2025)  OCULTA
// Valor total del inventario: $ 1.070.000,00 (el Backend suma también lo oculto: regla CU-18 de Reportes).
// Esta pantalla avisa los errores con alert() y pide confirmación para eliminar con confirm().

let backend;
let avisos;

const aceptarDialogos = (page, { aceptarConfirmaciones = true } = {}) => {
  avisos = [];
  page.on("dialog", async (dialogo) => {
    avisos.push({ tipo: dialogo.type(), mensaje: dialogo.message() });
    if (dialogo.type() === "confirm" && !aceptarConfirmaciones) await dialogo.dismiss();
    else await dialogo.accept();
  });
};

const abrir = async (page, { rol = "ADMIN", semilla, preparar, confirmar = true } = {}) => {
  aceptarDialogos(page, { aceptarConfirmaciones: confirmar });
  backend = await simularInventario(page, { rol, semilla });
  preparar?.(backend);
  await iniciarSesionComo(page, rol);
  await page.goto("/bienes-uso.html");
};

const filas = (page) => page.locator("table.gastos-tabla tbody tr");
const fila = (page, nombre) => filas(page).filter({ hasText: nombre });
const modal = (page) => page.locator(".gastos-modal");
const guardar = (page) => modal(page).getByRole("button", { name: /^Guardar/ });
const buscador = (page) => page.getByPlaceholder("Buscar por nombre...");
const verOcultos = (page) => page.getByRole("button", { name: "Ver ocultos" });
const nuevo = (page) => page.getByRole("button", { name: "Nuevo equipamiento" });

const llenarNuevo = async (page, datos = {}) => {
  const v = { nombre: "Cafetera industrial", valor: "120000", cantidad: "2", fecha: "05-11-2026", proveedor: "1", ...datos };
  await page.locator("#m-nombre").fill(v.nombre);
  await page.locator("#m-valor").fill(v.valor);
  await page.locator("#m-cant").fill(v.cantidad);
  await page.locator("#m-fecha").fill(v.fecha);
  if (v.proveedor) await page.locator("#m-prov").selectOption(v.proveedor);
};

const llenarEdicion = async (page, datos = {}) => {
  const v = { nombre: "Heladera nueva", valor: "900000", cantidad: "1", fecha: "20-01-2026", proveedor: "2", ...datos };
  await page.locator("#e-nombre").fill(v.nombre);
  await page.locator("#e-valor").fill(v.valor);
  await page.locator("#e-cant").fill(v.cantidad);
  await page.locator("#e-fecha").fill(v.fecha);
  if (v.proveedor) await page.locator("#e-prov").selectOption(v.proveedor);
};

test.describe("Equipamiento: pantalla", () => {
  test("muestra el título, el valor total del inventario, la cantidad de equipos y las columnas", async ({ page }) => {
    await abrir(page);
    await expect(page.getByRole("heading", { name: "Equipamiento", level: 1 })).toBeVisible();
    await expect(page.getByText("Valor Total del Inventario:")).toContainText(/1\.070\.000,00/);
    await expect(page.getByText("2 equipos")).toBeVisible();
    await expect(page.locator("table.gastos-tabla thead th")).toHaveText(["NOMBRE", "VALOR ADQ.", "CANTIDAD", "VALOR TOTAL", "FECHA", "CREADO POR", "ACCIONES"]);
  });

  test("lista el equipamiento visible con sus datos y no muestra lo oculto", async ({ page }) => {
    await abrir(page);
    await expect(filas(page)).toHaveCount(2);
    const estantes = fila(page, "Estantes metálicos");
    await expect(estantes).toContainText(/95\.000,00/);
    await expect(estantes).toContainText("2");
    await expect(estantes).toContainText(/190\.000,00/); // valor adquisición × cantidad
    await expect(estantes).toContainText("03-03-2026");
    await expect(estantes).toContainText("admin1");
    await expect(page.getByText("Balanza vieja")).toHaveCount(0);
  });

  test("con un solo equipo el contador va en singular", async ({ page }) => {
    await abrir(page, { semilla: (e) => e.bienes.splice(1, 1) });
    await expect(page.getByText("1 equipo", { exact: true })).toBeVisible();
  });

  test("sin equipamiento muestra 'Sin equipamiento' y el total en cero", async ({ page }) => {
    await abrir(page, { semilla: (e) => (e.bienes = []) });
    await expect(page.getByText("Sin equipamiento", { exact: true })).toBeVisible();
    await expect(page.getByText("Valor Total del Inventario:")).toContainText(/0,00/);
    await expect(page.getByText("0 equipos")).toBeVisible();
  });

  test("un nombre con HTML se muestra como texto y no se ejecuta", async ({ page }) => {
    await abrir(page, { semilla: (e) => (e.bienes[0].nombre = '<img src=x onerror="window.__xss=1">Heladera') });
    await expect(page.getByText('<img src=x onerror="window.__xss=1">Heladera')).toBeVisible();
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  });

  test("si no se puede cargar el equipamiento, avisa con el mensaje del backend", async ({ page }) => {
    await abrir(page, { preparar: (b) => b.fallar("GET /bienes-uso", { status: 500, body: { status: "error", mensaje: "Error al listar el equipamiento" } }) });
    await expect.poll(() => avisos.map((a) => a.mensaje)).toContain("Error al listar el equipamiento");
  });

  test("si no se puede cargar y no hay mensaje, usa el texto por defecto", async ({ page }) => {
    await abrir(page, { preparar: (b) => b.fallar("GET /bienes-uso", { status: 500, body: {} }) });
    await expect.poll(() => avisos.map((a) => a.mensaje)).toContain("Error en la petición");
  });
});

test.describe("Equipamiento: buscador y ocultos", () => {
  test("el buscador filtra por nombre sin distinguir mayúsculas", async ({ page }) => {
    await abrir(page);
    await buscador(page).fill("HELADERA");
    await expect(filas(page)).toHaveCount(1);
    await buscador(page).fill("zzzz");
    await expect(page.getByText("Sin equipamiento", { exact: true })).toBeVisible();
    await buscador(page).fill("");
    await expect(filas(page)).toHaveCount(2);
  });

  test("'Ver ocultos' muestra solo lo oculto, con Restaurar y Eliminar, y vuelve a la lista", async ({ page }) => {
    await abrir(page);
    await verOcultos(page).click();
    await expect(verOcultos(page)).toHaveClass(/activo/);
    await expect(filas(page)).toHaveCount(1);
    await expect(fila(page, "Balanza vieja").getByRole("button", { name: "Restaurar" })).toBeVisible();
    await expect(fila(page, "Balanza vieja").getByTitle("Eliminar")).toBeVisible();
    await expect(fila(page, "Balanza vieja").getByTitle("Editar")).toHaveCount(0);
    await verOcultos(page).click();
    await expect(filas(page)).toHaveCount(2);
  });

  test("sin ocultos, 'Ver ocultos' dice 'Sin elementos ocultos'", async ({ page }) => {
    await abrir(page, { semilla: (e) => e.bienes.forEach((b) => (b.activo = true)) });
    await verOcultos(page).click();
    await expect(page.getByText("Sin elementos ocultos")).toBeVisible();
  });

  test("ocultar saca el equipo de la lista y lo pasa a 'Ver ocultos'; el total no cambia porque lo oculto sigue sumando", async ({ page }) => {
    await abrir(page);
    await fila(page, "Estantes metálicos").getByTitle("Ocultar").click();
    await expect(filas(page)).toHaveCount(1);
    await expect(page.getByText("1 equipo", { exact: true })).toBeVisible();
    await expect(page.getByText("Valor Total del Inventario:")).toContainText(/1\.070\.000,00/);
    expect(backend.llamadas.some((l) => l.metodo === "PATCH" && l.ruta === "/bienes-uso/2/ocultar")).toBe(true);
    await verOcultos(page).click();
    await expect(fila(page, "Estantes metálicos")).toBeVisible();
  });

  test("restaurar devuelve el equipo a la lista y el total sigue igual", async ({ page }) => {
    await abrir(page);
    await verOcultos(page).click();
    await fila(page, "Balanza vieja").getByRole("button", { name: "Restaurar" }).click();
    await expect(page.getByText("Sin elementos ocultos")).toBeVisible();
    await verOcultos(page).click();
    await expect(filas(page)).toHaveCount(3);
    await expect(page.getByText("Valor Total del Inventario:")).toContainText(/1\.070\.000,00/);
  });

  test("si ocultar o restaurar fallan, avisa con el mensaje del backend", async ({ page }) => {
    await abrir(page, {
      preparar: (b) => {
        b.fallar("PATCH /bienes-uso/:id/ocultar", { status: 500, body: { mensaje: "No se pudo ocultar" } });
        b.fallar("PATCH /bienes-uso/:id/restaurar", { status: 404, body: { mensaje: "No se encontró el equipamiento" } });
      },
    });
    await fila(page, "Heladera exhibidora").getByTitle("Ocultar").click();
    await expect.poll(() => avisos.map((a) => a.mensaje)).toContain("No se pudo ocultar");
    await expect(filas(page)).toHaveCount(2);
    await verOcultos(page).click();
    await fila(page, "Balanza vieja").getByRole("button", { name: "Restaurar" }).click();
    await expect.poll(() => avisos.map((a) => a.mensaje)).toContain("No se encontró el equipamiento");
  });
});

test.describe("Equipamiento: eliminar", () => {
  test("pide confirmación con la advertencia, elimina lo oculto y lo saca de la lista", async ({ page }) => {
    await abrir(page);
    await verOcultos(page).click();
    await fila(page, "Balanza vieja").getByTitle("Eliminar").click();
    await expect(page.getByText("Sin elementos ocultos")).toBeVisible();
    expect(avisos).toContainEqual({
      tipo: "confirm",
      mensaje: "ADVERTENCIA: Eliminar este bien altera las sumatorias históricas. ¿Seguro que querés borrarlo definitivamente?",
    });
    expect(backend.llamadas.some((l) => l.metodo === "DELETE" && l.ruta === "/bienes-uso/3")).toBe(true);
  });

  test("si se cancela la confirmación no elimina nada", async ({ page }) => {
    await abrir(page, { confirmar: false });
    await verOcultos(page).click();
    await fila(page, "Balanza vieja").getByTitle("Eliminar").click();
    await expect(fila(page, "Balanza vieja")).toBeVisible();
    expect(backend.llamadas.some((l) => l.metodo === "DELETE")).toBe(false);
  });

  test("si el backend no deja eliminarlo, avisa con su mensaje y el equipo sigue", async ({ page }) => {
    await abrir(page, { preparar: (b) => b.fallar("DELETE /bienes-uso/:id", { status: 409, body: { mensaje: "El equipamiento tiene movimientos asociados" } }) });
    await verOcultos(page).click();
    await fila(page, "Balanza vieja").getByTitle("Eliminar").click();
    await expect.poll(() => avisos.map((a) => a.mensaje)).toContain("El equipamiento tiene movimientos asociados");
    await expect(fila(page, "Balanza vieja")).toBeVisible();
  });
});

test.describe("Equipamiento: nuevo equipamiento", () => {
  test.fixme("pide los proveedores a GET /proveedores", async ({ page }) => {
    await abrir(page);
    await nuevo(page).click();
    await expect(modal(page)).toBeVisible();
    // La dirección correcta es /proveedores (API_URL ya incluye /api). Con /api/proveedores el Backend real respondería 404.
    expect(backend.llamadas.map((l) => `${l.metodo} ${l.ruta}`)).toContain("GET /proveedores");
    expect(backend.llamadas.map((l) => l.ruta)).not.toContain("/api/proveedores");
  });

  test("el formulario ofrece los proveedores y la cantidad arranca en 1", async ({ page }) => {
    await abrir(page);
    await nuevo(page).click();
    await expect(modal(page).getByRole("heading", { name: "Nuevo equipamiento" })).toBeVisible();
    await expect(page.locator("#m-prov option")).toHaveText(["Seleccione un proveedor", "Distribuidora Norte", "Librería Central"]);
    await expect(page.locator("#m-cant")).toHaveValue("1");
    await expect(page.locator("#m-fecha")).toHaveAttribute("placeholder", "dd-mm-aaaa");
  });

  test("crea el equipamiento, envía los datos con los nombres del contrato y actualiza el total", async ({ page }) => {
    await abrir(page);
    await nuevo(page).click();
    await llenarNuevo(page);
    await guardar(page).click();
    await expect(modal(page)).toHaveCount(0);
    expect(backend.enviados("POST", "/bienes-uso")).toEqual([
      { nombre: "Cafetera industrial", precio_compra: 120000, cantidad: 2, stock_minimo: 0, proveedor_id: 1, fecha_adquisicion: "2026-11-05", iva_alicuota: 21 },
    ]);
    await expect(filas(page)).toHaveCount(3);
    await expect(fila(page, "Cafetera industrial")).toContainText(/240\.000,00/);
    await expect(page.getByText("3 equipos")).toBeVisible();
    await expect(page.getByText("Valor Total del Inventario:")).toContainText(/1\.310\.000,00/);
  });

  test("recorta los espacios del nombre", async ({ page }) => {
    await abrir(page);
    await nuevo(page).click();
    await llenarNuevo(page, { nombre: "   Cafetera   " });
    await guardar(page).click();
    await expect(modal(page)).toHaveCount(0);
    expect(backend.enviados("POST", "/bienes-uso")[0].nombre).toBe("Cafetera");
  });

  const invalidos = [
    ["sin nombre", { nombre: "" }, "El nombre es obligatorio."],
    ["con el nombre en blanco", { nombre: "    " }, "El nombre es obligatorio."],
    ["sin valor", { valor: "" }, "Ingrese un valor de adquisición válido."],
    ["con valor negativo", { valor: "-1" }, "Ingrese un valor de adquisición válido."],
    // El Backend exige un valor mayor a cero; la pantalla solo rechaza los negativos y con 0 deja que el Backend lo rechace.
    ["con valor 0", { valor: "0" }, "Ingrese un valor de adquisición válido."],
    ["sin cantidad", { cantidad: "" }, "La cantidad debe ser mayor a 0."],
    ["con cantidad 0", { cantidad: "0" }, "La cantidad debe ser mayor a 0."],
    ["sin proveedor", { proveedor: "" }, "Debe seleccionar un proveedor."],
    ["sin fecha", { fecha: "" }, "La fecha es obligatoria y debe tener el formato dd-mm-aaaa."],
    ["con la fecha en otro formato", { fecha: "2026-11-05" }, "La fecha es obligatoria y debe tener el formato dd-mm-aaaa."],
    ["con una fecha que no existe", { fecha: "30-02-2026" }, "La fecha es obligatoria y debe tener el formato dd-mm-aaaa."],
  ];

  for (const [nombre, datos, mensaje] of invalidos) {
    // Con valor 0 la pantalla todavía deja que el Backend lo rechace (pendiente de arreglar en el frontend).
    const prueba = nombre === "con valor 0" ? test.fixme : test;
    prueba(`rechaza guardar ${nombre}: avisa y no envía nada`, async ({ page }) => {
      await abrir(page);
      await nuevo(page).click();
      await llenarNuevo(page, datos);
      await guardar(page).click();
      await expect.poll(() => avisos.map((a) => a.mensaje)).toContain(mensaje);
      await expect(modal(page)).toHaveCount(1);
      await expect(guardar(page)).toBeEnabled();
      expect(backend.enviados("POST", "/bienes-uso")).toHaveLength(0);
    });
  }

  test("si el backend rechaza el alta, avisa con su mensaje y el formulario sigue abierto", async ({ page }) => {
    await abrir(page, { preparar: (b) => b.fallar("POST /bienes-uso", { status: 400, body: { status: "error", mensaje: "Error de validación en los datos enviados" } }) });
    await nuevo(page).click();
    await llenarNuevo(page);
    await guardar(page).click();
    await expect.poll(() => avisos.map((a) => a.mensaje)).toContain("Error de validación en los datos enviados");
    await expect(modal(page)).toHaveCount(1);
    await expect(guardar(page)).toBeEnabled();
  });

  test("Cancelar y la cruz cierran el formulario sin guardar, y el siguiente abre vacío", async ({ page }) => {
    await abrir(page);
    await nuevo(page).click();
    await llenarNuevo(page);
    await modal(page).getByRole("button", { name: "Cancelar" }).click();
    await expect(modal(page)).toHaveCount(0);
    await nuevo(page).click();
    await expect(page.locator("#m-nombre")).toHaveValue("");
    await modal(page).getByRole("button", { name: "×" }).click();
    await expect(modal(page)).toHaveCount(0);
    expect(backend.enviados("POST", "/bienes-uso")).toHaveLength(0);
  });
});

test.describe("Equipamiento: editar", () => {
  const abrirEdicion = async (page, nombre = "Heladera exhibidora") => {
    await fila(page, nombre).getByTitle("Editar").click();
    await expect(modal(page).getByRole("heading", { name: "Editar equipamiento" })).toBeVisible();
  };

  test("abre con los datos del equipo y la fecha como dd-mm-aaaa", async ({ page }) => {
    await abrir(page);
    await abrirEdicion(page);
    await expect(page.locator("#e-nombre")).toHaveValue("Heladera exhibidora");
    await expect(page.locator("#e-valor")).toHaveValue("850000");
    await expect(page.locator("#e-cant")).toHaveValue("1");
    await expect(page.locator("#e-fecha")).toHaveValue("12-02-2026");
  });

  test.fixme("abre con el proveedor del equipo ya elegido", async ({ page }) => {
    await abrir(page, { semilla: (e) => Object.assign(e.bienes[0], { proveedor_id: 2, proveedor_nombre: "Librería Central" }) });
    await abrirEdicion(page);
    await expect(page.locator("#e-prov")).toHaveValue("2");
  });

  test("guarda los cambios: envía los datos con los nombres del contrato y actualiza la fila y el total", async ({ page }) => {
    await abrir(page);
    await abrirEdicion(page);
    await llenarEdicion(page);
    await guardar(page).click();
    await expect(modal(page)).toHaveCount(0);
    expect(backend.enviados("PUT", "/bienes-uso/:id")).toEqual([
      { nombre: "Heladera nueva", precio_compra: 900000, cantidad: 1, proveedor_id: 2, fecha_adquisicion: "2026-01-20" },
    ]);
    await expect(fila(page, "Heladera nueva")).toContainText(/900\.000,00/);
    await expect(fila(page, "Heladera nueva")).toContainText("20-01-2026");
    await expect(page.getByText("Valor Total del Inventario:")).toContainText(/1\.120\.000,00/);
  });

  test("cambiar la cantidad recalcula el valor total de la fila", async ({ page }) => {
    await abrir(page);
    await abrirEdicion(page, "Estantes metálicos");
    await llenarEdicion(page, { nombre: "Estantes metálicos", valor: "95000", cantidad: "4", fecha: "03-03-2026" });
    await guardar(page).click();
    await expect(modal(page)).toHaveCount(0);
    await expect(fila(page, "Estantes metálicos")).toContainText(/380\.000,00/);
  });

  const invalidos = [
    ["sin nombre", { nombre: "" }, "El nombre es obligatorio."],
    ["sin valor", { valor: "" }, "Ingrese un valor de adquisición válido."],
    ["con valor negativo", { valor: "-10" }, "Ingrese un valor de adquisición válido."],
    ["con cantidad 0", { cantidad: "0" }, "La cantidad debe ser mayor a 0."],
    ["sin proveedor", { proveedor: "" }, "Debe seleccionar un proveedor."],
    ["sin fecha", { fecha: "" }, "La fecha es obligatoria y debe tener el formato dd-mm-aaaa."],
    ["con fecha inválida", { fecha: "2026-01-20" }, "La fecha es obligatoria y debe tener el formato dd-mm-aaaa."],
  ];

  for (const [nombre, datos, mensaje] of invalidos) {
    test(`rechaza guardar ${nombre}: avisa y no modifica nada`, async ({ page }) => {
      await abrir(page);
      await abrirEdicion(page);
      await llenarEdicion(page, datos);
      await guardar(page).click();
      await expect.poll(() => avisos.map((a) => a.mensaje)).toContain(mensaje);
      await expect(modal(page)).toHaveCount(1);
      expect(backend.enviados("PUT", "/bienes-uso/:id")).toHaveLength(0);
    });
  }

  test("si el backend rechaza la edición, avisa con su mensaje y el formulario sigue abierto", async ({ page }) => {
    await abrir(page, { preparar: (b) => b.fallar("PUT /bienes-uso/:id", { status: 404, body: { mensaje: "Equipamiento no encontrado" } }) });
    await abrirEdicion(page);
    await llenarEdicion(page);
    await guardar(page).click();
    await expect.poll(() => avisos.map((a) => a.mensaje)).toContain("Equipamiento no encontrado");
    await expect(modal(page)).toHaveCount(1);
    await expect(guardar(page)).toBeEnabled();
  });

  test("cancelar la edición no guarda los cambios", async ({ page }) => {
    await abrir(page);
    await abrirEdicion(page);
    await llenarEdicion(page);
    await modal(page).getByRole("button", { name: "Cancelar" }).click();
    await expect(fila(page, "Heladera exhibidora")).toBeVisible();
    expect(backend.enviados("PUT", "/bienes-uso/:id")).toHaveLength(0);
  });
});

test.describe("Equipamiento: acceso", () => {
  test("el Propietario también entra", async ({ page }) => {
    await abrir(page, { rol: "PROPIETARIO" });
    await expect(filas(page)).toHaveCount(2);
  });

  test("el menú lateral marca Equipamiento como la pantalla actual", async ({ page }) => {
    await abrir(page);
    await expect(page.getByTestId("menu-bienes_uso")).toHaveAttribute("aria-current", "page");
  });

  test("el Cajero no ve el contenido de Equipamiento ni el link en el menú", async ({ page }) => {
    await abrir(page, { rol: "CAJERO" });
    await expect(page.locator("#bienes-pagina")).toBeHidden();
    await expect(page.getByTestId("menu-bienes_uso")).toHaveCount(0);
  });

  // Como Gastos, Proveedores y Mi negocio: sin permiso para ver el módulo se vuelve al Panel.
  test.fixme("el Cajero que entra por la dirección vuelve al Panel y no pide el equipamiento", async ({ page }) => {
    await abrir(page, { rol: "CAJERO" });
    await expect(page).toHaveURL(/dashboard\.html$/);
    expect(backend.llamadas.some((l) => l.ruta === "/bienes-uso")).toBe(false);
  });

  test("sin sesión iniciada manda al login", async ({ page }) => {
    await page.goto("/bienes-uso.html");
    await expect(page).toHaveURL(/login\.html$/);
  });

  test("usar la pantalla de punta a punta no produce errores de JavaScript", async ({ page }) => {
    const errores = [];
    page.on("pageerror", (e) => errores.push(e.message));
    await abrir(page);
    await buscador(page).fill("heladera");
    await fila(page, "Heladera exhibidora").getByTitle("Ocultar").click();
    await verOcultos(page).click();
    await page.getByRole("button", { name: "Restaurar" }).first().click();
    expect(errores).toEqual([]);
  });
});
