const { test, expect } = require("@playwright/test");
const { iniciarSesionComo } = require("./helpers");
const { simularBackend, respuestaDeError } = require("./backend-falso");

// Backend falso (backend-falso.js): 7 gastos, total $ 995.051,25, y los medios de pago Efectivo (1) y Transferencia (2).
const TOTAL_INICIAL = /995\.051,25/;
const MEDIOS = [
  { id: 1, nombre: "Efectivo" },
  { id: 2, nombre: "Transferencia" },
];

// `semilla(estado)` cambia los datos de partida del Backend falso y `preparar(backend)` lo hace fallar, demorar o
// responder otra cosa. `sinMedios` hace que la lista de medios de pago no se pueda cargar.
let backend;
const abrirGastos = async (page, rol = "ADMIN", { semilla, preparar, sinMedios = false, ahora = null } = {}) => {
  backend = await simularBackend(page, { rol, semilla, ahora });
  if (sinMedios) backend.fallar("GET /medios-pago", respuestaDeError(500, "Error al listar los medios de pago"));
  preparar?.(backend);
  await iniciarSesionComo(page, rol);
  await page.goto("/gastos.html");
};

test.describe("Gastos operativos", () => {
  test("solo permite editar y eliminar (sin ocultar)", async ({ page }) => {
    await abrirGastos(page);
    await expect(page.getByTestId("gastos-tabla").locator("tbody tr")).toHaveCount(7);
    await expect(page.getByTestId("gastos-editar-1")).toBeVisible();
    await expect(page.getByTestId("gastos-eliminar-1")).toBeVisible();
    await expect(page.getByTestId("gastos-ocultar-1")).toHaveCount(0);
    await expect(page.getByTestId("gastos-ver-ocultos")).toHaveCount(0);
  });

  test("muestra el total del período arriba y lo recalcula al cambiar el período", async ({ page }) => {
    await abrirGastos(page);
    await expect(page.getByTestId("gastos-total")).toHaveText(TOTAL_INICIAL);
    await expect(page.getByTestId("gastos-total-titulo")).toHaveText("Total acumulado");
    await expect(page.getByTestId("gastos-total-detalle")).toHaveText("7 gastos");
    await page.getByTestId("gastos-filtro-fecha").selectOption("hoy");
    await expect(page.getByTestId("gastos-total-titulo")).toHaveText("Total de hoy");
    await expect(page.getByTestId("gastos-total-detalle")).toHaveText("0 gastos");
    await page.getByTestId("gastos-filtro-fecha").selectOption("mes");
    await expect(page.getByTestId("gastos-total-titulo")).toHaveText("Total de este mes");
    await page.getByTestId("gastos-filtro-fecha").selectOption("anio");
    await expect(page.getByTestId("gastos-total-titulo")).toHaveText("Total de este año");
  });

  test("editar el monto cambia el total", async ({ page }) => {
    await abrirGastos(page);
    await page.getByTestId("gastos-editar-2").click(); // Luz: 38.250,50
    await page.locator("#monto").fill("50000");
    await page.getByTestId("modal-guardar").click();
    await expect(page.getByTestId("gastos-total")).toHaveText(/1\.006\.800,75/, { timeout: 5000 });
  });

  test("eliminar pide confirmación y baja el total", async ({ page }) => {
    await abrirGastos(page);
    await page.getByTestId("gastos-eliminar-2").click();
    await page.getByTestId("modal-cancelar").click();
    await expect(page.getByTestId("gastos-total-detalle")).toHaveText("7 gastos");

    await page.getByTestId("gastos-eliminar-2").click();
    await page.getByTestId("modal-confirmar").click();
    await expect(page.getByTestId("gastos-total-detalle")).toHaveText("6 gastos");
    await expect(page.getByTestId("gastos-total")).toHaveText(/956\.800,75/);
  });

  test("no acepta una fecha futura (la base exige fecha de hoy o anterior)", async ({ page }) => {
    await abrirGastos(page);
    await page.getByTestId("gastos-nuevo").click();
    await page.locator("#fecha").fill("01-01-2099");
    await page.locator("#concepto").fill("Seguro anual");
    await page.locator("#monto").fill("1000");
    await page.getByTestId("modal-guardar").click();
    await expect(page.locator("#error-fecha")).toHaveText("La fecha no puede ser futura.");
    await expect(page.getByTestId("modal")).toHaveCount(1);
    await expect(page.getByTestId("gastos-total-detalle")).toHaveText("7 gastos");
  });

  test("sin medios de pago el mensaje va dentro del desplegable", async ({ page }) => {
    await abrirGastos(page, "ADMIN", { sinMedios: true });
    await page.getByTestId("gastos-nuevo").click();
    await expect(page.locator("#medio_pago_id")).toBeDisabled();
    await expect(page.locator("#medio_pago_id option")).toHaveText("Sin medios de pago. Creá uno en Configuración > Medios de pago");
  });

  test("con medios de pago el select se activa y se guarda el elegido", async ({ page }) => {
    await abrirGastos(page);
    await page.getByTestId("gastos-nuevo").click();
    await expect(page.locator("#medio_pago_id")).toBeEnabled();
    await expect(page.locator("#medio_pago_id option")).toHaveText(["Sin especificar", "Efectivo", "Transferencia"]);
    await page.locator("#fecha").fill("10-05-2026");
    await page.locator("#concepto").fill("Fletes de mayo");
    await page.locator("#monto").fill("2500");
    await page.locator("#medio_pago_id").selectOption("2");
    await page.getByTestId("modal-guardar").click();
    await expect(page.getByRole("row", { name: /Fletes de mayo/ })).toContainText("Transferencia", { timeout: 5000 });
  });

  test("el Cajero no entra a Gastos", async ({ page }) => {
    await abrirGastos(page, "CAJERO");
    await expect(page).toHaveURL(/dashboard\.html$/);
  });

  test("el desplegable se alimenta con los medios de pago creados en Configuración", async ({ page }) => {
    await abrirGastos(page, "PROPIETARIO");
    await page.goto("/configuracion.html#medios-pago");
    await page.getByTestId("medios_pago-nombre").fill("Débito");
    await page.getByTestId("medios_pago-agregar").click();
    await expect(page.getByTestId("medios_pago-lista")).toContainText("Débito");

    await page.goto("/gastos.html");
    await page.getByTestId("gastos-nuevo").click();
    await expect(page.locator("#medio_pago_id option")).toHaveText(["Sin especificar", "Efectivo", "Débito", "Transferencia"]);
    await page.locator("#fecha").fill("10-05-2026");
    await page.locator("#concepto").fill("Comisión bancaria");
    await page.locator("#monto").fill("900");
    await page.locator("#medio_pago_id").selectOption({ label: "Débito" });
    await page.getByTestId("modal-guardar").click();
    await expect(page.getByRole("row", { name: /Comisión bancaria/ })).toContainText("Débito", { timeout: 5000 });
  });

  test("cancelar y la cruz cierran el modal sin preguntar aunque se haya cargado algo", async ({ page }) => {
    await abrirGastos(page);
    await page.getByTestId("gastos-nuevo").click();
    await page.locator("#concepto").fill("Algo a medias");
    await page.getByTestId("modal-cancelar").click();
    await expect(page.getByTestId("modal")).toHaveCount(0);

    await page.getByTestId("gastos-nuevo").click();
    await page.locator("#concepto").fill("Otra vez");
    await page.getByTestId("modal").getByRole("button", { name: "Cerrar", exact: true }).click();
    await expect(page.getByTestId("modal")).toHaveCount(0);
    await expect(page.getByTestId("gastos-total-detalle")).toHaveText("7 gastos");
  });
});

// ---------------------------------------------------------------------------
// Pruebas ampliadas de la pantalla: validaciones, alta, edición, eliminación,
// búsqueda, períodos (con fecha fija), seguridad y pantalla chica.
// Datos de ejemplo: 1 Alquiler 450.000 (01-03) · 2 Luz 38.250,50 (05-03) · 3 Internet 21.000 (05-03)
// 4 Flete 15.500,75 (12-03) · 5 Alquiler 450.000 (01-04) · 6 Viáticos 8.300 (02-04) · 7 Reparación de heladera 12.000 (10-04)
// ---------------------------------------------------------------------------

