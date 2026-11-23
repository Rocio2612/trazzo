const { test, expect } = require("@playwright/test");
const { iniciarSesionComo } = require("./helpers");
const { simularCatalogo } = require("./backend-falso-catalogo");

// Pantalla Clientes (clientes.html). Solo la ve el Administrador (la matriz de roles no le da al Cajero el permiso "ver").
// Backend falso (backend-falso-catalogo.js), con estos datos:
//   1 Ana Pérez           DNI 30111222            Consumidor Final   3 ventas, saldo $ 1.500
//   2 Almacén Don José    CUIT 20-12345678-6      Resp. Inscripto    sin movimientos
//   3 Luis Gómez          (alta rápida: solo el nombre)              saldo a favor $ 300
//   4 Panadería La Espiga CUIT 30-71234567-8      OCULTO, sin movimientos (se puede eliminar)
//   5 Kiosco El Sol       DNI 28999111            OCULTO, con 4 ventas (no se puede eliminar)
// Los avisos salen en el cartel #toast; ocultar y eliminar piden confirmación con confirm() del navegador.

// Los tests usan una ventana alta (1000 px) porque en una de 720 px de alto el formulario de cliente queda cortado y no se
// llega al botón Guardar (ver el test de "pantallas bajas" al final).
test.use({ viewport: { width: 1280, height: 1000 } });

let backend;
let confirmaciones;
let erroresDePagina;

const abrir = async (page, { rol = "ADMIN", semilla, preparar, respuestas = [] } = {}) => {
  erroresDePagina = [];
  page.on("pageerror", (e) => erroresDePagina.push(e.message));
  confirmaciones = [];
  const pendientes = [...respuestas];
  page.on("dialog", async (dialogo) => {
    confirmaciones.push(dialogo.message());
    const acepta = dialogo.type() === "confirm" ? (pendientes.length ? pendientes.shift() : true) : true;
    if (acepta) await dialogo.accept();
    else await dialogo.dismiss();
  });
  backend = await simularCatalogo(page, { rol, semilla });
  preparar?.(backend);
  await iniciarSesionComo(page, rol);
  await page.goto("/clientes.html");
};

const filas = (page) => page.locator("#clientes-tbody tr");
const fila = (page, nombre) => filas(page).filter({ hasText: nombre });
const toast = (page) => page.locator("#toast");
const buscador = (page) => page.locator("#buscador");
const verOcultos = (page) => page.locator("#btn-ver-ocultos");
const nuevo = (page) => page.locator("#btn-nuevo-cliente");
const modal = (page) => page.locator("#modal-cliente");
const ficha = (page) => page.locator("#modal-ficha");
const guardar = (page) => page.locator("#btn-guardar-cliente");
const accion = (page, nombre, titulo) => fila(page, nombre).locator(`button[title="${titulo}"]`);

const llenar = async (page, datos = {}) => {
  const v = { nombre: "Carlos López", telefono: "11 4555-0000", correo: "carlos@correo.com", tipo: "DNI", numero: "30111999", domicilio: "Calle 1 123", categoria: "CONSUMIDOR_FINAL", ...datos };
  await page.locator("#nombre").fill(v.nombre);
  await page.locator("#telefono").fill(v.telefono);
  await page.locator("#correo").fill(v.correo);
  await page.locator("#tipo_documento").selectOption(v.tipo);
  await page.locator("#numero_documento").fill(v.numero);
  await page.locator("#domicilio").fill(v.domicilio);
  await page.locator("#categoria_impositiva").selectOption(v.categoria);
};

const abrirNuevo = async (page) => {
  await nuevo(page).click();
  await expect(modal(page)).toBeVisible();
};

