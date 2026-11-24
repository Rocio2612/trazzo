const { test, expect } = require("@playwright/test");
const { iniciarSesionComo } = require("./helpers");
const { simularCatalogo } = require("./backend-falso-catalogo");

// Pantalla Productos (productos.html). Backend falso (backend-falso-catalogo.js), con estos datos:
//   1 Sifón de soda       $ 850  / $ 1.337,05   stock 24, mínimo 6   (Distribuidora Norte)  categoría Bebidas
//   2 Detergente 750 ml   $ 620  / $ 900        stock 3,  mínimo 5   -> "Stock bajo"       (Librería Central)
//   3 Yerba mate 1 kg     $ 2100 / $ 2.900      stock 0,  mínimo 2   -> "Sin stock"        (Distribuidora Norte), sin categoría
//   4 Lavandina 1 l       OCULTO
// Los avisos salen en el cartel #toast y las confirmaciones (ocultar, eliminar) son confirm() del navegador.

let backend;
let confirmaciones;
let erroresDePagina;

// Responde los confirm() en orden (por defecto acepta) y guarda sus textos.
const prepararDialogos = (page, respuestas = []) => {
  confirmaciones = [];
  const pendientes = [...respuestas];
  page.on("dialog", async (dialogo) => {
    confirmaciones.push(dialogo.message());
    const acepta = dialogo.type() === "confirm" ? (pendientes.length ? pendientes.shift() : true) : true;
    if (acepta) await dialogo.accept();
    else await dialogo.dismiss();
  });
};

const abrir = async (page, { rol = "ADMIN", semilla, preparar, respuestas } = {}) => {
  erroresDePagina = [];
  page.on("pageerror", (e) => erroresDePagina.push(e.message));
  prepararDialogos(page, respuestas);
  backend = await simularCatalogo(page, { rol, semilla });
  preparar?.(backend);
  await iniciarSesionComo(page, rol);
  await page.goto("/productos.html");
};

const filas = (page) => page.locator("#productos-tbody tr");
const fila = (page, nombre) => filas(page).filter({ hasText: nombre });
const toast = (page) => page.locator("#toast");
const buscador = (page) => page.getByTestId("buscador");
const stockBajo = (page) => page.getByTestId("filtro-stock-bajo");
const verOcultos = (page) => page.getByTestId("filtro-ocultos");
const nuevo = (page) => page.getByTestId("btn-nuevo-producto");
const modalProducto = (page) => page.getByTestId("modal-producto");
const modalRepo = (page) => page.getByTestId("modal-reposicion");
const modalBaja = (page) => page.getByTestId("modal-baja");
const guardar = (page) => page.getByTestId("guardar-producto");
const accion = (page, nombre, titulo) => fila(page, nombre).locator(`button[title="${titulo}"]`);

const llenarNuevo = async (page, datos = {}) => {
  const v = { nombre: "Alfajor de maicena", compra: "100", venta: "150", cantidad: "10", minimo: "2", proveedor: "1", ...datos };
  await page.locator("#nombre").fill(v.nombre);
  await page.locator("#precio_compra").fill(v.compra);
  await page.locator("#precio_venta").fill(v.venta);
  await page.locator("#cantidad").fill(v.cantidad);
  await page.locator("#stock_minimo").fill(v.minimo);
  if (v.proveedor !== null) await page.locator("#proveedor_id").selectOption(v.proveedor);
};

const abrirNuevo = async (page) => {
  await nuevo(page).click();
  await expect(modalProducto(page)).toBeVisible();
};

test.describe("Productos: la lista", () => {
  test("muestra el título, el link al historial de reposición y las columnas del Admin", async ({ page }) => {
    await abrir(page);
    await expect(page.getByRole("heading", { name: "Productos", level: 1 })).toBeVisible();
    await expect(page.getByTestId("link-historial")).toHaveAttribute("href", "historial-reposiciones.html");
    await expect(page.locator("#productos-thead th:visible")).toHaveText(["Nombre", "Categoría", "Costo", "Precio", "Stock", "Mínimo", "Proveedor", "Creado por", "Acciones"]);
  });

  test("lista los productos visibles con sus datos y no muestra los ocultos", async ({ page }) => {
    await abrir(page);
    await expect(filas(page)).toHaveCount(3);
    const sifon = fila(page, "Sifón de soda");
    await expect(sifon).toContainText("Bebidas");
    await expect(sifon).toContainText(/850,00/);
    await expect(sifon).toContainText(/1\.337,05/);
    await expect(sifon).toContainText("24");
    await expect(sifon).toContainText("6");
    await expect(sifon).toContainText("Distribuidora Norte");
    await expect(sifon).toContainText("admin1");
    await expect(sifon).toContainText(/05\/11\/2026/);
    await expect(page.getByText("Lavandina 1 l")).toHaveCount(0);
  });

  test("pide solo los bienes de cambio (no insumos ni equipamiento)", async ({ page }) => {
    await abrir(page);
    await expect(filas(page)).toHaveCount(3);
    expect(backend.consultas("GET", "/productos")[0]).toMatchObject({ tipo_producto: "BIEN_DE_CAMBIO" });
  });

  test("marca 'Stock bajo' cuando el stock está por debajo del mínimo y 'Sin stock' cuando es 0", async ({ page }) => {
    await abrir(page);
    await expect(fila(page, "Detergente").locator(".badge-ambar")).toHaveText("Stock bajo");
    await expect(fila(page, "Yerba").locator(".badge-rojo")).toHaveText("Sin stock");
    await expect(fila(page, "Sifón").locator(".badge")).toHaveCount(0);
  });

  test("con el stock igual al mínimo también marca 'Stock bajo'", async ({ page }) => {
    await abrir(page, { semilla: (e) => (e.productos[0].cantidad = 6) });
    await expect(fila(page, "Sifón").locator(".badge-ambar")).toHaveText("Stock bajo");
  });

  test("un producto sin categoría ni proveedor muestra un guion", async ({ page }) => {
    await abrir(page, {
      semilla: (e) => {
        e.productos[2].proveedor_nombre = null;
      },
    });
    const celdas = fila(page, "Yerba").locator("td");
    await expect(celdas.nth(1)).toHaveText("—");
    await expect(celdas.nth(6)).toHaveText("—");
  });

  test("sin productos muestra 'Sin productos'", async ({ page }) => {
    await abrir(page, { semilla: (e) => (e.productos = []) });
    await expect(page.getByText("Sin productos", { exact: true })).toBeVisible();
  });

  test("mientras llegan los datos muestra 'Cargando...'", async ({ page }) => {
    await abrir(page, { preparar: (b) => b.demorar("GET /productos", 800) });
    await expect(page.getByText("Cargando...")).toBeVisible();
    await expect(filas(page)).toHaveCount(3);
  });

  test("un nombre con código HTML se muestra como texto y no se ejecuta", async ({ page }) => {
    const peligroso = '<img src=x onerror="window.__xss=1">Collar';
    await abrir(page, { semilla: (e) => (e.productos[0].nombre = peligroso) });
    await expect(filas(page)).toHaveCount(3);
    await expect(page.locator("#productos-tbody")).toContainText(peligroso);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  });

  test("el Admin ve la fecha de creación en la columna 'Creado por'", async ({ page }) => {
    await abrir(page);
    await expect(fila(page, "Detergente").locator("td").nth(7)).toContainText(/20\/10\/2026/);
  });
});