const filas = (page) => page.getByTestId("gastos-tabla").locator("tbody tr");
const aviso = (page) => page.locator(".gastos-toast");
const errorDe = (page, campo) => page.locator(`#error-${campo}`);
const guardar = (page) => page.getByTestId("modal-guardar");
const modal = (page) => page.getByTestId("modal");

// Fija "hoy" del navegador (hora local del mediodía) para que los períodos sean predecibles.
const fijarHoy = (page, iso) => page.clock.setFixedTime(new Date(`${iso}T12:00:00`));

const completar = async (page, { fecha, concepto, monto }) => {
  if (fecha !== undefined) await page.locator("#fecha").fill(fecha);
  if (concepto !== undefined) await page.locator("#concepto").fill(concepto);
  if (monto !== undefined) await page.locator("#monto").fill(monto);
};

// Abre "Nuevo gasto", lo completa y guarda; espera a que el modal se cierre.
const crearGasto = async (page, datos) => {
  await page.getByTestId("gastos-nuevo").click();
  await completar(page, datos);
  await guardar(page).click();
  await expect(modal(page)).toHaveCount(0);
};

test.describe("Gastos: validaciones del formulario", () => {
  test("al abrir 'Nuevo gasto' la fecha viene con hoy y el foco está en la fecha", async ({ page }) => {
    await fijarHoy(page, "2026-04-10");
    await abrirGastos(page);
    await page.getByTestId("gastos-nuevo").click();
    await expect(modal(page).getByRole("heading", { name: "Nuevo gasto" })).toBeVisible();
    await expect(page.locator("#fecha")).toHaveValue("10-04-2026");
    await expect(page.locator("#fecha")).toBeFocused();
    await expect(page.locator("#concepto")).toHaveValue("");
    await expect(page.locator("#monto")).toHaveValue("");
  });

  test("guardar con todo vacío marca los tres obligatorios, enfoca el primero y no guarda nada", async ({ page }) => {
    await abrirGastos(page);
    await page.getByTestId("gastos-nuevo").click();
    await page.locator("#fecha").fill("");
    await guardar(page).click();

    await expect(errorDe(page, "fecha")).toHaveText("Completá la fecha.");
    await expect(errorDe(page, "concepto")).toHaveText("Completá el concepto.");
    await expect(errorDe(page, "monto")).toHaveText("Completá el monto.");
    await expect(errorDe(page, "medio_pago_id")).toBeHidden();
    await expect(page.locator("#fecha")).toBeFocused();
    await expect(page.locator("#fecha")).toHaveClass(/con-error/);
    await expect(modal(page)).toHaveCount(1);
    await expect(filas(page)).toHaveCount(7);
    await expect(aviso(page)).toHaveCount(0);
  });

  test("el foco va al primer campo con error (no siempre a la fecha)", async ({ page }) => {
    await abrirGastos(page);
    await page.getByTestId("gastos-nuevo").click();
    await guardar(page).click();
    await expect(errorDe(page, "fecha")).toBeHidden();
    await expect(page.locator("#concepto")).toBeFocused();

    await page.locator("#concepto").fill("Algo");
    await guardar(page).click();
    await expect(page.locator("#monto")).toBeFocused();
  });

  test("el error de un campo desaparece al escribir en él, y los demás se mantienen", async ({ page }) => {
    await abrirGastos(page);
    await page.getByTestId("gastos-nuevo").click();
    await guardar(page).click();
    await expect(errorDe(page, "concepto")).toBeVisible();
    await expect(errorDe(page, "monto")).toBeVisible();

    await page.locator("#concepto").fill("L");
    await expect(errorDe(page, "concepto")).toBeHidden();
    await expect(page.locator("#concepto")).not.toHaveClass(/con-error/);
    await expect(errorDe(page, "monto")).toBeVisible();
  });

  test("un concepto de solo espacios se rechaza", async ({ page }) => {
    await abrirGastos(page);
    await page.getByTestId("gastos-nuevo").click();
    await completar(page, { concepto: "     ", monto: "100" });
    await guardar(page).click();
    await expect(errorDe(page, "concepto")).toHaveText("Completá el concepto.");
    await expect(filas(page)).toHaveCount(7);
  });

  for (const [fecha, mensaje] of [
    ["31-02-2026", "La fecha no es una fecha válida."],
    ["29-02-2025", "La fecha no es una fecha válida."],
    ["5/3/2026", "La fecha no es una fecha válida."],
    ["hola", "La fecha no es una fecha válida."],
    ["00-00-0000", "La fecha no es una fecha válida."],
    ["   ", "Completá la fecha."],
  ]) {
    test(`la fecha "${fecha}" se rechaza`, async ({ page }) => {
      await abrirGastos(page);
      await page.getByTestId("gastos-nuevo").click();
      await completar(page, { fecha, concepto: "Luz", monto: "100" });
      await guardar(page).click();
      await expect(errorDe(page, "fecha")).toHaveText(mensaje);
      await expect(filas(page)).toHaveCount(7);
    });
  }

  for (const [monto, mensaje] of [
    ["0", "El monto debe ser mayor a 0."],
    ["0.00", "El monto debe ser mayor a 0."],
    ["-50", "El monto debe ser mayor a 0."],
    ["10.123", "El monto admite hasta 2 decimales."],
    ["10000000000", "El monto es demasiado grande."],
    ["1e3", "El monto debe ser un número."],
  ]) {
    test(`el monto "${monto}" se rechaza`, async ({ page }) => {
      await abrirGastos(page);
      await page.getByTestId("gastos-nuevo").click();
      await completar(page, { concepto: "Luz", monto });
      await guardar(page).click();
      await expect(errorDe(page, "monto")).toHaveText(mensaje);
      await expect(page.locator("#monto")).toBeFocused();
      await expect(filas(page)).toHaveCount(7);
    });
  }

  test("el campo de monto es numérico y no deja escribir letras", async ({ page }) => {
    await abrirGastos(page);
    await page.getByTestId("gastos-nuevo").click();
    await expect(page.locator("#monto")).toHaveAttribute("type", "number");
    await page.locator("#monto").click();
    await page.keyboard.type("abc");
    await expect(page.locator("#monto")).toHaveValue("");
    await guardar(page).click();
    await expect(errorDe(page, "monto")).toHaveText("Completá el monto.");
  });

  test("los campos obligatorios están marcados con asterisco y el medio de pago es opcional", async ({ page }) => {
    await abrirGastos(page);
    await page.getByTestId("gastos-nuevo").click();
    await expect(page.locator('label[for="fecha"]')).toHaveText("Fecha *");
    await expect(page.locator('label[for="concepto"]')).toHaveText("Concepto *");
    await expect(page.locator('label[for="monto"]')).toHaveText("Monto *");
    await expect(page.locator('label[for="medio_pago_id"]')).toHaveText("Medio de pago (opcional)");
  });
});