test.describe("Clientes: la lista", () => {
  test("muestra el título, el buscador y las columnas", async ({ page }) => {
    await abrir(page);
    await expect(page.getByRole("heading", { name: "Clientes", level: 1 })).toBeVisible();
    await expect(page.locator("table thead th")).toHaveText(["Nombre o razón social", "Documento", "Categoría impositiva", "Acciones"]);
    await expect(buscador(page)).toHaveAttribute("placeholder", "Buscar por nombre, documento o correo...");
  });

  test("lista los clientes visibles con su documento y su categoría", async ({ page }) => {
    await abrir(page);
    await expect(filas(page)).toHaveCount(3);
    await expect(fila(page, "Ana Pérez")).toContainText("DNI 30111222");
    await expect(fila(page, "Ana Pérez")).toContainText("CONSUMIDOR FINAL");
    await expect(fila(page, "Almacén Don José")).toContainText("CUIT 20-12345678-6");
    await expect(fila(page, "Almacén Don José")).toContainText("RESPONSABLE INSCRIPTO");
    await expect(page.getByText("Panadería La Espiga")).toHaveCount(0);
  });

  test("un cliente de alta rápida (solo el nombre) muestra guiones en el documento y la categoría", async ({ page }) => {
    await abrir(page);
    const celdas = fila(page, "Luis Gómez").locator("td");
    await expect(celdas.nth(1)).toHaveText("—");
    await expect(celdas.nth(2)).toHaveText("—");
  });

  test("el Admin ve Ver ficha, Editar y Ocultar en cada cliente", async ({ page }) => {
    await abrir(page);
    for (const titulo of ["Ver ficha", "Editar", "Ocultar"]) await expect(page.locator(`#clientes-tbody button[title="${titulo}"]`)).toHaveCount(3);
    await expect(page.locator('#clientes-tbody button[title="Eliminar"]')).toHaveCount(0);
  });

  test("sin clientes muestra 'Sin clientes'", async ({ page }) => {
    await abrir(page, { semilla: (e) => (e.clientes = []) });
    await expect(page.getByText("Sin clientes", { exact: true })).toBeVisible();
  });

  test("mientras llegan los datos muestra 'Cargando...'", async ({ page }) => {
    await abrir(page, { preparar: (b) => b.demorar("GET /clientes", 800) });
    await expect(page.getByText("Cargando...", { exact: true })).toBeVisible();
    await expect(filas(page)).toHaveCount(3);
  });

  test("si el backend falla, avisa en la tabla", async ({ page }) => {
    await abrir(page, { preparar: (b) => b.fallar("GET /clientes", { status: 500, body: { mensaje: "Error interno del servidor" } }) });
    await expect(page.getByText("Error al cargar clientes")).toBeVisible();
  });

  test("sin conexión también avisa en la tabla", async ({ page }) => {
    await abrir(page, { preparar: (b) => b.fallar("GET /clientes", { abortar: true }) });
    await expect(page.getByText("Error al cargar clientes")).toBeVisible();
  });

  test.fixme("un nombre con código HTML se muestra como texto y no se ejecuta", async ({ page }) => {
    const peligroso = '<img src=x onerror="window.__xss=1">Collar';
    await abrir(page, { semilla: (e) => (e.clientes[0].nombre = peligroso) });
    await expect(filas(page)).toHaveCount(3);
    await expect(page.locator("#clientes-tbody")).toContainText(peligroso);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  });
});

test.describe("Clientes: buscador y ver ocultos", () => {
  test("busca por nombre sin distinguir mayúsculas", async ({ page }) => {
    await abrir(page);
    await buscador(page).fill("ANA");
    await expect(filas(page)).toHaveCount(1);
    await expect(fila(page, "Ana Pérez")).toBeVisible();
  });

  test("busca por número de documento", async ({ page }) => {
    await abrir(page);
    await buscador(page).fill("12345678");
    await expect(filas(page)).toHaveCount(1);
    await expect(fila(page, "Almacén Don José")).toBeVisible();
  });

  test("busca por correo", async ({ page }) => {
    await abrir(page);
    await buscador(page).fill("DONJOSE@almacen");
    await expect(filas(page)).toHaveCount(1);
    await expect(fila(page, "Almacén Don José")).toBeVisible();
  });

  test("un cliente sin documento ni correo no rompe la búsqueda", async ({ page }) => {
    await abrir(page);
    await buscador(page).fill("luis");
    await expect(filas(page)).toHaveCount(1);
    await buscador(page).fill("9999");
    await expect(page.getByText("Sin clientes", { exact: true })).toBeVisible();
  });

  test("al borrar el texto vuelven todos", async ({ page }) => {
    await abrir(page);
    await buscador(page).fill("ana");
    await expect(filas(page)).toHaveCount(1);
    await buscador(page).fill("");
    await expect(filas(page)).toHaveCount(3);
  });

  test("'Ver ocultos' pide los ocultos y muestra Restaurar y Eliminar en lugar de Editar y Ocultar", async ({ page }) => {
    await abrir(page);
    await verOcultos(page).click();
    await expect(verOcultos(page)).toHaveClass(/activo/);
    await expect(filas(page)).toHaveCount(2);
    expect(backend.consultas("GET", "/clientes").at(-1)).toMatchObject({ ocultos: "true" });
    const oculto = fila(page, "Panadería La Espiga");
    await expect(oculto.getByRole("button", { name: "Restaurar" })).toBeVisible();
    await expect(oculto.locator('button[title="Eliminar"]')).toBeVisible();
    await expect(oculto.locator('button[title="Ver ficha"]')).toBeVisible();
    await expect(oculto.locator('button[title="Editar"]')).toHaveCount(0);
    await expect(oculto.locator('button[title="Ocultar"]')).toHaveCount(0);
  });

  test("al volver a tocar 'Ver ocultos' vuelve la lista normal", async ({ page }) => {
    await abrir(page);
    await verOcultos(page).click();
    await expect(filas(page)).toHaveCount(2);
    await verOcultos(page).click();
    await expect(verOcultos(page)).not.toHaveClass(/activo/);
    await expect(filas(page)).toHaveCount(3);
  });

  test("sin clientes ocultos dice 'Sin elementos ocultos'", async ({ page }) => {
    await abrir(page, { semilla: (e) => (e.clientes = e.clientes.filter((c) => c.activo)) });
    await verOcultos(page).click();
    await expect(page.getByText("Sin elementos ocultos")).toBeVisible();
  });

  test("el buscador también filtra dentro de los ocultos", async ({ page }) => {
    await abrir(page);
    await verOcultos(page).click();
    await buscador(page).fill("kiosco");
    await expect(filas(page)).toHaveCount(1);
    await expect(fila(page, "Kiosco El Sol")).toBeVisible();
  });
});