test.describe("Productos: errores al cargar", () => {
  test("si el backend responde con un mensaje, lo muestra en la tabla", async ({ page }) => {
    await abrir(page, { preparar: (b) => b.fallar("GET /productos", { status: 500, body: { status: "error", mensaje: "Error interno del servidor" } }) });
    await expect(page.locator("#productos-tbody .fila-mensaje.error")).toHaveText("Error interno del servidor");
  });

  test("si el backend responde sin mensaje, usa el texto por defecto", async ({ page }) => {
    await abrir(page, { preparar: (b) => b.fallar("GET /productos", { status: 500, body: {} }) });
    await expect(page.locator("#productos-tbody .fila-mensaje.error")).toHaveText("Error al cargar los productos");
  });

  test("sin conexión con el servidor lo avisa", async ({ page }) => {
    await abrir(page, { preparar: (b) => b.fallar("GET /productos", { abortar: true }) });
    await expect(page.locator("#productos-tbody .fila-mensaje.error")).toHaveText("No se pudo conectar con el servidor.");
  });

  test("el mensaje de error ocupa todo el ancho de la tabla (9 columnas para el Admin, 8 para el Cajero)", async ({ page }) => {
    await abrir(page, { preparar: (b) => b.fallar("GET /productos", { status: 500, body: {} }) });
    await expect(page.locator("#productos-tbody td[colspan]")).toHaveAttribute("colspan", "9");
  });

  test("tras el error, buscar de nuevo vuelve a pedir la lista y la muestra", async ({ page }) => {
    await abrir(page, { preparar: (b) => b.fallar("GET /productos", { status: 500, body: {} }) });
    await expect(page.locator("#productos-tbody .fila-mensaje.error")).toBeVisible();
    // El backend se recupera: al tocar un filtro se vuelve a pedir.
    backend.fallar("GET /productos", undefined);
    await stockBajo(page).click();
    await expect(filas(page)).toHaveCount(2);
  });

  test("si no cargan los proveedores, lo avisa y los desplegables quedan deshabilitados con el aviso", async ({ page }) => {
    await abrir(page, { preparar: (b) => b.fallar("GET /proveedores", { status: 500, body: {} }) });
    await expect(filas(page)).toHaveCount(3);
    await expect(toast(page)).toContainText("No se pudieron cargar los proveedores");
    await expect(toast(page)).toHaveClass(/error/);
    for (const id of ["#proveedor_id", "#proveedor_id_repo"]) {
      await expect(page.locator(id)).toBeDisabled();
      await expect(page.locator(`${id} option`)).toHaveText(["Error al cargar proveedores"]);
    }
  });

  test("si el servidor de proveedores responde con un mensaje propio, lo muestra", async ({ page }) => {
    await abrir(page, { preparar: (b) => b.fallar("GET /proveedores", { status: 500, body: { mensaje: "Error interno del servidor" } }) });
    await expect(toast(page)).toHaveText("Error interno del servidor");
  });

  test("sin conexión con el servidor de proveedores, lo avisa", async ({ page }) => {
    await abrir(page, { preparar: (b) => b.fallar("GET /proveedores", { abortar: true }) });
    await expect(toast(page)).toHaveText("No se pudo conectar con el servidor.");
  });
});

test.describe("Productos: buscador y filtros", () => {
  test("al escribir pide al backend los productos de ese nombre", async ({ page }) => {
    await abrir(page);
    await expect(filas(page)).toHaveCount(3);
    await buscador(page).fill("deterg");
    await expect(filas(page)).toHaveCount(1);
    await expect(fila(page, "Detergente 750 ml")).toBeVisible();
    expect(backend.consultas("GET", "/productos").at(-1)).toMatchObject({ q: "deterg" });
  });

  test("no distingue mayúsculas de minúsculas", async ({ page }) => {
    await abrir(page);
    await buscador(page).fill("YERBA");
    await expect(filas(page)).toHaveCount(1);
    await expect(fila(page, "Yerba mate 1 kg")).toBeVisible();
  });

  test("sin coincidencias muestra 'Sin productos'", async ({ page }) => {
    await abrir(page);
    await buscador(page).fill("zzzz");
    await expect(page.getByText("Sin productos", { exact: true })).toBeVisible();
  });

  test("al borrar el texto vuelve a mostrar todos", async ({ page }) => {
    await abrir(page);
    await buscador(page).fill("deterg");
    await expect(filas(page)).toHaveCount(1);
    await buscador(page).fill("");
    await expect(filas(page)).toHaveCount(3);
  });

  test("espera a que termine de escribir: no pide una vez por letra", async ({ page }) => {
    await abrir(page);
    await expect(filas(page)).toHaveCount(3);
    await buscador(page).pressSequentially("detergente");
    await expect(filas(page)).toHaveCount(1);
    const pedidos = backend.consultas("GET", "/productos");
    expect(pedidos).toHaveLength(2); // la carga inicial y una sola búsqueda
    expect(pedidos.at(-1).q).toBe("detergente");
  });

  test("una respuesta lenta de una búsqueda anterior no pisa a la última", async ({ page }) => {
    await abrir(page, { preparar: (b) => b.demorar("GET /productos", (consulta) => (consulta.q === "sif" ? 1500 : 0)) });
    await expect(filas(page)).toHaveCount(3);
    await buscador(page).fill("sif"); // tarda en responder
    await page.waitForTimeout(400);
    await buscador(page).fill(""); // responde enseguida con los 3
    await expect(filas(page)).toHaveCount(3);
    await page.waitForTimeout(1500); // llega la respuesta vieja
    await expect(filas(page)).toHaveCount(3);
  });

  test("'Stock bajo' muestra solo los que están en el mínimo o por debajo, y al volver a tocarlo vuelve a todos", async ({ page }) => {
    await abrir(page);
    await stockBajo(page).click();
    await expect(stockBajo(page)).toHaveClass(/activo/);
    await expect(filas(page)).toHaveCount(2);
    await expect(fila(page, "Sifón")).toHaveCount(0);
    expect(backend.consultas("GET", "/productos").at(-1)).toMatchObject({ stock_bajo: "true" });
    await stockBajo(page).click();
    await expect(stockBajo(page)).not.toHaveClass(/activo/);
    await expect(filas(page)).toHaveCount(3);
    expect(backend.consultas("GET", "/productos").at(-1).stock_bajo).toBeUndefined();
  });

  test("el Admin puede ver los ocultos: aparecen marcados y sin el botón Ocultar", async ({ page }) => {
    await abrir(page);
    await verOcultos(page).click();
    await expect(verOcultos(page)).toHaveClass(/activo/);
    await expect(filas(page)).toHaveCount(1);
    const oculto = fila(page, "Lavandina 1 l");
    await expect(oculto.locator(".badge-gris")).toHaveText("Oculto");
    await expect(oculto.locator('button[title="Ocultar"]')).toHaveCount(0);
    await expect(oculto.locator('button[title="Editar"]')).toHaveCount(1);
    expect(backend.consultas("GET", "/productos").at(-1)).toMatchObject({ ocultos: "true" });
  });

  test("al salir de 'Ver ocultos' vuelve la lista normal", async ({ page }) => {
    await abrir(page);
    await verOcultos(page).click();
    await expect(filas(page)).toHaveCount(1);
    await verOcultos(page).click();
    await expect(verOcultos(page)).not.toHaveClass(/activo/);
    await expect(filas(page)).toHaveCount(3);
  });

  test("sin productos ocultos muestra 'Sin productos'", async ({ page }) => {
    await abrir(page, { semilla: (e) => (e.productos = e.productos.filter((p) => p.activo)) });
    await verOcultos(page).click();
    await expect(page.getByText("Sin productos", { exact: true })).toBeVisible();
  });
});

