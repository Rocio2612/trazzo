const { test, expect } = require("@playwright/test");
const { iniciarSesionComo } = require("./helpers");
const { simularInventario } = require("./backend-falso-inventario");

// Pantalla Insumos (insumos.html, bienes de gasto). Backend falso (backend-falso-inventario.js), con estos datos:
//   1 Papel de ticket     $ 500 × 10 rollos   = $ 5.000   (Librería Central)
//   2 Bolsas de papel     $  20 × 100 unid.   = $ 2.000   (Distribuidora Norte)
//   3 Cinta de embalar    $ 800 × 3           = $ 2.400   (Librería Central) OCULTO
// Valor total del inventario (solo los visibles): $ 7.000,00.
// Esta pantalla avisa los errores con alert() y pide confirmación para eliminar con confirm().

let backend;
let avisos;

// Acepta todos los alert y confirm, y guarda sus mensajes.
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
  await page.goto("/insumos.html");
};

const filas = (page) => page.locator("table.gastos-tabla tbody tr");
const fila = (page, nombre) => filas(page).filter({ hasText: nombre });
const modal = (page) => page.locator(".gastos-modal");
const guardar = (page) => modal(page).getByRole("button", { name: /^Guardar/ });
const buscador = (page) => page.getByPlaceholder("Buscar por nombre...");
const verOcultos = (page) => page.getByRole("button", { name: "Ver ocultos" });

const llenarNuevo = async (page, datos = {}) => {
  const v = { nombre: "Tinta para sellos", costo: "150.5", cantidad: "4", fecha: "05-11-2026", proveedor: "1", ...datos };
  await page.locator("#m-nombre").fill(v.nombre);
  await page.locator("#m-costo").fill(v.costo);
  await page.locator("#m-cant").fill(v.cantidad);
  await page.locator("#m-fecha").fill(v.fecha);
  if (v.proveedor) await page.locator("#m-prov").selectOption(v.proveedor);
};

test.describe("Insumos: pantalla", () => {
  test("muestra el título, el valor total del inventario, la cantidad y las columnas", async ({ page }) => {
    await abrir(page);
    await expect(page.getByRole("heading", { name: "Insumos", level: 1 })).toBeVisible();
    await expect(page.getByText("Valor Total del Inventario:")).toContainText(/7\.000,00/);
    await expect(page.getByText("2 insumos")).toBeVisible();
    await expect(page.locator("table.gastos-tabla thead th")).toHaveText(["NOMBRE", "COSTO UNITARIO", "CANTIDAD", "UNIDAD", "COSTO TOTAL", "FECHA", "PROVEEDOR", "CREADO POR", "ACCIONES"]);
  });

  test("lista los insumos visibles con sus datos y no muestra los ocultos", async ({ page }) => {
    await abrir(page);
    await expect(filas(page)).toHaveCount(2);
    const papel = fila(page, "Papel de ticket");
    await expect(papel).toContainText(/500,00/);
    await expect(papel).toContainText("10");
    await expect(papel).toContainText("rollos");
    await expect(papel).toContainText(/5\.000,00/);
    await expect(papel).toContainText("05-11-2026");
    await expect(papel).toContainText("Librería Central");
    await expect(papel).toContainText("admin1");
    await expect(page.getByText("Cinta de embalar")).toHaveCount(0);
  });

  test("con un solo insumo el contador va en singular", async ({ page }) => {
    await abrir(page, { semilla: (e) => e.insumos.splice(1, 1) });
    await expect(page.getByText("1 insumo", { exact: true })).toBeVisible();
  });

  test("sin insumos muestra 'Sin insumos' y el total en cero", async ({ page }) => {
    await abrir(page, { semilla: (e) => (e.insumos = []) });
    await expect(page.getByText("Sin insumos", { exact: true })).toBeVisible();
    await expect(page.getByText("Valor Total del Inventario:")).toContainText(/0,00/);
    await expect(page.getByText("0 insumos")).toBeVisible();
  });

  test("un insumo sin unidad de medida ni proveedor se muestra con valores por defecto", async ({ page }) => {
    await abrir(page, {
      semilla: (e) => {
        e.insumos[0].unidad_medida = null;
        e.insumos[0].proveedor_nombre = null;
        e.insumos[0].creado_por = null;
      },
    });
    const papel = fila(page, "Papel de ticket");
    await expect(papel).toContainText("unidades");
    await expect(papel).toContainText("—");
    await expect(papel).toContainText("admin");
  });

  test("un nombre con HTML se muestra como texto y no se ejecuta", async ({ page }) => {
    await abrir(page, { semilla: (e) => (e.insumos[0].nombre = '<img src=x onerror="window.__xss=1">Resma') });
    await expect(page.getByText('<img src=x onerror="window.__xss=1">Resma')).toBeVisible();
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  });

  test("si no se pueden cargar los insumos, avisa con el mensaje del backend", async ({ page }) => {
    await abrir(page, { preparar: (b) => b.fallar("GET /bienes-gasto", { status: 500, body: { status: "error", mensaje: "Error al listar los insumos" } }) });
    await expect.poll(() => avisos.map((a) => a.mensaje)).toContain("Error al listar los insumos");
  });

  test("si no se pueden cargar y no hay mensaje, usa el texto por defecto", async ({ page }) => {
    await abrir(page, { preparar: (b) => b.fallar("GET /bienes-gasto", { status: 500, body: {} }) });
    await expect.poll(() => avisos.map((a) => a.mensaje)).toContain("Error en la petición");
  });
});

