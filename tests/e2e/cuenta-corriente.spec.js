const { test, expect } = require("@playwright/test");
const { iniciarSesionComo } = require("./helpers");
const { simularPagos } = require("./backend-falso-pagos");

// Pantalla Cuenta corriente (cuenta-corriente.html). Usa el Backend (pagos-service): GET /pagos/cuentas-corrientes,
// GET /pagos?incluir_ocultos=true, GET /medios-pago, POST /pagos, PUT /pagos/<id>, PATCH /pagos/<id>/anular y
// PATCH /pagos/<id>/visibilidad. Se prueba contra el backend falso (backend-falso-pagos.js), que responde con el formato y las
// reglas del real. Los datos de ejemplo son:
//   Ventas:  00001-00000467 Sandra Quiroga            $ 4.260   sin pagos vigentes          -> Pendiente (deuda $ 4.260)
//            00001-00000460 Panadería La Espiga S.A.  $ 6.500   pagó $ 6.500 (Efectivo)     -> Saldada
//            00001-00000462 Almacén Don Pedro S.R.L.  $ 4.260   pagó $ 1.000 (Transferencia)-> Pendiente (deuda $ 3.260)
//            00001-00000470 Luis Gómez                $ 3.000   ANULADA
//   Pagos:   00000001 (venta 462, Transferencia, $ 1.000)  ·  00000002 (venta 460, Efectivo, $ 6.500)
//            00000003 (venta 467, Mercado Pago, $ 500): anulado y oculto, solo lo ve el Administrador en "Ver ocultos".
// Los avisos de error salen con alert(); los de éxito ("Pago registrado", "Pago anulado", ...) en un cartel que dura unos segundos.

// Los tests marcados como test.fixme dependen de errores de la pantalla que todavía no se arreglaron:
//  1. El formulario de pago no abre: cargarDatos lee los medios de pago de `.items`, pero el Backend los manda en `.medios_pago`
//     (da "mediosPago.forEach is not a function"). Afecta a todos los tests que abren Registrar pago, + Pagar o Editar.
//  2. El botón "Cerrar" del detalle de una venta no hace nada (solo funciona la cruz).
//  3. El formulario ofrece también las ventas saldadas y las anuladas, que el Backend rechaza.
//  4. El saldo que queda no se recalcula al elegir otra venta.
//  5. Sin conexión, el aviso dice "Failed to fetch" en lugar de "No se pudo conectar con el servidor."
// Cuando se arreglen, se les saca el .fixme.

let backend;
let avisos;

const abrir = async (page, { rol = "ADMIN", ahora = null, semilla, preparar } = {}) => {
  avisos = [];
  page.on("dialog", async (dialogo) => {
    avisos.push(dialogo.message());
    await dialogo.accept();
  });
  if (ahora) await page.clock.setFixedTime(ahora);
  backend = await simularPagos(page, { rol, semilla });
  preparar?.(backend);
  await iniciarSesionComo(page, rol);
  await page.goto("/cuenta-corriente.html");
  await expect(page.getByRole("heading", { name: "Cuenta corriente", level: 1 })).toBeVisible();
};

const filas = (page) => page.locator("#cc-tabla-container tbody tr");
const fila = (page, texto) => filas(page).filter({ hasText: texto });
const pestania = (page, nombre) => page.locator(".cc-tab", { hasText: nombre });
const buscador = (page) => page.locator(".cc-buscador");
const filtroEstado = (page) => page.locator(".cc-filtro");
const modal = (page) => page.locator(".cc-modal");
const cartel = (page, texto) => page.getByText(texto, { exact: true });

const VENTA_PENDIENTE = "00001-00000467";
const VENTA_SALDADA = "00001-00000460";
const VENTA_PARCIAL = "00001-00000462";
const VENTA_ANULADA = "00001-00000470";

const irAPagos = async (page) => {
  await pestania(page, "Pagos").click();
  await expect(pestania(page, "Pagos")).toHaveClass(/activa/);
};