test.describe("Gastos: alta", () => {
  test("registra el gasto y lo muestra con todos sus datos", async ({ page }) => {
    await fijarHoy(page, "2026-04-10");
    await abrirGastos(page);
    await crearGasto(page, { fecha: "09-04-2026", concepto: "  Limpieza  ", monto: "1234.5" });

    await expect(filas(page)).toHaveCount(8);
    const fila = page.getByRole("row", { name: /Limpieza/ });
    await expect(fila.locator("td").nth(0)).toHaveText("09-04-2026");
    await expect(fila.locator("td").nth(1)).toHaveText("Limpieza"); // sin los espacios
    await expect(fila.locator("td").nth(2)).toContainText("1.234,50");
    await expect(fila.locator("td").nth(3)).toHaveText("—");
    await expect(fila.locator("td").nth(4)).toHaveText("usuario1"); // sale del token
    await expect(aviso(page)).toHaveText("Gasto registrado");
    await expect(page.getByTestId("gastos-total")).toHaveText(/996\.285,75/);
    await expect(page.getByTestId("gastos-total-detalle")).toHaveText("8 gastos");
  });

  test("el botón Guardar se deshabilita mientras procesa y el doble clic no duplica el gasto", async ({ page }) => {
    await abrirGastos(page, "ADMIN", { preparar: (b) => b.demorar("POST /gastos", 600) });
    await page.getByTestId("gastos-nuevo").click();
    await completar(page, { concepto: "Doble clic", monto: "100" });
    await guardar(page).dblclick();
    await expect(guardar(page)).toBeDisabled();
    await expect(guardar(page)).toHaveText("Guardando…");
    await expect(page.getByTestId("gastos-total-detalle")).toHaveText("8 gastos");
    await page.waitForTimeout(800);
    await expect(page.getByTestId("gastos-total-detalle")).toHaveText("8 gastos");
    await expect(page.getByRole("row", { name: /Doble clic/ })).toHaveCount(1);
  });

  test("acepta el monto mínimo (0,01) y el máximo (9.999.999.999,99)", async ({ page }) => {
    await abrirGastos(page);
    await crearGasto(page, { concepto: "Mínimo", monto: "0.01" });
    await expect(page.getByRole("row", { name: /Mínimo/ }).locator("td").nth(2)).toContainText("0,01");
    await crearGasto(page, { concepto: "Máximo", monto: "9999999999.99" });
    await expect(page.getByRole("row", { name: /Máximo/ }).locator("td").nth(2)).toContainText("9.999.999.999,99");
    await expect(page.getByTestId("gastos-total-detalle")).toHaveText("9 gastos");
  });

  test("acepta el 29 de febrero de un año bisiesto", async ({ page }) => {
    await abrirGastos(page);
    await crearGasto(page, { fecha: "29-02-2024", concepto: "Bisiesto", monto: "10" });
    await expect(page.getByRole("row", { name: /Bisiesto/ }).locator("td").nth(0)).toHaveText("29-02-2024");
  });

  test("también acepta la fecha escrita como aaaa-mm-dd y la muestra como dd-mm-aaaa", async ({ page }) => {
    await abrirGastos(page);
    await crearGasto(page, { fecha: "2026-05-20", concepto: "Formato ISO", monto: "10" });
    await expect(page.getByRole("row", { name: /Formato ISO/ }).locator("td").nth(0)).toHaveText("20-05-2026");
  });

  test("un concepto con HTML se muestra como texto y no se ejecuta", async ({ page }) => {
    await abrirGastos(page);
    const peligroso = '<img src=x onerror="window.__xss=1"><b>negrita</b>';
    await crearGasto(page, { concepto: peligroso, monto: "10" });
    await expect(filas(page).filter({ hasText: "negrita" }).locator("td").nth(1)).toHaveText(peligroso);
    await expect(filas(page).filter({ hasText: "negrita" }).locator("b")).toHaveCount(0);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();

    // y también en el diálogo de eliminar
    await page.getByTestId("gastos-eliminar-8").click();
    await expect(modal(page)).toContainText(peligroso);
    await expect(modal(page).locator("img")).toHaveCount(0);
  });

  test("un concepto larguísimo (5000 caracteres seguidos) no rompe la tabla", async ({ page }) => {
    await abrirGastos(page);
    await crearGasto(page, { concepto: "x".repeat(5000), monto: "10" });
    await expect(filas(page)).toHaveCount(8);
    await expect(page.getByTestId("gastos-eliminar-8")).toBeVisible();
    const desborda = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(desborda).toBe(false);
  });

  test("el gasto creado con la fecha de hoy aparece en Hoy, Este mes y Este año", async ({ page }) => {
    await fijarHoy(page, "2026-04-10");
    await abrirGastos(page);
    await crearGasto(page, { fecha: "10-04-2026", concepto: "De hoy", monto: "1000" });

    await page.getByTestId("gastos-filtro-fecha").selectOption("hoy");
    await expect(page.getByTestId("gastos-total-detalle")).toHaveText("2 gastos"); // heladera + el nuevo
    await expect(page.getByTestId("gastos-total")).toHaveText(/13\.000,00/);
    await page.getByTestId("gastos-filtro-fecha").selectOption("mes");
    await expect(page.getByTestId("gastos-total-detalle")).toHaveText("4 gastos");
    await page.getByTestId("gastos-filtro-fecha").selectOption("anio");
    await expect(page.getByTestId("gastos-total-detalle")).toHaveText("8 gastos");
  });

  test("no se puede cargar un gasto para el año que viene: el total no cambia", async ({ page }) => {
    await fijarHoy(page, "2026-04-10");
    await abrirGastos(page);
    await page.getByTestId("gastos-nuevo").click();
    await completar(page, { fecha: "01-01-2027", concepto: "Del año próximo", monto: "5000" });
    await guardar(page).click();
    await expect(errorDe(page, "fecha")).toHaveText("La fecha no puede ser futura.");
    await page.getByTestId("modal-cancelar").click();
    await page.getByTestId("gastos-filtro-fecha").selectOption("anio");
    await expect(page.getByTestId("gastos-total-detalle")).toHaveText("7 gastos");
    await page.getByTestId("gastos-filtro-fecha").selectOption("todas");
    await expect(page.getByTestId("gastos-total-detalle")).toHaveText("7 gastos");
    await expect(page.getByTestId("gastos-total")).toHaveText(TOTAL_INICIAL);
  });

  test("después de guardar, abrir otro gasto nuevo vuelve a empezar vacío", async ({ page }) => {
    await abrirGastos(page);
    await crearGasto(page, { concepto: "Primero", monto: "10" });
    await page.getByTestId("gastos-nuevo").click();
    await expect(page.locator("#concepto")).toHaveValue("");
    await expect(page.locator("#monto")).toHaveValue("");
    await expect(errorDe(page, "concepto")).toBeHidden();
  });

  test("el aviso de recálculo solo aparece al editar, no al crear", async ({ page }) => {
    await abrirGastos(page);
    await page.getByTestId("gastos-nuevo").click();
    await expect(modal(page).locator(".gastos-banner")).toHaveCount(0);
  });
});