test.describe("Insumos: buscador y ocultos", () => {
  test("el buscador filtra por nombre sin distinguir mayúsculas", async ({ page }) => {
    await abrir(page);
    await buscador(page).fill("BOLSAS");
    await expect(filas(page)).toHaveCount(1);
    await expect(fila(page, "Bolsas de papel")).toBeVisible();
    await buscador(page).fill("zzzz");
    await expect(page.getByText("Sin insumos", { exact: true })).toBeVisible();
    await buscador(page).fill("");
    await expect(filas(page)).toHaveCount(2);
  });

  test("'Ver ocultos' muestra solo los ocultos, con Restaurar y Eliminar, y vuelve a la lista", async ({ page }) => {
    await abrir(page);
    await verOcultos(page).click();
    await expect(verOcultos(page)).toHaveClass(/activo/);
    await expect(filas(page)).toHaveCount(1);
    await expect(fila(page, "Cinta de embalar")).toBeVisible();
    await expect(fila(page, "Cinta de embalar").getByRole("button", { name: "Restaurar" })).toBeVisible();
    await expect(fila(page, "Cinta de embalar").getByTitle("Eliminar")).toBeVisible();
    await expect(fila(page, "Cinta de embalar").getByTitle("Editar")).toHaveCount(0);
    await verOcultos(page).click();
    await expect(filas(page)).toHaveCount(2);
  });

  test("sin ocultos, 'Ver ocultos' dice 'Sin elementos ocultos'", async ({ page }) => {
    await abrir(page, { semilla: (e) => e.insumos.forEach((i) => (i.activo = true)) });
    await verOcultos(page).click();
    await expect(page.getByText("Sin elementos ocultos")).toBeVisible();
  });

  test("ocultar saca el insumo de la lista, baja el total y lo pasa a 'Ver ocultos'", async ({ page }) => {
    await abrir(page);
    await fila(page, "Papel de ticket").getByTitle("Ocultar").click();
    await expect(filas(page)).toHaveCount(1);
    await expect(page.getByText("1 insumo", { exact: true })).toBeVisible();
    await expect(page.getByText("Valor Total del Inventario:")).toContainText(/2\.000,00/);
    expect(backend.llamadas.some((l) => l.metodo === "PATCH" && l.ruta === "/bienes-gasto/1/ocultar")).toBe(true);
    await verOcultos(page).click();
    await expect(fila(page, "Papel de ticket")).toBeVisible();
  });

  test("restaurar devuelve el insumo a la lista y suma su valor", async ({ page }) => {
    await abrir(page);
    await verOcultos(page).click();
    await fila(page, "Cinta de embalar").getByRole("button", { name: "Restaurar" }).click();
    await expect(page.getByText("Sin elementos ocultos")).toBeVisible();
    await verOcultos(page).click();
    await expect(filas(page)).toHaveCount(3);
    await expect(page.getByText("Valor Total del Inventario:")).toContainText(/9\.400,00/);
  });

  test("si ocultar falla, avisa con el mensaje del backend y el insumo sigue en la lista", async ({ page }) => {
    await abrir(page, { preparar: (b) => b.fallar("PATCH /bienes-gasto/:id/ocultar", { status: 500, body: { mensaje: "No se pudo ocultar" } }) });
    await fila(page, "Papel de ticket").getByTitle("Ocultar").click();
    await expect.poll(() => avisos.map((a) => a.mensaje)).toContain("No se pudo ocultar");
    await expect(filas(page)).toHaveCount(2);
  });

  test("si restaurar falla, avisa con el mensaje del backend", async ({ page }) => {
    await abrir(page, { preparar: (b) => b.fallar("PATCH /bienes-gasto/:id/restaurar", { status: 404, body: { mensaje: "No se encontró el insumo" } }) });
    await verOcultos(page).click();
    await fila(page, "Cinta de embalar").getByRole("button", { name: "Restaurar" }).click();
    await expect.poll(() => avisos.map((a) => a.mensaje)).toContain("No se encontró el insumo");
  });
});

