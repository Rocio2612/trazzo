const { test, expect } = require("@playwright/test");
const { iniciarSesionComo } = require("./helpers");
const { simularBackendVentas } = require("./backend-falso-ventas");

// Backend falso (backend-falso-ventas.js). Ventas de ejemplo:
//   451 cuenta corriente, Almacén Don Pedro, hace 40 días, $ 6.200, confirmada
//   452 contado, Consumidor final, de hoy, $ 3.730, confirmada
//   453 cuenta corriente, Kiosco El Sol, hace 20 días, $ 2.400, ANULADA
let backend;
const abrirHistorial = async (page, rol = "ADMIN", opciones = {}) => {
  backend = await simularBackendVentas(page, { rol, ...opciones });
  await iniciarSesionComo(page, rol);
  await page.goto("/historial-ventas.html");
  await expect(page.getByTestId("ventas-fila-1")).toBeVisible();
};

const filas = (page) => page.getByTestId("ventas-tabla").locator("tbody tr");

test.describe("Historial de ventas: lista y buscador", () => {
  test("muestra todas las ventas, de contado y a cuenta corriente", async ({ page }) => {
    await abrirHistorial(page);
    await expect(page.getByTestId("ventas-tabla").locator("thead th")).toHaveText(["N° de venta", "Tipo de venta", "Cliente", "Fecha y hora", "Total", "Estado", "Acciones"]);
    await expect(filas(page)).toHaveCount(3);
    await expect(page.getByTestId("ventas-fila-1")).toContainText("00001-00000451");
    await expect(page.getByTestId("ventas-fila-1")).toContainText("Almacén Don Pedro S.R.L.");
    await expect(page.getByTestId("ventas-fila-1")).toContainText(/6\.200,00/);
    await expect(page.getByTestId("ventas-fila-2")).toContainText("Consumidor final");
  });

  test("cada venta tiene su cartelito de tipo (Contado o Cuenta corriente) y de estado (Confirmada o Anulada)", async ({ page }) => {
    await abrirHistorial(page);
    await expect(page.getByTestId("tipo-venta-1")).toHaveText("Cuenta corriente");
    await expect(page.getByTestId("tipo-venta-2")).toHaveText("Contado");
    await expect(page.getByTestId("estado-venta-1")).toHaveText("Confirmada");
    await expect(page.getByTestId("estado-venta-3")).toHaveText("Anulada");
    await expect(page.getByTestId("ventas-fila-3")).toContainText(/2\.400,00/); // el total de una anulada va tachado
    await expect(page.getByTestId("ventas-fila-3").locator(".ventas-tachado")).toHaveCount(1);
  });

  test("el buscador encuentra por N° de venta (con o sin guion), cliente y tipo", async ({ page }) => {
    await abrirHistorial(page);
    await page.getByTestId("ventas-buscador").fill("00001-00000452");
    await expect(filas(page)).toHaveCount(1);
    await page.getByTestId("ventas-buscador").fill("0000100000453");
    await expect(filas(page)).toHaveCount(1);
    await expect(page.getByTestId("ventas-fila-3")).toBeVisible();
    await page.getByTestId("ventas-buscador").fill("pedro");
    await expect(filas(page)).toHaveCount(1);
    await page.getByTestId("ventas-buscador").fill("contado");
    await expect(filas(page)).toHaveCount(1);
    await page.getByTestId("ventas-buscador").fill("cuenta corriente");
    await expect(filas(page)).toHaveCount(2);
    await page.getByTestId("ventas-buscador").fill("zzzz");
    await expect(page.getByTestId("ventas-tabla-vacio")).toHaveText("Sin resultados");
  });

  test("se filtra por estado (confirmadas o anuladas) y por tipo (contado o cuenta corriente)", async ({ page }) => {
    await abrirHistorial(page);
    await expect(page.locator("[data-testid=ventas-filtro-estado] option")).toHaveText(["Todas", "Confirmadas", "Anuladas", "Contado", "Cuenta corriente"]);
    await page.getByTestId("ventas-filtro-estado").selectOption("CONFIRMADA");
    await expect(filas(page)).toHaveCount(2);
    await page.getByTestId("ventas-filtro-estado").selectOption("ANULADA");
    await expect(filas(page)).toHaveCount(1);
    await expect(page.getByTestId("ventas-fila-3")).toBeVisible();
    await page.getByTestId("ventas-filtro-estado").selectOption("CONTADO");
    await expect(filas(page)).toHaveCount(1);
    await expect(page.getByTestId("ventas-fila-2")).toBeVisible();
    await page.getByTestId("ventas-filtro-estado").selectOption("CUENTA_CORRIENTE");
    await expect(filas(page)).toHaveCount(2);
    await page.getByTestId("ventas-filtro-estado").selectOption("");
    await expect(filas(page)).toHaveCount(3);
  });

  test("se filtra por período: hoy, este mes y este año", async ({ page }) => {
    await abrirHistorial(page);
    await page.getByTestId("ventas-filtro-fecha").selectOption("hoy");
    await expect(filas(page)).toHaveCount(1);
    await expect(page.getByTestId("ventas-fila-2")).toBeVisible();
    await page.getByTestId("ventas-filtro-fecha").selectOption("mes");
    expect(await filas(page).count()).toBeGreaterThanOrEqual(1);
    await page.getByTestId("ventas-filtro-fecha").selectOption("anio");
    expect(await filas(page).count()).toBeGreaterThanOrEqual(1);
    await page.getByTestId("ventas-filtro-fecha").selectOption("todas");
    await expect(filas(page)).toHaveCount(3);
  });

  test("sin ventas muestra el mensaje 'Sin ventas'", async ({ page }) => {
    backend = await simularBackendVentas(page, { rol: "ADMIN", semilla: (estado) => (estado.ventas = []) });
    await iniciarSesionComo(page, "ADMIN");
    await page.goto("/historial-ventas.html");
    await expect(page.getByTestId("ventas-tabla-vacio")).toHaveText("Sin ventas");
  });

  test("si no se pueden cargar las ventas muestra un error", async ({ page }) => {
    backend = await simularBackendVentas(page, { rol: "ADMIN" });
    backend.fallar("GET /ventas", { status: 500, body: { mensaje: "Error al listar las ventas" } });
    await iniciarSesionComo(page, "ADMIN");
    await page.goto("/historial-ventas.html");
    await expect(page.getByTestId("ventas-error-carga")).toHaveText("Error al listar las ventas");
  });

  test("'Volver a ventas' lleva a Nueva venta", async ({ page }) => {
    await abrirHistorial(page);
    await expect(page.getByTestId("ventas-volver")).toHaveText("Volver a ventas");
    await page.getByTestId("ventas-volver").click();
    await expect(page).toHaveURL(/ventas\.html$/);
  });
});