test.describe("Productos: nuevo producto", () => {
  test("el botón abre el formulario vacío con el IVA en 21% y los proveedores visibles", async ({ page }) => {
    await abrir(page);
    await abrirNuevo(page);
    await expect(page.locator("#modal-producto-titulo")).toHaveText("Nuevo producto");
    await expect(page.locator("#nombre")).toBeFocused();
    await expect(page.locator("#nombre")).toHaveValue("");
    await expect(page.locator("#iva_alicuota")).toHaveValue("21");
    await expect(page.locator("#rentabilidad")).toHaveValue("0");
    await expect(page.locator("#precio_compra")).toBeEnabled();
    await expect(page.locator("#cantidad")).toBeEnabled();
    await expect(page.locator("#ayuda-costo")).toBeHidden();
    await expect(page.locator("#proveedor_id option")).toHaveText(["Elegir proveedor…", "Distribuidora Norte", "Librería Central"]);
  });

  test("sin proveedores el desplegable avisa y queda deshabilitado", async ({ page }) => {
    await abrir(page, { semilla: (e) => (e.proveedores = []) });
    await abrirNuevo(page);
    await expect(page.locator("#proveedor_id option")).toHaveText(["Sin proveedores"]);
    await expect(page.locator("#proveedor_id")).toBeDisabled();
  });

  test("sugiere el precio de venta: costo + rentabilidad + IVA", async ({ page }) => {
    await abrir(page);
    await abrirNuevo(page);
    await page.locator("#precio_compra").fill("100");
    await page.locator("#rentabilidad").fill("50");
    await expect(page.locator("#precio_venta")).toHaveValue("181.5");
    await page.locator("#iva_alicuota").selectOption("10.5");
    await expect(page.locator("#precio_venta")).toHaveValue("165.75");
    await page.locator("#iva_alicuota").selectOption("0");
    await expect(page.locator("#precio_venta")).toHaveValue("150");
  });

  test("si se escribe el precio de venta a mano, ya no se pisa con la sugerencia", async ({ page }) => {
    await abrir(page);
    await abrirNuevo(page);
    await page.locator("#precio_compra").fill("100");
    await page.locator("#precio_venta").fill("200");
    await page.locator("#precio_compra").fill("300");
    await page.locator("#rentabilidad").fill("10");
    await expect(page.locator("#precio_venta")).toHaveValue("200");
  });

  test("avisa cuando el precio de venta es menor al costo y deja de avisar al corregirlo", async ({ page }) => {
    await abrir(page);
    await abrirNuevo(page);
    await page.locator("#precio_compra").fill("1000");
    await page.locator("#precio_venta").fill("500");
    const banner = page.getByTestId("banner-precio-menor");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("El precio de venta es menor al costo unitario.");
    await page.locator("#precio_venta").fill("1000");
    await expect(banner).toBeHidden();
  });

  test("el aviso de precio menor no impide guardar", async ({ page }) => {
    await abrir(page);
    await abrirNuevo(page);
    await llenarNuevo(page, { compra: "1000", venta: "500" });
    await guardar(page).click();
    await expect(toast(page)).toHaveText("Producto creado");
    expect(backend.enviados("POST", "/productos")).toHaveLength(1);
  });

  const invalidos = [
    ["sin nombre", { nombre: "" }, "#error-nombre", "Rellene el nombre del producto."],
    ["con el nombre solo de espacios", { nombre: "    " }, "#error-nombre", "Rellene el nombre del producto."],
    ["sin precio de compra", { compra: "", venta: "150" }, null, "Ingresá un precio de compra mayor a 0."],
    ["con precio de compra 0", { compra: "0" }, null, "Ingresá un precio de compra mayor a 0."],
    ["con precio de compra negativo", { compra: "-5" }, null, "Ingresá un precio de compra mayor a 0."],
    ["sin precio de venta", { venta: "" }, null, "Ingresá un precio de venta mayor a 0."],
    ["con precio de venta 0", { venta: "0" }, null, "Ingresá un precio de venta mayor a 0."],
    ["sin stock actual", { cantidad: "" }, null, "Ingresá el stock actual."],
    ["con stock actual negativo", { cantidad: "-1" }, null, "Ingresá el stock actual."],
    ["con stock actual decimal", { cantidad: "1.5" }, null, "Ingresá el stock actual."],
    ["sin stock mínimo", { minimo: "" }, null, "Ingresá el stock mínimo."],
    ["con stock mínimo negativo", { minimo: "-1" }, null, "Ingresá el stock mínimo."],
    ["con stock mínimo decimal", { minimo: "0.5" }, null, "Ingresá el stock mínimo."],
    ["sin proveedor", { proveedor: "" }, null, "Elegí un proveedor. Si no hay, cargalos primero en Proveedores."],
  ];

  for (const [nombre, datos, campoError, mensaje] of invalidos) {
    test(`rechaza guardar ${nombre}: avisa y no envía nada`, async ({ page }) => {
      await abrir(page);
      await abrirNuevo(page);
      await llenarNuevo(page, datos);
      await guardar(page).click();
      if (campoError) {
        await expect(page.locator(campoError)).toHaveText(mensaje);
        await expect(page.locator("#nombre")).toHaveClass(/input-error/);
      } else {
        await expect(toast(page)).toHaveText(mensaje);
        await expect(toast(page)).toHaveClass(/error/);
      }
      await expect(modalProducto(page)).toBeVisible();
      await expect(guardar(page)).toBeEnabled();
      expect(backend.enviados("POST", "/productos")).toHaveLength(0);
    });
  }

  test("el nombre no deja escribir más de 120 caracteres", async ({ page }) => {
    await abrir(page);
    await abrirNuevo(page);
    await page.locator("#nombre").fill("a".repeat(130));
    await expect(page.locator("#nombre")).toHaveValue("a".repeat(120));
  });

  test("el error del nombre desaparece al escribir", async ({ page }) => {
    await abrir(page);
    await abrirNuevo(page);
    await guardar(page).click();
    await expect(page.locator("#error-nombre")).toBeVisible();
    await page.locator("#nombre").fill("A");
    await expect(page.locator("#error-nombre")).toBeHidden();
    await expect(page.locator("#nombre")).not.toHaveClass(/input-error/);
  });

  test("guarda con los datos escritos, cierra el formulario, avisa y muestra el producto nuevo", async ({ page }) => {
    await abrir(page);
    await abrirNuevo(page);
    await llenarNuevo(page, { nombre: "  Alfajor de maicena  ", compra: "100.5", venta: "180", cantidad: "10", minimo: "3", proveedor: "2" });
    await guardar(page).click();
    await expect(toast(page)).toHaveText("Producto creado");
    await expect(toast(page)).not.toHaveClass(/error/);
    await expect(modalProducto(page)).toBeHidden();
    expect(backend.enviados("POST", "/productos")).toEqual([
      { nombre: "Alfajor de maicena", iva_alicuota: 21, rentabilidad: 0, precio_venta: 180, stock_minimo: 3, proveedor_id: 2, precio_compra: 100.5, cantidad: 10 },
    ]);
    await expect(filas(page)).toHaveCount(4);
    await expect(fila(page, "Alfajor de maicena")).toContainText("Librería Central");
  });

  test("envía el IVA y la rentabilidad elegidos", async ({ page }) => {
    await abrir(page);
    await abrirNuevo(page);
    await page.locator("#iva_alicuota").selectOption("10.5");
    await page.locator("#rentabilidad").fill("25");
    await llenarNuevo(page, { venta: "300" });
    await guardar(page).click();
    await expect(toast(page)).toHaveText("Producto creado");
    expect(backend.enviados("POST", "/productos")[0]).toMatchObject({ iva_alicuota: 10.5, rentabilidad: 25 });
  });

  test("permite crear con stock inicial 0", async ({ page }) => {
    await abrir(page);
    await abrirNuevo(page);
    await llenarNuevo(page, { cantidad: "0", minimo: "0" });
    await guardar(page).click();
    await expect(toast(page)).toHaveText("Producto creado");
    expect(backend.enviados("POST", "/productos")[0]).toMatchObject({ cantidad: 0, stock_minimo: 0 });
  });

  test("un nombre repetido (409) se avisa junto al campo y el formulario sigue abierto", async ({ page }) => {
    await abrir(page);
    await abrirNuevo(page);
    await llenarNuevo(page, { nombre: "Sifón de soda" });
    await guardar(page).click();
    await expect(page.locator("#error-nombre")).toHaveText("Ya existe un producto con ese nombre.");
    await expect(modalProducto(page)).toBeVisible();
    await expect(guardar(page)).toBeEnabled();
  });

  test("un error del servidor con mensaje propio lo muestra y deja reintentar", async ({ page }) => {
    await abrir(page, { preparar: (b) => b.fallar("POST /productos", { status: 500, body: { status: "error", mensaje: "Error interno del servidor" } }) });
    await abrirNuevo(page);
    await llenarNuevo(page);
    await guardar(page).click();
    await expect(toast(page)).toHaveText("Error interno del servidor");
    await expect(toast(page)).toHaveClass(/error/);
    await expect(modalProducto(page)).toBeVisible();
    await expect(guardar(page)).toBeEnabled();
  });

  test("un error del servidor sin mensaje usa el texto por defecto", async ({ page }) => {
    await abrir(page, { preparar: (b) => b.fallar("POST /productos", { status: 500, body: {} }) });
    await abrirNuevo(page);
    await llenarNuevo(page);
    await guardar(page).click();
    await expect(toast(page)).toHaveText("No se pudo guardar el producto.");
  });

  test("sin conexión lo avisa y no cierra el formulario", async ({ page }) => {
    await abrir(page, { preparar: (b) => b.fallar("POST /productos", { abortar: true }) });
    await abrirNuevo(page);
    await llenarNuevo(page);
    await guardar(page).click();
    await expect(toast(page)).toHaveText("No se pudo conectar con el servidor.");
    await expect(modalProducto(page)).toBeVisible();
  });

  test("un doble clic en Guardar no crea el producto dos veces", async ({ page }) => {
    await abrir(page, { preparar: (b) => b.demorar("POST /productos", 600) });
    await abrirNuevo(page);
    await llenarNuevo(page);
    await guardar(page).evaluate((boton) => {
      boton.click();
      boton.click();
    });
    await expect(guardar(page)).toBeDisabled();
    await expect(toast(page)).toHaveText("Producto creado");
    expect(backend.enviados("POST", "/productos")).toHaveLength(1);
  });

  test("Cancelar, la ✕, Escape y un clic afuera cierran el formulario sin guardar", async ({ page }) => {
    await abrir(page);
    await abrirNuevo(page);
    await modalProducto(page).getByRole("button", { name: "Cancelar" }).click();
    await expect(modalProducto(page)).toBeHidden();
    await abrirNuevo(page);
    await modalProducto(page).getByRole("button", { name: "Cerrar" }).click();
    await expect(modalProducto(page)).toBeHidden();
    await abrirNuevo(page);
    await page.keyboard.press("Escape");
    await expect(modalProducto(page)).toBeHidden();
    await abrirNuevo(page);
    await modalProducto(page).click({ position: { x: 5, y: 5 } });
    await expect(modalProducto(page)).toBeHidden();
    expect(backend.enviados("POST", "/productos")).toHaveLength(0);
  });

  test("al volver a abrir el formulario, está vacío y sin errores", async ({ page }) => {
    await abrir(page);
    await abrirNuevo(page);
    await page.locator("#nombre").fill("Algo");
    await page.locator("#cantidad").fill("5");
    await modalProducto(page).getByRole("button", { name: "Cancelar" }).click();
    await abrirNuevo(page);
    await expect(page.locator("#nombre")).toHaveValue("");
    await expect(page.locator("#cantidad")).toHaveValue("");
    await guardar(page).click();
    await expect(page.locator("#error-nombre")).toBeVisible();
    await modalProducto(page).getByRole("button", { name: "Cancelar" }).click();
    await abrirNuevo(page);
    await expect(page.locator("#error-nombre")).toBeHidden();
  });
});