test.describe("Insumos: eliminar", () => {
  test("pide confirmación, elimina el insumo oculto y lo saca de la lista", async ({ page }) => {
    await abrir(page);
    await verOcultos(page).click();
    await fila(page, "Cinta de embalar").getByTitle("Eliminar").click();
    await expect(page.getByText("Sin elementos ocultos")).toBeVisible();
    expect(avisos).toContainEqual({ tipo: "confirm", mensaje: "¿Eliminar definitivamente este insumo?" });
    expect(backend.llamadas.some((l) => l.metodo === "DELETE" && l.ruta === "/bienes-gasto/3")).toBe(true);
  });

  test("si se cancela la confirmación no elimina nada", async ({ page }) => {
    await abrir(page, { confirmar: false });
    await verOcultos(page).click();
    await fila(page, "Cinta de embalar").getByTitle("Eliminar").click();
    await expect(fila(page, "Cinta de embalar")).toBeVisible();
    expect(backend.llamadas.some((l) => l.metodo === "DELETE")).toBe(false);
  });

  test("si el backend no deja eliminarlo, avisa con su mensaje y el insumo sigue", async ({ page }) => {
    await abrir(page, { preparar: (b) => b.fallar("DELETE /bienes-gasto/:id", { status: 409, body: { mensaje: "El insumo tiene reposiciones asociadas" } }) });
    await verOcultos(page).click();
    await fila(page, "Cinta de embalar").getByTitle("Eliminar").click();
    await expect.poll(() => avisos.map((a) => a.mensaje)).toContain("El insumo tiene reposiciones asociadas");
    await expect(fila(page, "Cinta de embalar")).toBeVisible();
  });
});