test.describe("Historial de ventas: acciones del Administrador", () => {
  test("cada venta tiene ver detalle, anular (si no está anulada) y ocultar; no hay editar, eliminar ni descargar ticket", async ({ page }) => {
    await abrirHistorial(page);
    await expect(page.getByTestId("ventas-detalle-1")).toBeVisible();
    await expect(page.getByTestId("ventas-anular-1")).toBeVisible();
    await expect(page.getByTestId("ventas-ocultar-1")).toBeVisible();
    await expect(page.getByTestId("ventas-anular-3")).toHaveCount(0); // ya anulada
    await expect(page.getByTestId("ventas-fila-1").locator("button")).toHaveCount(3);
    await expect(page.locator("[data-testid^=ventas-editar]")).toHaveCount(0);
    await expect(page.locator("[data-testid^=ventas-eliminar]")).toHaveCount(0);
    await expect(page.locator("[data-testid^=ventas-ticket]")).toHaveCount(0);
  });

  test("anular pide confirmación, la venta queda Anulada y el stock vuelve", async ({ page }) => {
    await abrirHistorial(page);
    await page.getByTestId("ventas-anular-2").click(); // 3 Detergentes y 1 Lavandina
    await expect(page.getByTestId("modal")).toContainText("¿Anular la venta 00001-00000452?");
    await expect(page.getByTestId("modal")).toContainText("Se devuelve el stock de los productos, se anulan los pagos de la venta y se excluye de los reportes.");
    await page.getByTestId("modal-cancelar").click();
    await expect(page.getByTestId("estado-venta-2")).toHaveText("Confirmada");
    expect(backend.llamadas.some((l) => l.metodo === "PATCH" && l.ruta === "/ventas/2/anular")).toBe(false);

    await page.getByTestId("ventas-anular-2").click();
    await page.getByTestId("modal-confirmar").click();
    await expect(page.getByTestId("estado-venta-2")).toHaveText("Anulada");
    await expect(page.getByTestId("ventas-anular-2")).toHaveCount(0);
    await expect(page.locator(".gastos-toast")).toHaveText("Venta 00001-00000452 anulada");
    expect(backend.estado.productos.find((p) => p.id === 3).cantidad).toBe(27); // 24 + 3
    expect(backend.estado.productos.find((p) => p.id === 4).cantidad).toBe(41); // 40 + 1

    // el stock aumentó: se ve en Nueva venta (que lee el stock de los productos)
    await page.goto("/ventas.html");
    await expect(page.getByTestId("venta-producto-3")).toContainText("Stock: 27");
  });

  // El Backend todavía no oculta ventas. Reactivar cuando lo haga.
  test.skip("ocultar pide confirmación; la venta sale del listado y se ve en 'Ver ocultos'", async ({ page }) => {
    await abrirHistorial(page);
    await page.getByTestId("ventas-ocultar-1").click();
    await expect(page.getByTestId("modal")).toContainText("¿Ocultar la venta 00001-00000451?");
    await expect(page.getByTestId("modal")).toContainText("se sigue contando en los reportes");
    await page.getByTestId("modal-cancelar").click();
    await expect(filas(page)).toHaveCount(3);
    await page.getByTestId("ventas-ocultar-1").click();
    await page.getByTestId("modal-confirmar").click();
    await expect(filas(page)).toHaveCount(2);
    await expect(page.locator(".gastos-toast")).toHaveText("Venta 00001-00000451 oculta");
    await page.getByTestId("ventas-filtro-ocultos").click();
    await expect(filas(page)).toHaveCount(2); // la 454 que ya estaba oculta y la 451
    expect(backend.estado.ventas.find((v) => v.id === 1).anulada).toBe(false); // sigue confirmada: ocultar no la anula
  });

  // El Backend todavía no oculta ventas. Reactivar cuando lo haga.
  test.skip("'Ver ocultos' muestra las ocultas con 'Restaurar', que vuelve a mostrarlas sin pedir confirmación", async ({ page }) => {
    await abrirHistorial(page);
    await page.getByTestId("ventas-filtro-ocultos").click();
    await expect(page.getByTestId("ventas-filtro-ocultos")).toHaveClass(/activo/);
    await expect(filas(page)).toHaveCount(1);
    await expect(page.getByTestId("ventas-fila-4")).toContainText("00001-00000454");
    await expect(page.getByTestId("ventas-ocultar-4")).toContainText("Restaurar");
    await page.getByTestId("ventas-ocultar-4").click(); // restaurar: inmediato
    await expect(page.locator(".gastos-toast")).toHaveText("Venta 00001-00000454 restaurada");
    await expect(page.getByTestId("ventas-tabla-vacio")).toHaveText("Sin ventas ocultas");
    await page.getByTestId("ventas-filtro-ocultos").click();
    await expect(filas(page)).toHaveCount(4);
  });

  test("si el Backend no puede anular, avisa y recarga", async ({ page }) => {
    await abrirHistorial(page);
    backend.fallar("PATCH /ventas/:id/anular", { status: 409, body: { mensaje: "La venta ya está anulada" } });
    await page.getByTestId("ventas-anular-1").click();
    await page.getByTestId("modal-confirmar").click();
    await expect(page.locator(".gastos-toast")).toHaveText("La venta ya está anulada");
  });
});

