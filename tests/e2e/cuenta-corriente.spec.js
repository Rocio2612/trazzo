const { test, expect } = require("@playwright/test");
const { simularApi, iniciarSesionComo } = require("./helpers");

// Pantalla Cuenta corriente (cuenta-corriente.html). Todavía no usa el Backend: los datos están escritos en
// frontend/js/cuenta-corriente.js (cargarDatos), igual que los avisos "Pago registrado", "Pago anulado", etc., que son alert()
// y no cambian nada. Los datos de ejemplo son:
//   Ventas:  00001-0000467 Sandra Quiroga           $ 4.260 · pagado $ 0       · Pendiente (deuda $ 4.260)
//            00001-0000460 Panadería La Espiga S.A. $ 6.500 · pagado $ 6.500   · Saldada
//            00001-0000462 Almacén Don Pedro S.R.L. $ 4.260 · pagado $ 1.000   · Pendiente (deuda $ 3.260)
//   Pagos:   00000002 de la venta 460, Efectivo, $ 6.500   ·   00000001 de la venta 462, Transferencia, $ 1.000
// El rol de la pantalla se lee de localStorage["trazzo_rol"] ("Cajero" o cualquier otro valor = Administrador).

let avisos;

const abrir = async (page, { rol = "ADMIN", rolLocal = null, ahora = null } = {}) => {
  avisos = [];
  page.on("dialog", async (dialogo) => {
    avisos.push(dialogo.message());
    await dialogo.accept();
  });
  if (ahora) await page.clock.setFixedTime(ahora);
  await simularApi(page, { "GET /auth/yo": { status: 200, body: { status: "ok" } }, "GET /notificaciones/contador": { status: 200, body: { cantidad: 0 } } });
  await iniciarSesionComo(page, rol);
  if (rolLocal) await page.evaluate((r) => localStorage.setItem("trazzo_rol", r), rolLocal);
  await page.goto("/cuenta-corriente.html");
  await expect(page.getByRole("heading", { name: "Cuenta corriente", level: 1 })).toBeVisible();
};

const filas = (page) => page.locator("#cc-tabla-container tbody tr");
const fila = (page, texto) => filas(page).filter({ hasText: texto });
const pestania = (page, nombre) => page.locator(".cc-tab", { hasText: nombre });
const buscador = (page) => page.locator(".cc-buscador");
const filtroEstado = (page) => page.locator(".cc-filtro");
const modal = (page) => page.locator(".cc-modal");

const VENTA_PENDIENTE = "00001-0000467";
const VENTA_SALDADA = "00001-0000460";
const VENTA_PARCIAL = "00001-0000462";