test.describe("Clientes: ficha", () => {
  test("muestra la ficha completa: identificación, contacto y movimientos", async ({ page }) => {
    await abrir(page);
    await accion(page, "Ana Pérez", "Ver ficha").click();
    await expect(ficha(page)).toBeVisible();
    const contenido = page.locator("#ficha-contenido");
    await expect(contenido).toContainText("Ana Pérez");
    await expect(contenido).toContainText("DNI");
    await expect(contenido).toContainText("30111222");
    await expect(contenido).toContainText("CONSUMIDOR FINAL");
    await expect(contenido).toContainText("11 4555-1234");
    await expect(contenido).toContainText("ana@correo.com");
    await expect(contenido).toContainText("Calle Falsa 123");
    await expect(contenido).toContainText("Ventas Registradas");
    await expect(contenido).toContainText(/1\.500,00/);
    expect(backend.llamadas.filter((l) => l.metodo === "GET" && l.ruta === "/clientes/1")).toHaveLength(1);
  });

  test("el saldo que debe el cliente va en rojo y el saldo a favor en verde", async ({ page }) => {
    await abrir(page);
    await accion(page, "Ana Pérez", "Ver ficha").click();
    await expect(page.locator("#ficha-contenido").getByText(/1\.500,00/)).toHaveCSS("color", "rgb(176, 42, 55)");
    await page.locator("#modal-ficha").getByRole("button", { name: "Cerrar" }).click();
    await accion(page, "Luis Gómez", "Ver ficha").click();
    await expect(page.locator("#ficha-contenido").getByText(/300,00/)).toHaveCSS("color", "rgb(20, 108, 67)");
  });

  test("lo que el cliente no tiene cargado se muestra con un guion y sin movimientos con 0", async ({ page }) => {
    await abrir(page);
    await accion(page, "Luis Gómez", "Ver ficha").click();
    const contenido = page.locator("#ficha-contenido");
    await expect(contenido).toContainText("Luis Gómez");
    await expect(contenido.getByText("—")).toHaveCount(6);
  });

  test("el botón Editar de la ficha cierra la ficha y abre el formulario de edición", async ({ page }) => {
    await abrir(page);
    await accion(page, "Ana Pérez", "Ver ficha").click();
    await page.locator("#btn-ficha-editar").click();
    await expect(ficha(page)).toBeHidden();
    await expect(modal(page)).toBeVisible();
    await expect(page.locator("#modal-cliente-titulo")).toHaveText("Editar cliente");
    await expect(page.locator("#nombre")).toHaveValue("Ana Pérez");
  });

  test("el botón Cerrar y la ✕ cierran la ficha", async ({ page }) => {
    await abrir(page);
    await accion(page, "Ana Pérez", "Ver ficha").click();
    await ficha(page).getByRole("button", { name: "Cerrar" }).click();
    await expect(ficha(page)).toBeHidden();
    await accion(page, "Ana Pérez", "Ver ficha").click();
    await ficha(page).locator(".modal-header .btn-icono").click();
    await expect(ficha(page)).toBeHidden();
  });

  test("si no se puede cargar la ficha, avisa y no la abre", async ({ page }) => {
    await abrir(page, { preparar: (b) => b.fallar("GET /clientes/:id", { status: 500, body: {} }) });
    await accion(page, "Ana Pérez", "Ver ficha").click();
    await expect(toast(page)).toHaveText("Error al cargar la ficha");
    await expect(toast(page)).toHaveClass(/error/);
    await expect(ficha(page)).toBeHidden();
  });

  test.fixme("el nombre con código HTML se ve como texto también en la ficha", async ({ page }) => {
    const peligroso = '<img src=x onerror="window.__xss=1">Collar';
    await abrir(page, { semilla: (e) => (e.clientes[0].nombre = peligroso) });
    await page.locator('#clientes-tbody button[title="Ver ficha"]').first().click();
    await expect(page.locator("#ficha-contenido")).toContainText(peligroso);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  });
});