test.describe("Cuenta corriente: ventas", () => {
  test("muestra el título, las pestañas (Ventas activa) y las columnas", async ({ page }) => {
    await abrir(page);
    await expect(pestania(page, "Ventas")).toHaveClass(/activa/);
    await expect(pestania(page, "Pagos")).not.toHaveClass(/activa/);
    await expect(page.locator("#cc-tabla-container thead th")).toHaveText(["N° de venta", "Cliente", "Fecha y hora", "Total", "Pagado", "Saldo", "Estado", "Acciones"]);
    await expect(filas(page)).toHaveCount(4);
    await expect(page.getByRole("button", { name: "Registrar pago" }).first()).toBeVisible();
  });

  test("pide al backend las ventas, los pagos (con los ocultos) y los medios de pago", async ({ page }) => {
    await abrir(page);
    await expect(filas(page)).toHaveCount(4);
    expect(backend.enviados("GET", "/pagos/cuentas-corrientes")).toHaveLength(1);
    expect(backend.consultas("GET", "/pagos")).toEqual([{ incluir_ocultos: "true" }]);
    expect(backend.enviados("GET", "/medios-pago")).toHaveLength(1);
  });

  test("una venta pendiente muestra su deuda y el estado Pendiente", async ({ page }) => {
    await abrir(page);
    const venta = fila(page, VENTA_PENDIENTE);
    await expect(venta).toContainText("Sandra Quiroga");
    await expect(venta).toContainText("03-11-2026");
    await expect(venta).toContainText(/4\.260,00/);
    await expect(venta).toContainText("Deuda");
    await expect(venta).toContainText("Pendiente");
  });

  test("una venta con pago parcial muestra lo pagado y lo que falta", async ({ page }) => {
    await abrir(page);
    const venta = fila(page, VENTA_PARCIAL);
    await expect(venta).toContainText(/1\.000,00/); // pagado
    await expect(venta).toContainText(/3\.260,00/); // saldo
    await expect(venta).toContainText("Deuda");
    await expect(venta).toContainText("Pendiente");
  });

  test("una venta saldada muestra $ 0,00 de saldo, el estado Saldada y '+ Pagar' deshabilitado con su motivo", async ({ page }) => {
    await abrir(page);
    const venta = fila(page, VENTA_SALDADA);
    await expect(venta).toContainText("Saldada");
    await expect(venta.locator(".saldo-monto")).toHaveText(/0,00/);
    const pagar = venta.getByRole("button", { name: "+ Pagar" });
    await expect(pagar).toBeDisabled();
    await expect(pagar).toHaveAttribute("title", "Venta saldada: no admite más pagos");
  });

  test("una venta anulada muestra 'Venta anulada', sin pagado ni saldo, y no se puede pagar", async ({ page }) => {
    await abrir(page);
    const venta = fila(page, VENTA_ANULADA);
    await expect(venta).toContainText("Anulada");
    await expect(venta.locator(".saldo-label")).toHaveText("Venta anulada");
    await expect(venta.locator(".saldo-monto")).toHaveText("—");
    const pagar = venta.getByRole("button", { name: "+ Pagar" });
    await expect(pagar).toBeDisabled();
    await expect(pagar).toHaveAttribute("title", "Venta anulada: no se puede pagar");
  });

  test("'+ Pagar' está habilitado en las ventas con deuda", async ({ page }) => {
    await abrir(page);
    await expect(fila(page, VENTA_PENDIENTE).getByRole("button", { name: "+ Pagar" })).toBeEnabled();
    await expect(fila(page, VENTA_PARCIAL).getByRole("button", { name: "+ Pagar" })).toBeEnabled();
  });

  test("si lo pagado supera el total, la venta figura Saldada con saldo a favor", async ({ page }) => {
    await abrir(page, { semilla: (e) => e.pagos.push({ id: 9, venta_id: 467, medio_pago_id: 1, monto: 4500, fecha_pago: "2026-11-04T15:00:00+00:00", estado: "ACTIVO", oculto: false, creado_por: "admin1" }) });
    const venta = fila(page, VENTA_PENDIENTE);
    await expect(venta.locator(".saldo-label")).toHaveText("Saldo a favor");
    await expect(venta.locator(".saldo-monto")).toHaveText(/240,00/);
    await expect(venta).toContainText("Saldada");
  });

  test("el buscador encuentra por cliente y por número de venta, sin distinguir mayúsculas", async ({ page }) => {
    await abrir(page);
    await buscador(page).fill("PANADERÍA");
    await expect(filas(page)).toHaveCount(1);
    await expect(fila(page, VENTA_SALDADA)).toBeVisible();
    await buscador(page).fill("0000462");
    await expect(filas(page)).toHaveCount(1);
    await expect(fila(page, "Almacén Don Pedro")).toBeVisible();
    await buscador(page).fill("zzzz");
    await expect(page.getByText("Sin ventas", { exact: true })).toBeVisible();
    await buscador(page).fill("");
    await expect(filas(page)).toHaveCount(4);
  });

  test("el filtro de estado tiene Todas, Pendientes, Saldadas y Anuladas y filtra", async ({ page }) => {
    await abrir(page);
    await expect(filtroEstado(page).locator("option")).toHaveText(["Todas", "Pendientes", "Saldadas", "Anuladas"]);
    await filtroEstado(page).selectOption("pendiente");
    await expect(filas(page)).toHaveCount(2);
    await filtroEstado(page).selectOption("saldada");
    await expect(filas(page)).toHaveCount(1);
    await expect(fila(page, VENTA_SALDADA)).toBeVisible();
    await filtroEstado(page).selectOption("anulada");
    await expect(filas(page)).toHaveCount(1);
    await expect(fila(page, VENTA_ANULADA)).toBeVisible();
    await filtroEstado(page).selectOption("todas");
    await expect(filas(page)).toHaveCount(4);
  });

  test("el buscador y el filtro de estado se combinan", async ({ page }) => {
    await abrir(page);
    await filtroEstado(page).selectOption("pendiente");
    await buscador(page).fill("sandra");
    await expect(filas(page)).toHaveCount(1);
    await filtroEstado(page).selectOption("saldada");
    await expect(page.getByText("Sin ventas", { exact: true })).toBeVisible();
  });

  test("sin ventas a cuenta corriente dice 'Sin ventas'", async ({ page }) => {
    await abrir(page, { semilla: (e) => ((e.ventas = []), (e.pagos = [])) });
    await expect(page.getByText("Sin ventas", { exact: true })).toBeVisible();
  });

  test("mientras llegan los datos muestra 'Actualizando saldos...'", async ({ page }) => {
    await abrir(page, { preparar: (b) => b.demorar("GET /pagos/cuentas-corrientes", 800) });
    await expect(page.getByText("Actualizando saldos...")).toBeVisible();
    await expect(filas(page)).toHaveCount(4);
  });

  test("un nombre de cliente con código HTML se muestra como texto y no se ejecuta", async ({ page }) => {
    const peligroso = '<img src=x onerror="window.__xss=1">Collar';
    await abrir(page, { semilla: (e) => (e.ventas[0].cliente_nombre = peligroso) });
    await expect(filas(page)).toHaveCount(4);
    await expect(page.locator("#cc-tabla-container")).toContainText(peligroso);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  });
});