test.describe("Historial de ventas: detalle y ticket", () => {
  test("el detalle muestra cliente, estado, datos, productos con los precios del momento y total", async ({ page }) => {
    await abrirHistorial(page);
    await page.getByTestId("ventas-detalle-1").click();
    const detalle = page.getByTestId("venta-detalle");
    await expect(page.getByTestId("modal")).toContainText("Venta 00001-00000451");
    await expect(detalle).toContainText("Almacén Don Pedro S.R.L.");
    await expect(detalle).toContainText("Confirmada");
    await expect(detalle).toContainText("Cuenta corriente");
    await expect(page.getByTestId("venta-detalle-items")).toContainText("Yerba mate 1 kg");
    await expect(page.getByTestId("venta-detalle-items")).toContainText(/3\.100,00/);
    await expect(page.getByTestId("venta-detalle-items")).toContainText(/6\.200,00/);
    await expect(page.getByTestId("venta-detalle-total")).toHaveText(/6\.200,00/);
  });

  test("en una venta de contado el detalle muestra el medio de pago; sin productos ni IVA, que el Backend no manda", async ({ page }) => {
    await abrirHistorial(page);
    await page.getByTestId("ventas-detalle-2").click();
    await expect(page.getByTestId("venta-detalle")).toContainText("Efectivo");
    await expect(page.getByTestId("venta-detalle-items").locator("tbody tr")).toHaveCount(0);
    await expect(page.getByTestId("venta-detalle")).not.toContainText("IVA");
  });

  test("el detalle ya no ofrece descargar el ticket y no lo pide al backend", async ({ page }) => {
    await abrirHistorial(page);
    await page.getByTestId("ventas-detalle-2").click();
    await expect(page.getByTestId("venta-detalle")).toBeVisible();
    await expect(page.getByTestId("ventas-detalle-ticket")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /ticket/i })).toHaveCount(0);
    expect(backend.llamadas.some((l) => l.ruta.endsWith("/ticket"))).toBe(false);
  });

  test("una venta anulada se ve en el detalle con su aviso", async ({ page }) => {
    await abrirHistorial(page);
    await page.getByTestId("ventas-detalle-3").click();
    await expect(page.getByTestId("venta-detalle")).toContainText("Anulada");
    await expect(page.getByTestId("venta-detalle")).toContainText("se devolvió el stock");
  });

  test("'Cerrar' cierra el detalle", async ({ page }) => {
    await abrirHistorial(page);
    await page.getByTestId("ventas-detalle-1").click();
    await expect(page.getByTestId("venta-detalle")).toBeVisible();
    await page.getByTestId("modal-cancelar").click();
    await expect(page.getByTestId("venta-detalle")).toHaveCount(0);
  });

  // El Backend todavía no descuenta el saldo a favor. Reactivar cuando lo haga.
  test.skip("si parte de la venta se pagó con saldo a favor, el detalle lo aclara", async ({ page }) => {
    await abrirHistorial(page, "ADMIN", {
      semilla: (estado) => {
        const venta = estado.ventas.find((v) => v.id === 2);
        venta.medio_pago = null;
        venta.credito_aplicado = 500;
      },
    });
    await page.getByTestId("ventas-detalle-2").click();
    await expect(page.getByTestId("venta-detalle")).toContainText("Saldo a favor");
    await expect(page.getByTestId("venta-detalle")).toContainText(/Incluye .*500,00 pagados con saldo a favor del cliente\./);
  });
});