test.describe("Productos: editar", () => {
  const abrirEditar = async (page, nombre = "Sifón de soda") => {
    await accion(page, nombre, "Editar").click();
    await expect(modalProducto(page)).toBeVisible();
  };

  test("abre con los datos del producto; el costo y el stock no se pueden cambiar", async ({ page }) => {
    await abrir(page);
    await abrirEditar(page);
    await expect(page.locator("#modal-producto-titulo")).toHaveText("Editar producto");
    await expect(page.locator("#nombre")).toHaveValue("Sifón de soda");
    await expect(page.locator("#precio_compra")).toHaveValue("850");
    await expect(page.locator("#precio_compra")).toBeDisabled();
    await expect(page.locator("#cantidad")).toHaveValue("24");
    await expect(page.locator("#cantidad")).toBeDisabled();
    await expect(page.locator("#stock_minimo")).toHaveValue("6");
    await expect(page.locator("#rentabilidad")).toHaveValue("30");
    await expect(page.locator("#iva_alicuota")).toHaveValue("21");
    await expect(page.locator("#precio_venta")).toHaveValue("1337.05");
    await expect(page.locator("#proveedor_id")).toHaveValue("1");
    await expect(page.locator("#ayuda-costo")).toBeVisible();
    await expect(page.locator("#ayuda-stock")).toBeVisible();
  });

  test("no cambia el precio de venta solo al tocar el IVA o la rentabilidad", async ({ page }) => {
    await abrir(page);
    await abrirEditar(page);
    await page.locator("#iva_alicuota").selectOption("10.5");
    await page.locator("#rentabilidad").fill("80");
    await expect(page.locator("#precio_venta")).toHaveValue("1337.05");
  });

  test("guarda los cambios sin enviar el costo ni el stock", async ({ page }) => {
    await abrir(page);
    await abrirEditar(page);
    await page.locator("#nombre").fill("Sifón de soda 1 l");
    await page.locator("#precio_venta").fill("1500");
    await page.locator("#stock_minimo").fill("8");
    await page.locator("#proveedor_id").selectOption("2");
    await guardar(page).click();
    await expect(toast(page)).toHaveText("Producto actualizado");
    await expect(modalProducto(page)).toBeHidden();
    expect(backend.enviados("PUT", "/productos/:id")).toEqual([
      { nombre: "Sifón de soda 1 l", iva_alicuota: 21, rentabilidad: 30, precio_venta: 1500, stock_minimo: 8, proveedor_id: 2 },
    ]);
    expect(backend.llamadas.find((l) => l.metodo === "PUT").ruta).toBe("/productos/1");
    await expect(fila(page, "Sifón de soda 1 l")).toContainText(/1\.500,00/);
    await expect(fila(page, "Sifón de soda 1 l")).toContainText("Librería Central");
  });

  test("valida el nombre y el precio de venta igual que al crear", async ({ page }) => {
    await abrir(page);
    await abrirEditar(page);
    await page.locator("#nombre").fill("");
    await guardar(page).click();
    await expect(page.locator("#error-nombre")).toHaveText("Rellene el nombre del producto.");
    await page.locator("#nombre").fill("Sifón");
    await page.locator("#precio_venta").fill("0");
    await guardar(page).click();
    await expect(toast(page)).toHaveText("Ingresá un precio de venta mayor a 0.");
    expect(backend.enviados("PUT", "/productos/:id")).toHaveLength(0);
  });

  test("un nombre repetido (409) se avisa junto al campo", async ({ page }) => {
    await abrir(page);
    await abrirEditar(page);
    await page.locator("#nombre").fill("Detergente 750 ml");
    await guardar(page).click();
    await expect(page.locator("#error-nombre")).toHaveText("Ya existe un producto con ese nombre.");
    await expect(modalProducto(page)).toBeVisible();
  });

  test("un error del servidor se avisa y el formulario sigue abierto", async ({ page }) => {
    await abrir(page, { preparar: (b) => b.fallar("PUT /productos/:id", { status: 500, body: { mensaje: "Error interno del servidor" } }) });
    await abrirEditar(page);
    await guardar(page).click();
    await expect(toast(page)).toHaveText("Error interno del servidor");
    await expect(modalProducto(page)).toBeVisible();
  });

  test("después de editar, 'Nuevo producto' vuelve a dejar escribir el costo y el stock", async ({ page }) => {
    await abrir(page);
    await abrirEditar(page);
    await modalProducto(page).getByRole("button", { name: "Cancelar" }).click();
    await abrirNuevo(page);
    await expect(page.locator("#modal-producto-titulo")).toHaveText("Nuevo producto");
    await expect(page.locator("#precio_compra")).toBeEnabled();
    await expect(page.locator("#cantidad")).toBeEnabled();
    await expect(page.locator("#nombre")).toHaveValue("");
  });

  test("editar un producto sin proveedor deja el desplegable sin elegir y pide elegir uno", async ({ page }) => {
    await abrir(page, { semilla: (e) => (e.productos[2].proveedor_id = null) });
    await abrirEditar(page, "Yerba");
    await expect(page.locator("#proveedor_id")).toHaveValue("");
    await guardar(page).click();
    await expect(toast(page)).toHaveText("Elegí un proveedor. Si no hay, cargalos primero en Proveedores.");
  });
});