test.describe("Clientes: nuevo cliente", () => {
  test("el botón abre el formulario vacío, sin el aviso de alta rápida", async ({ page }) => {
    await abrir(page);
    await abrirNuevo(page);
    await expect(page.locator("#modal-cliente-titulo")).toHaveText("Nuevo cliente");
    await expect(page.locator("#aviso-edicion")).toBeHidden();
    await expect(page.locator("#nombre")).toHaveValue("");
    await expect(page.locator("#tipo_documento")).toHaveValue("");
    await expect(page.locator("#categoria_impositiva")).toHaveValue("");
    await expect(page.locator("#tipo_documento option")).toHaveText(["Elegí una opción", "DNI", "CUIT", "CUIL"]);
    await expect(page.locator("#categoria_impositiva option")).toHaveText(["Elegí una opción", "Responsable Inscripto", "Monotributista", "Exento", "Consumidor Final"]);
    await expect(page.locator("#nombre")).toBeFocused();
  });

  test("sin completar nada marca todos los campos obligatorios y no envía nada", async ({ page }) => {
    await abrir(page);
    await abrirNuevo(page);
    await guardar(page).click();
    await expect(page.locator("#error-nombre")).toHaveText("Completá el nombre o la razón social.");
    await expect(page.locator("#error-telefono")).toHaveText("Completá el teléfono.");
    await expect(page.locator("#error-correo")).toHaveText("Completá el correo.");
    await expect(page.locator("#error-tipo_documento")).toHaveText("Elegí el tipo de documento.");
    await expect(page.locator("#error-domicilio")).toHaveText("Completá el domicilio.");
    await expect(page.locator("#error-categoria_impositiva")).toHaveText("Elegí la categoría impositiva.");
    await expect(page.locator("#nombre")).toHaveClass(/error/);
    await expect(modal(page)).toBeVisible();
    expect(backend.enviados("POST", "/clientes")).toHaveLength(0);
  });

  const faltantes = [
    ["el nombre", { nombre: "" }, "#error-nombre", "Completá el nombre o la razón social."],
    ["el nombre con solo espacios", { nombre: "   " }, "#error-nombre", "Completá el nombre o la razón social."],
    ["el teléfono", { telefono: "" }, "#error-telefono", "Completá el teléfono."],
    ["el correo", { correo: "" }, "#error-correo", "Completá el correo."],
    ["el domicilio", { domicilio: "" }, "#error-domicilio", "Completá el domicilio."],
    ["el número de documento", { numero: "" }, "#error-numero_documento", /\S/],
  ];

  for (const [nombre, datos, selector, mensaje] of faltantes) {
    // Si falta el número de documento, el error se muestra como una caja vacía (sin texto): pendiente de arreglar.
    const prueba = nombre === "el número de documento" ? test.fixme : test;
    prueba(`si falta ${nombre}, lo avisa con un mensaje y no envía nada`, async ({ page }) => {
      await abrir(page);
      await abrirNuevo(page);
      await llenar(page, datos);
      await guardar(page).click();
      await expect(page.locator(selector)).toBeVisible();
      await expect(page.locator(selector)).toHaveText(mensaje);
      await expect(modal(page)).toBeVisible();
      expect(backend.enviados("POST", "/clientes")).toHaveLength(0);
    });
  }

  test("al guardar de nuevo se limpian los errores de lo que ya se completó", async ({ page }) => {
    await abrir(page);
    await abrirNuevo(page);
    await guardar(page).click();
    await expect(page.locator("#error-nombre")).toBeVisible();
    await page.locator("#nombre").fill("Carlos");
    await guardar(page).click();
    await expect(page.locator("#error-nombre")).toBeHidden();
    await expect(page.locator("#nombre")).not.toHaveClass(/error/);
    await expect(page.locator("#error-telefono")).toBeVisible();
  });

  test("ayuda del documento: pide elegir el tipo primero y explica el formato de cada uno", async ({ page }) => {
    await abrir(page);
    await abrirNuevo(page);
    const ayuda = page.locator("#ayuda-documento");
    await expect(ayuda).toHaveText("Elegí primero el tipo de documento.");
    await page.locator("#tipo_documento").selectOption("CUIT");
    await expect(ayuda).toHaveText("Formato XX-XXXXXXXXX-X (11 dígitos).");
    await page.locator("#tipo_documento").selectOption("CUIL");
    await expect(ayuda).toHaveText("Formato XX-XXXXXXXXX-X (11 dígitos).");
    await page.locator("#tipo_documento").selectOption("DNI");
    await expect(ayuda).toHaveText("7 u 8 dígitos, sin puntos.");
    await page.locator("#tipo_documento").selectOption("");
    await expect(ayuda).toHaveText("Elegí primero el tipo de documento.");
  });

  test("valida el dígito verificador del CUIT y del CUIL mientras se escribe", async ({ page }) => {
    await abrir(page);
    await abrirNuevo(page);
    const ayuda = page.locator("#ayuda-documento");
    await page.locator("#tipo_documento").selectOption("CUIT");
    await page.locator("#numero_documento").fill("20-12345678-6");
    await expect(ayuda).toHaveText("✓ Formato válido.");
    await expect(ayuda).toHaveClass(/valido/);
    await page.locator("#numero_documento").fill("20123456786");
    await expect(ayuda).toHaveText("✓ Formato válido.");
    await page.locator("#numero_documento").fill("20-12345678-9");
    await expect(ayuda).toHaveText("× El formato no es válido.");
    await expect(ayuda).not.toHaveClass(/valido/);
    await page.locator("#numero_documento").fill("20-123");
    await expect(ayuda).toHaveText("× El formato no es válido.");
    await page.locator("#tipo_documento").selectOption("CUIL");
    await page.locator("#numero_documento").fill("20-12345678-6");
    await expect(ayuda).toHaveText("✓ Formato válido.");
  });

  test.fixme("no envía un CUIT con el dígito verificador incorrecto", async ({ page }) => {
    await abrir(page);
    await abrirNuevo(page);
    await llenar(page, { tipo: "CUIT", numero: "20-12345678-9" });
    await guardar(page).click();
    await expect(modal(page)).toBeVisible();
    expect(backend.enviados("POST", "/clientes")).toHaveLength(0);
  });

  test.fixme("no envía un DNI de menos de 7 dígitos", async ({ page }) => {
    await abrir(page);
    await abrirNuevo(page);
    await llenar(page, { tipo: "DNI", numero: "123" });
    await guardar(page).click();
    await expect(modal(page)).toBeVisible();
    expect(backend.enviados("POST", "/clientes")).toHaveLength(0);
  });

  test("guarda con los datos escritos (sin espacios de más), avisa, cierra y muestra al cliente nuevo", async ({ page }) => {
    await abrir(page);
    await abrirNuevo(page);
    await llenar(page, { nombre: "  Carlos López  ", telefono: " 11 4555-0000 ", correo: " carlos@correo.com ", domicilio: " Calle 1 123 ", tipo: "CUIT", numero: "27-23456789-0", categoria: "MONOTRIBUTISTA" });
    await guardar(page).click();
    await expect(toast(page)).toHaveText("Cliente creado");
    await expect(toast(page)).not.toHaveClass(/error/);
    await expect(modal(page)).toBeHidden();
    expect(backend.enviados("POST", "/clientes")).toEqual([
      { nombre: "Carlos López", telefono: "11 4555-0000", correo: "carlos@correo.com", tipo_documento: "CUIT", numero_documento: "27-23456789-0", domicilio: "Calle 1 123", categoria_impositiva: "MONOTRIBUTISTA" },
    ]);
    await expect(filas(page)).toHaveCount(4);
    await expect(fila(page, "Carlos López")).toContainText("MONOTRIBUTISTA");
  });

  test("mientras guarda, el botón dice 'Guardando...' y se bloquea; un doble clic no crea dos clientes", async ({ page }) => {
    await abrir(page, { preparar: (b) => b.demorar("POST /clientes", 1500) });
    await abrirNuevo(page);
    await llenar(page);
    await guardar(page).evaluate((boton) => {
      boton.click();
      boton.click();
    });
    await expect(guardar(page)).toBeDisabled();
    await expect(guardar(page)).toHaveText("Guardando...");
    await expect(toast(page)).toHaveText("Cliente creado");
    await expect(guardar(page)).toHaveText("Guardar");
    expect(backend.enviados("POST", "/clientes")).toHaveLength(1);
  });

  test("un documento repetido se avisa junto al campo del documento y el formulario sigue abierto", async ({ page }) => {
    await abrir(page);
    await abrirNuevo(page);
    await llenar(page, { numero: "30111222" });
    await guardar(page).click();
    await expect(page.locator("#error-numero_documento")).toHaveText("Ya existe un cliente con ese documento.");
    await expect(page.locator("#numero_documento")).toHaveClass(/error/);
    await expect(modal(page)).toBeVisible();
    await expect(guardar(page)).toBeEnabled();
    await expect(guardar(page)).toHaveText("Guardar");
  });

  test("otro error del servidor se avisa en el cartel y deja reintentar", async ({ page }) => {
    await abrir(page, { preparar: (b) => b.fallar("POST /clientes", { status: 500, body: { mensaje: "Error interno del servidor" } }) });
    await abrirNuevo(page);
    await llenar(page);
    await guardar(page).click();
    await expect(toast(page)).toHaveText("Error interno del servidor");
    await expect(toast(page)).toHaveClass(/error/);
    await expect(modal(page)).toBeVisible();
    await expect(guardar(page)).toBeEnabled();
  });

  test.fixme("sin conexión avisa en castellano que no se pudo conectar", async ({ page }) => {
    await abrir(page, { preparar: (b) => b.fallar("POST /clientes", { abortar: true }) });
    await abrirNuevo(page);
    await llenar(page);
    await guardar(page).click();
    await expect(toast(page)).toHaveText("No se pudo conectar con el servidor.");
  });

  test("Cancelar, la ✕ y un clic afuera cierran el formulario sin guardar", async ({ page }) => {
    await abrir(page);
    await abrirNuevo(page);
    await modal(page).getByRole("button", { name: "Cancelar" }).click();
    await expect(modal(page)).toBeHidden();
    await abrirNuevo(page);
    await modal(page).locator(".modal-header .btn-icono").click();
    await expect(modal(page)).toBeHidden();
    await abrirNuevo(page);
    await modal(page).click({ position: { x: 5, y: 5 } });
    await expect(modal(page)).toBeHidden();
    expect(backend.enviados("POST", "/clientes")).toHaveLength(0);
  });

  test("al volver a abrir el formulario está vacío y sin errores", async ({ page }) => {
    await abrir(page);
    await abrirNuevo(page);
    await page.locator("#nombre").fill("Algo");
    await guardar(page).click();
    await expect(page.locator("#error-telefono")).toBeVisible();
    await modal(page).getByRole("button", { name: "Cancelar" }).click();
    await abrirNuevo(page);
    await expect(page.locator("#nombre")).toHaveValue("");
    await expect(page.locator("#error-telefono")).toBeHidden();
    await expect(page.locator("#ayuda-documento")).toHaveText("Elegí primero el tipo de documento.");
  });
});