test.describe("Insumos: nuevo insumo", () => {
  test("pide los proveedores a GET /proveedores", async ({ page }) => {
    await abrir(page);
    await page.getByRole("button", { name: "Nuevo insumo" }).click();
    await expect(modal(page)).toBeVisible();
    // La dirección correcta es /proveedores (API_URL ya incluye /api). Con /api/proveedores el Backend real respondería 404.
    expect(backend.llamadas.map((l) => `${l.metodo} ${l.ruta}`)).toContain("GET /proveedores");
    expect(backend.llamadas.map((l) => l.ruta)).not.toContain("/api/proveedores");
  });

  test("el formulario ofrece los proveedores y calcula el costo total solo", async ({ page }) => {
    await abrir(page);
    await page.getByRole("button", { name: "Nuevo insumo" }).click();
    await expect(modal(page).getByRole("heading", { name: "Nuevo insumo" })).toBeVisible();
    await expect(page.locator("#m-prov option")).toHaveText(["Seleccione un proveedor", "Distribuidora Norte", "Librería Central"]);
    await expect(page.locator("#m-total")).toHaveJSProperty("readOnly", true);
    await page.locator("#m-costo").fill("150.5");
    await page.locator("#m-cant").fill("4");
    await expect(page.locator("#m-total")).toHaveValue(/602,00/);
    await page.locator("#m-cant").fill("");
    await expect(page.locator("#m-total")).toHaveValue("");
  });

  test("crea el insumo, envía los datos con los nombres del contrato y lo muestra con el total actualizado", async ({ page }) => {
    await abrir(page);
    await page.getByRole("button", { name: "Nuevo insumo" }).click();
    await llenarNuevo(page);
    await guardar(page).click();
    await expect(modal(page)).toHaveCount(0);
    expect(backend.enviados("POST", "/bienes-gasto")).toEqual([
      { nombre: "Tinta para sellos", precio_compra: 150.5, cantidad: 4, stock_minimo: 0, proveedor_id: 1, iva_alicuota: 21, fecha: "2026-11-05" },
    ]);
    await expect(filas(page)).toHaveCount(3);
    await expect(fila(page, "Tinta para sellos")).toContainText("Distribuidora Norte");
    await expect(page.getByText("3 insumos")).toBeVisible();
    await expect(page.getByText("Valor Total del Inventario:")).toContainText(/7\.602,00/);
  });

  test("recorta los espacios del nombre", async ({ page }) => {
    await abrir(page);
    await page.getByRole("button", { name: "Nuevo insumo" }).click();
    await llenarNuevo(page, { nombre: "   Tinta   " });
    await guardar(page).click();
    await expect(modal(page)).toHaveCount(0);
    expect(backend.enviados("POST", "/bienes-gasto")[0].nombre).toBe("Tinta");
  });

  const invalidos = [
    ["sin nombre", { nombre: "" }, "El nombre es obligatorio."],
    ["con el nombre en blanco", { nombre: "    " }, "El nombre es obligatorio."],
    ["sin costo", { costo: "" }, "El costo unitario debe ser mayor a 0."],
    ["con costo negativo", { costo: "-5" }, "El costo unitario debe ser mayor a 0."],
    ["sin cantidad", { cantidad: "" }, "La cantidad debe ser mayor a 0."],
    ["con cantidad 0", { cantidad: "0" }, "La cantidad debe ser mayor a 0."],
    ["con cantidad negativa", { cantidad: "-2" }, "La cantidad debe ser mayor a 0."],
    ["sin proveedor", { proveedor: "" }, "Debe seleccionar un proveedor."],
    ["sin fecha", { fecha: "" }, "La fecha es obligatoria y debe tener el formato dd-mm-aaaa."],
    ["con la fecha en otro formato", { fecha: "2026-11-05" }, "La fecha es obligatoria y debe tener el formato dd-mm-aaaa."],
    ["con una fecha que no existe", { fecha: "31-02-2026" }, "La fecha es obligatoria y debe tener el formato dd-mm-aaaa."],
  ];

  for (const [nombre, datos, mensaje] of invalidos) {
    test(`rechaza guardar ${nombre}: avisa y no envía nada`, async ({ page }) => {
      await abrir(page);
      await page.getByRole("button", { name: "Nuevo insumo" }).click();
      await llenarNuevo(page, datos);
      await guardar(page).click();
      await expect.poll(() => avisos.map((a) => a.mensaje)).toContain(mensaje);
      await expect(modal(page)).toHaveCount(1);
      await expect(guardar(page)).toBeEnabled();
      await expect(guardar(page)).toHaveText("Guardar");
      expect(backend.enviados("POST", "/bienes-gasto")).toHaveLength(0);
    });
  }

  // El Backend exige un costo mayor a cero ("El costo y la cantidad deben ser mayores a cero"). La pantalla solo rechaza costos
  // negativos: con 0 envía el pedido y el Backend lo rechaza. Debería avisarlo antes, igual que con la cantidad.
  test("un costo unitario de 0 se rechaza antes de enviarlo", async ({ page }) => {
    await abrir(page);
    await page.getByRole("button", { name: "Nuevo insumo" }).click();
    await llenarNuevo(page, { costo: "0" });
    await guardar(page).click();
    await expect.poll(() => avisos.length).toBeGreaterThan(0);
    expect(backend.enviados("POST", "/bienes-gasto")).toHaveLength(0);
  });

  test("si el backend rechaza el alta, avisa con su mensaje y el formulario sigue abierto", async ({ page }) => {
    await abrir(page, { preparar: (b) => b.fallar("POST /bienes-gasto", { status: 400, body: { status: "error", mensaje: "Error de validación en los datos enviados" } }) });
    await page.getByRole("button", { name: "Nuevo insumo" }).click();
    await llenarNuevo(page);
    await guardar(page).click();
    await expect.poll(() => avisos.map((a) => a.mensaje)).toContain("Error de validación en los datos enviados");
    await expect(modal(page)).toHaveCount(1);
    await expect(guardar(page)).toBeEnabled();
  });

  test("Cancelar y la cruz cierran el formulario sin guardar", async ({ page }) => {
    await abrir(page);
    await page.getByRole("button", { name: "Nuevo insumo" }).click();
    await llenarNuevo(page);
    await modal(page).getByRole("button", { name: "Cancelar" }).click();
    await expect(modal(page)).toHaveCount(0);
    await page.getByRole("button", { name: "Nuevo insumo" }).click();
    await modal(page).getByRole("button", { name: "×" }).click();
    await expect(modal(page)).toHaveCount(0);
    expect(backend.enviados("POST", "/bienes-gasto")).toHaveLength(0);
  });

  test("después de cancelar, un alta nueva abre vacía", async ({ page }) => {
    await abrir(page);
    await page.getByRole("button", { name: "Nuevo insumo" }).click();
    await llenarNuevo(page);
    await modal(page).getByRole("button", { name: "Cancelar" }).click();
    await page.getByRole("button", { name: "Nuevo insumo" }).click();
    await expect(page.locator("#m-nombre")).toHaveValue("");
    await expect(page.locator("#m-prov")).toHaveValue("");
  });
});

