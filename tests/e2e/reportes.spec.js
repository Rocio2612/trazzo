const { test, expect } = require("@playwright/test");
const { simularApi, iniciarSesionComo } = require("./helpers");

// La pantalla le pide GET /reportes?periodo= al Backend. Acá ese pedido se intercepta (sin Backend) y se responde con los datos de
// ejemplo de frontend/js/mocks/reportes.js. Para que los números no cambien con el día en que se corren los tests, el reloj se fija
// el 15-11-2026: "Este mes" es noviembre de 2026 y "Este año", 2026.
// Valores de los ejemplos (verificados a mano):
//   Hoy       Ingresos $ 0 · Desglose $ 1.700 (Sifón: 2 unidades compradas hoy)
//   Este mes  Ingresos $ 11.730 · Vendido y saldado $ 11.730 (falta saldar 1) · CMV $ 10.380 · Ganancia bruta $ 5.610 · Gastos $ 0 · Neta $ 5.610 · Desglose $ 25.700
//   Este año  Ingresos $ 147.930 · Vendido y saldado $ 102.270 (faltan 4) · CMV $ 203.600 · Bruta $ 101.130 · Gastos $ 995.051,25 · Bienes $ 2.967.000 · Neta -$ 1.333.621,25 · Desglose $ 241.330
//   Siempre   Inversión actual en inventario $ 241.330 · Por cobrar $ 156.800
const HOY = new Date("2026-11-15T12:00:00");

const apiBasica = (page) =>
  simularApi(page, {
    "GET /auth/yo": { status: 200, body: { status: "ok" } },
    "GET /notificaciones/contador": { status: 200, body: { cantidad: 0 } },
    "GET /notificaciones": { status: 200, body: [] },
  });

const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,OPTIONS" };

// Intercepta GET /reportes. `responder(periodo)` devuelve { status, body } o { abortar: true } (backend caído).
// Devuelve la lista de pedidos que hizo la pantalla. Hay que llamarla después de apiBasica para que tenga prioridad.
const simularReportes = async (page, responder) => {
  const pedidos = [];
  await page.route(
    (url) => url.pathname === "/api/reportes",
    async (route) => {
      const request = route.request();
      if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
      const periodo = new URL(request.url()).searchParams.get("periodo");
      pedidos.push({ metodo: request.method(), periodo, autorizacion: request.headers().authorization });
      const { abortar, status = 200, body } = await responder(periodo);
      if (abortar) return route.abort();
      return route.fulfill({ status, headers: CORS, json: body });
    },
  );
  return pedidos;
};

// Respuesta con los datos de ejemplo. Se calculan dentro de la página para que usen su reloj fijo y la falla simulada.
const conEjemplos = (page) => async (periodo) => ({
  body: await page.evaluate(async (elegido) => {
    const { servicioReportes } = await import("/js/mocks/reportes.js");
    return servicioReportes.obtener({ periodo: elegido });
  }, periodo),
});

const abrirReportes = async (page, { rol = "ADMIN", falla = "", responder } = {}) => {
  await page.clock.setFixedTime(HOY);
  if (falla) await page.addInitScript((servicio) => sessionStorage.setItem("trazzo_reportes_falla", servicio), falla);
  await apiBasica(page);
  const pedidos = await simularReportes(page, responder ?? conEjemplos(page));
  await iniciarSesionComo(page, rol);
  await page.goto("/reportes.html");
  return pedidos;
};

const abrirReportesComoAdmin = async (page, opciones) => {
  await abrirReportes(page, opciones);
  await expect(page.getByTestId("rep-ingresos")).toBeVisible();
};

const valor = (page, id) => page.getByTestId(`rep-${id}-valor`);
const cambiarPeriodo = async (page, periodo) => {
  await page.getByTestId("reportes-filtro-periodo").selectOption(periodo);
  await expect(page.getByTestId("rep-ingresos")).toBeVisible(); // terminó de actualizar
};