test.describe("Historial de ventas: rol Cajero", () => {
  test("no ve ocultar, restaurar ni 'Ver ocultos'; sí puede ver el detalle y anular", async ({ page }) => {
    await abrirHistorial(page, "CAJERO");
    await expect(page.getByTestId("ventas-detalle-1")).toBeVisible();
    await expect(page.getByTestId("ventas-anular-1")).toBeVisible();
    await expect(page.getByTestId("ventas-ocultar-1")).toBeHidden();
    await expect(page.getByTestId("ventas-filtro-ocultos")).toBeHidden();
    await expect(page.locator("[data-testid^=ventas-editar]")).toHaveCount(0);
    await expect(page.locator("[data-testid^=ventas-eliminar]")).toHaveCount(0);
  });

  test("puede anular una venta", async ({ page }) => {
    await abrirHistorial(page, "CAJERO");
    await page.getByTestId("ventas-anular-2").click();
    await page.getByTestId("modal-confirmar").click();
    await expect(page.getByTestId("estado-venta-2")).toHaveText("Anulada");
  });

  test("puede ver el detalle de una venta", async ({ page }) => {
    await abrirHistorial(page, "CAJERO");
    await page.getByTestId("ventas-detalle-2").click();
    await expect(page.getByTestId("venta-detalle")).toContainText("Consumidor final");
    await expect(page.getByTestId("venta-detalle-total")).toHaveText(/3\.730,00/);
  });

  test("cancelar la anulación no la anula", async ({ page }) => {
    await abrirHistorial(page, "CAJERO");
    await page.getByTestId("ventas-anular-2").click();
    await page.getByTestId("modal-cancelar").click();
    await expect(page.getByTestId("estado-venta-2")).toHaveText("Confirmada");
    expect(backend.llamadas.some((l) => l.ruta === "/ventas/2/anular")).toBe(false);
  });
});