test.describe("Insumos: reponer", () => {
  const abrirReponer = async (page, nombre = "Papel de ticket") => {
    await fila(page, nombre).getByRole("button", { name: "Reponer" }).click();
    await expect(modal(page).getByRole("heading", { name: "Reponer stock" })).toBeVisible();
  };

  test("el formulario nombra el insumo y propone el monto según el costo unitario", async ({ page }) => {
    await abrir(page);
    await abrirReponer(page);
    await expect(modal(page)).toContainText("Reponiendo stock de: Papel de ticket");
    await expect(page.locator("#m-prov option")).toHaveText(["Seleccione un proveedor", "Distribuidora Norte", "Librería Central"]);
    await page.locator("#m-cant").fill("4");
    await expect(page.locator("#m-monto")).toHaveValue("2000.00"); // 4 × $ 500
    await page.locator("#m-cant").fill("");
    await expect(page.locator("#m-monto")).toHaveValue("");
  });

  test("repone: envía los datos, suma la cantidad y actualiza el valor total", async ({ page }) => {
    await abrir(page);
    await abrirReponer(page);
    await page.locator("#m-cant").fill("4");
    await page.locator("#m-monto").fill("2400");
    await page.locator("#m-fecha").fill("12-11-2026");
    await page.locator("#m-prov").selectOption("2");
    await guardar(page).click();
    await expect(modal(page)).toHaveCount(0);
    expect(backend.enviados("POST", "/bienes-gasto/:id/reposicion")).toEqual([{ proveedor_id: 2, cantidad: 4, monto_total: 2400, fecha: "2026-11-12" }]);
    await expect(fila(page, "Papel de ticket")).toContainText("14");
    await expect(page.getByText("Valor Total del Inventario:")).toContainText(/9\.400,00/);
  });

  const invalidos = [
    ["sin cantidad", { cantidad: "" }, "La cantidad debe ser mayor a 0."],
    ["con cantidad 0", { cantidad: "0" }, "La cantidad debe ser mayor a 0."],
    ["sin monto", { monto: "" }, "El monto debe ser mayor a 0."],
    ["con monto 0", { monto: "0" }, "El monto debe ser mayor a 0."],
    ["sin proveedor", { proveedor: "" }, "Debe seleccionar un proveedor."],
    ["sin fecha", { fecha: "" }, "La fecha es obligatoria y debe tener el formato dd-mm-aaaa."],
    ["con fecha inválida", { fecha: "99-99-2026" }, "La fecha es obligatoria y debe tener el formato dd-mm-aaaa."],
  ];

  for (const [nombre, datos, mensaje] of invalidos) {
    test(`rechaza reponer ${nombre}`, async ({ page }) => {
      await abrir(page);
      await abrirReponer(page);
      const v = { cantidad: "4", monto: "2400", fecha: "12-11-2026", proveedor: "2", ...datos };
      await page.locator("#m-cant").fill(v.cantidad);
      await page.locator("#m-monto").fill(v.monto);
      await page.locator("#m-fecha").fill(v.fecha);
      if (v.proveedor) await page.locator("#m-prov").selectOption(v.proveedor);
      await guardar(page).click();
      await expect.poll(() => avisos.map((a) => a.mensaje)).toContain(mensaje);
      await expect(modal(page)).toHaveCount(1);
      expect(backend.enviados("POST", "/bienes-gasto/:id/reposicion")).toHaveLength(0);
    });
  }

  test("si el backend rechaza la reposición, avisa con su mensaje y el formulario sigue abierto", async ({ page }) => {
    await abrir(page, { preparar: (b) => b.fallar("POST /bienes-gasto/:id/reposicion", { status: 500, body: { mensaje: "No se pudo registrar la reposición" } }) });
    await abrirReponer(page);
    await page.locator("#m-cant").fill("4");
    await page.locator("#m-fecha").fill("12-11-2026");
    await page.locator("#m-prov").selectOption("2");
    await guardar(page).click();
    await expect.poll(() => avisos.map((a) => a.mensaje)).toContain("No se pudo registrar la reposición");
    await expect(modal(page)).toHaveCount(1);
  });
});