test.describe("Productos: reposición de stock", () => {
  const abrirRepo = async (page, nombre = "Sifón de soda") => {
    await accion(page, nombre, "Reponer stock").click();
    await expect(modalRepo(page)).toBeVisible();
  };
  const confirmar = (page) => page.getByTestId("confirmar-reposicion");

  test("abre con el nombre del producto y su proveedor ya elegido", async ({ page }) => {
    await abrir(page);
    await abrirRepo(page, "Detergente");
    await expect(page.locator("#repo-prod-nombre")).toHaveText("Detergente 750 ml");
    await expect(page.locator("#repo-cantidad")).toBeFocused();
    await expect(page.locator("#repo-cantidad")).toHaveValue("");
    await expect(page.locator("#proveedor_id_repo")).toHaveValue("2");
  });

  test("sugiere el monto: cantidad × costo actual", async ({ page }) => {
    await abrir(page);
    await abrirRepo(page);
    await page.locator("#repo-cantidad").fill("5");
    await expect(page.locator("#monto_total")).toHaveValue("4250");
    await page.locator("#repo-cantidad").fill("10");
    await expect(page.locator("#monto_total")).toHaveValue("8500");
    await page.locator("#repo-cantidad").fill("");
    await expect(page.locator("#monto_total")).toHaveValue("");
  });

  test("si se escribe el monto a mano, ya no se pisa al cambiar la cantidad", async ({ page }) => {
    await abrir(page);
    await abrirRepo(page);
    await page.locator("#repo-cantidad").fill("5");
    await page.locator("#monto_total").fill("4000");
    await page.locator("#repo-cantidad").fill("8");
    await expect(page.locator("#monto_total")).toHaveValue("4000");
  });

  // Este formulario usa la validación del propio navegador (campos required/min/step): marca el campo y no envía.
  const invalidos = [
    ["sin cantidad", { cantidad: "", monto: "100" }, "#repo-cantidad"],
    ["con cantidad 0", { cantidad: "0", monto: "100" }, "#repo-cantidad"],
    ["con cantidad negativa", { cantidad: "-2", monto: "100" }, "#repo-cantidad"],
    ["con cantidad decimal", { cantidad: "1.5", monto: "100" }, "#repo-cantidad"],
    ["sin monto total", { cantidad: "5", monto: "" }, "#monto_total"],
    ["con monto total 0", { cantidad: "5", monto: "0" }, "#monto_total"],
    ["sin proveedor", { cantidad: "5", monto: "100", proveedor: "" }, "#proveedor_id_repo"],
  ];

  for (const [nombre, datos, campo] of invalidos) {
    test(`rechaza confirmar ${nombre}: marca el campo y no envía nada`, async ({ page }) => {
      await abrir(page);
      await abrirRepo(page);
      await page.locator("#repo-cantidad").fill(datos.cantidad);
      await page.locator("#monto_total").fill(datos.monto);
      if (datos.proveedor !== undefined) await page.locator("#proveedor_id_repo").selectOption(datos.proveedor);
      await confirmar(page).click();
      expect(await page.locator(campo).evaluate((el) => el.validity.valid)).toBe(false);
      await expect(modalRepo(page)).toBeVisible();
      expect(backend.enviados("POST", "/productos/:id/reposicion")).toHaveLength(0);
    });
  }

  test("registra la reposición, avisa, cierra y suma al stock", async ({ page }) => {
    await abrir(page);
    await abrirRepo(page);
    await page.locator("#repo-cantidad").fill("5");
    await confirmar(page).click();
    await expect(toast(page)).toHaveText("Reposición registrada");
    await expect(modalRepo(page)).toBeHidden();
    expect(backend.enviados("POST", "/productos/:id/reposicion")).toEqual([{ cantidad: 5, monto_total: 4250, proveedor_id: 1 }]);
    expect(backend.llamadas.find((l) => l.ruta.endsWith("/reposicion")).ruta).toBe("/productos/1/reposicion");
    await expect(fila(page, "Sifón de soda").locator("td").nth(4)).toContainText("29");
  });

  test("un producto sin stock sale de 'Sin stock' al reponerlo", async ({ page }) => {
    await abrir(page);
    await abrirRepo(page, "Yerba");
    await page.locator("#repo-cantidad").fill("6");
    await confirmar(page).click();
    await expect(toast(page)).toHaveText("Reposición registrada");
    await expect(fila(page, "Yerba").locator(".badge-rojo")).toHaveCount(0);
  });

  test("un error del servidor se avisa con su mensaje y el formulario sigue abierto", async ({ page }) => {
    await abrir(page, { preparar: (b) => b.fallar("POST /productos/:id/reposicion", { status: 500, body: { mensaje: "Error interno del servidor" } }) });
    await abrirRepo(page);
    await page.locator("#repo-cantidad").fill("5");
    await confirmar(page).click();
    await expect(toast(page)).toHaveText("Error interno del servidor");
    await expect(modalRepo(page)).toBeVisible();
    await expect(confirmar(page)).toBeEnabled();
  });

  test("un error sin mensaje usa el texto por defecto", async ({ page }) => {
    await abrir(page, { preparar: (b) => b.fallar("POST /productos/:id/reposicion", { status: 500, body: {} }) });
    await abrirRepo(page);
    await page.locator("#repo-cantidad").fill("5");
    await confirmar(page).click();
    await expect(toast(page)).toHaveText("No se pudo registrar la reposición.");
  });

  test("un doble clic en Confirmar no registra la reposición dos veces", async ({ page }) => {
    await abrir(page, { preparar: (b) => b.demorar("POST /productos/:id/reposicion", 600) });
    await abrirRepo(page);
    await page.locator("#repo-cantidad").fill("5");
    await confirmar(page).evaluate((boton) => {
      boton.click();
      boton.click();
    });
    await expect(toast(page)).toHaveText("Reposición registrada");
    expect(backend.enviados("POST", "/productos/:id/reposicion")).toHaveLength(1);
  });

  test("al volver a abrirlo está vacío", async ({ page }) => {
    await abrir(page);
    await abrirRepo(page);
    await page.locator("#repo-cantidad").fill("5");
    await modalRepo(page).getByRole("button", { name: "Cancelar" }).click();
    await expect(modalRepo(page)).toBeHidden();
    await abrirRepo(page, "Detergente");
    await expect(page.locator("#repo-cantidad")).toHaveValue("");
    await expect(page.locator("#monto_total")).toHaveValue("");
    await expect(page.locator("#repo-prod-nombre")).toHaveText("Detergente 750 ml");
  });
});