test.describe("Clientes: editar", () => {
  test("abre con los datos del cliente y el aviso de que se completen todos los datos", async ({ page }) => {
    await abrir(page);
    await accion(page, "Ana Pérez", "Editar").click();
    await expect(modal(page)).toBeVisible();
    await expect(page.locator("#modal-cliente-titulo")).toHaveText("Editar cliente");
    await expect(page.locator("#aviso-edicion")).toBeVisible();
    await expect(page.locator("#nombre")).toHaveValue("Ana Pérez");
    await expect(page.locator("#telefono")).toHaveValue("11 4555-1234");
    await expect(page.locator("#correo")).toHaveValue("ana@correo.com");
    await expect(page.locator("#tipo_documento")).toHaveValue("DNI");
    await expect(page.locator("#numero_documento")).toHaveValue("30111222");
    await expect(page.locator("#domicilio")).toHaveValue("Calle Falsa 123");
    await expect(page.locator("#categoria_impositiva")).toHaveValue("CONSUMIDOR_FINAL");
    await expect(page.locator("#ayuda-documento")).toHaveText("7 u 8 dígitos, sin puntos.");
  });

  test("guarda los cambios con PUT, avisa y actualiza la lista", async ({ page }) => {
    await abrir(page);
    await accion(page, "Ana Pérez", "Editar").click();
    await page.locator("#nombre").fill("Ana María Pérez");
    await page.locator("#telefono").fill("11 9999-0000");
    await guardar(page).click();
    await expect(toast(page)).toHaveText("Cliente actualizado");
    await expect(modal(page)).toBeHidden();
    expect(backend.enviados("PUT", "/clientes/:id")).toEqual([
      { nombre: "Ana María Pérez", telefono: "11 9999-0000", correo: "ana@correo.com", tipo_documento: "DNI", numero_documento: "30111222", domicilio: "Calle Falsa 123", categoria_impositiva: "CONSUMIDOR_FINAL" },
    ]);
    expect(backend.llamadas.find((l) => l.metodo === "PUT").ruta).toBe("/clientes/1");
    await expect(fila(page, "Ana María Pérez")).toBeVisible();
  });

  test("un cliente de alta rápida abre con los campos vacíos y obliga a completarlos", async ({ page }) => {
    await abrir(page);
    await accion(page, "Luis Gómez", "Editar").click();
    await expect(page.locator("#nombre")).toHaveValue("Luis Gómez");
    await expect(page.locator("#telefono")).toHaveValue("");
    await expect(page.locator("#tipo_documento")).toHaveValue("");
    await guardar(page).click();
    await expect(page.locator("#error-telefono")).toBeVisible();
    await expect(page.locator("#error-correo")).toBeVisible();
    await expect(page.locator("#error-tipo_documento")).toBeVisible();
    await expect(page.locator("#error-domicilio")).toBeVisible();
    await expect(page.locator("#error-categoria_impositiva")).toBeVisible();
    expect(backend.enviados("PUT", "/clientes/:id")).toHaveLength(0);
  });

  test("un documento que ya tiene otro cliente se avisa junto al campo", async ({ page }) => {
    await abrir(page);
    await accion(page, "Ana Pérez", "Editar").click();
    await page.locator("#tipo_documento").selectOption("CUIT");
    await page.locator("#numero_documento").fill("20-12345678-6");
    await guardar(page).click();
    await expect(page.locator("#error-numero_documento")).toHaveText("Ya existe un cliente con ese documento.");
    await expect(modal(page)).toBeVisible();
  });

  test("un error del servidor al editar se avisa y el formulario sigue abierto", async ({ page }) => {
    await abrir(page, { preparar: (b) => b.fallar("PUT /clientes/:id", { status: 500, body: { mensaje: "Error interno del servidor" } }) });
    await accion(page, "Ana Pérez", "Editar").click();
    await guardar(page).click();
    await expect(toast(page)).toHaveText("Error interno del servidor");
    await expect(modal(page)).toBeVisible();
  });

  test("después de editar, 'Nuevo cliente' abre vacío y sin el aviso", async ({ page }) => {
    await abrir(page);
    await accion(page, "Ana Pérez", "Editar").click();
    await modal(page).getByRole("button", { name: "Cancelar" }).click();
    await abrirNuevo(page);
    await expect(page.locator("#modal-cliente-titulo")).toHaveText("Nuevo cliente");
    await expect(page.locator("#aviso-edicion")).toBeHidden();
    await expect(page.locator("#nombre")).toHaveValue("");
    await expect(page.locator("#numero_documento")).toHaveValue("");
  });
});