test.describe("Reportes: pantalla del Administrador", () => {
  test("muestra el título, el filtro de período en 'Este mes' y todas las tarjetas", async ({ page }) => {
    await abrirReportesComoAdmin(page);
    await expect(page.getByRole("heading", { name: "Reportes", level: 1 })).toBeVisible();
    await expect(page.getByTestId("reportes-filtro-periodo")).toHaveValue("mes");
    await expect(page.getByTestId("reportes-filtro-periodo").locator("option")).toHaveText(["Hoy", "Este mes", "Este año"]);
    await expect(page.getByRole("heading", { name: "Indicadores principales" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Estado actual" })).toBeVisible();
    for (const id of ["ingresos", "vendido-saldado", "cmv", "ganancia-bruta", "gastos", "bienes-uso", "ganancia-neta", "inventario", "por-cobrar"]) {
      await expect(page.getByTestId(`rep-${id}`)).toBeVisible();
    }
    await expect(page.getByText("CMV (Costo de Mercadería Vendida)")).toBeVisible();
    await expect(page.getByText("Ganancia neta operativa estimada")).toBeVisible();
    await expect(page.getByText("Inversión realizada en bienes de uso")).toBeVisible();
  });

  test("'Este mes': los indicadores del período con los ejemplos", async ({ page }) => {
    await abrirReportesComoAdmin(page);
    await expect(valor(page, "ingresos")).toHaveText(/^\$\s11\.730,00$/);
    await expect(valor(page, "vendido-saldado")).toHaveText(/11\.730,00/);
    await expect(page.getByTestId("rep-faltan-saldar")).toHaveText("1 venta confirmada falta por saldar");
    await expect(valor(page, "cmv")).toHaveText(/10\.380,00/);
    await expect(valor(page, "ganancia-bruta")).toHaveText(/5\.610,00/);
    await expect(valor(page, "gastos")).toHaveText(/\$\s0,00/);
    await expect(valor(page, "bienes-uso")).toHaveText(/\$\s0,00/);
    await expect(valor(page, "ganancia-neta")).toHaveText(/5\.610,00/);
  });

  test("cambiar el período recalcula las tarjetas y el desglose", async ({ page }) => {
    await abrirReportesComoAdmin(page);
    await expect(valor(page, "ingresos")).toHaveText(/11\.730,00/);

    await cambiarPeriodo(page, "anio");
    await expect(valor(page, "ingresos")).toHaveText(/147\.930,00/);
    await expect(valor(page, "vendido-saldado")).toHaveText(/102\.270,00/);
    await expect(page.getByTestId("rep-faltan-saldar")).toHaveText("4 ventas confirmadas faltan por saldar");
    await expect(valor(page, "cmv")).toHaveText(/203\.600,00/);
    await expect(valor(page, "ganancia-bruta")).toHaveText(/101\.130,00/);
    await expect(valor(page, "gastos")).toHaveText(/995\.051,25/);
    await expect(valor(page, "bienes-uso")).toHaveText(/2\.967\.000,00/);
    await expect(page.getByTestId("rep-desglose-total")).toHaveText(/241\.330,00/);

    await cambiarPeriodo(page, "hoy");
    await expect(valor(page, "ingresos")).toHaveText(/\$\s0,00/);
    await expect(valor(page, "cmv")).toHaveText(/\$\s0,00/);
    await expect(page.getByTestId("rep-faltan-saldar")).toHaveText("0 ventas confirmadas faltan por saldar");
    await expect(page.getByTestId("rep-desglose-total")).toHaveText(/1\.700,00/);

    await cambiarPeriodo(page, "mes");
    await expect(valor(page, "ingresos")).toHaveText(/11\.730,00/);
  });

  test("pide GET /reportes con el período elegido y el token de la sesión", async ({ page }) => {
    const pedidos = await abrirReportes(page);
    await expect(page.getByTestId("rep-ingresos")).toBeVisible();
    await cambiarPeriodo(page, "anio");
    await expect(valor(page, "ingresos")).toHaveText(/147\.930,00/);
    expect(pedidos.map((p) => `${p.metodo} ${p.periodo}`)).toEqual(["GET mes", "GET anio"]);
    for (const pedido of pedidos) expect(pedido.autorizacion).toMatch(/^Bearer .+/);
  });

  test("mientras recalcula muestra 'Actualizando indicadores…'", async ({ page }) => {
    await abrirReportesComoAdmin(page);
    await page.getByTestId("reportes-filtro-periodo").selectOption("anio");
    await expect(page.getByTestId("reportes-actualizando")).toHaveText("Actualizando indicadores…");
    await expect(valor(page, "ingresos")).toBeVisible();
    await expect(page.getByTestId("reportes-actualizando")).toHaveCount(0);
  });

  test("si se cambia de período dos veces seguidas queda el último", async ({ page }) => {
    await abrirReportesComoAdmin(page);
    const filtro = page.getByTestId("reportes-filtro-periodo");
    await filtro.selectOption("hoy");
    await filtro.selectOption("anio");
    await expect(valor(page, "ingresos")).toHaveText(/147\.930,00/);
    await expect(page.getByTestId("rep-desglose-total")).toHaveText(/241\.330,00/);
    await expect(filtro).toHaveValue("anio");
  });

  test("todo el dinero se ve con el mismo formato argentino ($ 1.234,56)", async ({ page }) => {
    await abrirReportesComoAdmin(page);
    for (const periodo of ["mes", "anio", "hoy"]) {
      await cambiarPeriodo(page, periodo);
      const valores = await page.locator('[data-testid^="rep-"][data-testid$="-valor"]').allTextContents();
      expect(valores).toHaveLength(9);
      for (const texto of valores) expect(texto).toMatch(/^-?\$\s\d{1,3}(\.\d{3})*,\d{2}$/);
      const celdas = await page.locator('[data-testid="rep-desglose"] td.num').allTextContents();
      for (const texto of celdas.filter((t) => t.includes("$"))) expect(texto).toMatch(/^\$\s\d{1,3}(\.\d{3})*,\d{2}$/);
    }
  });

  test("una ganancia negativa se muestra en rojo con el signo menos; una positiva no", async ({ page }) => {
    await abrirReportesComoAdmin(page);
    await expect(valor(page, "ganancia-neta")).not.toHaveClass(/reportes-valor-negativo/);
    await cambiarPeriodo(page, "anio");
    await expect(valor(page, "ganancia-neta")).toHaveText(/^-\$\s1\.333\.621,25$/);
    await expect(valor(page, "ganancia-neta")).toHaveClass(/reportes-valor-negativo/);
    await expect(valor(page, "ganancia-bruta")).not.toHaveClass(/reportes-valor-negativo/);
  });

  test("'Estado actual' no cambia con el período y dice 'Al día de hoy'", async ({ page }) => {
    await abrirReportesComoAdmin(page);
    for (const periodo of ["mes", "anio", "hoy"]) {
      await cambiarPeriodo(page, periodo);
      await expect(valor(page, "inventario")).toHaveText(/241\.330,00/);
      await expect(valor(page, "por-cobrar")).toHaveText(/156\.800,00/);
    }
    await expect(page.getByTestId("rep-inventario-al-dia")).toHaveText("Al día de hoy");
    await expect(page.getByTestId("rep-por-cobrar-al-dia")).toHaveText("Al día de hoy");
    await expect(page.getByTestId("rep-ingresos").getByText("Al día de hoy")).toHaveCount(0);
  });

  test("el desglose de inversión lista los productos por inversión de mayor a menor, con su total", async ({ page }) => {
    await abrirReportesComoAdmin(page);
    const filas = page.locator('[data-testid="rep-desglose"] tbody tr');
    await expect(filas).toHaveCount(4); // 3 productos + el total
    await expect(filas.nth(0)).toContainText("Detergente 750 ml");
    await expect(filas.nth(0)).toContainText(/24.*620,00.*14\.880,00/);
    await expect(filas.nth(1)).toContainText("Lavandina 1 l");
    await expect(filas.nth(2)).toContainText("Sifón de soda 1.5 l");
    await expect(filas.nth(3)).toContainText("Total invertido en el período");
    await expect(page.getByTestId("rep-desglose-total")).toHaveText(/25\.700,00/);
    await expect(page.getByText("Este monto refleja capital acumulado, no es una pérdida.")).toBeVisible();
    await expect(page.getByRole("columnheader")).toHaveText(["Producto", "Unidades en stock", "Costo unitario", "Inversión"]);
  });

  test("el desglose muestra el período elegido y no incluye productos sin stock (Bidón)", async ({ page }) => {
    await abrirReportesComoAdmin(page);
    await expect(page.locator(".reportes-desglose-titulo")).toContainText("Este mes");
    await cambiarPeriodo(page, "anio");
    await expect(page.locator(".reportes-desglose-titulo")).toContainText("Este año");
    await expect(page.locator('[data-testid="rep-desglose"] tbody tr')).toHaveCount(14); // 13 productos con stock + el total
    await expect(page.getByTestId("rep-desglose")).not.toContainText("Bidón de agua 20 l"); // stock 0
  });

  test("es de solo lectura: no hay botones ni campos para editar", async ({ page }) => {
    await abrirReportesComoAdmin(page);
    await expect(page.locator("main button")).toHaveCount(0);
    await expect(page.locator("main input")).toHaveCount(0);
    await expect(page.locator("main select")).toHaveCount(1); // solo el filtro de período
  });

  test("con el menú lateral abierto o cerrado el contenido se acomoda al ancho disponible", async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await abrirReportesComoAdmin(page);
    const ancho = () => page.locator("main").evaluate((m) => Math.round(m.getBoundingClientRect().width));
    const abierto = await ancho();
    await page.getByTestId("btn-contraer-menu").click();
    await expect.poll(ancho).toBeGreaterThan(abierto + 100); // gana lo que el menú pierde
    await page.getByTestId("btn-contraer-menu").click();
    await expect.poll(ancho).toBe(abierto);
  });
});

test.describe("Reportes: si un servicio falla, lo demás se sigue viendo", () => {
  test("falla Finanzas: avisa y marca gastos, bienes de uso y ganancia neta", async ({ page }) => {
    await abrirReportesComoAdmin(page, { falla: "finanzas" });
    const aviso = page.getByTestId("reportes-aviso-parcial");
    await expect(aviso).toHaveText("No se pudieron calcular algunos indicadores por una falla en Finanzas.");
    for (const id of ["gastos", "bienes-uso", "ganancia-neta"]) {
      await expect(page.getByTestId(`rep-${id}-error`)).toHaveText("No se pudo calcular");
      await expect(page.getByTestId(`rep-${id}`).locator("p")).toHaveCount(0); // sin otro texto de error
    }
    // lo que no depende de Finanzas sigue normal
    await expect(valor(page, "ingresos")).toHaveText(/11\.730,00/);
    await expect(valor(page, "cmv")).toHaveText(/10\.380,00/);
    await expect(valor(page, "inventario")).toHaveText(/241\.330,00/);
    await expect(page.getByTestId("rep-desglose-total")).toHaveText(/25\.700,00/);
  });

  test("falla Productos: no se calculan el inventario ni el desglose", async ({ page }) => {
    await abrirReportesComoAdmin(page, { falla: "productos" });
    await expect(page.getByTestId("reportes-aviso-parcial")).toContainText("una falla en Productos.");
    await expect(page.getByTestId("rep-inventario-error")).toHaveText("No se pudo calcular");
    await expect(page.getByTestId("rep-desglose-error")).toHaveText("No se pudo calcular");
    await expect(page.getByTestId("rep-desglose")).toHaveCount(0);
    await expect(valor(page, "ingresos")).toHaveText(/11\.730,00/);
    await expect(valor(page, "gastos")).toBeVisible();
    await expect(valor(page, "por-cobrar")).toHaveText(/156\.800,00/);
  });

  test("falla Transacciones: no se calculan ventas, ganancias ni 'Por cobrar'", async ({ page }) => {
    await abrirReportesComoAdmin(page, { falla: "transacciones" });
    await expect(page.getByTestId("reportes-aviso-parcial")).toContainText("una falla en Transacciones.");
    for (const id of ["ingresos", "vendido-saldado", "cmv", "ganancia-bruta", "ganancia-neta", "por-cobrar"]) {
      await expect(page.getByTestId(`rep-${id}-error`)).toHaveText("No se pudo calcular");
    }
    await expect(page.getByTestId("rep-faltan-saldar")).toHaveCount(0);
    await expect(valor(page, "gastos")).toBeVisible();
    await expect(valor(page, "bienes-uso")).toBeVisible();
    await expect(valor(page, "inventario")).toHaveText(/241\.330,00/);
  });

  test("la falla sigue marcada al cambiar de período", async ({ page }) => {
    await abrirReportesComoAdmin(page, { falla: "finanzas" });
    await page.getByTestId("reportes-filtro-periodo").selectOption("anio");
    await expect(page.getByTestId("rep-gastos-error")).toBeVisible();
    await expect(valor(page, "ingresos")).toHaveText(/147\.930,00/);
  });

  test("sin fallas no aparece ningún aviso", async ({ page }) => {
    await abrirReportesComoAdmin(page);
    await expect(page.getByTestId("reportes-aviso-parcial")).toHaveCount(0);
    await expect(page.getByText("No se pudo calcular")).toHaveCount(0);
  });
});

test.describe("Reportes: acceso por rol", () => {
  test("el Administrador ve el link en el menú y entra desde ahí", async ({ page }) => {
    await page.clock.setFixedTime(HOY);
    await apiBasica(page);
    await simularReportes(page, conEjemplos(page));
    await iniciarSesionComo(page, "ADMIN");
    await page.goto("/dashboard.html");
    await page.getByTestId("menu-reportes").click();
    await expect(page).toHaveURL(/reportes\.html$/);
    await expect(page.getByTestId("menu-reportes")).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("rep-ingresos")).toBeVisible();
  });

  test("el Cajero no ve el link a Reportes en el menú", async ({ page }) => {
    await page.clock.setFixedTime(HOY);
    await apiBasica(page);
    await iniciarSesionComo(page, "CAJERO");
    await page.goto("/dashboard.html");
    await expect(page.getByTestId("menu-ventas")).toBeVisible();
    await expect(page.getByTestId("menu-reportes")).toHaveCount(0);
  });

  test("el Cajero que entra por la dirección ve el aviso 403 y vuelve al Panel sin ver ningún dato", async ({ page }) => {
    const mensajes = [];
    page.on("dialog", async (dialogo) => {
      mensajes.push(dialogo.message());
      await dialogo.accept();
    });
    await abrirReportes(page, { rol: "CAJERO" });
    await expect(page).toHaveURL(/dashboard\.html$/);
    expect(mensajes).toEqual(["Acceso denegado (403): no tenés permiso para ver Reportes."]);
    await expect(page.locator('[data-testid^="rep-"]')).toHaveCount(0);
  });

  test("el Propietario también ve el link y entra a Reportes", async ({ page }) => {
    await abrirReportesComoAdmin(page, { rol: "PROPIETARIO" });
    await expect(page).toHaveURL(/reportes\.html$/);
    await expect(page.getByTestId("menu-reportes")).toBeVisible();
  });

  test("sin sesión, Reportes redirige al login", async ({ page }) => {
    await page.goto("/reportes.html");
    await expect(page).toHaveURL(/login\.html$/);
  });
});

// Estos casos no se pueden armar con los datos de ejemplo (el simulador solo deja caer un servicio a la vez y nunca falla
// toda la consulta). Se responde GET /reportes con lo que haga falta en cada caso.
test.describe("Reportes: respuestas especiales del servicio", () => {
  const base = {
    periodo: "mes",
    servicios_caidos: [],
    ingresos: 1000,
    vendido_saldado: 800,
    ventas_por_saldar: 2,
    cmv: 300,
    ganancia_bruta: 500,
    gastos_operativos: 100,
    bienes_de_uso: 50,
    ganancia_neta: 400,
    inventario_actual: 5000,
    por_cobrar: 700,
    desglose_inversion: [{ producto: "Producto X", unidades: 2, costo_unitario: 100, inversion: 200 }],
  };

  const respuesta = (cambios = {}) => ({ body: { ...base, ...cambios } });
  const abrir = (page, responder) => abrirReportes(page, { responder });

  test("si falla toda la consulta, avisa y no muestra tarjetas (error de conexión)", async ({ page }) => {
    await abrir(page, () => ({ abortar: true }));
    await expect(page.getByTestId("reportes-error")).toHaveText("No se pudo conectar con el servidor.");
    await expect(page.getByTestId("reportes-error")).toHaveAttribute("role", "alert");
    await expect(page.locator('[data-testid^="rep-"]')).toHaveCount(0);
    await expect(page.getByTestId("reportes-filtro-periodo")).toBeVisible();
  });

  test("si el servidor responde con error y sin mensaje propio, usa el texto por defecto", async ({ page }) => {
    await abrir(page, () => ({ status: 500, body: {} }));
    await expect(page.getByTestId("reportes-error")).toHaveText("No se pudieron cargar los reportes. Intentá de nuevo.");
  });

  test("si el servidor responde con un mensaje propio, lo muestra", async ({ page }) => {
    await abrir(page, () => ({ status: 503, body: { status: "error", mensaje: "Servicio en mantenimiento" } }));
    await expect(page.getByTestId("reportes-error")).toHaveText("Servicio en mantenimiento");
  });

  test("tras un error se puede volver a consultar cambiando el período", async ({ page }) => {
    await abrir(page, (periodo) => (periodo === "mes" ? { abortar: true } : respuesta({ periodo, ingresos: 2500 })));
    await expect(page.getByTestId("reportes-error")).toBeVisible();
    await page.getByTestId("reportes-filtro-periodo").selectOption("anio");
    await expect(valor(page, "ingresos")).toHaveText(/2\.500,00/);
    await expect(page.getByTestId("reportes-error")).toHaveCount(0);
  });

  test("sin productos comprados en el período, el desglose lo dice y las demás tarjetas siguen", async ({ page }) => {
    await abrir(page, () => respuesta({ desglose_inversion: [] }));
    await expect(page.getByTestId("rep-desglose-vacio")).toHaveText("Sin inventario comprado en este período.");
    await expect(page.getByTestId("rep-desglose")).toHaveCount(0);
    await expect(page.getByText("Este monto refleja capital acumulado, no es una pérdida.")).toBeVisible();
    await expect(valor(page, "ingresos")).toHaveText(/1\.000,00/);
  });

  test("un indicador sin valor se marca como sin datos, sin aviso de falla de servicio", async ({ page }) => {
    await abrir(page, () => respuesta({ ingresos: null }));
    await expect(page.getByTestId("rep-ingresos-error")).toHaveText("No se pudo calcular");
    await expect(page.getByTestId("rep-ingresos").locator("p")).toHaveCount(0);
    await expect(page.getByTestId("reportes-aviso-parcial")).toHaveCount(0);
    await expect(valor(page, "cmv")).toHaveText(/300,00/);
  });

  test("con dos servicios caídos, el aviso los nombra a los dos", async ({ page }) => {
    await abrir(page, () =>
      respuesta({ servicios_caidos: ["transacciones", "finanzas"], ingresos: null, vendido_saldado: null, ventas_por_saldar: null, cmv: null,
        ganancia_bruta: null, gastos_operativos: null, bienes_de_uso: null, ganancia_neta: null, por_cobrar: null }),
    );
    await expect(page.getByTestId("reportes-aviso-parcial")).toContainText("una falla en Transacciones y Finanzas.");
    await expect(page.getByTestId("rep-ingresos-error")).toBeVisible();
    await expect(page.getByTestId("rep-gastos-error")).toBeVisible();
    await expect(valor(page, "inventario")).toHaveText(/5\.000,00/);
  });

  test("con los tres servicios caídos, no queda ninguna tarjeta con valor", async ({ page }) => {
    await abrir(page, () =>
      respuesta({ servicios_caidos: ["transacciones", "finanzas", "productos"], ingresos: null, vendido_saldado: null, ventas_por_saldar: null,
        cmv: null, ganancia_bruta: null, gastos_operativos: null, bienes_de_uso: null, ganancia_neta: null, inventario_actual: null, por_cobrar: null,
        desglose_inversion: null }),
    );
    await expect(page.getByTestId("reportes-aviso-parcial")).toContainText("una falla en Transacciones, Finanzas y Productos.");
    await expect(page.locator('[data-testid^="rep-"][data-testid$="-error"]')).toHaveCount(10); // 9 tarjetas + el desglose
    await expect(page.locator('[data-testid^="rep-"][data-testid$="-valor"]')).toHaveCount(0);
  });

  test("un servicio caído que la pantalla no conoce se ignora", async ({ page }) => {
    await abrir(page, () => respuesta({ servicios_caidos: ["servicio-nuevo"] }));
    await expect(page.getByTestId("reportes-aviso-parcial")).toHaveCount(0);
    await expect(valor(page, "ingresos")).toHaveText(/1\.000,00/);
  });

  test("solo las ganancias se pintan de rojo cuando son negativas", async ({ page }) => {
    await abrir(page, () => respuesta({ ingresos: -5, ganancia_bruta: -100, ganancia_neta: -300 }));
    await expect(valor(page, "ganancia-bruta")).toHaveClass(/reportes-valor-negativo/);
    await expect(valor(page, "ganancia-neta")).toHaveClass(/reportes-valor-negativo/);
    await expect(valor(page, "ingresos")).not.toHaveClass(/reportes-valor-negativo/);
    await expect(valor(page, "ganancia-bruta")).toHaveText(/^-\$\s100,00$/);
  });

  test("una ganancia en cero no se pinta de rojo", async ({ page }) => {
    await abrir(page, () => respuesta({ ganancia_bruta: 0, ganancia_neta: 0 }));
    await expect(valor(page, "ganancia-neta")).not.toHaveClass(/reportes-valor-negativo/);
    await expect(valor(page, "ganancia-neta")).toHaveText(/^\$\s0,00$/);
  });

  test("con una sola venta por saldar el cartel va en singular", async ({ page }) => {
    await abrir(page, () => respuesta({ ventas_por_saldar: 1 }));
    await expect(page.getByTestId("rep-faltan-saldar")).toHaveText("1 venta confirmada falta por saldar");
  });

  test("si llega una respuesta vieja después de la nueva, se descarta", async ({ page }) => {
    // "Hoy" tarda mucho más que "Este año": su respuesta llega última y no debe pisar a la que se pidió después.
    await abrir(page, async (periodo) => {
      await new Promise((r) => setTimeout(r, periodo === "hoy" ? 900 : 50));
      return respuesta({ periodo, ingresos: periodo === "hoy" ? 111 : 222 });
    });
    await expect(valor(page, "ingresos")).toHaveText(/222,00/);
    const filtro = page.getByTestId("reportes-filtro-periodo");
    await filtro.selectOption("hoy");
    await filtro.selectOption("anio");
    await expect(valor(page, "ingresos")).toHaveText(/222,00/);
    await page.waitForTimeout(1200); // da tiempo a que llegue la respuesta vieja
    await expect(valor(page, "ingresos")).toHaveText(/222,00/);
    await expect(filtro).toHaveValue("anio");
  });
});