test.describe("Productos: baja de stock", () => {
  const abrirBaja = async (page, nombre = "Sifón de soda") => {
    await accion(page, nombre, "Dar de baja").click();
    await expect(modalBaja(page)).toBeVisible();
  };
  const confirmar = (page) => page.getByTestId("confirmar-baja");

  test("abre con el nombre, el stock actual y los tres motivos", async ({ page }) => {
    await abrir(page);
    await abrirBaja(page);
    await expect(page.locator("#baja-prod-nombre")).toHaveText("Sifón de soda");
    await expect(page.locator("#baja-stock-actual")).toHaveText("Stock actual: 24");
    await expect(page.locator("#baja-cantidad")).toHaveAttribute("max", "24");
    await expect(page.locator("#baja-motivo option")).toHaveText(["Roto", "Perdido", "No utilizado"]);
    await expect(page.locator("#baja-cantidad")).toBeFocused();
  });

  test("registra la baja con la cantidad y el motivo elegidos, y descuenta del stock", async ({ page }) => {
    await abrir(page);
    await abrirBaja(page);
    await page.locator("#baja-cantidad").fill("2");
    await page.locator("#baja-motivo").selectOption("perdido");
    await confirmar(page).click();
    await expect(toast(page)).toHaveText("Baja registrada");
    await expect(modalBaja(page)).toBeHidden();
    expect(backend.enviados("POST", "/productos/:id/baja")).toEqual([{ cantidad: 2, motivo: "perdido" }]);
    expect(backend.llamadas.find((l) => l.ruta.endsWith("/baja")).ruta).toBe("/productos/1/baja");
    await expect(fila(page, "Sifón de soda").locator("td").nth(4)).toContainText("22");
  });

  test("el motivo por defecto es 'roto'", async ({ page }) => {
    await abrir(page);
    await abrirBaja(page);
    await page.locator("#baja-cantidad").fill("1");
    await confirmar(page).click();
    await expect(toast(page)).toHaveText("Baja registrada");
    expect(backend.enviados("POST", "/productos/:id/baja")[0].motivo).toBe("roto");
  });

  test("se puede dar de baja todo el stock", async ({ page }) => {
    await abrir(page);
    await abrirBaja(page, "Detergente");
    await page.locator("#baja-cantidad").fill("3");
    await confirmar(page).click();
    await expect(toast(page)).toHaveText("Baja registrada");
    await expect(fila(page, "Detergente").locator(".badge-rojo")).toHaveText("Sin stock");
  });

  // Este formulario usa la validación del propio navegador (required, min, max = stock, step): marca el campo y no envía.
  const invalidos = [
    ["sin cantidad", ""],
    ["con cantidad 0", "0"],
    ["con cantidad negativa", "-1"],
    ["con cantidad decimal", "1.5"],
    ["con más cantidad que el stock", "25"],
  ];

  for (const [nombre, cantidad] of invalidos) {
    test(`rechaza ${nombre}: marca el campo y no envía nada`, async ({ page }) => {
      await abrir(page);
      await abrirBaja(page);
      await page.locator("#baja-cantidad").fill(cantidad);
      await confirmar(page).click();
      expect(await page.locator("#baja-cantidad").evaluate((el) => el.validity.valid)).toBe(false);
      await expect(modalBaja(page)).toBeVisible();
      expect(backend.enviados("POST", "/productos/:id/baja")).toHaveLength(0);
    });
  }

  test("un producto sin stock no deja dar de baja ninguna unidad", async ({ page }) => {
    await abrir(page);
    await abrirBaja(page, "Yerba");
    await expect(page.locator("#baja-stock-actual")).toHaveText("Stock actual: 0");
    await page.locator("#baja-cantidad").fill("1");
    await confirmar(page).click();
    expect(await page.locator("#baja-cantidad").evaluate((el) => el.validity.valid)).toBe(false);
    await expect(modalBaja(page)).toBeVisible();
    expect(backend.enviados("POST", "/productos/:id/baja")).toHaveLength(0);
  });

  test("si el backend rechaza la baja (409), avisa con su mensaje y deja el formulario abierto", async ({ page }) => {
    await abrir(page, { preparar: (b) => b.fallar("POST /productos/:id/baja", { status: 409, body: { mensaje: "No hay stock suficiente para registrar la baja." } }) });
    await abrirBaja(page);
    await page.locator("#baja-cantidad").fill("2");
    await confirmar(page).click();
    await expect(toast(page)).toHaveText("No hay stock suficiente para registrar la baja.");
    await expect(modalBaja(page)).toBeVisible();
    await expect(confirmar(page)).toBeEnabled();
  });

  test("un error sin mensaje usa el texto por defecto", async ({ page }) => {
    await abrir(page, { preparar: (b) => b.fallar("POST /productos/:id/baja", { status: 500, body: {} }) });
    await abrirBaja(page);
    await page.locator("#baja-cantidad").fill("2");
    await confirmar(page).click();
    await expect(toast(page)).toHaveText("No se pudo registrar la baja.");
  });

  test("un doble clic en Registrar baja no la registra dos veces", async ({ page }) => {
    await abrir(page, { preparar: (b) => b.demorar("POST /productos/:id/baja", 600) });
    await abrirBaja(page);
    await page.locator("#baja-cantidad").fill("2");
    await confirmar(page).evaluate((boton) => {
      boton.click();
      boton.click();
    });
    await expect(toast(page)).toHaveText("Baja registrada");
    expect(backend.enviados("POST", "/productos/:id/baja")).toHaveLength(1);
  });
});