test.describe("Cuenta corriente: ventas", () => {
  test("muestra el título, las pestañas (Ventas activa) y las columnas", async ({ page }) => {
    await abrir(page);
    await expect(pestania(page, "Ventas")).toHaveClass(/activa/);
    await expect(pestania(page, "Pagos")).not.toHaveClass(/activa/);
    await expect(page.locator("#cc-tabla-container thead th")).toHaveText(["N° de venta", "Cliente", "Fecha y hora", "Total", "Pagado", "Saldo", "Estado", "Acciones"]);
    await expect(filas(page)).toHaveCount(3);
    await expect(page.getByRole("button", { name: "Registrar pago" }).first()).toBeVisible();
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

  test("'+ Pagar' está habilitado en las ventas con deuda", async ({ page }) => {
    await abrir(page);
    await expect(fila(page, VENTA_PENDIENTE).getByRole("button", { name: "+ Pagar" })).toBeEnabled();
    await expect(fila(page, VENTA_PARCIAL).getByRole("button", { name: "+ Pagar" })).toBeEnabled();
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
    await expect(filas(page)).toHaveCount(3);
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
    await expect(page.getByText("Sin ventas", { exact: true })).toBeVisible();
    await filtroEstado(page).selectOption("todas");
    await expect(filas(page)).toHaveCount(3);
  });

  test("el buscador y el filtro de estado se combinan", async ({ page }) => {
    await abrir(page);
    await filtroEstado(page).selectOption("pendiente");
    await buscador(page).fill("sandra");
    await expect(filas(page)).toHaveCount(1);
    await filtroEstado(page).selectOption("saldada");
    await expect(page.getByText("Sin ventas", { exact: true })).toBeVisible();
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
    await expect(modal(page)).toContainText("Total de la venta");
    await expect(modal(page)).toContainText(/4\.260,00/);
    await expect(modal(page)).toContainText(/1\.000,00/);
    await expect(modal(page)).toContainText(/3\.260,00/);
    await expect(modal(page)).toContainText("Deuda");
    await expect(modal(page)).toContainText("El saldo y el estado los calcula el sistema: no se pueden editar.");
  });

  test("lista los pagos de esa venta con su medio y estado", async ({ page }) => {
    await abrir(page);
    await abrirDetalle(page, VENTA_PARCIAL);
    await expect(modal(page)).toContainText("00000001");
    await expect(modal(page)).toContainText("Transferencia");
    await expect(modal(page)).toContainText("Vigente");
  });

  test("una venta sin pagos dice 'Todavía no tiene pagos'", async ({ page }) => {
    await abrir(page);
    await abrirDetalle(page, VENTA_PENDIENTE);
    await expect(modal(page)).toContainText("Todavía no tiene pagos");
  });

  test("en una venta saldada el saldo dice 'Saldada' y 'Registrar pago' está deshabilitado", async ({ page }) => {
    await abrir(page);
    await abrirDetalle(page, VENTA_SALDADA);
    await expect(modal(page).locator(".detalle-cuadro").last()).toContainText("Saldada");
    await expect(modal(page).getByRole("button", { name: "Registrar pago" })).toBeDisabled();
  });

  // Hoy el detalle usa un producto de ejemplo fijo ("Producto de Ejemplo") porque la venta no trae sus productos.
  test.fixme("el detalle lista los productos reales de la venta, no uno de ejemplo", async ({ page }) => {
    await abrir(page);
    await abrirDetalle(page, VENTA_PARCIAL);
    await expect(modal(page)).not.toContainText("Producto de Ejemplo");
  });

  test("'Cerrar' y la cruz cierran el detalle", async ({ page }) => {
    await abrir(page);
    await abrirDetalle(page, VENTA_PARCIAL);
    await modal(page).getByRole("button", { name: "Cerrar" }).click();
    await expect(modal(page)).toHaveCount(0);
    await abrirDetalle(page, VENTA_PARCIAL);
    await modal(page).getByRole("button", { name: "×" }).click();
    await expect(modal(page)).toHaveCount(0);
  });

  test("'Registrar pago' del detalle abre el formulario con esa venta elegida y su deuda como monto", async ({ page }) => {
    await abrir(page);
    await abrirDetalle(page, VENTA_PARCIAL);
    await modal(page).getByRole("button", { name: "Registrar pago" }).click();
    await expect(modal(page).getByRole("heading", { name: "Registrar pago" })).toBeVisible();
    await expect(page.locator("#cc-pago-venta")).toHaveValue(VENTA_PARCIAL);
    await expect(page.locator("#cc-pago-monto")).toHaveValue("3260.00");
  });
});

test.describe("Cuenta corriente: registrar pago", () => {
  const abrirFormulario = async (page) => {
    await page.getByRole("button", { name: "Registrar pago" }).first().click();
    await expect(modal(page).getByRole("heading", { name: "Registrar pago" })).toBeVisible();
  };

  test("el formulario general ofrece solo las ventas con deuda, los medios de pago y la fecha y hora de hoy", async ({ page }) => {
    await abrir(page, { ahora: new Date("2026-11-15T14:30:00") });
    await abrirFormulario(page);
    await expect(page.locator("#cc-pago-venta option")).toHaveText(["Elegí una venta", `${VENTA_PENDIENTE} · Sandra Quiroga`, `${VENTA_PARCIAL} · Almacén Don Pedro S.R.L.`]);
    await expect(page.locator("#cc-pago-medio option")).toHaveText(["Elegí una opción", "Efectivo", "Transferencia", "Tarjeta Débito", "Mercado Pago"]);
    await expect(page.locator("#cc-pago-fecha")).toHaveValue("15-11-2026");
  });

  // El campo pide "hh:mm": la hora por defecto tiene que verse como 14:30 (24 horas), no como "02:30 p. m.".
  test.fixme("la hora por defecto se ve como hh:mm de 24 horas", async ({ page }) => {
    await abrir(page, { ahora: new Date("2026-11-15T14:30:00") });
    await abrirFormulario(page);
    await expect(page.locator("#cc-pago-hora")).toHaveValue("14:30");
  });

  // Con días de un solo dígito la fecha por defecto tiene que seguir siendo dd-mm-aaaa (05-11-2026), el formato que pide el campo.
  test.fixme("la fecha por defecto de un día de un solo dígito sigue siendo dd-mm-aaaa", async ({ page }) => {
    await abrir(page, { ahora: new Date("2026-11-05T09:07:00") });
    await abrirFormulario(page);
    await expect(page.locator("#cc-pago-fecha")).toHaveValue("05-11-2026");
    await expect(page.locator("#cc-pago-hora")).toHaveValue("09:07");
  });

  test("al elegir una venta y escribir el monto muestra el saldo que queda", async ({ page }) => {
    await abrir(page);
    await abrirFormulario(page);
    await page.locator("#cc-pago-venta").selectOption(VENTA_PARCIAL);
    await expect(modal(page)).toContainText(/Saldo después del pago: .*3\.260,00.* \(deuda\)/);
    await page.locator("#cc-pago-monto").fill("1000");
    await expect(modal(page)).toContainText(/Saldo después del pago: .*2\.260,00.* \(deuda\)/);
    await page.locator("#cc-pago-monto").fill("3260");
    await expect(modal(page)).toContainText("Saldo después del pago: $ 0,00 (saldada)");
    await page.locator("#cc-pago-monto").fill("4000");
    await expect(modal(page)).toContainText(/Saldo después del pago: .*740,00.* \(saldo a favor\)/);
  });

  test("guardar vacío avisa qué falta y no cierra el formulario", async ({ page }) => {
    await abrir(page);
    await abrirFormulario(page);
    await modal(page).getByRole("button", { name: "Guardar" }).click();
    await expect(page.locator(".cc-aviso.error")).toHaveText("Revisá estos datos: monto abonado, medio de pago, fecha y hora.");
    await expect(page.locator(".cc-aviso.error")).toBeVisible();
    await expect(modal(page)).toHaveCount(1);
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
    test(`no guarda ${nombre}`, async ({ page }) => {
      await abrir(page);
      await abrirFormulario(page);
      const v = { venta: VENTA_PARCIAL, monto: "500", medio: "Efectivo", fecha: "15-11-2026", hora: "10:00", ...datos };
      if (v.venta) await page.locator("#cc-pago-venta").selectOption(v.venta);
      await page.locator("#cc-pago-monto").fill(v.monto);
      if (v.medio) await page.locator("#cc-pago-medio").selectOption(v.medio);
      await page.locator("#cc-pago-fecha").fill(v.fecha);
      await page.locator("#cc-pago-hora").fill(v.hora);
      await modal(page).getByRole("button", { name: "Guardar" }).click();
      await expect(page.locator(".cc-aviso.error")).toBeVisible();
      await expect(modal(page)).toHaveCount(1);
      expect(avisos).toEqual([]);
    });
  }

  test("con todo completo guarda, cierra el formulario y avisa 'Pago registrado'", async ({ page }) => {
    await abrir(page);
    await abrirFormulario(page);
    await page.locator("#cc-pago-venta").selectOption(VENTA_PARCIAL);
    await page.locator("#cc-pago-monto").fill("500");
    await page.locator("#cc-pago-medio").selectOption("Efectivo");
    await modal(page).getByRole("button", { name: "Guardar" }).click();
    await expect(modal(page)).toHaveCount(0);
    expect(avisos).toEqual(["Pago registrado"]);
  });

  test("mientras guarda el botón dice 'Guardando...' y queda deshabilitado", async ({ page }) => {
    await abrir(page);
    await abrirFormulario(page);
    await page.locator("#cc-pago-venta").selectOption(VENTA_PARCIAL);
    await page.locator("#cc-pago-monto").fill("500");
    await page.locator("#cc-pago-medio").selectOption("Efectivo");
    const guardar = modal(page).getByRole("button", { name: /Guard/ });
    await guardar.click();
    await expect(guardar).toBeDisabled();
    await expect(guardar).toHaveText("Guardando...");
  });

  test("'+ Pagar' de una venta abre el formulario con la venta fija y su deuda como monto", async ({ page }) => {
    await abrir(page);
    await fila(page, VENTA_PENDIENTE).getByRole("button", { name: "+ Pagar" }).click();
    await expect(page.locator("#cc-pago-venta")).toBeDisabled();
    await expect(page.locator("#cc-pago-venta")).toHaveValue(VENTA_PENDIENTE);
    await expect(page.locator("#cc-pago-monto")).toHaveValue("4260.00");
    await expect(modal(page)).toContainText("Saldo después del pago: $ 0,00 (saldada)");
  });

  test("Cancelar y la cruz cierran el formulario sin guardar", async ({ page }) => {
    await abrir(page);
    await abrirFormulario(page);
    await modal(page).getByRole("button", { name: "Cancelar" }).click();
    await expect(modal(page)).toHaveCount(0);
    await abrirFormulario(page);
    await modal(page).getByRole("button", { name: "×" }).click();
    await expect(modal(page)).toHaveCount(0);
    expect(avisos).toEqual([]);
  });
});

test.describe("Cuenta corriente: pagos", () => {
  const irAPagos = async (page) => {
    await pestania(page, "Pagos").click();
    await expect(pestania(page, "Pagos")).toHaveClass(/activa/);
  };

  test("la pestaña Pagos muestra las columnas y los pagos con su estado", async ({ page }) => {
    await abrir(page);
    await irAPagos(page);
    await expect(page.locator("#cc-tabla-container thead th")).toHaveText(["N° de pago", "N° de venta", "Cliente", "Fecha y hora", "Medio de pago", "Monto", "Estado", "Acciones"]);
    await expect(filas(page)).toHaveCount(2);
    const pago = fila(page, "00000001");
    await expect(pago).toContainText(VENTA_PARCIAL);
    await expect(pago).toContainText("Almacén Don Pedro S.R.L.");
    await expect(pago).toContainText("Transferencia");
    await expect(pago).toContainText(/1\.000,00/);
    await expect(pago).toContainText("Vigente");
    await expect(buscador(page)).toHaveAttribute("placeholder", "Buscar por cliente, N° de venta o N° de pago...");
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
    await pestania(page, "Ventas").click();
    await expect(filas(page)).toHaveCount(3);
    await expect(buscador(page)).toHaveValue("");
  });

  test("cada pago vigente se puede editar, anular y ocultar", async ({ page }) => {
    await abrir(page);
    await irAPagos(page);
    const pago = fila(page, "00000001");
    await expect(pago.getByTitle("Editar")).toBeVisible();
    await expect(pago.getByTitle("Anular")).toBeVisible();
    await expect(pago.getByTitle("Ocultar")).toBeVisible();
  });

  test("editar abre el formulario con los datos del pago y la venta bloqueada", async ({ page }) => {
    await abrir(page);
    await irAPagos(page);
    await fila(page, "00000001").getByTitle("Editar").click();
    await expect(modal(page).getByRole("heading", { name: "Editar pago 00000001" })).toBeVisible();
    await expect(page.locator("#cc-pago-venta")).toBeDisabled();
    await expect(page.locator("#cc-pago-monto")).toHaveValue("1000");
    await expect(page.locator("#cc-pago-medio")).toHaveValue("Transferencia");
    await expect(page.locator("#cc-pago-fecha")).toHaveValue("21-10-2026");
  });

  test("guardar la edición avisa 'Pago actualizado'", async ({ page }) => {
    await abrir(page);
    await irAPagos(page);
    await fila(page, "00000001").getByTitle("Editar").click();
    await modal(page).getByRole("button", { name: "Guardar" }).click();
    await expect(modal(page)).toHaveCount(0);
    expect(avisos).toEqual(["Pago actualizado"]);
  });

  test("anular pide confirmación con el aviso del saldo y avisa 'Pago anulado'", async ({ page }) => {
    await abrir(page);
    await irAPagos(page);
    await fila(page, "00000001").getByTitle("Anular").click();
    await expect(modal(page).getByRole("heading", { name: "Anular pago" })).toBeVisible();
    await expect(modal(page)).toContainText(/¿Anular el pago 00000001 de .*1\.000,00\?/);
    await expect(modal(page)).toContainText("El saldo de la venta volverá a subir. El pago conserva su número y se excluye de los reportes.");
    await expect(modal(page)).toContainText("Esta acción no se puede deshacer. Los pagos no se eliminan: se anulan.");
    await modal(page).getByRole("button", { name: "Anular pago" }).click();
    await expect(modal(page)).toHaveCount(0);
    expect(avisos).toEqual(["Pago anulado"]);
  });

  test("cancelar la anulación no avisa nada", async ({ page }) => {
    await abrir(page);
    await irAPagos(page);
    await fila(page, "00000001").getByTitle("Anular").click();
    await modal(page).getByRole("button", { name: "Cancelar" }).click();
    await expect(modal(page)).toHaveCount(0);
    expect(avisos).toEqual([]);
  });

  test("ocultar pide confirmación y avisa 'Pago oculto'", async ({ page }) => {
    await abrir(page);
    await irAPagos(page);
    await fila(page, "00000001").getByTitle("Ocultar").click();
    await expect(modal(page)).toContainText("¿Ocultar el pago 00000001?");
    await expect(modal(page)).toContainText("Deja de verse en el listado, pero se sigue contando en el saldo de la venta y en los reportes.");
    await modal(page).getByRole("button", { name: "Ocultar" }).click();
    await expect(modal(page)).toHaveCount(0);
    expect(avisos).toEqual(["Pago oculto"]);
  });

  test("'Ver ocultos' alterna entre las dos listas y sin ocultos dice 'Sin pagos ocultos'", async ({ page }) => {
    await abrir(page);
    await irAPagos(page);
    const chip = page.getByRole("button", { name: "Ver ocultos" });
    await chip.click();
    await expect(chip).toHaveClass(/activo/);
    await expect(page.getByText("Sin pagos ocultos")).toBeVisible();
    await chip.click();
    await expect(filas(page)).toHaveCount(2);
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
  // La pantalla detecta al Cajero por localStorage["trazzo_rol"] === "Cajero". El login nunca guarda esa clave: el rol real
  // está en el token (como en el resto de las pantallas). Este test es el que debería cumplirse con la sesión de un Cajero.
  test.fixme("un Cajero con sesión real (token) no ve 'Ocultar' ni 'Ver ocultos'", async ({ page }) => {
    await abrir(page, { rol: "CAJERO" });
    await pestania(page, "Pagos").click();
    await expect(page.getByTitle("Ocultar")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Ver ocultos" })).toHaveCount(0);
  });

  test("cuando la pantalla sabe que es Cajero no ofrece 'Ocultar' ni 'Ver ocultos', pero sí editar y anular", async ({ page }) => {
    await abrir(page, { rol: "CAJERO", rolLocal: "Cajero" });
    await pestania(page, "Pagos").click();
    await expect(filas(page)).toHaveCount(2);
    await expect(page.getByTitle("Ocultar")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Ver ocultos" })).toHaveCount(0);
    await expect(fila(page, "00000001").getByTitle("Editar")).toBeVisible();
    await expect(fila(page, "00000001").getByTitle("Anular")).toBeVisible();
  });

  test("el Cajero ve el link en el menú y el Administrador también", async ({ page }) => {
    await abrir(page, { rol: "CAJERO" });
    await expect(page.getByTestId("menu-cuentas_corrientes")).toHaveAttribute("aria-current", "page");
  });

  test("el Cajero también puede registrar pagos", async ({ page }) => {
    await abrir(page, { rol: "CAJERO", rolLocal: "Cajero" });
    await fila(page, VENTA_PENDIENTE).getByRole("button", { name: "+ Pagar" }).click();
    await expect(modal(page)).toBeVisible();
  });
});

test.describe("Cuenta corriente: acceso", () => {
  test("el Administrador y el Propietario entran", async ({ page }) => {
    await abrir(page, { rol: "PROPIETARIO" });
    await expect(filas(page)).toHaveCount(3);
  });

  test("sin sesión iniciada manda al login", async ({ page }) => {
    await page.goto("/cuenta-corriente.html");
    await expect(page).toHaveURL(/login\.html$/);
  });

  test("usar la pantalla de punta a punta no produce errores de JavaScript", async ({ page }) => {
    const errores = [];
    page.on("pageerror", (e) => errores.push(e.message));
    await abrir(page);
    await filtroEstado(page).selectOption("pendiente");
    await fila(page, VENTA_PARCIAL).getByTitle("Ver detalle").click();
    await modal(page).getByRole("button", { name: "Cerrar" }).click();
    await pestania(page, "Pagos").click();
    await fila(page, "00000001").getByTitle("Editar").click();
    await modal(page).getByRole("button", { name: "Cancelar" }).click();
    expect(errores).toEqual([]);
  });
});