test.describe("Insumos: consumir", () => {
  const abrirConsumo = async (page, nombre = "Papel de ticket") => {
    await fila(page, nombre).getByRole("button", { name: "Consumir" }).click();
    await expect(modal(page).getByRole("heading", { name: "Registrar consumo" })).toBeVisible();
  };

  test("registra el consumo: envía los datos, baja la cantidad y el valor total", async ({ page }) => {
    await abrir(page);
    await abrirConsumo(page);
    await expect(modal(page)).toContainText("Consumiendo: Papel de ticket");
    await page.locator("#m-cant").fill("3");
    await page.locator("#m-fecha").fill("12-11-2026");
    await guardar(page).click();
    await expect(modal(page)).toHaveCount(0);
    expect(backend.enviados("POST", "/bienes-gasto/:id/consumo")).toEqual([{ cantidad: 3, motivo: "Consumo operativo", fecha: "2026-11-12" }]);
    await expect(fila(page, "Papel de ticket")).toContainText(/3\.500,00/);
    await expect(page.getByText("Valor Total del Inventario:")).toContainText(/5\.500,00/);
  });

  const invalidos = [
    ["sin cantidad", { cantidad: "" }, "La cantidad debe ser mayor a 0."],
    ["con cantidad 0", { cantidad: "0" }, "La cantidad debe ser mayor a 0."],
    ["con cantidad negativa", { cantidad: "-1" }, "La cantidad debe ser mayor a 0."],
    ["sin fecha", { fecha: "" }, "La fecha es obligatoria y debe tener el formato dd-mm-aaaa."],
    ["con fecha inválida", { fecha: "2026-11-12" }, "La fecha es obligatoria y debe tener el formato dd-mm-aaaa."],
  ];

  for (const [nombre, datos, mensaje] of invalidos) {
    test(`rechaza consumir ${nombre}`, async ({ page }) => {
      await abrir(page);
      await abrirConsumo(page);
      const v = { cantidad: "3", fecha: "12-11-2026", ...datos };
      await page.locator("#m-cant").fill(v.cantidad);
      await page.locator("#m-fecha").fill(v.fecha);
      await guardar(page).click();
      await expect.poll(() => avisos.map((a) => a.mensaje)).toContain(mensaje);
      await expect(modal(page)).toHaveCount(1);
      expect(backend.enviados("POST", "/bienes-gasto/:id/consumo")).toHaveLength(0);
    });
  }

  test("si se consume más de lo que hay, el backend lo rechaza y el aviso dice cuánto queda", async ({ page }) => {
    await abrir(page);
    await abrirConsumo(page);
    await page.locator("#m-cant").fill("50");
    await page.locator("#m-fecha").fill("12-11-2026");
    await guardar(page).click();
    await expect.poll(() => avisos.map((a) => a.mensaje)).toContain('No hay stock suficiente de "Papel de ticket" (stock actual: 10)');
    await expect(modal(page)).toHaveCount(1);
    await expect(guardar(page)).toBeEnabled();
    await expect(fila(page, "Papel de ticket")).toContainText("10");
  });
});