test.describe("Cuenta corriente: errores al cargar", () => {
  const MENSAJE = "Error al cargar los datos. Verificá la conexión.";

  test("si falla el pedido de las ventas, lo avisa", async ({ page }) => {
    await abrir(page, { preparar: (b) => b.fallar("GET /pagos/cuentas-corrientes", { status: 500, body: { mensaje: "Error interno del servidor" } }) });
    await expect(page.getByText(MENSAJE)).toBeVisible();
  });

  test("si falla el pedido de los pagos, lo avisa", async ({ page }) => {
    await abrir(page, { preparar: (b) => b.fallar("GET /pagos", { status: 500, body: { mensaje: "Error interno del servidor" } }) });
    await expect(page.getByText(MENSAJE)).toBeVisible();
  });

  test("si falla el pedido de los medios de pago, lo avisa", async ({ page }) => {
    await abrir(page, { preparar: (b) => b.fallar("GET /medios-pago", { status: 500, body: { mensaje: "Error interno del servidor" } }) });
    await expect(page.getByText(MENSAJE)).toBeVisible();
  });

  test("sin conexión también lo avisa", async ({ page }) => {
    await abrir(page, { preparar: (b) => b.fallar("GET /pagos/cuentas-corrientes", { abortar: true }) });
    await expect(page.getByText(MENSAJE)).toBeVisible();
  });
});

test.describe("Cuenta corriente: detalle de una venta", () => {
  const abrirDetalle = async (page, numero) => {
    await fila(page, numero).getByTitle("Ver detalle").click();
    await expect(modal(page)).toBeVisible();
  };

  test("muestra el cliente, el estado, los datos, el saldo y la nota de que lo calcula el sistema", async ({ page }) => {
    await abrir(page);
    await abrirDetalle(page, VENTA_PARCIAL);
    await expect(modal(page).getByRole("heading", { name: `Venta ${VENTA_PARCIAL}` })).toBeVisible();
    await expect(modal(page)).toContainText("Almacén Don Pedro S.R.L.");
    await expect(modal(page)).toContainText("Pendiente");
    await expect(modal(page)).toContainText("Cuenta Corriente");
    await expect(modal(page)).toContainText("20-10-2026");
    await expect(modal(page)).toContainText("Total de la venta");
    await expect(modal(page)).toContainText(/4\.260,00/);
    await expect(modal(page)).toContainText(/1\.000,00/);
    await expect(modal(page)).toContainText(/3\.260,00/);
    await expect(modal(page)).toContainText("Deuda");
    await expect(modal(page)).toContainText("El saldo y el estado los calcula el sistema: no se pueden editar.");
  });

  test("lista los productos reales de la venta con precio, cantidad y subtotal", async ({ page }) => {
    await abrir(page);
    await abrirDetalle(page, VENTA_PARCIAL);
    await expect(modal(page).getByText("Productos vendidos")).toBeVisible();
    const sifon = modal(page).locator("tr", { hasText: "Sifón de soda" });
    await expect(sifon).toContainText(/1\.200,00/);
    await expect(sifon).toContainText("1");
    const lavandina = modal(page).locator("tr", { hasText: "Lavandina 1 l" });
    await expect(lavandina).toContainText(/1\.530,00/);
    await expect(lavandina).toContainText("2");
    await expect(lavandina).toContainText(/3\.060,00/);
    await expect(modal(page)).not.toContainText("Producto de Ejemplo");
  });

  test("una venta sin detalle de productos avisa que no hay", async ({ page }) => {
    await abrir(page);
    await abrirDetalle(page, VENTA_ANULADA);
    await expect(modal(page)).toContainText("No hay detalle de productos disponible.");
  });

  test("lista los pagos de esa venta con su medio y estado", async ({ page }) => {
    await abrir(page);
    await abrirDetalle(page, VENTA_PARCIAL);
    await expect(modal(page)).toContainText("00000001");
    await expect(modal(page)).toContainText("Transferencia");
    await expect(modal(page)).toContainText("Vigente");
  });

  test("un pago anulado (y no oculto) figura como Anulado", async ({ page }) => {
    await abrir(page, { semilla: (e) => (e.pagos[2].oculto = false) });
    await abrirDetalle(page, VENTA_PENDIENTE);
    await expect(modal(page)).toContainText("00000003");
    await expect(modal(page)).toContainText("Anulado");
  });

  test("una venta sin pagos visibles dice 'Todavía no tiene pagos'", async ({ page }) => {
    await abrir(page);
    await abrirDetalle(page, VENTA_PENDIENTE);
    await expect(modal(page)).toContainText("Todavía no tiene pagos");
    await expect(modal(page)).not.toContainText("00000003");
  });

  test("en una venta saldada el saldo dice 'Saldada' y 'Registrar pago' está deshabilitado", async ({ page }) => {
    await abrir(page);
    await abrirDetalle(page, VENTA_SALDADA);
    await expect(modal(page).locator(".detalle-cuadro").last()).toContainText("Saldada");
    await expect(modal(page).getByRole("button", { name: "Registrar pago" })).toBeDisabled();
  });

  test("en una venta anulada 'Registrar pago' está deshabilitado", async ({ page }) => {
    await abrir(page);
    await abrirDetalle(page, VENTA_ANULADA);
    await expect(modal(page)).toContainText("Anulada");
    await expect(modal(page).getByRole("button", { name: "Registrar pago" })).toBeDisabled();
  });

  test("con lo pagado por encima del total, el saldo se muestra como saldo a favor", async ({ page }) => {
    await abrir(page, { semilla: (e) => e.pagos.push({ id: 9, venta_id: 467, medio_pago_id: 1, monto: 4500, fecha_pago: "2026-11-04T15:00:00+00:00", estado: "ACTIVO", oculto: false, creado_por: "admin1" }) });
    await abrirDetalle(page, VENTA_PENDIENTE);
    const saldo = modal(page).locator(".detalle-cuadro").last();
    await expect(saldo).toContainText(/240,00/);
    await expect(saldo).toContainText("Saldo a favor");
  });

  test.fixme("'Cerrar' y la cruz cierran el detalle", async ({ page }) => {
    await abrir(page);
    await abrirDetalle(page, VENTA_PARCIAL);
    await modal(page).getByRole("button", { name: "Cerrar" }).click();
    await expect(modal(page)).toHaveCount(0);
    await abrirDetalle(page, VENTA_PARCIAL);
    await modal(page).getByRole("button", { name: "×" }).click();
    await expect(modal(page)).toHaveCount(0);
  });

  test.fixme("'Registrar pago' del detalle abre el formulario con esa venta elegida y su deuda como monto", async ({ page }) => {
    await abrir(page);
    await abrirDetalle(page, VENTA_PARCIAL);
    await modal(page).getByRole("button", { name: "Registrar pago" }).click();
    await expect(modal(page).getByRole("heading", { name: "Registrar pago" })).toBeVisible();
    await expect(page.locator("#cc-pago-venta option:checked")).toHaveText(new RegExp(VENTA_PARCIAL));
    await expect(page.locator("#cc-pago-monto")).toHaveValue("3260.00");
  });
});