test.describe("Historial de ventas: más casos de la lista", () => {
  test("las ventas se ordenan de la más reciente a la más antigua", async ({ page }) => {
    await abrirHistorial(page);
    await expect(filas(page).nth(0)).toContainText("00001-00000452"); // hoy
    await expect(filas(page).nth(1)).toContainText("00001-00000453"); // hace 20 días
    await expect(filas(page).nth(2)).toContainText("00001-00000451"); // hace 40 días
  });

  test("mientras llegan las ventas muestra 'Cargando…'", async ({ page }) => {
    backend = await simularBackendVentas(page, { rol: "ADMIN" });
    backend.demorar("GET /ventas", 700);
    await iniciarSesionComo(page, "ADMIN");
    await page.goto("/historial-ventas.html");
    await expect(page.getByTestId("ventas-cargando")).toHaveText("Cargando…");
    await expect(page.getByTestId("ventas-fila-1")).toBeVisible();
    await expect(page.getByTestId("ventas-cargando")).toHaveCount(0);
  });

  test("sin ventas ocultas, 'Ver ocultos' muestra 'Sin ventas ocultas'", async ({ page }) => {
    await abrirHistorial(page);
    await page.getByTestId("ventas-filtro-ocultos").click();
    await expect(page.getByTestId("ventas-tabla-vacio")).toHaveText("Sin ventas ocultas");
    await page.getByTestId("ventas-filtro-ocultos").click();
    await expect(filas(page)).toHaveCount(3);
  });

  test("los filtros se combinan: estado y buscador juntos", async ({ page }) => {
    await abrirHistorial(page);
    await page.getByTestId("ventas-filtro-estado").selectOption("CUENTA_CORRIENTE");
    await page.getByTestId("ventas-buscador").fill("kiosco");
    await expect(filas(page)).toHaveCount(1);
    await expect(page.getByTestId("ventas-fila-3")).toBeVisible();
    await page.getByTestId("ventas-filtro-estado").selectOption("CONTADO");
    await expect(page.getByTestId("ventas-tabla-vacio")).toHaveText("Sin resultados");
    await page.getByTestId("ventas-buscador").fill("");
    await page.getByTestId("ventas-filtro-estado").selectOption("");
    await expect(filas(page)).toHaveCount(3);
  });

  test("con el período 'Hoy' y sin ventas de hoy muestra 'Sin resultados', no 'Sin ventas'", async ({ page }) => {
    await abrirHistorial(page, "ADMIN", { semilla: (estado) => (estado.ventas.find((v) => v.id === 2).fecha_hora = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()) });
    await page.getByTestId("ventas-filtro-fecha").selectOption("hoy");
    await expect(page.getByTestId("ventas-tabla-vacio")).toHaveText("Sin resultados");
  });

  // El Backend todavía no oculta ventas. Reactivar cuando lo haga.
  test.skip("los filtros también valen dentro de 'Ver ocultos'", async ({ page }) => {
    await abrirHistorial(page);
    await page.getByTestId("ventas-filtro-ocultos").click();
    await expect(filas(page)).toHaveCount(1);
    await page.getByTestId("ventas-buscador").fill("zzzz");
    await expect(page.getByTestId("ventas-tabla-vacio")).toHaveText("Sin ventas ocultas");
  });

  // El Backend todavía no oculta ventas. Reactivar cuando lo haga.
  test.skip("una venta oculta solo ofrece 'Restaurar' (sin detalle ni anular)", async ({ page }) => {
    await abrirHistorial(page);
    await page.getByTestId("ventas-filtro-ocultos").click();
    await expect(page.getByTestId("ventas-fila-4").locator("button")).toHaveCount(1);
    await expect(page.getByTestId("ventas-detalle-4")).toHaveCount(0);
    await expect(page.getByTestId("ventas-anular-4")).toHaveCount(0);
  });

  test("una venta anulada solo ofrece ver el detalle y ocultar", async ({ page }) => {
    await abrirHistorial(page);
    await expect(page.getByTestId("ventas-fila-3").locator("button")).toHaveCount(2);
    await expect(page.getByTestId("ventas-detalle-3")).toBeVisible();
    await expect(page.getByTestId("ventas-ocultar-3")).toBeVisible();
  });

  test("sin sesión, el historial redirige al login", async ({ page }) => {
    await page.goto("/historial-ventas.html");
    await expect(page).toHaveURL(/login\.html$/);
  });
});