test.describe("Productos: ocultar y eliminar", () => {
  test("Ocultar pide confirmación, oculta el producto y lo saca de la lista", async ({ page }) => {
    await abrir(page);
    await accion(page, "Detergente", "Ocultar").click();
    await expect(toast(page)).toHaveText("Producto oculto");
    expect(confirmaciones).toEqual(["¿Ocultar este producto? No se borrarán sus datos."]);
    expect(backend.llamadas.find((l) => l.metodo === "PATCH").ruta).toBe("/productos/2/ocultar");
    await expect(filas(page)).toHaveCount(2);
    await expect(fila(page, "Detergente")).toHaveCount(0);
  });

  test("si se cancela la confirmación, no se oculta nada", async ({ page }) => {
    await abrir(page, { respuestas: [false] });
    await accion(page, "Detergente", "Ocultar").click();
    await expect(filas(page)).toHaveCount(3);
    expect(backend.enviados("PATCH", "/productos/:id/ocultar")).toHaveLength(0);
  });

  test("si ocultar falla, avisa con el mensaje del servidor y el producto sigue en la lista", async ({ page }) => {
    await abrir(page, { preparar: (b) => b.fallar("PATCH /productos/:id/ocultar", { status: 500, body: { mensaje: "Error interno del servidor" } }) });
    await accion(page, "Detergente", "Ocultar").click();
    await expect(toast(page)).toHaveText("Error interno del servidor");
    await expect(toast(page)).toHaveClass(/error/);
    await expect(filas(page)).toHaveCount(3);
  });

  test("si ocultar falla sin mensaje, usa el texto por defecto", async ({ page }) => {
    await abrir(page, { preparar: (b) => b.fallar("PATCH /productos/:id/ocultar", { status: 500, body: {} }) });
    await accion(page, "Detergente", "Ocultar").click();
    await expect(toast(page)).toHaveText("No se pudo ocultar el producto.");
  });

  test("Eliminar pide confirmación y borra un producto sin movimientos", async ({ page }) => {
    await abrir(page);
    await accion(page, "Yerba", "Eliminar").click();
    await expect(toast(page)).toHaveText("Producto eliminado");
    expect(confirmaciones).toEqual(["¿Eliminar definitivamente? Esta acción no se puede deshacer."]);
    expect(backend.llamadas.find((l) => l.metodo === "DELETE").ruta).toBe("/productos/3");
    await expect(fila(page, "Yerba")).toHaveCount(0);
    await expect(filas(page)).toHaveCount(2);
  });

  test("si se cancela la confirmación, no se elimina nada", async ({ page }) => {
    await abrir(page, { respuestas: [false] });
    await accion(page, "Yerba", "Eliminar").click();
    await expect(filas(page)).toHaveCount(3);
    expect(backend.enviados("DELETE", "/productos/:id")).toHaveLength(0);
  });

  test("un producto con movimientos (409) ofrece ocultarlo; si se acepta, se oculta", async ({ page }) => {
    await abrir(page);
    await accion(page, "Sifón", "Eliminar").click();
    await expect(toast(page)).toHaveText("Producto oculto");
    expect(confirmaciones).toEqual(["¿Eliminar definitivamente? Esta acción no se puede deshacer.", "El producto tiene movimientos y no se puede eliminar. ¿Querés ocultarlo?"]);
    expect(backend.enviados("PATCH", "/productos/:id/ocultar")).toHaveLength(1);
    await expect(fila(page, "Sifón")).toHaveCount(0);
  });

  test("si no se acepta ocultarlo, el producto queda como estaba", async ({ page }) => {
    await abrir(page, { respuestas: [true, false] });
    await accion(page, "Sifón", "Eliminar").click();
    await expect.poll(() => confirmaciones.length).toBe(2);
    await expect(filas(page)).toHaveCount(3);
    expect(backend.enviados("PATCH", "/productos/:id/ocultar")).toHaveLength(0);
  });

  test("otro error al eliminar se avisa con su mensaje", async ({ page }) => {
    await abrir(page, { preparar: (b) => b.fallar("DELETE /productos/:id", { status: 500, body: { mensaje: "Error interno del servidor" } }) });
    await accion(page, "Yerba", "Eliminar").click();
    await expect(toast(page)).toHaveText("Error interno del servidor");
    await expect(filas(page)).toHaveCount(3);
  });

  test("otro error al eliminar sin mensaje usa el texto por defecto", async ({ page }) => {
    await abrir(page, { preparar: (b) => b.fallar("DELETE /productos/:id", { status: 500, body: {} }) });
    await accion(page, "Yerba", "Eliminar").click();
    await expect(toast(page)).toHaveText("No se pudo eliminar el producto.");
  });

  test("un producto oculto también se puede eliminar desde 'Ver ocultos'", async ({ page }) => {
    await abrir(page);
    await verOcultos(page).click();
    await accion(page, "Lavandina", "Eliminar").click();
    await expect(toast(page)).toHaveText("Producto eliminado");
    expect(backend.llamadas.find((l) => l.metodo === "DELETE").ruta).toBe("/productos/4");
  });
});