test.describe("Cuenta corriente: registrar pago", () => {
  const abrirFormulario = async (page) => {
    await page.getByRole("button", { name: "Registrar pago" }).first().click();
    await expect(modal(page).getByRole("heading", { name: "Registrar pago" })).toBeVisible();
  };
  const guardar = (page) => modal(page).getByRole("button", { name: /^Guard/ });

  // Completa el formulario (por defecto, un pago de $ 500 de la venta 462 en efectivo).
  const llenar = async (page, datos = {}) => {
    const v = { venta: "462", monto: "500", medio: "Efectivo", fecha: "15-11-2026", hora: "10:00", ...datos };
    if (v.venta) await page.locator("#cc-pago-venta").selectOption(v.venta);
    await page.locator("#cc-pago-monto").fill(v.monto);
    if (v.medio) await page.locator("#cc-pago-medio").selectOption({ label: v.medio });
    await page.locator("#cc-pago-fecha").fill(v.fecha);
    await page.locator("#cc-pago-hora").fill(v.hora);
  };

  test.fixme("el formulario general ofrece los medios de pago y la fecha y hora de hoy", async ({ page }) => {
    await abrir(page, { ahora: new Date("2026-11-15T14:30:00") });
    await abrirFormulario(page);
    await expect(page.locator("#cc-pago-medio option")).toHaveText(["Elegí una opción", "Efectivo", "Transferencia", "Tarjeta Débito", "Mercado Pago"]);
    await expect(page.locator("#cc-pago-fecha")).toHaveValue("15-11-2026");
    await expect(page.locator("#cc-pago-hora")).toHaveValue("14:30");
  });

  test.fixme("la fecha y la hora por defecto de un día de un solo dígito mantienen los dos dígitos", async ({ page }) => {
    await abrir(page, { ahora: new Date("2026-11-05T09:07:00") });
    await abrirFormulario(page);
    await expect(page.locator("#cc-pago-fecha")).toHaveValue("05-11-2026");
    await expect(page.locator("#cc-pago-hora")).toHaveValue("09:07");
  });

  test.fixme("el desplegable de ventas ofrece solo las ventas que se pueden pagar (con deuda y no anuladas)", async ({ page }) => {
    await abrir(page);
    await abrirFormulario(page);
    await expect(page.locator("#cc-pago-venta option")).toHaveText(["Elegí una venta", `${VENTA_PENDIENTE} · Sandra Quiroga`, `${VENTA_PARCIAL} · Almacén Don Pedro S.R.L.`]);
  });

  test.fixme("al elegir una venta y escribir el monto muestra el saldo que queda", async ({ page }) => {
    await abrir(page);
    await abrirFormulario(page);
    await page.locator("#cc-pago-venta").selectOption("462");
    await page.locator("#cc-pago-monto").fill("1000");
    await expect(modal(page)).toContainText(/Saldo después del pago: .*2\.260,00.* \(deuda\)/);
    await page.locator("#cc-pago-monto").fill("3260");
    await expect(modal(page)).toContainText("Saldo después del pago: $ 0,00 (saldada)");
    await page.locator("#cc-pago-monto").fill("4000");
    await expect(modal(page)).toContainText(/Saldo después del pago: .*740,00.* \(saldo a favor\)/);
  });

  test.fixme("al elegir otra venta, el saldo que queda se recalcula con esa venta", async ({ page }) => {
    await abrir(page);
    await abrirFormulario(page);
    await page.locator("#cc-pago-venta").selectOption("462");
    await page.locator("#cc-pago-monto").fill("1000");
    await expect(modal(page)).toContainText(/Saldo después del pago: .*2\.260,00.* \(deuda\)/);
    await page.locator("#cc-pago-venta").selectOption("467");
    await expect(modal(page)).toContainText(/Saldo después del pago: .*3\.260,00.* \(deuda\)/);
  });

  test.fixme("guardar vacío avisa qué falta y no cierra el formulario", async ({ page }) => {
    await abrir(page);
    await abrirFormulario(page);
    await guardar(page).click();
    await expect(page.locator(".cc-aviso.error")).toHaveText("Revisá estos datos: venta, monto abonado, medio de pago, fecha y hora.");
    await expect(page.locator(".cc-aviso.error")).toBeVisible();
    await expect(modal(page)).toHaveCount(1);
    expect(backend.enviados("POST", "/pagos")).toHaveLength(0);
    expect(avisos).toEqual([]);
  });

  const incompletos = [
    ["sin venta", { venta: "" }],
    ["sin monto", { monto: "" }],
    ["con monto 0", { monto: "0" }],
    ["con monto negativo", { monto: "-5" }],
    ["sin medio de pago", { medio: "" }],
    ["sin fecha", { fecha: "" }],
    ["sin hora", { hora: "" }],
  ];

  for (const [nombre, datos] of incompletos) {
    test.fixme(`no guarda ${nombre}`, async ({ page }) => {
      await abrir(page);
      await abrirFormulario(page);
      await llenar(page, datos);
      await guardar(page).click();
      await expect(page.locator(".cc-aviso.error")).toBeVisible();
      await expect(modal(page)).toHaveCount(1);
      expect(backend.enviados("POST", "/pagos")).toHaveLength(0);
      expect(avisos).toEqual([]);
    });
  }

  test.fixme("con todo completo guarda, cierra el formulario, avisa y actualiza la venta", async ({ page }) => {
    await abrir(page);
    await abrirFormulario(page);
    await llenar(page);
    await guardar(page).click();
    await expect(modal(page)).toHaveCount(0);
    await expect(cartel(page, "Pago registrado")).toBeVisible();
    expect(backend.enviados("POST", "/pagos")).toEqual([{ venta_id: 462, medio_pago_id: 1, monto: 500, fecha_pago: "2026-11-15 10:00:00" }]);
    const venta = fila(page, VENTA_PARCIAL);
    await expect(venta).toContainText(/1\.500,00/); // pagado
    await expect(venta).toContainText(/2\.760,00/); // saldo
    expect(avisos).toEqual([]);
  });

  test.fixme("el pago nuevo aparece en la pestaña Pagos", async ({ page }) => {
    await abrir(page);
    await abrirFormulario(page);
    await llenar(page, { medio: "Mercado Pago" });
    await guardar(page).click();
    await expect(modal(page)).toHaveCount(0);
    await irAPagos(page);
    await expect(filas(page)).toHaveCount(3);
    await expect(filas(page).first()).toContainText("Mercado Pago");
  });

  test.fixme("pagar de más: el excedente queda como saldo a favor y la venta pasa a Saldada", async ({ page }) => {
    await abrir(page);
    await abrirFormulario(page);
    await llenar(page, { monto: "4000" });
    await guardar(page).click();
    await expect(modal(page)).toHaveCount(0);
    const venta = fila(page, VENTA_PARCIAL);
    await expect(venta.locator(".saldo-label")).toHaveText("Saldo a favor");
    await expect(venta.locator(".saldo-monto")).toHaveText(/740,00/);
    await expect(venta).toContainText("Saldada");
  });

  test.fixme("mientras guarda el botón dice 'Guardando...' y queda deshabilitado", async ({ page }) => {
    await abrir(page, { preparar: (b) => b.demorar("POST /pagos", 1500) });
    await abrirFormulario(page);
    await llenar(page);
    await guardar(page).click();
    await expect(guardar(page)).toBeDisabled();
    await expect(guardar(page)).toHaveText("Guardando...");
  });

  test.fixme("un doble clic en Guardar no registra el pago dos veces", async ({ page }) => {
    await abrir(page, { preparar: (b) => b.demorar("POST /pagos", 800) });
    await abrirFormulario(page);
    await llenar(page);
    await guardar(page).evaluate((boton) => {
      boton.click();
      boton.click();
    });
    await expect(modal(page)).toHaveCount(0);
    expect(backend.enviados("POST", "/pagos")).toHaveLength(1);
  });

  test.fixme("si el backend rechaza el pago, avisa con su mensaje y el formulario sigue abierto", async ({ page }) => {
    await abrir(page, { preparar: (b) => b.fallar("POST /pagos", { status: 409, body: { status: "error", mensaje: "Esta venta ya se encuentra completamente saldada" } }) });
    await abrirFormulario(page);
    await llenar(page);
    await guardar(page).click();
    await expect.poll(() => avisos).toEqual(["Esta venta ya se encuentra completamente saldada"]);
    await expect(modal(page)).toHaveCount(1);
    await expect(guardar(page)).toBeEnabled();
    await expect(guardar(page)).toHaveText("Guardar");
  });

  test.fixme("una fecha futura la rechaza el backend y se avisa", async ({ page }) => {
    await abrir(page);
    await abrirFormulario(page);
    await llenar(page, { fecha: "01-01-2099" });
    await guardar(page).click();
    await expect.poll(() => avisos).toEqual(["La fecha de pago no puede ser posterior a la fecha actual"]);
    await expect(modal(page)).toHaveCount(1);
  });

  test.fixme("una fecha anterior a la venta la rechaza el backend y se avisa", async ({ page }) => {
    await abrir(page);
    await abrirFormulario(page);
    await llenar(page, { fecha: "19-10-2026", hora: "10:00" });
    await guardar(page).click();
    await expect.poll(() => avisos).toEqual(["La fecha y hora del pago no pueden ser anteriores a las de la venta (20-10-2026 12:00)"]);
    await expect(modal(page)).toHaveCount(1);
    await expect(guardar(page)).toBeEnabled();
  });

  test.fixme("una fecha mal escrita la rechaza el backend y se avisa", async ({ page }) => {
    await abrir(page);
    await abrirFormulario(page);
    await llenar(page, { fecha: "15/11/2026" });
    await guardar(page).click();
    await expect.poll(() => avisos).toEqual(["Formato de fecha inválido. Use dd-mm-aaaa hh:mm o ISO 8601"]);
    await expect(modal(page)).toHaveCount(1);
    await expect(guardar(page)).toBeEnabled();
  });

  test.fixme("sin conexión avisa en castellano que no se pudo conectar", async ({ page }) => {
    await abrir(page, { preparar: (b) => b.fallar("POST /pagos", { abortar: true }) });
    await abrirFormulario(page);
    await llenar(page);
    await guardar(page).click();
    await expect.poll(() => avisos).toEqual(["No se pudo conectar con el servidor."]);
  });

  test.fixme("'+ Pagar' de una venta abre el formulario con la venta fija y su deuda como monto", async ({ page }) => {
    await abrir(page);
    await fila(page, VENTA_PENDIENTE).getByRole("button", { name: "+ Pagar" }).click();
    await expect(page.locator("#cc-pago-venta")).toBeDisabled();
    await expect(page.locator("#cc-pago-venta option:checked")).toHaveText(new RegExp(VENTA_PENDIENTE));
    await expect(page.locator("#cc-pago-monto")).toHaveValue("4260.00");
    await expect(modal(page)).toContainText("Saldo después del pago: $ 0,00 (saldada)");
  });

  test.fixme("con la venta fija se guarda sin elegir venta y se envía el id de esa venta", async ({ page }) => {
    await abrir(page);
    await fila(page, VENTA_PENDIENTE).getByRole("button", { name: "+ Pagar" }).click();
    await page.locator("#cc-pago-medio").selectOption({ label: "Transferencia" });
    await page.locator("#cc-pago-fecha").fill("10-11-2026");
    await page.locator("#cc-pago-hora").fill("11:00");
    await guardar(page).click();
    await expect(modal(page)).toHaveCount(0);
    expect(backend.enviados("POST", "/pagos")).toEqual([{ venta_id: 467, medio_pago_id: 2, monto: 4260, fecha_pago: "2026-11-10 11:00:00" }]);
    await expect(fila(page, VENTA_PENDIENTE)).toContainText("Saldada");
  });

  test.fixme("Cancelar y la cruz cierran el formulario sin guardar", async ({ page }) => {
    await abrir(page);
    await abrirFormulario(page);
    await modal(page).getByRole("button", { name: "Cancelar" }).click();
    await expect(modal(page)).toHaveCount(0);
    await abrirFormulario(page);
    await modal(page).getByRole("button", { name: "×" }).click();
    await expect(modal(page)).toHaveCount(0);
    expect(backend.enviados("POST", "/pagos")).toHaveLength(0);
    expect(avisos).toEqual([]);
  });

  test.fixme("si hay datos cargados, al cerrar pregunta si se descartan; 'Seguir editando' conserva lo escrito", async ({ page }) => {
    await abrir(page);
    await abrirFormulario(page);
    await page.locator("#cc-pago-monto").fill("123");
    await modal(page).getByRole("button", { name: "Cancelar" }).click();
    const descarte = modal(page).filter({ hasText: "Hay datos sin guardar" });
    await expect(descarte).toBeVisible();
    await expect(descarte).toContainText("Si cerrás ahora, se pierde lo que cargaste. ¿Querés descartarlo?");
    await descarte.getByRole("button", { name: "Seguir editando" }).click();
    await expect(page.locator("#cc-pago-monto")).toHaveValue("123");
    await modal(page).getByRole("button", { name: "Cancelar" }).click();
    await modal(page).filter({ hasText: "Hay datos sin guardar" }).getByRole("button", { name: "Descartar" }).click();
    await expect(modal(page)).toHaveCount(0);
  });
});