test.describe("Historial de ventas: anular y ocultar, casos adicionales", () => {
  test("anular una venta a cuenta corriente devuelve su stock", async ({ page }) => {
    await abrirHistorial(page);
    await page.getByTestId("ventas-anular-1").click(); // 2 Yerbas
    await expect(page.getByTestId("modal")).toContainText("¿Anular la venta 00001-00000451?");
    await page.getByTestId("modal-confirmar").click();
    await expect(page.getByTestId("estado-venta-1")).toHaveText("Anulada");
    expect(backend.estado.productos.find((p) => p.id === 5).cantidad).toBe(17); // 15 + 2
  });

  test("con un filtro puesto, al anular la venta la lista se actualiza respetándolo", async ({ page }) => {
    await abrirHistorial(page);
    await page.getByTestId("ventas-filtro-estado").selectOption("CONFIRMADA");
    await expect(filas(page)).toHaveCount(2);
    await page.getByTestId("ventas-anular-2").click();
    await page.getByTestId("modal-confirmar").click();
    await expect(filas(page)).toHaveCount(1);
    await expect(page.getByTestId("ventas-fila-1")).toBeVisible();
    await expect(page.getByTestId("ventas-filtro-estado")).toHaveValue("CONFIRMADA");
  });

  test("si anular falla sin mensaje del backend usa el texto por defecto", async ({ page }) => {
    await abrirHistorial(page);
    backend.fallar("PATCH /ventas/:id/anular", { status: 500, body: {} });
    await page.getByTestId("ventas-anular-1").click();
    await page.getByTestId("modal-confirmar").click();
    await expect(page.locator(".gastos-toast")).toHaveText("No se pudo anular la venta.");
    await expect(page.getByTestId("estado-venta-1")).toHaveText("Confirmada");
  });

  test("si ocultar falla, avisa y la venta sigue en la lista", async ({ page }) => {
    await abrirHistorial(page);
    backend.fallar("PATCH /ventas/:id/ocultar", { status: 500, body: { mensaje: "Error al ocultar la venta" } });
    await page.getByTestId("ventas-ocultar-1").click();
    await page.getByTestId("modal-confirmar").click();
    await expect(page.locator(".gastos-toast")).toHaveText("Error al ocultar la venta");
    await expect(filas(page)).toHaveCount(3);
  });

  test("si ocultar falla sin mensaje usa el texto por defecto", async ({ page }) => {
    await abrirHistorial(page);
    backend.fallar("PATCH /ventas/:id/ocultar", { status: 500, body: {} });
    await page.getByTestId("ventas-ocultar-1").click();
    await page.getByTestId("modal-confirmar").click();
    await expect(page.locator(".gastos-toast")).toHaveText("No se pudo ocultar la venta.");
  });

  // El Backend todavía no oculta ventas. Reactivar cuando lo haga.
  test.skip("si restaurar falla sin mensaje usa el texto por defecto y la venta sigue oculta", async ({ page }) => {
    await abrirHistorial(page);
    backend.fallar("PATCH /ventas/:id/ocultar", { status: 500, body: {} });
    await page.getByTestId("ventas-filtro-ocultos").click();
    await page.getByTestId("ventas-ocultar-4").click();
    await expect(page.locator(".gastos-toast")).toHaveText("No se pudo restaurar la venta.");
    await expect(page.getByTestId("ventas-fila-4")).toBeVisible();
  });
});