test.describe("Productos: rol Cajero", () => {
  test("ve la lista con 8 columnas (sin 'Creado por') y sin el botón 'Nuevo producto' ni 'Ver ocultos'", async ({ page }) => {
    await abrir(page, { rol: "CAJERO" });
    await expect(filas(page)).toHaveCount(3);
    await expect(page.locator("#productos-thead th:visible")).toHaveText(["Nombre", "Categoría", "Costo", "Precio", "Stock", "Mínimo", "Proveedor", "Acciones"]);
    await expect(nuevo(page)).toBeHidden();
    await expect(verOcultos(page)).toBeHidden();
    await expect(page.getByText("admin1")).toHaveCount(0);
  });

  test("solo puede reponer y dar de baja: no ve Editar, Ocultar ni Eliminar", async ({ page }) => {
    await abrir(page, { rol: "CAJERO" });
    await expect(filas(page)).toHaveCount(3);
    await expect(page.locator('button[title="Reponer stock"]')).toHaveCount(3);
    await expect(page.locator('button[title="Dar de baja"]')).toHaveCount(3);
    await expect(page.locator('button[title="Editar"]')).toHaveCount(0);
    await expect(page.locator('button[title="Ocultar"]')).toHaveCount(0);
    await expect(page.locator('button[title="Eliminar"]')).toHaveCount(0);
  });

  test("puede registrar una reposición", async ({ page }) => {
    await abrir(page, { rol: "CAJERO" });
    await accion(page, "Sifón", "Reponer stock").click();
    await page.locator("#repo-cantidad").fill("2");
    await page.getByTestId("confirmar-reposicion").click();
    await expect(toast(page)).toHaveText("Reposición registrada");
  });

  test("puede registrar una baja", async ({ page }) => {
    await abrir(page, { rol: "CAJERO" });
    await accion(page, "Sifón", "Dar de baja").click();
    await page.locator("#baja-cantidad").fill("1");
    await page.getByTestId("confirmar-baja").click();
    await expect(toast(page)).toHaveText("Baja registrada");
  });

  test("puede buscar y filtrar por stock bajo, y nunca pide los ocultos", async ({ page }) => {
    await abrir(page, { rol: "CAJERO" });
    await stockBajo(page).click();
    await expect(filas(page)).toHaveCount(2);
    await buscador(page).fill("yerba");
    await expect(filas(page)).toHaveCount(1);
    for (const consulta of backend.consultas("GET", "/productos")) expect(consulta.ocultos).toBeUndefined();
  });

  test("el mensaje de error de la tabla ocupa 8 columnas", async ({ page }) => {
    await abrir(page, { rol: "CAJERO", preparar: (b) => b.fallar("GET /productos", { status: 500, body: {} }) });
    await expect(page.locator("#productos-tbody td[colspan]")).toHaveAttribute("colspan", "8");
  });
});

test.describe("Productos: acceso", () => {
  test("sin sesión iniciada manda al login", async ({ page }) => {
    await page.goto("/productos.html");
    await expect(page).toHaveURL(/login\.html/);
  });

  test("el menú lateral marca Productos como la pantalla actual", async ({ page }) => {
    await abrir(page);
    await expect(page.getByTestId("menu-productos")).toHaveAttribute("aria-current", "page");
  });

  test("usar la pantalla de punta a punta no produce errores de JavaScript", async ({ page }) => {
    await abrir(page);
    await abrirNuevo(page);
    await llenarNuevo(page);
    await guardar(page).click();
    await expect(toast(page)).toHaveText("Producto creado");
    await accion(page, "Sifón", "Reponer stock").click();
    await page.locator("#repo-cantidad").fill("1");
    await page.getByTestId("confirmar-reposicion").click();
    await expect(toast(page)).toHaveText("Reposición registrada");
    expect(erroresDePagina).toEqual([]);
  });
});