test.describe("Insumos: editar", () => {
  test("el botón Editar tiene que abrir un formulario con los datos del insumo", async ({ page }) => {
    await abrir(page);
    await fila(page, "Papel de ticket").getByTitle("Editar").click();
    // Hoy el botón solo avisa que "la API de edición todavía no está documentada" (editar() en insumos.js).
    await expect(modal(page)).toBeVisible();
    await expect(page.locator("#e-nombre, #m-nombre")).toHaveValue("Papel de ticket");
  });
});

test.describe("Insumos: acceso", () => {
  test("el Propietario también entra", async ({ page }) => {
    await abrir(page, { rol: "PROPIETARIO" });
    await expect(filas(page)).toHaveCount(2);
  });

  test("el menú lateral marca Insumos como la pantalla actual", async ({ page }) => {
    await abrir(page);
    await expect(page.getByTestId("menu-insumos")).toHaveAttribute("aria-current", "page");
  });

  test("el Cajero no ve el contenido de Insumos ni el link en el menú", async ({ page }) => {
    await abrir(page, { rol: "CAJERO" });
    await expect(page.locator("#insumos-pagina")).toBeHidden();
    await expect(page.getByTestId("menu-insumos")).toHaveCount(0);
  });

  // Como Gastos, Proveedores y Mi negocio: sin permiso para ver el módulo se vuelve al Panel y no se piden los datos al Backend.
  test("el Cajero que entra por la dirección vuelve al Panel y no pide los insumos", async ({ page }) => {
    await abrir(page, { rol: "CAJERO" });
    await expect(page).toHaveURL(/dashboard\.html$/);
    expect(backend.llamadas.some((l) => l.ruta === "/bienes-gasto")).toBe(false);
  });

  test("sin sesión iniciada manda al login", async ({ page }) => {
    await page.goto("/insumos.html");
    await expect(page).toHaveURL(/login\.html$/);
  });

  test("usar la pantalla de punta a punta no produce errores de JavaScript", async ({ page }) => {
    const errores = [];
    page.on("pageerror", (e) => errores.push(e.message));
    await abrir(page);
    await buscador(page).fill("papel");
    await fila(page, "Papel de ticket").getByTitle("Ocultar").click();
    await verOcultos(page).click();
    await page.getByRole("button", { name: "Restaurar" }).first().click();
    expect(errores).toEqual([]);
  });
});