test.describe("Gastos: edición", () => {
  test("abre con los datos del gasto y avisa que se recalcula el total", async ({ page }) => {
    await abrirGastos(page);
    await page.getByTestId("gastos-editar-2").click();
    await expect(modal(page).getByRole("heading", { name: "Editar gasto" })).toBeVisible();
    await expect(page.locator("#fecha")).toHaveValue("05-03-2026");
    await expect(page.locator("#concepto")).toHaveValue("Luz");
    await expect(page.locator("#monto")).toHaveValue("38250.50");
    await expect(page.locator("#medio_pago_id")).toHaveValue("");
    await expect(modal(page).locator(".gastos-banner")).toHaveText("Si cambiás la fecha o el monto, se recalcula el total del período.");
  });

  test("guardar sin cambiar nada deja todo igual", async ({ page }) => {
    await abrirGastos(page);
    await page.getByTestId("gastos-editar-2").click();
    await guardar(page).click();
    await expect(aviso(page)).toHaveText("Gasto actualizado");
    await expect(page.getByTestId("gastos-total")).toHaveText(TOTAL_INICIAL);
    await expect(filas(page)).toHaveCount(7);
    const fila = page.getByTestId("gastos-fila-2");
    await expect(fila.locator("td").nth(0)).toHaveText("05-03-2026");
    await expect(fila.locator("td").nth(1)).toHaveText("Luz");
    await expect(fila.locator("td").nth(2)).toContainText("38.250,50");
  });

  test("editar concepto y fecha actualiza la fila sin cambiar la cantidad ni el 'Creado por'", async ({ page }) => {
    await abrirGastos(page);
    await page.getByTestId("gastos-editar-2").click();
    await completar(page, { fecha: "06-03-2026", concepto: "Luz de marzo" });
    await guardar(page).click();
    const fila = page.getByRole("row", { name: /Luz de marzo/ });
    await expect(fila.locator("td").nth(0)).toHaveText("06-03-2026");
    await expect(fila.locator("td").nth(4)).toHaveText("admin1");
    await expect(page.getByTestId("gastos-total-detalle")).toHaveText("7 gastos");
    await expect(page.getByTestId("gastos-total")).toHaveText(TOTAL_INICIAL);
  });

  test("editar con datos inválidos muestra los errores y no modifica el gasto", async ({ page }) => {
    await abrirGastos(page);
    await page.getByTestId("gastos-editar-2").click();
    await completar(page, { concepto: "", monto: "0" });
    await guardar(page).click();
    await expect(errorDe(page, "concepto")).toHaveText("Completá el concepto.");
    await expect(errorDe(page, "monto")).toHaveText("El monto debe ser mayor a 0.");
    await page.getByTestId("modal-cancelar").click();
    await expect(page.getByTestId("gastos-fila-2").locator("td").nth(1)).toHaveText("Luz");
    await expect(page.getByTestId("gastos-total")).toHaveText(TOTAL_INICIAL);
  });

  test("cancelar la edición no guarda los cambios", async ({ page }) => {
    await abrirGastos(page);
    await page.getByTestId("gastos-editar-2").click();
    await completar(page, { concepto: "Cambiado", monto: "1" });
    await page.getByTestId("modal-cancelar").click();
    await expect(page.getByRole("row", { name: /Cambiado/ })).toHaveCount(0);
    await expect(page.getByTestId("gastos-total")).toHaveText(TOTAL_INICIAL);
  });

  test("mover un gasto a otro mes cambia el total del período", async ({ page }) => {
    await fijarHoy(page, "2026-04-10");
    await abrirGastos(page);
    await page.getByTestId("gastos-filtro-fecha").selectOption("mes");
    await expect(page.getByTestId("gastos-total")).toHaveText(/470\.300,00/);
    await expect(page.getByTestId("gastos-total-detalle")).toHaveText("3 gastos");

    await page.getByTestId("gastos-filtro-fecha").selectOption("todas");
    await page.getByTestId("gastos-editar-2").click(); // Luz: de marzo a abril
    await completar(page, { fecha: "05-04-2026" });
    await guardar(page).click();
    await expect(aviso(page)).toHaveText("Gasto actualizado");

    await page.getByTestId("gastos-filtro-fecha").selectOption("mes");
    await expect(page.getByTestId("gastos-total")).toHaveText(/508\.550,50/);
    await expect(page.getByTestId("gastos-total-detalle")).toHaveText("4 gastos");
  });

  test("editar un gasto recién creado funciona igual", async ({ page }) => {
    await abrirGastos(page);
    await crearGasto(page, { concepto: "Recién creado", monto: "100" });
    await page.getByTestId("gastos-editar-8").click();
    await expect(page.locator("#concepto")).toHaveValue("Recién creado");
    await completar(page, { monto: "250.25" });
    await guardar(page).click();
    await expect(page.getByRole("row", { name: /Recién creado/ }).locator("td").nth(2)).toContainText("250,25");
  });

  test("el medio de pago llega preseleccionado y se puede quitar", async ({ page }) => {
    await abrirGastos(page);
    await page.getByTestId("gastos-nuevo").click();
    await completar(page, { concepto: "Con medio", monto: "100" });
    await page.locator("#medio_pago_id").selectOption("1");
    await guardar(page).click();
    await expect(page.getByRole("row", { name: /Con medio/ }).locator("td").nth(3)).toHaveText("Efectivo");

    await page.getByTestId("gastos-editar-8").click();
    await expect(page.locator("#medio_pago_id")).toHaveValue("1");
    await page.locator("#medio_pago_id").selectOption("");
    await guardar(page).click();
    await expect(page.getByRole("row", { name: /Con medio/ }).locator("td").nth(3)).toHaveText("—");
  });
});

test.describe("Gastos: eliminación", () => {
  test("el diálogo nombra el gasto, avisa del recálculo y que no se puede deshacer", async ({ page }) => {
    await abrirGastos(page);
    await page.getByTestId("gastos-eliminar-1").click();
    await expect(modal(page)).toContainText('¿Eliminar "Alquiler del local" definitivamente?');
    await expect(modal(page)).toContainText("el total del período y la Ganancia Neta Operativa se recalculan");
    await expect(modal(page)).toContainText("Esta acción no se puede deshacer.");
  });

  test("Escape, la cruz y el fondo cierran el diálogo sin eliminar", async ({ page }) => {
    await abrirGastos(page);
    await page.getByTestId("gastos-eliminar-1").click();
    await page.keyboard.press("Escape");
    await expect(modal(page)).toHaveCount(0);

    await page.getByTestId("gastos-eliminar-1").click();
    await modal(page).getByRole("button", { name: "Cerrar", exact: true }).click();
    await expect(modal(page)).toHaveCount(0);

    await page.getByTestId("gastos-eliminar-1").click();
    await modal(page).click({ position: { x: 5, y: 5 } }); // clic en el fondo oscuro
    await expect(modal(page)).toHaveCount(0);
    await expect(filas(page)).toHaveCount(7);
    await expect(page.getByTestId("gastos-total")).toHaveText(TOTAL_INICIAL);
  });

  test("confirmar elimina la fila, avisa y recalcula el total", async ({ page }) => {
    await abrirGastos(page);
    await page.getByTestId("gastos-eliminar-2").click();
    await page.getByTestId("modal-confirmar").click();
    await expect(filas(page)).toHaveCount(6);
    await expect(page.getByTestId("gastos-eliminar-2")).toHaveCount(0);
    await expect(aviso(page)).toHaveText('"Luz" se eliminó');
    await expect(page.getByTestId("gastos-total")).toHaveText(/956\.800,75/);
  });

  test("eliminar un gasto dentro de un período filtrado baja el total de ese período", async ({ page }) => {
    await fijarHoy(page, "2026-04-10");
    await abrirGastos(page);
    await page.getByTestId("gastos-filtro-fecha").selectOption("mes");
    await page.getByTestId("gastos-eliminar-7").click();
    await page.getByTestId("modal-confirmar").click();
    await expect(page.getByTestId("gastos-total")).toHaveText(/458\.300,00/);
    await expect(page.getByTestId("gastos-total-detalle")).toHaveText("2 gastos");
  });

  test("al eliminar todos los gastos queda 'Sin gastos' y el total en cero", async ({ page }) => {
    await abrirGastos(page);
    for (let id = 1; id <= 7; id++) {
      await page.getByTestId(`gastos-eliminar-${id}`).click();
      await page.getByTestId("modal-confirmar").click();
      await expect(page.getByTestId(`gastos-eliminar-${id}`)).toHaveCount(0);
    }
    await expect(page.getByTestId("gastos-tabla-vacio")).toHaveText("Sin gastos");
    await expect(page.getByTestId("gastos-total")).toHaveText(/\$\s0,00/);
    await expect(page.getByTestId("gastos-total-detalle")).toHaveText("0 gastos");
  });

  test("el total no queda en negativo ni raro después de eliminar y volver a crear", async ({ page }) => {
    await abrirGastos(page);
    await page.getByTestId("gastos-eliminar-1").click();
    await page.getByTestId("modal-confirmar").click();
    await crearGasto(page, { concepto: "Nuevo alquiler", monto: "450000" });
    await expect(page.getByTestId("gastos-total")).toHaveText(TOTAL_INICIAL);
    await expect(page.getByTestId("gastos-total-detalle")).toHaveText("7 gastos");
  });
});