test.describe("Clientes: ocultar, restaurar y eliminar", () => {
  test("Ocultar pide confirmación y saca al cliente de la lista", async ({ page }) => {
    await abrir(page);
    await accion(page, "Ana Pérez", "Ocultar").click();
    await expect(toast(page)).toHaveText("Cliente oculto");
    expect(confirmaciones).toEqual(["¿Ocultar este cliente? Dejará de verse en ventas nuevas, pero se conserva su historial."]);
    expect(backend.llamadas.find((l) => l.metodo === "PATCH").ruta).toBe("/clientes/1/visibilidad");
    await expect(filas(page)).toHaveCount(2);
    await expect(fila(page, "Ana Pérez")).toHaveCount(0);
  });

  test("si se cancela la confirmación, no se oculta nada", async ({ page }) => {
    await abrir(page, { respuestas: [false] });
    await accion(page, "Ana Pérez", "Ocultar").click();
    await expect(filas(page)).toHaveCount(3);
    expect(backend.enviados("PATCH", "/clientes/:id/visibilidad")).toHaveLength(0);
  });

  test("si ocultar falla, avisa con el mensaje del servidor y el cliente sigue en la lista", async ({ page }) => {
    await abrir(page, { preparar: (b) => b.fallar("PATCH /clientes/:id/visibilidad", { status: 500, body: { mensaje: "Error interno del servidor" } }) });
    await accion(page, "Ana Pérez", "Ocultar").click();
    await expect(toast(page)).toHaveText("Error interno del servidor");
    await expect(filas(page)).toHaveCount(3);
  });

  test("un cliente oculto aparece en 'Ver ocultos'", async ({ page }) => {
    await abrir(page);
    await accion(page, "Ana Pérez", "Ocultar").click();
    await expect(toast(page)).toHaveText("Cliente oculto");
    await verOcultos(page).click();
    await expect(filas(page)).toHaveCount(3);
    await expect(fila(page, "Ana Pérez")).toBeVisible();
  });

  test("Restaurar devuelve al cliente a la lista, sin pedir confirmación", async ({ page }) => {
    await abrir(page);
    await verOcultos(page).click();
    await fila(page, "Panadería La Espiga").getByRole("button", { name: "Restaurar" }).click();
    await expect(toast(page)).toHaveText("Cliente restaurado");
    expect(confirmaciones).toEqual([]);
    expect(backend.llamadas.find((l) => l.metodo === "PATCH").ruta).toBe("/clientes/4/visibilidad");
    await expect(fila(page, "Panadería La Espiga")).toHaveCount(0);
    await verOcultos(page).click();
    await expect(fila(page, "Panadería La Espiga")).toBeVisible();
  });

  test("si restaurar falla, avisa con el mensaje del servidor", async ({ page }) => {
    await abrir(page, { preparar: (b) => b.fallar("PATCH /clientes/:id/visibilidad", { status: 500, body: { mensaje: "Error interno del servidor" } }) });
    await verOcultos(page).click();
    await fila(page, "Panadería La Espiga").getByRole("button", { name: "Restaurar" }).click();
    await expect(toast(page)).toHaveText("Error interno del servidor");
    await expect(fila(page, "Panadería La Espiga")).toBeVisible();
  });

  test("Eliminar pide confirmación y borra un cliente oculto sin movimientos", async ({ page }) => {
    await abrir(page);
    await verOcultos(page).click();
    await accion(page, "Panadería La Espiga", "Eliminar").click();
    await expect(toast(page)).toHaveText("Cliente eliminado");
    expect(confirmaciones).toEqual(["¿Eliminar este cliente definitivamente? Esta acción no se puede deshacer."]);
    expect(backend.llamadas.find((l) => l.metodo === "DELETE").ruta).toBe("/clientes/4");
    await expect(filas(page)).toHaveCount(1);
  });

  test("si se cancela la confirmación, no se elimina nada", async ({ page }) => {
    await abrir(page, { respuestas: [false] });
    await verOcultos(page).click();
    await accion(page, "Panadería La Espiga", "Eliminar").click();
    await expect(filas(page)).toHaveCount(2);
    expect(backend.enviados("DELETE", "/clientes/:id")).toHaveLength(0);
  });

  test("un cliente con ventas o saldo (409) no se elimina: abre el aviso con el motivo del servidor", async ({ page }) => {
    await abrir(page);
    await verOcultos(page).click();
    await accion(page, "Kiosco El Sol", "Eliminar").click();
    const aviso = page.locator("#modal-error-eliminar");
    await expect(aviso).toBeVisible();
    await expect(page.locator("#texto-error-eliminar")).toHaveText("No se puede eliminar el cliente porque tiene ventas registradas o saldo en cuenta corriente.");
    await expect(filas(page)).toHaveCount(2);
    await aviso.getByRole("button", { name: "Cerrar" }).last().click();
    await expect(aviso).toBeHidden();
  });

  test.fixme("si el 409 viene sin mensaje, el aviso explica el motivo con el texto por defecto", async ({ page }) => {
    await abrir(page, { preparar: (b) => b.fallar("DELETE /clientes/:id", { status: 409, body: {} }) });
    await verOcultos(page).click();
    await accion(page, "Kiosco El Sol", "Eliminar").click();
    await expect(page.locator("#texto-error-eliminar")).toHaveText("No se puede eliminar el cliente porque tiene ventas registradas o saldo en cuenta corriente.");
  });

  test("otro error al eliminar se avisa en el cartel", async ({ page }) => {
    await abrir(page, { preparar: (b) => b.fallar("DELETE /clientes/:id", { status: 500, body: { mensaje: "Error interno del servidor" } }) });
    await verOcultos(page).click();
    await accion(page, "Panadería La Espiga", "Eliminar").click();
    await expect(toast(page)).toHaveText("Error interno del servidor");
    await expect(page.locator("#modal-error-eliminar")).toBeHidden();
  });
});