test.describe("Cuenta corriente: pagos", () => {
  test("la pestaña Pagos muestra las columnas y los pagos vigentes con su estado", async ({ page }) => {
    await abrir(page);
    await irAPagos(page);
    await expect(page.locator("#cc-tabla-container thead th")).toHaveText(["N° de pago", "N° de venta", "Cliente", "Fecha y hora", "Medio de pago", "Monto", "Estado", "Acciones"]);
    await expect(filas(page)).toHaveCount(2);
    const pago = fila(page, "00000001");
    await expect(pago).toContainText(VENTA_PARCIAL);
    await expect(pago).toContainText("Almacén Don Pedro S.R.L.");
    await expect(pago).toContainText("21-10-2026");
    await expect(pago).toContainText("Transferencia");
    await expect(pago).toContainText(/1\.000,00/);
    await expect(pago).toContainText("Vigente");
    await expect(buscador(page)).toHaveAttribute("placeholder", "Buscar por cliente, N° de venta o N° de pago...");
  });

  test("los pagos más recientes van primero", async ({ page }) => {
    await abrir(page);
    await irAPagos(page);
    await expect(filas(page).first()).toContainText("00000001"); // 21-10-2026, después del 16-10-2026
    await expect(filas(page).last()).toContainText("00000002");
  });

  test("el buscador de pagos encuentra por cliente, venta o número de pago", async ({ page }) => {
    await abrir(page);
    await irAPagos(page);
    await buscador(page).fill("panadería");
    await expect(filas(page)).toHaveCount(1);
    await buscador(page).fill("0000462");
    await expect(filas(page)).toHaveCount(1);
    await buscador(page).fill("00000002");
    await expect(filas(page)).toHaveCount(1);
    await expect(fila(page, VENTA_SALDADA)).toBeVisible();
    await buscador(page).fill("zzzz");
    await expect(page.getByText("Sin pagos", { exact: true })).toBeVisible();
  });

  test("al cambiar de pestaña se vuelve a la lista de ventas y se vacía la búsqueda", async ({ page }) => {
    await abrir(page);
    await irAPagos(page);
    await buscador(page).fill("panadería");
    await pestania(page, "Ventas").click();
    await expect(filas(page)).toHaveCount(4);
    await expect(buscador(page)).toHaveValue("");
  });

  test("sin pagos dice 'Sin pagos'", async ({ page }) => {
    await abrir(page, { semilla: (e) => (e.pagos = []) });
    await irAPagos(page);
    await expect(page.getByText("Sin pagos", { exact: true })).toBeVisible();
  });

  test("cada pago vigente se puede editar, anular y ocultar", async ({ page }) => {
    await abrir(page);
    await irAPagos(page);
    const pago = fila(page, "00000001");
    await expect(pago.getByTitle("Editar")).toBeVisible();
    await expect(pago.getByTitle("Anular")).toBeVisible();
    await expect(pago.getByTitle("Ocultar")).toBeVisible();
  });

  test("un pago anulado figura como Anulado y no se puede editar ni anular", async ({ page }) => {
    await abrir(page, { semilla: (e) => (e.pagos[2].oculto = false) });
    await irAPagos(page);
    const pago = fila(page, "00000003");
    await expect(pago).toContainText("Anulado");
    await expect(pago.getByTitle("Editar")).toHaveCount(0);
    await expect(pago.getByTitle("Anular")).toHaveCount(0);
    await expect(pago.getByTitle("Ocultar")).toBeVisible();
  });

  test.fixme("editar abre el formulario con los datos del pago", async ({ page }) => {
    await abrir(page);
    await irAPagos(page);
    await fila(page, "00000001").getByTitle("Editar").click();
    await expect(modal(page).getByRole("heading", { name: "Editar pago 00000001" })).toBeVisible();
    await expect(page.locator("#cc-pago-venta option:checked")).toHaveText(new RegExp(VENTA_PARCIAL));
    await expect(page.locator("#cc-pago-monto")).toHaveValue("1000");
    await expect(page.locator("#cc-pago-medio option:checked")).toHaveText("Transferencia");
    await expect(page.locator("#cc-pago-fecha")).toHaveValue("21-10-2026");
  });

  test.fixme("al editar, el saldo que se muestra cuenta como si el pago todavía no estuviera", async ({ page }) => {
    await abrir(page);
    await irAPagos(page);
    await fila(page, "00000001").getByTitle("Editar").click();
    await expect(modal(page)).toContainText(/Saldo después del pago: .*3\.260,00.* \(deuda\)/);
    await page.locator("#cc-pago-monto").fill("4260");
    await expect(modal(page)).toContainText("Saldo después del pago: $ 0,00 (saldada)");
  });

  test.fixme("guardar la edición envía PUT, avisa y actualiza la lista y la venta", async ({ page }) => {
    await abrir(page);
    await irAPagos(page);
    await fila(page, "00000001").getByTitle("Editar").click();
    await page.locator("#cc-pago-monto").fill("2000");
    await modal(page).getByRole("button", { name: "Guardar" }).click();
    await expect(modal(page)).toHaveCount(0);
    await expect(cartel(page, "Pago 00000001 actualizado")).toBeVisible();
    const enviado = backend.enviados("PUT", "/pagos/:id");
    expect(enviado).toHaveLength(1);
    expect(enviado[0]).toMatchObject({ venta_id: 462, medio_pago_id: 2, monto: 2000 });
    expect(backend.llamadas.find((l) => l.metodo === "PUT").ruta).toBe("/pagos/1");
    await expect(fila(page, "00000001")).toContainText(/2\.000,00/);
    await pestania(page, "Ventas").click();
    await expect(fila(page, VENTA_PARCIAL)).toContainText(/2\.260,00/);
  });

  test.fixme("si el backend rechaza la edición, avisa y el formulario sigue abierto", async ({ page }) => {
    await abrir(page, { preparar: (b) => b.fallar("PUT /pagos/:id", { status: 409, body: { status: "error", mensaje: "No se puede editar un pago anulado" } }) });
    await irAPagos(page);
    await fila(page, "00000001").getByTitle("Editar").click();
    await modal(page).getByRole("button", { name: "Guardar" }).click();
    await expect.poll(() => avisos).toEqual(["No se puede editar un pago anulado"]);
    await expect(modal(page)).toHaveCount(1);
  });

  test("anular pide confirmación con el aviso del saldo, anula el pago y sube la deuda de la venta", async ({ page }) => {
    await abrir(page);
    await irAPagos(page);
    await fila(page, "00000001").getByTitle("Anular").click();
    await expect(modal(page).getByRole("heading", { name: "Anular pago" })).toBeVisible();
    await expect(modal(page)).toContainText(/¿Anular el pago 00000001 de .*1\.000,00\?/);
    await expect(modal(page)).toContainText("El saldo de la venta volverá a subir. El pago conserva su número y se excluye de los reportes.");
    await expect(modal(page)).toContainText("Esta acción no se puede deshacer. Los pagos no se eliminan: se anulan.");
    await modal(page).getByRole("button", { name: "Anular pago" }).click();
    await expect(modal(page)).toHaveCount(0);
    await expect(cartel(page, "Pago 00000001 anulado")).toBeVisible();
    expect(backend.llamadas.find((l) => l.metodo === "PATCH").ruta).toBe("/pagos/1/anular");
    await expect(fila(page, "00000001")).toContainText("Anulado");
    await expect(fila(page, "00000001").getByTitle("Anular")).toHaveCount(0);
    await pestania(page, "Ventas").click();
    await expect(fila(page, VENTA_PARCIAL)).toContainText(/4\.260,00/); // la deuda vuelve al total
  });

  test("cancelar la anulación no cambia nada", async ({ page }) => {
    await abrir(page);
    await irAPagos(page);
    await fila(page, "00000001").getByTitle("Anular").click();
    await modal(page).getByRole("button", { name: "Cancelar" }).click();
    await expect(modal(page)).toHaveCount(0);
    expect(backend.enviados("PATCH", "/pagos/:id/anular")).toHaveLength(0);
    expect(avisos).toEqual([]);
  });

  test("si el backend rechaza la anulación, avisa y el pago sigue vigente", async ({ page }) => {
    await abrir(page, { preparar: (b) => b.fallar("PATCH /pagos/:id/anular", { status: 409, body: { status: "error", mensaje: "No se puede anular el pago porque el saldo a favor generado ya fue utilizado en otra venta" } }) });
    await irAPagos(page);
    await fila(page, "00000001").getByTitle("Anular").click();
    await modal(page).getByRole("button", { name: "Anular pago" }).click();
    await expect.poll(() => avisos).toEqual(["No se puede anular el pago porque el saldo a favor generado ya fue utilizado en otra venta"]);
    await expect(fila(page, "00000001")).toContainText("Vigente");
  });

  test("ocultar pide confirmación, oculta el pago y no cambia el saldo de la venta", async ({ page }) => {
    await abrir(page);
    await irAPagos(page);
    await fila(page, "00000001").getByTitle("Ocultar").click();
    await expect(modal(page)).toContainText("¿Ocultar el pago 00000001?");
    await expect(modal(page)).toContainText("Deja de verse en el listado, pero se sigue contando en el saldo de la venta y en los reportes.");
    await modal(page).getByRole("button", { name: "Ocultar" }).click();
    await expect(modal(page)).toHaveCount(0);
    await expect(cartel(page, "Pago 00000001 oculto")).toBeVisible();
    expect(backend.enviados("PATCH", "/pagos/:id/visibilidad")).toEqual([{ oculto: true }]);
    await expect(filas(page)).toHaveCount(1);
    await pestania(page, "Ventas").click();
    await expect(fila(page, VENTA_PARCIAL)).toContainText(/3\.260,00/);
  });

  test("si ocultar falla, avisa con el mensaje del servidor", async ({ page }) => {
    await abrir(page, { preparar: (b) => b.fallar("PATCH /pagos/:id/visibilidad", { status: 500, body: { status: "error", mensaje: "Error interno del servidor" } }) });
    await irAPagos(page);
    await fila(page, "00000001").getByTitle("Ocultar").click();
    await modal(page).getByRole("button", { name: "Ocultar" }).click();
    await expect.poll(() => avisos).toEqual(["Error interno del servidor"]);
    await expect(filas(page)).toHaveCount(2);
  });

  test("'Ver ocultos' muestra los pagos ocultos con Restaurar y sin Editar, Anular ni Ocultar", async ({ page }) => {
    await abrir(page);
    await irAPagos(page);
    const chip = page.getByRole("button", { name: "Ver ocultos" });
    await chip.click();
    await expect(chip).toHaveClass(/activo/);
    await expect(filas(page)).toHaveCount(1);
    const pago = fila(page, "00000003");
    await expect(pago.getByRole("button", { name: "Restaurar" })).toBeVisible();
    await expect(pago.getByTitle("Editar")).toHaveCount(0);
    await expect(pago.getByTitle("Anular")).toHaveCount(0);
    await expect(pago.getByTitle("Ocultar")).toHaveCount(0);
    await chip.click();
    await expect(chip).not.toHaveClass(/activo/);
    await expect(filas(page)).toHaveCount(2);
  });

  test("sin pagos ocultos dice 'Sin pagos ocultos'", async ({ page }) => {
    await abrir(page, { semilla: (e) => (e.pagos[2].oculto = false) });
    await irAPagos(page);
    await page.getByRole("button", { name: "Ver ocultos" }).click();
    await expect(page.getByText("Sin pagos ocultos")).toBeVisible();
  });

  test("Restaurar devuelve el pago a la lista y avisa", async ({ page }) => {
    await abrir(page);
    await irAPagos(page);
    await page.getByRole("button", { name: "Ver ocultos" }).click();
    await fila(page, "00000003").getByRole("button", { name: "Restaurar" }).click();
    await expect(cartel(page, "Pago 00000003 restaurado")).toBeVisible();
    expect(backend.enviados("PATCH", "/pagos/:id/visibilidad")).toEqual([{ oculto: false }]);
    await expect(page.getByText("Sin pagos ocultos")).toBeVisible();
    await page.getByRole("button", { name: "Ver ocultos" }).click();
    await expect(filas(page)).toHaveCount(3);
  });

  test("al cambiar de pestaña 'Ver ocultos' vuelve a estar apagado", async ({ page }) => {
    await abrir(page);
    await irAPagos(page);
    await page.getByRole("button", { name: "Ver ocultos" }).click();
    await pestania(page, "Ventas").click();
    await irAPagos(page);
    await expect(filas(page)).toHaveCount(2);
  });
});