test.describe("Gastos: búsqueda y períodos", () => {
  test("busca por concepto sin distinguir mayúsculas ni espacios, y el total no cambia", async ({ page }) => {
    await abrirGastos(page);
    const buscador = page.getByTestId("gastos-buscador");
    await buscador.fill("alquiler");
    await expect(filas(page)).toHaveCount(2);
    await buscador.fill("ALQUILER");
    await expect(filas(page)).toHaveCount(2);
    await buscador.fill("  luz  ");
    await expect(filas(page)).toHaveCount(1);
    await expect(page.getByTestId("gastos-total")).toHaveText(TOTAL_INICIAL); // el total sigue el período, no el buscador
    await expect(page.getByTestId("gastos-total-detalle")).toHaveText("7 gastos");
  });

  test("la búsqueda no distingue tildes, ni al escribir ni en el gasto", async ({ page }) => {
    await abrirGastos(page);
    const buscador = page.getByTestId("gastos-buscador");
    await buscador.fill("reparacion"); // el gasto es "Reparación de heladera"
    await expect(filas(page)).toHaveCount(1);
    await buscador.fill("VIATICOS");
    await expect(filas(page)).toHaveCount(1);
    await buscador.fill("Reparación");
    await expect(filas(page)).toHaveCount(1);
    await buscador.fill("alquilér"); // tilde de más: igual lo encuentra
    await expect(filas(page)).toHaveCount(2);
  });

  test("sin coincidencias muestra 'Sin resultados' y al borrar el texto vuelve la lista", async ({ page }) => {
    await abrirGastos(page);
    const buscador = page.getByTestId("gastos-buscador");
    await buscador.fill("zzz");
    await expect(page.getByTestId("gastos-tabla-vacio")).toHaveText("Sin resultados");
    await buscador.fill("");
    await expect(filas(page)).toHaveCount(7);
  });

  test("los símbolos raros en el buscador no rompen la pantalla", async ({ page }) => {
    await abrirGastos(page);
    const errores = [];
    page.on("pageerror", (e) => errores.push(e.message));
    for (const texto of ["(", "[", "*", ".*", "\\", "<script>", "%", "'"]) {
      await page.getByTestId("gastos-buscador").fill(texto);
      await expect(page.getByTestId("gastos-tabla-vacio")).toHaveText("Sin resultados");
    }
    await page.getByTestId("gastos-buscador").fill("");
    await expect(filas(page)).toHaveCount(7);
    expect(errores).toEqual([]);
  });

  test("también busca por medio de pago", async ({ page }) => {
    await abrirGastos(page);
    await page.getByTestId("gastos-nuevo").click();
    await completar(page, { concepto: "Pago a proveedor", monto: "100" });
    await page.locator("#medio_pago_id").selectOption("2");
    await guardar(page).click();
    await expect(filas(page)).toHaveCount(8);
    await page.getByTestId("gastos-buscador").fill("transfer");
    await expect(filas(page)).toHaveCount(1);
    await expect(filas(page).first()).toContainText("Pago a proveedor");
  });

  test("la búsqueda se actualiza sola cuando se crea o elimina un gasto", async ({ page }) => {
    await abrirGastos(page);
    await page.getByTestId("gastos-buscador").fill("alquiler");
    await expect(filas(page)).toHaveCount(2);
    await crearGasto(page, { concepto: "Alquiler de depósito", monto: "100" });
    await expect(filas(page)).toHaveCount(3);
    await page.getByTestId("gastos-eliminar-1").click();
    await page.getByTestId("modal-confirmar").click();
    await expect(filas(page)).toHaveCount(2);
  });

  test("períodos con fecha fija: hoy, este mes y este año muestran las filas y el total correctos", async ({ page }) => {
    await fijarHoy(page, "2026-04-10");
    await abrirGastos(page);
    const periodo = page.getByTestId("gastos-filtro-fecha");

    await periodo.selectOption("hoy");
    await expect(filas(page)).toHaveCount(1);
    await expect(filas(page).first()).toContainText("Reparación de heladera");
    await expect(page.getByTestId("gastos-total")).toHaveText(/12\.000,00/);
    await expect(page.getByTestId("gastos-total-detalle")).toHaveText("1 gasto");

    await periodo.selectOption("mes");
    await expect(filas(page)).toHaveCount(3);
    await expect(page.getByTestId("gastos-total")).toHaveText(/470\.300,00/);

    await periodo.selectOption("anio");
    await expect(filas(page)).toHaveCount(7);
    await expect(page.getByTestId("gastos-total")).toHaveText(TOTAL_INICIAL);

    await periodo.selectOption("todas");
    await expect(page.getByTestId("gastos-total-titulo")).toHaveText("Total acumulado");
  });

  test("un período sin gastos muestra 'Sin resultados' y total en cero", async ({ page }) => {
    await fijarHoy(page, "2026-04-20");
    await abrirGastos(page);
    await page.getByTestId("gastos-filtro-fecha").selectOption("hoy");
    await expect(page.getByTestId("gastos-tabla-vacio")).toHaveText("Sin resultados");
    await expect(page.getByTestId("gastos-total")).toHaveText(/\$\s0,00/);
    await expect(page.getByTestId("gastos-total-detalle")).toHaveText("0 gastos");
  });

  test("el último día del mes cuenta como parte del mes (31 de marzo)", async ({ page }) => {
    await fijarHoy(page, "2026-03-31");
    await abrirGastos(page);
    await page.getByTestId("gastos-filtro-fecha").selectOption("mes");
    await expect(page.getByTestId("gastos-total-detalle")).toHaveText("4 gastos");
    await expect(page.getByTestId("gastos-total")).toHaveText(/524\.751,25/);
  });

  test("un gasto del 28 de febrero entra en febrero y no en marzo", async ({ page }) => {
    await fijarHoy(page, "2026-02-28");
    await abrirGastos(page);
    await crearGasto(page, { fecha: "28-02-2026", concepto: "De febrero", monto: "100" });
    await page.getByTestId("gastos-filtro-fecha").selectOption("mes");
    await expect(page.getByTestId("gastos-total-detalle")).toHaveText("1 gasto");
    await page.getByTestId("gastos-filtro-fecha").selectOption("hoy");
    await expect(page.getByTestId("gastos-total-detalle")).toHaveText("1 gasto");
  });

  test("el 1 de enero del año siguiente 'Este año' empieza en cero", async ({ page }) => {
    await fijarHoy(page, "2027-01-01");
    await abrirGastos(page);
    await page.getByTestId("gastos-filtro-fecha").selectOption("anio");
    await expect(page.getByTestId("gastos-total-detalle")).toHaveText("0 gastos");
    await expect(page.getByTestId("gastos-total-titulo")).toHaveText("Total de este año");
  });

  test("buscar dentro de un período: el total sigue el período y la lista el buscador", async ({ page }) => {
    await fijarHoy(page, "2026-04-10");
    await abrirGastos(page);
    await page.getByTestId("gastos-filtro-fecha").selectOption("mes");
    await page.getByTestId("gastos-buscador").fill("alquiler");
    await expect(filas(page)).toHaveCount(1);
    await expect(page.getByTestId("gastos-total")).toHaveText(/470\.300,00/);
    await expect(page.getByTestId("gastos-total-detalle")).toHaveText("3 gastos");
  });

  test("la tabla tiene las columnas esperadas y los montos en formato argentino", async ({ page }) => {
    await abrirGastos(page);
    await expect(page.getByTestId("gastos-tabla").locator("thead th")).toHaveText([
      "Fecha",
      "Concepto",
      "Monto",
      "Medio de pago",
      "Creado por",
      "Acciones",
    ]);
    const primera = page.getByTestId("gastos-fila-1");
    await expect(primera.locator("td").nth(0)).toHaveText("01-03-2026");
    await expect(primera.locator("td").nth(2)).toContainText("450.000,00");
    await expect(primera.locator("td").nth(4)).toHaveText("admin1");
  });
});