test.describe("Clientes: pantallas bajas", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test.fixme("en una pantalla de 720 px de alto, los botones Guardar y Cancelar del formulario quedan a la vista", async ({ page }) => {
    await abrir(page);
    await abrirNuevo(page);
    const caja = await guardar(page).boundingBox();
    expect(caja.y + caja.height).toBeLessThanOrEqual(720);
    await guardar(page).click({ timeout: 3000 });
  });
});

test.describe("Clientes: rol Cajero y acceso", () => {
  test.fixme("el Cajero que entra por la dirección vuelve al Panel y no pide los clientes", async ({ page }) => {
    await abrir(page, { rol: "CAJERO" });
    await expect(page).toHaveURL(/dashboard\.html/);
    expect(backend.enviados("GET", "/clientes")).toHaveLength(0);
  });

  test("sin sesión iniciada manda al login", async ({ page }) => {
    await page.goto("/clientes.html");
    await expect(page).toHaveURL(/login\.html/);
  });

  test("el menú lateral marca Clientes como la pantalla actual", async ({ page }) => {
    await abrir(page);
    await expect(page.getByTestId("menu-clientes")).toHaveAttribute("aria-current", "page");
  });

  test("usar la pantalla de punta a punta no produce errores de JavaScript", async ({ page }) => {
    await abrir(page);
    await abrirNuevo(page);
    await llenar(page);
    await guardar(page).click();
    await expect(toast(page)).toHaveText("Cliente creado");
    await accion(page, "Ana Pérez", "Ver ficha").click();
    await expect(ficha(page)).toBeVisible();
    expect(erroresDePagina).toEqual([]);
  });
});