test.describe("Cuenta corriente: rol Cajero", () => {
  test("un Cajero con sesión real (token) no ve 'Ocultar' ni 'Ver ocultos'", async ({ page }) => {
    await abrir(page, { rol: "CAJERO" });
    await irAPagos(page);
    await expect(filas(page)).toHaveCount(2);
    await expect(page.getByTitle("Ocultar")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Ver ocultos" })).toHaveCount(0);
  });

  test("el Cajero puede editar y anular pagos, y nunca recibe los ocultos", async ({ page }) => {
    await abrir(page, { rol: "CAJERO" });
    await irAPagos(page);
    await expect(fila(page, "00000001").getByTitle("Editar")).toBeVisible();
    await expect(fila(page, "00000001").getByTitle("Anular")).toBeVisible();
    await expect(page.getByText("00000003")).toHaveCount(0);
  });

  test.fixme("el Cajero puede registrar pagos", async ({ page }) => {
    await abrir(page, { rol: "CAJERO" });
    await fila(page, VENTA_PENDIENTE).getByRole("button", { name: "+ Pagar" }).click();
    await expect(modal(page)).toBeVisible();
    await page.locator("#cc-pago-medio").selectOption({ label: "Efectivo" });
    await page.locator("#cc-pago-fecha").fill("10-11-2026");
    await page.locator("#cc-pago-hora").fill("11:00");
    await modal(page).getByRole("button", { name: /^Guard/ }).click();
    await expect(modal(page)).toHaveCount(0);
    await expect(cartel(page, "Pago registrado")).toBeVisible();
  });

  test("el Cajero ve el link en el menú de Cuenta corriente", async ({ page }) => {
    await abrir(page, { rol: "CAJERO" });
    await expect(page.getByTestId("menu-cuentas_corrientes")).toHaveAttribute("aria-current", "page");
  });
});

test.describe("Cuenta corriente: acceso", () => {
  test("el Administrador y el Propietario entran", async ({ page }) => {
    await abrir(page, { rol: "PROPIETARIO" });
    await expect(filas(page)).toHaveCount(4);
  });

  test("sin sesión iniciada manda al login", async ({ page }) => {
    await page.goto("/cuenta-corriente.html");
    await expect(page).toHaveURL(/login\.html$/);
  });

  test.fixme("usar la pantalla de punta a punta no produce errores de JavaScript", async ({ page }) => {
    const errores = [];
    page.on("pageerror", (e) => errores.push(e.message));
    await abrir(page);
    await filtroEstado(page).selectOption("pendiente");
    await fila(page, VENTA_PARCIAL).getByTitle("Ver detalle").click();
    await modal(page).getByRole("button", { name: "×" }).click();
    await page.getByRole("button", { name: "Registrar pago" }).first().click();
    await modal(page).getByRole("button", { name: "Cancelar" }).click();
    await pestania(page, "Pagos").click();
    await fila(page, "00000001").getByTitle("Editar").click();
    await modal(page).getByRole("button", { name: "Cancelar" }).click();
    expect(errores).toEqual([]);
  });
});