test.describe("Gastos: acceso y teclado", () => {
  test("el Propietario también entra a Gastos y ve el link en el menú lateral", async ({ page }) => {
    await abrirGastos(page, "PROPIETARIO");
    await expect(filas(page)).toHaveCount(7);
    await expect(page.locator('a[href="gastos.html"]').first()).toBeVisible();
  });

  test("sin sesión iniciada manda al login", async ({ page }) => {
    await page.goto("/gastos.html");
    await expect(page).toHaveURL(/login\.html$/);
  });

  test("un rol desconocido no entra a Gastos", async ({ page }) => {
    await abrirGastos(page, "VISITANTE");
    await expect(page).not.toHaveURL(/gastos\.html/);
  });

  test("el modal tiene rol de diálogo con nombre accesible", async ({ page }) => {
    await abrirGastos(page);
    await page.getByTestId("gastos-nuevo").click();
    await expect(page.getByRole("dialog", { name: "Nuevo gasto" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(modal(page)).toHaveCount(0);
  });

  test("un clic dentro del formulario no cierra el modal, pero sí en el fondo", async ({ page }) => {
    await abrirGastos(page);
    await page.getByTestId("gastos-nuevo").click();
    await page.locator("#concepto").click();
    await page.getByRole("dialog").getByRole("heading").click();
    await expect(modal(page)).toHaveCount(1);
    await modal(page).click({ position: { x: 5, y: 5 } });
    await expect(modal(page)).toHaveCount(0);
  });

  test("con el diálogo de confirmar abierto, Escape cierra solo ese diálogo", async ({ page }) => {
    await abrirGastos(page);
    await page.getByTestId("gastos-eliminar-1").click();
    await expect(modal(page)).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(modal(page)).toHaveCount(0);
    await expect(filas(page)).toHaveCount(7);
  });

  for (const campo of ["fecha", "concepto", "monto"]) {
    test(`Enter en el campo ${campo} guarda el gasto`, async ({ page }) => {
      await abrirGastos(page);
      await page.getByTestId("gastos-nuevo").click();
      await completar(page, { concepto: "Con Enter", monto: "10" });
      await page.locator(`#${campo}`).press("Enter");
      await expect(modal(page)).toHaveCount(0);
      await expect(page.getByRole("row", { name: /Con Enter/ })).toHaveCount(1);
      await expect(aviso(page)).toHaveText("Gasto registrado");
    });
  }

  test("Enter con datos inválidos muestra los errores y no guarda", async ({ page }) => {
    await abrirGastos(page);
    await page.getByTestId("gastos-nuevo").click();
    await page.locator("#concepto").press("Enter");
    await expect(errorDe(page, "concepto")).toHaveText("Completá el concepto.");
    await expect(errorDe(page, "monto")).toHaveText("Completá el monto.");
    await expect(modal(page)).toHaveCount(1);
    await expect(filas(page)).toHaveCount(7);
  });

  test("Enter repetido no duplica el gasto", async ({ page }) => {
    await abrirGastos(page, "ADMIN", { preparar: (b) => b.demorar("POST /gastos", 600) });
    await page.getByTestId("gastos-nuevo").click();
    await completar(page, { concepto: "Enter doble", monto: "10" });
    await page.locator("#monto").press("Enter");
    await page.locator("#monto").press("Enter").catch(() => {});
    await expect(modal(page)).toHaveCount(0);
    await page.waitForTimeout(800);
    await expect(page.getByRole("row", { name: /Enter doble/ })).toHaveCount(1);
  });

  test("Enter también guarda al editar", async ({ page }) => {
    await abrirGastos(page);
    await page.getByTestId("gastos-editar-2").click();
    await completar(page, { concepto: "Luz editada" });
    await page.locator("#concepto").press("Enter");
    await expect(page.getByRole("row", { name: /Luz editada/ })).toHaveCount(1);
    await expect(aviso(page)).toHaveText("Gasto actualizado");
  });

  test("Enter en el diálogo de eliminar confirma (el botón Eliminar tiene el foco)", async ({ page }) => {
    await abrirGastos(page);
    await page.getByTestId("gastos-eliminar-2").click();
    await page.keyboard.press("Enter");
    await expect(filas(page)).toHaveCount(6);
  });

  test("el concepto no tiene largo máximo (es TEXT en la base): el campo deja escribir lo que haga falta", async ({ page }) => {
    await abrirGastos(page);
    await page.getByTestId("gastos-nuevo").click();
    await expect(page.locator("#concepto")).not.toHaveAttribute("maxlength", /.*/);
    await page.locator("#concepto").click();
    await page.keyboard.insertText("a".repeat(300));
    expect((await page.locator("#concepto").inputValue()).length).toBe(300);
    await page.locator("#monto").fill("10");
    await guardar(page).click();
    await expect(page.getByRole("row", { name: /a{300}/ })).toHaveCount(1);
  });

  test("la pantalla no tira errores de JavaScript ni de red inesperados al usarla", async ({ page }) => {
    const errores = [];
    page.on("pageerror", (e) => errores.push(e.message));
    await abrirGastos(page);
    await crearGasto(page, { concepto: "Sin errores", monto: "10" });
    await page.getByTestId("gastos-editar-8").click();
    await guardar(page).click();
    await page.getByTestId("gastos-eliminar-8").click();
    await page.getByTestId("modal-confirmar").click();
    await page.getByTestId("gastos-buscador").fill("luz");
    await page.getByTestId("gastos-filtro-fecha").selectOption("anio");
    expect(errores).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// La base no acepta gastos con fecha futura (chk_gasto_fecha_no_futura): la pantalla tampoco.
// ---------------------------------------------------------------------------

test.describe("Gastos: fecha futura", () => {
  test("mañana se rechaza, con el mensaje junto al campo y el foco en la fecha", async ({ page }) => {
    await fijarHoy(page, "2026-04-10");
    await abrirGastos(page);
    await page.getByTestId("gastos-nuevo").click();
    await completar(page, { fecha: "11-04-2026", concepto: "De mañana", monto: "100" });
    await guardar(page).click();
    await expect(errorDe(page, "fecha")).toHaveText("La fecha no puede ser futura.");
    await expect(page.locator("#fecha")).toBeFocused();
    await expect(page.locator("#fecha")).toHaveClass(/con-error/);
    await expect(page.getByTestId("modal")).toHaveCount(1);
    await expect(filas(page)).toHaveCount(7);
    await expect(aviso(page)).toHaveCount(0);
  });

  test("hoy y ayer se aceptan", async ({ page }) => {
    await fijarHoy(page, "2026-04-10");
    await abrirGastos(page);
    await crearGasto(page, { fecha: "10-04-2026", concepto: "De hoy", monto: "100" });
    await crearGasto(page, { fecha: "09-04-2026", concepto: "De ayer", monto: "100" });
    await expect(filas(page)).toHaveCount(9);
  });

  test("la fecha que viene por defecto al abrir el formulario (hoy) es válida", async ({ page }) => {
    await fijarHoy(page, "2026-04-10");
    await abrirGastos(page);
    await page.getByTestId("gastos-nuevo").click();
    await completar(page, { concepto: "Con la fecha de hoy", monto: "100" });
    await guardar(page).click();
    await expect(page.getByTestId("modal")).toHaveCount(0);
    await expect(filas(page)).toHaveCount(8);
  });

  test("también se rechaza escrita como aaaa-mm-dd", async ({ page }) => {
    await fijarHoy(page, "2026-04-10");
    await abrirGastos(page);
    await page.getByTestId("gastos-nuevo").click();
    await completar(page, { fecha: "2026-04-11", concepto: "De mañana", monto: "100" });
    await guardar(page).click();
    await expect(errorDe(page, "fecha")).toHaveText("La fecha no puede ser futura.");
  });

  test("el error desaparece al corregir la fecha y entonces se puede guardar", async ({ page }) => {
    await fijarHoy(page, "2026-04-10");
    await abrirGastos(page);
    await page.getByTestId("gastos-nuevo").click();
    await completar(page, { fecha: "01-01-2099", concepto: "Corregido", monto: "100" });
    await guardar(page).click();
    await expect(errorDe(page, "fecha")).toBeVisible();
    await page.locator("#fecha").fill("10-04-2026");
    await expect(errorDe(page, "fecha")).toBeHidden();
    await guardar(page).click();
    await expect(page.getByTestId("modal")).toHaveCount(0);
    await expect(page.getByRole("row", { name: /Corregido/ })).toHaveCount(1);
  });

  test("una fecha futura no oculta los errores de los otros campos", async ({ page }) => {
    await fijarHoy(page, "2026-04-10");
    await abrirGastos(page);
    await page.getByTestId("gastos-nuevo").click();
    await page.locator("#fecha").fill("01-01-2099");
    await guardar(page).click();
    await expect(errorDe(page, "fecha")).toHaveText("La fecha no puede ser futura.");
    await expect(errorDe(page, "concepto")).toHaveText("Completá el concepto.");
    await expect(errorDe(page, "monto")).toHaveText("Completá el monto.");
  });

  test("al editar, pasar un gasto a una fecha futura se rechaza y el gasto no cambia", async ({ page }) => {
    await fijarHoy(page, "2026-04-10");
    await abrirGastos(page);
    await page.getByTestId("gastos-editar-2").click();
    await completar(page, { fecha: "11-04-2026" });
    await guardar(page).click();
    await expect(errorDe(page, "fecha")).toHaveText("La fecha no puede ser futura.");
    await page.getByTestId("modal-cancelar").click();
    await expect(page.getByTestId("gastos-fila-2").locator("td").nth(0)).toHaveText("05-03-2026");
    await expect(page.getByTestId("gastos-total")).toHaveText(TOTAL_INICIAL);
  });

  test("al editar, mover un gasto a hoy o a una fecha anterior sigue funcionando", async ({ page }) => {
    await fijarHoy(page, "2026-04-10");
    await abrirGastos(page);
    await page.getByTestId("gastos-editar-2").click();
    await completar(page, { fecha: "10-04-2026" });
    await guardar(page).click();
    await expect(aviso(page)).toHaveText("Gasto actualizado");
    await expect(page.getByTestId("gastos-fila-2").locator("td").nth(0)).toHaveText("10-04-2026");
  });

  test("los gastos de ejemplo, todos anteriores a hoy, se pueden editar sin tocar la fecha", async ({ page }) => {
    await fijarHoy(page, "2026-04-10");
    await abrirGastos(page);
    for (const id of [1, 4, 7]) {
      await page.getByTestId(`gastos-editar-${id}`).click();
      await guardar(page).click();
      await expect(page.getByTestId("modal")).toHaveCount(0);
    }
  });

  test("Enter con una fecha futura muestra el error y no guarda", async ({ page }) => {
    await fijarHoy(page, "2026-04-10");
    await abrirGastos(page);
    await page.getByTestId("gastos-nuevo").click();
    await completar(page, { fecha: "11-04-2026", concepto: "De mañana", monto: "100" });
    await page.locator("#concepto").press("Enter");
    await expect(errorDe(page, "fecha")).toHaveText("La fecha no puede ser futura.");
    await expect(filas(page)).toHaveCount(7);
  });
});

// ---------------------------------------------------------------------------
// Nombres y tipos de la base: el medio de pago viaja como número entero (INT) y "Creado por" sale de creado_por.
// Lo que la pantalla envía al guardar se lee de lo que recibió el Backend falso.
// ---------------------------------------------------------------------------

// Lo que la pantalla envía al guardar lo registra el Backend falso.
const registrarEnvios = async () => {};
const enviados = async (_page, clave) => backend.enviados(clave === "__crear" ? "POST" : "PUT", clave === "__crear" ? "/gastos" : "/gastos/:id");

test.describe("Gastos: lo que se envía y lo que se muestra, con los nombres de la base", () => {
  test("el medio de pago elegido viaja como número entero, no como texto", async ({ page }) => {
    await registrarEnvios(page);
    await abrirGastos(page);
    await page.getByTestId("gastos-nuevo").click();
    await completar(page, { concepto: "Con medio", monto: "100" });
    await page.locator("#medio_pago_id").selectOption("2");
    await guardar(page).click();
    await expect(page.getByRole("row", { name: /Con medio/ })).toContainText("Transferencia");
    const [envio] = await enviados(page, "__crear");
    expect(envio.medio_pago_id).toBe(2);
    expect(typeof envio.medio_pago_id).toBe("number");
  });

  test("sin medio de pago viaja null", async ({ page }) => {
    await registrarEnvios(page);
    await abrirGastos(page);
    await crearGasto(page, { concepto: "Sin medio", monto: "100" });
    expect((await enviados(page, "__crear"))[0].medio_pago_id).toBeNull();
  });

  test("al editar, el medio de pago también viaja como número, y quitarlo manda null", async ({ page }) => {
    await registrarEnvios(page);
    await abrirGastos(page);
    await page.getByTestId("gastos-editar-2").click();
    await page.locator("#medio_pago_id").selectOption("1");
    await guardar(page).click();
    await expect(aviso(page)).toHaveText("Gasto actualizado");
    await page.getByTestId("gastos-editar-2").click();
    await expect(page.locator("#medio_pago_id")).toHaveValue("1");
    await page.locator("#medio_pago_id").selectOption("");
    await guardar(page).click();
    await expect(modal(page)).toHaveCount(0);
    const envios = await enviados(page, "__actualizar");
    expect(envios.map((e) => e.medio_pago_id)).toEqual([1, null]);
  });

  test("el envío lleva solo fecha, concepto, monto y medio de pago", async ({ page }) => {
    await registrarEnvios(page);
    await abrirGastos(page);
    await crearGasto(page, { fecha: "09-04-2026", concepto: "  Con espacios  ", monto: "1234.5" });
    const [envio] = await enviados(page, "__crear");
    expect(envio).toEqual({ fecha: "2026-04-09", concepto: "Con espacios", monto: 1234.5, medio_pago_id: null });
  });

  test("«Creado por» muestra quién creó cada gasto: el usuario de ejemplo y el de la sesión para los nuevos", async ({ page }) => {
    await abrirGastos(page);
    await expect(filas(page).first().locator("td").nth(4)).toHaveText("admin1");
    await crearGasto(page, { concepto: "Nuevo", monto: "10" });
    await expect(filas(page).filter({ hasText: "Nuevo" }).locator("td").nth(4)).toHaveText("usuario1");
  });

  test("al editar un gasto, «Creado por» no cambia", async ({ page }) => {
    await abrirGastos(page);
    await page.getByTestId("gastos-editar-2").click();
    await completar(page, { concepto: "Luz editada" });
    await guardar(page).click();
    await expect(page.getByRole("row", { name: /Luz editada/ }).locator("td").nth(4)).toHaveText("admin1");
  });
});

// ---------------------------------------------------------------------------
// «Eliminar» frente a `activo` (como en la base): un gasto eliminado queda inactivo y no se lista ni se suma.
// Para quien usa la pantalla se ve igual que un borrado.
// ---------------------------------------------------------------------------

test.describe("Gastos: eliminar desactiva el gasto", () => {
  const eliminarGasto = async (page, id) => {
    await page.getByTestId(`gastos-eliminar-${id}`).click();
    await page.getByTestId("modal-confirmar").click();
    await expect(page.getByTestId(`gastos-eliminar-${id}`)).toHaveCount(0);
  };

  test("un gasto eliminado no vuelve a aparecer al cambiar de período, al buscar ni al crear otro", async ({ page }) => {
    await fijarHoy(page, "2026-04-10");
    await abrirGastos(page);
    await eliminarGasto(page, 2);
    await page.getByTestId("gastos-filtro-fecha").selectOption("anio");
    await expect(page.getByTestId("gastos-eliminar-2")).toHaveCount(0);
    await page.getByTestId("gastos-filtro-fecha").selectOption("todas");
    await page.getByTestId("gastos-buscador").fill("luz");
    await expect(page.getByTestId("gastos-tabla-vacio")).toHaveText("Sin resultados");
    await page.getByTestId("gastos-buscador").fill("");
    await crearGasto(page, { concepto: "Otro gasto", monto: "10" });
    await expect(page.getByTestId("gastos-eliminar-2")).toHaveCount(0);
    await expect(filas(page)).toHaveCount(7);
  });

  test("el total del período no cuenta lo eliminado, en ningún período", async ({ page }) => {
    await fijarHoy(page, "2026-03-20");
    await abrirGastos(page);
    await page.getByTestId("gastos-filtro-fecha").selectOption("mes");
    await expect(page.getByTestId("gastos-total")).toHaveText(/524\.751,25/);
    await eliminarGasto(page, 2);
    await expect(page.getByTestId("gastos-total")).toHaveText(/486\.500,75/);
    await expect(page.getByTestId("gastos-total-detalle")).toHaveText("3 gastos");
    await page.getByTestId("gastos-filtro-fecha").selectOption("todas");
    await expect(page.getByTestId("gastos-total")).toHaveText(/956\.800,75/);
  });

  test("los gastos nuevos siguen teniendo un número propio aunque se hayan eliminado otros", async ({ page }) => {
    await abrirGastos(page);
    await eliminarGasto(page, 7);
    await crearGasto(page, { concepto: "Después de eliminar", monto: "10" });
    await expect(page.getByTestId("gastos-editar-8")).toBeVisible();
    await expect(page.getByTestId("gastos-editar-7")).toHaveCount(0);
  });

  test("se pueden eliminar todos y volver a crear", async ({ page }) => {
    await abrirGastos(page);
    for (let id = 1; id <= 7; id++) await eliminarGasto(page, id);
    await expect(page.getByTestId("gastos-tabla-vacio")).toHaveText("Sin gastos");
    await crearGasto(page, { concepto: "Volver a empezar", monto: "100" });
    await expect(filas(page)).toHaveCount(1);
    await expect(page.getByTestId("gastos-total-detalle")).toHaveText("1 gasto");
  });

  test("un gasto eliminado se puede volver a crear con el mismo concepto y monto (no hay nombres únicos)", async ({ page }) => {
    await abrirGastos(page);
    await eliminarGasto(page, 2);
    await crearGasto(page, { fecha: "05-03-2026", concepto: "Luz", monto: "38250.50" });
    await expect(page.getByRole("row", { name: /Luz/ })).toHaveCount(1);
    await expect(page.getByTestId("gastos-total")).toHaveText(TOTAL_INICIAL);
  });
});

// ---------------------------------------------------------------------------
// El concepto es TEXT en la base: no tiene largo máximo.
// ---------------------------------------------------------------------------

test.describe("Gastos: el concepto no tiene largo máximo", () => {
  test("un concepto de más de 100 caracteres, con palabras, se guarda completo", async ({ page }) => {
    await abrirGastos(page);
    const largo = "Pago de alquiler y expensas del local comercial, incluye el ajuste trimestral. ".repeat(6).trim();
    expect(largo.length).toBeGreaterThan(400);
    await crearGasto(page, { concepto: largo, monto: "100" });
    await expect(filas(page).filter({ hasText: "ajuste trimestral" }).locator("td").nth(1)).toHaveText(largo);
    await expect(aviso(page)).toHaveText("Gasto registrado");
  });

  test("no aparece ningún mensaje de largo al guardar un concepto largo", async ({ page }) => {
    await abrirGastos(page);
    await page.getByTestId("gastos-nuevo").click();
    await completar(page, { concepto: "x".repeat(1500), monto: "100" });
    await guardar(page).click();
    await expect(errorDe(page, "concepto")).toBeHidden();
    await expect(modal(page)).toHaveCount(0);
  });

  test("al editar un gasto con un concepto largo, el formulario lo abre completo", async ({ page }) => {
    await abrirGastos(page);
    const largo = "y".repeat(800);
    await crearGasto(page, { concepto: largo, monto: "100" });
    await page.getByTestId("gastos-editar-8").click();
    await expect(page.locator("#concepto")).toHaveValue(largo);
    await completar(page, { concepto: `${largo}!` });
    await guardar(page).click();
    await expect(filas(page).filter({ hasText: "yyyyyyyyyy" }).locator("td").nth(1)).toHaveText(`${largo}!`);
  });

  test("el concepto sigue siendo obligatorio", async ({ page }) => {
    await abrirGastos(page);
    await page.getByTestId("gastos-nuevo").click();
    await completar(page, { concepto: "   ", monto: "100" });
    await guardar(page).click();
    await expect(errorDe(page, "concepto")).toHaveText("Completá el concepto.");
  });

  test("el diálogo de eliminar muestra el concepto largo completo", async ({ page }) => {
    await abrirGastos(page);
    const largo = "z".repeat(600);
    await crearGasto(page, { concepto: largo, monto: "100" });
    await page.getByTestId("gastos-eliminar-8").click();
    await expect(modal(page)).toContainText(`¿Eliminar "${largo}" definitivamente?`);
  });

  test("la búsqueda encuentra el final de un concepto largo", async ({ page }) => {
    await abrirGastos(page);
    await crearGasto(page, { concepto: `${"a".repeat(500)} palabrafinal`, monto: "100" });
    await page.getByTestId("gastos-buscador").fill("palabrafinal");
    await expect(filas(page)).toHaveCount(1);
  });
});

// ---------------------------------------------------------------------------
// Datos de auditoría de la base (creado_por, creado_en, modificado_por, modificado_en) a la vista.
// El navegador usa la hora de Buenos Aires para que las horas sean siempre las mismas.
// ---------------------------------------------------------------------------

test.describe("Gastos: quién y cuándo creó y modificó cada gasto", () => {
  test.use({ timezoneId: "America/Argentina/Buenos_Aires" });
  const AHORA = new Date("2026-04-10T15:00:00Z"); // 12:00 en Buenos Aires
  const auditoria = (page) => page.getByTestId("gasto-auditoria");

  test("al editar, el formulario dice quién y cuándo creó el gasto", async ({ page }) => {
    await abrirGastos(page);
    await page.getByTestId("gastos-editar-2").click();
    await expect(auditoria(page)).toHaveText("Creado por admin1 el 05-03-2026 08:30");
  });

  test("al crear, el formulario no muestra datos de auditoría", async ({ page }) => {
    await abrirGastos(page);
    await page.getByTestId("gastos-nuevo").click();
    await expect(auditoria(page)).toHaveCount(0);
  });

  test("«Creado por» muestra el nombre y, al pasar el mouse, el día y la hora", async ({ page }) => {
    await abrirGastos(page);
    const celdaCreador = page.getByTestId("gastos-fila-2").locator("td").nth(4);
    await expect(celdaCreador).toHaveText("admin1");
    await expect(celdaCreador.locator("span")).toHaveAttribute("title", "Creado por admin1 el 05-03-2026 08:30");
  });

  test("un gasto recién creado dice que lo creó el usuario de la sesión, con la hora actual", async ({ page }) => {
    await page.clock.setFixedTime(AHORA);
    await abrirGastos(page, "ADMIN", { ahora: AHORA });
    await crearGasto(page, { fecha: "10-04-2026", concepto: "Nuevo", monto: "10" });
    await expect(filas(page).filter({ hasText: "Nuevo" }).locator("td").nth(4).locator("span")).toHaveAttribute("title", "Creado por usuario1 el 10-04-2026 12:00");
    await page.getByTestId("gastos-editar-8").click();
    await expect(auditoria(page)).toHaveText("Creado por usuario1 el 10-04-2026 12:00");
  });

  test("después de editar, se agrega quién y cuándo lo modificó, y lo de la creación no cambia", async ({ page }) => {
    await page.clock.setFixedTime(AHORA);
    await abrirGastos(page, "ADMIN", { ahora: AHORA });
    await page.getByTestId("gastos-editar-2").click();
    await completar(page, { concepto: "Luz editada" });
    await guardar(page).click();
    await expect(aviso(page)).toHaveText("Gasto actualizado");
    await page.getByTestId("gastos-editar-2").click();
    await expect(auditoria(page)).toHaveText("Creado por admin1 el 05-03-2026 08:30 · Modificado por usuario1 el 10-04-2026 12:00");
  });

  test("un gasto sin modificar nunca dice «Modificado»", async ({ page }) => {
    await abrirGastos(page);
    for (const id of [1, 4, 7]) {
      await page.getByTestId(`gastos-editar-${id}`).click();
      await expect(auditoria(page)).not.toContainText("Modificado");
      await page.getByTestId("modal-cancelar").click();
    }
  });

  test("cancelar una edición no marca el gasto como modificado", async ({ page }) => {
    await abrirGastos(page);
    await page.getByTestId("gastos-editar-2").click();
    await completar(page, { concepto: "No se guarda" });
    await page.getByTestId("modal-cancelar").click();
    await page.getByTestId("gastos-editar-2").click();
    await expect(auditoria(page)).not.toContainText("Modificado");
  });

  test("la línea de auditoría convive con el aviso de recálculo y no lo reemplaza", async ({ page }) => {
    await abrirGastos(page);
    await page.getByTestId("gastos-editar-2").click();
    await expect(modal(page).locator(".gastos-banner")).toHaveText("Si cambiás la fecha o el monto, se recalcula el total del período.");
    await expect(auditoria(page)).toBeVisible();
    await page.locator("#monto").fill("5");
    await expect(modal(page).locator(".gastos-banner")).toHaveCount(1);
    await expect(auditoria(page)).toHaveCount(1);
  });
});
