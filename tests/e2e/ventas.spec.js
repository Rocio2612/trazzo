const { test, expect } = require("@playwright/test");
const { iniciarSesionComo } = require("./helpers");
const { simularBackendVentas } = require("./backend-falso-ventas");

// Backend falso (backend-falso-ventas.js). Productos: Sifón (id 1, stock 2), Bidón (id 2, stock 0), Detergente (id 3, stock 24,
// $ 980), Lavandina (id 4, stock 40, $ 590) y Yerba (id 5, stock 15, $ 3.100). Clientes: Almacén Don Pedro (1, RI), María Fernanda
// López (2, $ 660 a favor), Kiosco El Sol (3, Monotributista) y Fundación Manos Unidas (4, Exento). Las ventas de ejemplo
// llegan hasta el N° 00001-00000454: la próxima venta es la 00001-00000455.
let backend;
const abrirVentas = async (page, rol = "ADMIN", opciones = {}) => {
  backend = await simularBackendVentas(page, { rol, ...opciones });
  await iniciarSesionComo(page, rol);
  await page.goto("/ventas.html");
  await expect(page.getByTestId("venta-producto-3")).toBeVisible();
};

const agregar = (page, ...ids) => ids.reduce((p, id) => p.then(() => page.getByTestId(`venta-producto-${id}`).click()), Promise.resolve());

// Arma una venta y abre el modal "Cobrar".
const abrirCobro = async (page, ids = [3]) => {
  await agregar(page, ...ids);
  await page.getByTestId("venta-cobrar").click();
  await expect(page.getByTestId("venta-confirmar")).toBeVisible();
};

test.describe("Nueva venta: productos y carrito", () => {
  test("muestra los productos con su stock y precio, y 'Sin stock' en el que no tiene", async ({ page }) => {
    await abrirVentas(page);
    await expect(page.getByTestId("venta-disponibles")).toHaveText("5 disponibles");
    await expect(page.getByTestId("venta-producto-3")).toContainText("Detergente 750 ml");
    await expect(page.getByTestId("venta-producto-3")).toContainText("Limpieza · Stock: 24");
    await expect(page.getByTestId("venta-producto-3")).toContainText(/980,00/);
    await expect(page.getByTestId("venta-producto-2")).toContainText("Sin stock");
    await expect(page.getByTestId("venta-producto-3")).not.toContainText("Sin stock");
  });

  test("un producto sin stock (Bidón) no se puede seleccionar de la lista; los demás sí", async ({ page }) => {
    await abrirVentas(page);
    await expect(page.getByTestId("venta-producto-2")).toBeDisabled();
    await expect(page.getByTestId("venta-producto-1")).toBeEnabled(); // Sifón: stock 2
    await expect(page.getByTestId("venta-producto-3")).toBeEnabled();
    await page.getByTestId("venta-producto-2").click({ force: true });
    await expect(page.getByTestId("venta-carrito-vacio")).toBeVisible();
    await expect(page.getByTestId("venta-items-contador")).toHaveText("0 ítems");
  });

  test("el buscador filtra los productos por nombre", async ({ page }) => {
    await abrirVentas(page);
    await page.getByTestId("venta-buscador").fill("yerba");
    await expect(page.getByTestId("venta-disponibles")).toHaveText("1 disponible");
    await expect(page.getByTestId("venta-producto-5")).toBeVisible();
    await page.getByTestId("venta-buscador").fill("zzzz");
    await expect(page.getByTestId("venta-productos")).toContainText("Sin resultados");
  });

  test("al sumar productos el carrito muestra subtotales y total en tiempo real", async ({ page }) => {
    await abrirVentas(page);
    await expect(page.getByTestId("venta-total")).toHaveText(/0,00/);
    await agregar(page, 3, 3, 5); // Detergente x2 ($ 1.960) y Yerba x1 ($ 3.100)
    await expect(page.getByTestId("venta-items-contador")).toHaveText("2 ítems");
    await expect(page.getByTestId("venta-cantidad-3")).toHaveValue("2");
    await expect(page.getByTestId("venta-subtotal-3")).toHaveText(/1\.960,00/);
    await expect(page.getByTestId("venta-total")).toHaveText(/5\.060,00/);
    await page.getByTestId("venta-cantidad-3").fill("3");
    await expect(page.getByTestId("venta-subtotal-3")).toHaveText(/2\.940,00/);
    await expect(page.getByTestId("venta-total")).toHaveText(/6\.040,00/);
    await page.getByTestId("venta-mas-5").click();
    await expect(page.getByTestId("venta-subtotal-5")).toHaveText(/6\.200,00/);
    await page.getByTestId("venta-menos-5").click();
    await expect(page.getByTestId("venta-cantidad-5")).toHaveValue("1");
  });

  test("los títulos de las columnas del carrito se ven siempre, aunque esté vacío", async ({ page }) => {
    await abrirVentas(page);
    await expect(page.getByTestId("venta-carrito-vacio")).toBeVisible();
    await expect(page.getByTestId("venta-carrito").locator("thead th")).toHaveText(["Producto", "Precio unitario", "Cantidad", "Subtotal", ""]);
    await agregar(page, 3);
    await expect(page.getByTestId("venta-carrito-vacio")).toBeHidden();
    await expect(page.getByTestId("venta-carrito").locator("thead th").first()).toBeVisible();
  });

  test("se puede quitar un producto y vaciar el carrito; con el carrito vacío 'Vaciar' no hace nada", async ({ page }) => {
    await abrirVentas(page);
    await page.getByTestId("venta-vaciar").click(); // vacío: no hace nada y sigue disponible
    await expect(page.getByTestId("venta-vaciar")).toBeEnabled();
    await agregar(page, 3, 4, 5);
    await expect(page.getByTestId("venta-items-contador")).toHaveText("3 ítems");
    await page.getByTestId("venta-quitar-4").click();
    await expect(page.getByTestId("venta-items-contador")).toHaveText("2 ítems");
    await expect(page.getByTestId("venta-cantidad-4")).toHaveCount(0);
    await page.getByTestId("venta-vaciar").click();
    await expect(page.getByTestId("venta-items-contador")).toHaveText("0 ítems");
    await expect(page.getByTestId("venta-carrito-vacio")).toBeVisible();
    await expect(page.getByTestId("venta-total")).toHaveText(/0,00/);
  });

  test("'Cobrar' sin productos avisa y no abre el modal", async ({ page }) => {
    await abrirVentas(page);
    await expect(page.getByTestId("venta-cobrar")).toBeEnabled();
    await page.getByTestId("venta-cobrar").click();
    await expect(page.getByTestId("venta-aviso")).toHaveText("No seleccionaste ningún producto. Agregá al menos uno para cobrar la venta.");
    await expect(page.getByTestId("venta-confirmar")).toHaveCount(0);
  });

  test("una cantidad vacía, 0 o con decimales se marca y no deja cobrar", async ({ page }) => {
    await abrirVentas(page);
    await agregar(page, 3);
    for (const invalida of ["", "0", "1.5", "abc"]) {
      await page.getByTestId("venta-cantidad-3").fill(invalida);
      await expect(page.getByTestId("venta-subtotal-3")).toHaveText("—");
      await expect(page.getByTestId("venta-carrito")).toContainText("Cantidad obligatoria: un número entero mayor a 0.");
      await page.getByTestId("venta-cobrar").click();
      await expect(page.getByTestId("venta-aviso")).toHaveText("Revisá las cantidades: cada producto necesita una cantidad entera mayor a 0.");
      await expect(page.getByTestId("venta-confirmar")).toHaveCount(0);
    }
    await page.getByTestId("venta-cantidad-3").fill("2");
    await expect(page.getByTestId("venta-subtotal-3")).toHaveText(/1\.960,00/);
  });

  test("el carrito no deja pedir más de lo que hay: el + se desactiva y lo escrito se baja al stock con aviso", async ({ page }) => {
    await abrirVentas(page);
    await agregar(page, 1, 3); // Sifón (stock 2) y Detergente (stock 24)
    await expect(page.getByTestId("venta-cantidad-1")).not.toHaveClass(/con-error/); // sin alerta, no es rojo
    await expect(page.getByTestId("venta-mas-1")).toBeEnabled();
    await page.getByTestId("venta-mas-1").click(); // 2 = todo el stock
    await expect(page.getByTestId("venta-cantidad-1")).toHaveValue("2");
    await expect(page.getByTestId("venta-mas-1")).toBeDisabled();
    await expect(page.getByTestId("venta-mas-3")).toBeEnabled();

    await page.getByTestId("venta-cantidad-1").fill("5"); // más de lo que hay
    await expect(page.getByTestId("venta-cantidad-1")).toHaveValue("2");
    await expect(page.getByTestId("venta-stock-insuficiente-1")).toHaveText("Solo quedan 2 en stock");
    await expect(page.getByTestId("venta-cantidad-1")).toHaveClass(/con-error/); // con la alerta, rojo
    await expect(page.getByTestId("venta-subtotal-1")).toHaveText(/2\.400,00/);

    await page.getByTestId("venta-cantidad-1").fill("1"); // vuelve a un valor que alcanza
    await expect(page.getByTestId("venta-stock-insuficiente-1")).toBeHidden();
    await expect(page.getByTestId("venta-cantidad-1")).not.toHaveClass(/con-error/);
    await expect(page.getByTestId("venta-mas-1")).toBeEnabled();

    await page.getByTestId("venta-cantidad-3").fill("30");
    await expect(page.getByTestId("venta-cantidad-3")).toHaveValue("24");
    await expect(page.getByTestId("venta-stock-insuficiente-3")).toHaveText("Solo quedan 24 en stock");
  });

  test("agregar de la lista un producto que ya tiene todo su stock en el carrito no suma más y avisa", async ({ page }) => {
    await abrirVentas(page);
    await agregar(page, 1, 1, 1); // Sifón (stock 2): la tercera vez no suma
    await expect(page.getByTestId("venta-cantidad-1")).toHaveValue("2");
    await expect(page.getByTestId("venta-stock-insuficiente-1")).toHaveText("Solo quedan 2 en stock");
  });
});

test.describe("Nueva venta: modal Cobrar", () => {
  test("arranca con la fecha y el número sin asignar, contado y Consumidor final", async ({ page }) => {
    await abrirVentas(page);
    await abrirCobro(page, [3, 3]);
    await expect(page.getByTestId("venta-fecha-hora")).toHaveValue("Se asigna al confirmar");
    await expect(page.getByTestId("venta-numero-previo")).toHaveValue("Se asigna al confirmar");
    await expect(page.getByTestId("venta-fecha-hora")).toHaveJSProperty("readOnly", true);
    await expect(page.getByTestId("venta-numero-previo")).toHaveJSProperty("readOnly", true);
    await expect(page.getByTestId("venta-tipo")).toHaveValue("CONTADO");
    await expect(page.locator("[data-testid=venta-cliente] option:checked")).toHaveText("Consumidor final");
    await expect(page.getByTestId("venta-cobrar-total")).toHaveText(/1\.960,00/);
  });

  test("el cliente es una lista desplegable con los clientes ya registrados y no hay alta rápida", async ({ page }) => {
    await abrirVentas(page);
    await abrirCobro(page);
    await expect(page.getByTestId("venta-cliente")).toHaveJSProperty("tagName", "SELECT");
    await expect(page.locator("[data-testid=venta-cliente] option")).toHaveText(["Consumidor final", "Almacén Don Pedro S.R.L.", "Fundación Manos Unidas", "Kiosco El Sol (Carlos Gómez)", "María Fernanda López"]);
    await expect(page.getByText("Alta rápida")).toHaveCount(0);
  });

  test("contado sin medio de pago no se puede confirmar", async ({ page }) => {
    await abrirVentas(page);
    await abrirCobro(page);
    await page.getByTestId("venta-confirmar").click();
    await expect(page.locator("#error-medio_pago")).toHaveText("Seleccioná el medio de pago de la venta.");
    await expect(page.getByTestId("formulario-errores")).toHaveText("Revisá estos datos: medio de pago.");
    expect(backend.enviados("POST", "/ventas")).toHaveLength(0);
  });

  test("cuenta corriente exige un cliente registrado y no pide medio de pago", async ({ page }) => {
    await abrirVentas(page);
    await abrirCobro(page);
    await page.getByTestId("venta-tipo").selectOption("CUENTA_CORRIENTE");
    await expect(page.locator("#medio_pago")).toBeHidden();
    await expect(page.locator("[data-testid=venta-cliente] option").first()).toHaveText("Elegí un cliente…");
    await page.getByTestId("venta-confirmar").click();
    await expect(page.locator("#error-cliente")).toHaveText("Seleccioná un cliente registrado para una venta a cuenta corriente.");
    expect(backend.enviados("POST", "/ventas")).toHaveLength(0);
    await page.getByTestId("venta-cliente").selectOption("1");
    await expect(page.locator("#error-cliente")).toBeHidden();
  });

  test("venta de contado: se envía sin fecha, hora ni número, y se muestra el número recién al confirmar", async ({ page }) => {
    await abrirVentas(page);
    await abrirCobro(page, [3, 3]);
    await page.getByTestId("venta-medio-pago").selectOption("1");
    await page.getByTestId("venta-confirmar").click();
    await expect(page.getByTestId("venta-confirmada")).toBeVisible();
    await expect(page.getByTestId("venta-numero")).toHaveText("00001-00000455");
    expect(backend.enviados("POST", "/ventas")).toEqual([{ tipo: "CONTADO", cliente_id: null, medio_pago_id: 1, saldo_a_favor_usado: 0, items: [{ producto_id: 3, cantidad: 2 }] }]);
    await expect(page.getByTestId("venta-confirmada")).toContainText("Consumidor final");
    await expect(page.getByTestId("venta-confirmada")).toContainText("Efectivo");
    await expect(page.getByTestId("venta-confirmada")).toContainText("Se registró el cobro y el pago se generó automáticamente.");
    await expect(page.getByTestId("venta-ticket")).toHaveCount(0); // ya no se descarga el ticket desde acá
    // el carrito queda vacío y el stock se actualiza
    await page.getByTestId("venta-otra").click();
    await expect(page.getByTestId("venta-items-contador")).toHaveText("0 ítems");
    await expect(page.getByTestId("venta-producto-3")).toContainText("Stock: 22");
  });

  test("al confirmar no hay botón de ticket; ofrece 'Ver historial' y 'Nueva venta'", async ({ page }) => {
    await abrirVentas(page);
    await abrirCobro(page);
    await expect(page.getByTestId("venta-ver-historial")).toHaveCount(0);
    await page.getByTestId("venta-medio-pago").selectOption("2");
    await page.getByTestId("venta-confirmar").click();
    await expect(page.getByTestId("venta-confirmada")).toBeVisible();
    await expect(page.getByTestId("venta-ticket")).toHaveCount(0);
    expect(backend.llamadas.some((l) => l.ruta.endsWith("/ticket"))).toBe(false);
    await expect(page.getByTestId("venta-otra")).toHaveText("Nueva venta");
    await expect(page.getByTestId("venta-ver-historial")).toHaveText("Ver historial");
    await page.getByTestId("venta-ver-historial").click();
    await expect(page).toHaveURL(/historial-ventas\.html$/);
  });

  test("venta a cuenta corriente: queda con el cliente elegido y sin pago", async ({ page }) => {
    await abrirVentas(page);
    await abrirCobro(page, [5]);
    await page.getByTestId("venta-tipo").selectOption("CUENTA_CORRIENTE");
    await page.getByTestId("venta-cliente").selectOption("1");
    await page.getByTestId("venta-confirmar").click();
    await expect(page.getByTestId("venta-confirmada")).toContainText("Almacén Don Pedro S.R.L.");
    await expect(page.getByTestId("venta-confirmada")).toContainText("Cuenta corriente");
    await expect(page.getByTestId("venta-confirmada")).toContainText(/Saldo a cobrar/i);
    await expect(page.getByTestId("venta-confirmada")).toContainText("La venta quedó en cuenta corriente");
    expect(backend.enviados("POST", "/ventas")).toEqual([{ tipo: "CUENTA_CORRIENTE", cliente_id: 1, medio_pago_id: null, saldo_a_favor_usado: 0, items: [{ producto_id: 5, cantidad: 1 }] }]);
  });

  test("'Confirmar' se deshabilita mientras procesa y un doble clic no genera dos ventas", async ({ page }) => {
    await abrirVentas(page);
    backend.demorar("POST /ventas", 600);
    await abrirCobro(page);
    await page.getByTestId("venta-medio-pago").selectOption("1");
    await page.getByTestId("venta-confirmar").dblclick();
    await expect(page.getByTestId("venta-confirmar")).toBeDisabled();
    await expect(page.getByTestId("venta-confirmar")).toHaveText("Confirmando…");
    await expect(page.getByTestId("venta-confirmada")).toBeVisible();
    expect(backend.enviados("POST", "/ventas")).toHaveLength(1);
    expect(backend.estado.ventas.filter((v) => !v.oculto && v.fecha_hora && v.numero === "00001-00000455")).toHaveLength(1);
  });

  test("stock insuficiente: se muestra arriba el mensaje exacto del Backend y la venta no se crea", async ({ page }) => {
    await abrirVentas(page);
    await abrirCobro(page, [1, 1]); // Sifón x2: alcanza con el stock que se ve (2)
    backend.estado.productos.find((p) => p.id === 1).cantidad = 1; // otra venta se llevó una unidad
    await page.getByTestId("venta-medio-pago").selectOption("1");
    await page.getByTestId("venta-confirmar").click();
    await expect(page.getByTestId("venta-alerta-stock")).toHaveText('No se puede confirmar la venta: "Sifón de soda 1.5 l" no tiene stock suficiente (stock actual: 1).');
    await expect(page.getByTestId("venta-confirmar")).toHaveCount(0); // el modal se cerró
    await expect(page.getByTestId("venta-cantidad-1")).toHaveValue("2"); // el carrito queda como estaba
    expect(backend.estado.ventas).toHaveLength(4);
    expect(backend.estado.productos.find((p) => p.id === 1).cantidad).toBe(1);
  });

  test("un producto que se quedó sin stock mientras se armaba la venta bloquea el cobro con su nombre y stock", async ({ page }) => {
    await abrirVentas(page);
    await abrirCobro(page, [3, 4]);
    backend.estado.productos.find((p) => p.id === 3).cantidad = 0; // otra venta se llevó todo el Detergente
    await page.getByTestId("venta-medio-pago").selectOption("1");
    await page.getByTestId("venta-confirmar").click();
    await expect(page.getByTestId("venta-alerta-stock")).toContainText('"Detergente 750 ml" no tiene stock suficiente (stock actual: 0)');
    expect(backend.estado.ventas).toHaveLength(4);
  });

  test("si el Backend rechaza el medio de pago, el error sale en el modal y sigue abierto", async ({ page }) => {
    await abrirVentas(page);
    backend.fallar("POST /ventas", { status: 400, body: { status: "error", mensaje: "Error de validación", errores: { medio_pago_id: "El medio de pago ya no está disponible." } } });
    await abrirCobro(page);
    await page.getByTestId("venta-medio-pago").selectOption("1");
    await page.getByTestId("venta-confirmar").click();
    await expect(page.locator("#error-medio_pago")).toHaveText("El medio de pago ya no está disponible.");
    await expect(page.getByTestId("venta-confirmar")).toBeEnabled();
    await expect(page.getByTestId("venta-confirmar")).toHaveText("Confirmar venta");
  });

  test("si no se pueden cargar los clientes, avisa y no abre el modal", async ({ page }) => {
    await abrirVentas(page);
    backend.fallar("GET /clientes", { status: 500, body: { mensaje: "Error al listar los clientes" } });
    await agregar(page, 3);
    await page.getByTestId("venta-cobrar").click();
    await expect(page.locator(".gastos-toast")).toContainText("Error al listar los clientes");
    await expect(page.getByTestId("venta-confirmar")).toHaveCount(0);
  });
});

test.describe("Nueva venta: saldo a favor del cliente", () => {
  test("al elegir un cliente con saldo a favor avisa cuánto tiene y ofrece usarlo (casilla sin marcar)", async ({ page }) => {
    await abrirVentas(page);
    await abrirCobro(page, [4]); // Lavandina $ 590
    await expect(page.getByTestId("venta-credito-aviso")).toBeHidden();
    await page.getByTestId("venta-cliente").selectOption("2");
    await expect(page.getByTestId("venta-credito-aviso")).toContainText(/Este cliente tiene .*660,00 a favor/);
    await expect(page.getByTestId("venta-aplicar-credito")).not.toBeChecked();
    await expect(page.getByTestId("venta-monto-credito")).toBeHidden();
    await expect(page.getByTestId("venta-cobrar-total")).toHaveText(/590,00/);
    await page.getByTestId("venta-cliente").selectOption("1"); // sin saldo a favor
    await expect(page.getByTestId("venta-credito-aviso")).toBeHidden();
  });

  test("al marcar la casilla propone el máximo y el total a cobrar se actualiza en tiempo real", async ({ page }) => {
    await abrirVentas(page);
    await abrirCobro(page, [4]);
    await page.getByTestId("venta-cliente").selectOption("2");
    await page.getByTestId("venta-aplicar-credito").check();
    await expect(page.getByTestId("venta-monto-credito")).toHaveValue("590"); // lo menor entre su saldo (660) y el total (590)
    await expect(page.getByTestId("venta-cobrar-total")).toHaveText(/0,00/);
    await expect(page.getByTestId("venta-credito-queda")).toHaveText(/Le quedan .*70,00 a favor/);
    await page.getByTestId("venta-monto-credito").fill("200");
    await expect(page.getByTestId("venta-cobrar-total")).toHaveText(/390,00/);
    await expect(page.getByTestId("venta-credito-queda")).toHaveText(/Le quedan .*460,00 a favor/);
    const desglose = page.getByTestId("venta-credito-desglose");
    await expect(desglose).toContainText("Total de la venta");
    await expect(desglose).toContainText("Saldo a favor aplicado");
    await expect(desglose).toContainText(/200,00/);
    await page.getByTestId("venta-aplicar-credito").uncheck();
    await expect(page.getByTestId("venta-cobrar-total")).toHaveText(/590,00/);
    await expect(page.getByTestId("venta-credito-desglose")).toHaveCount(0);
  });

  test("valida cuánto saldo a favor se usa: vacío, 0, más de lo que tiene y más que el total", async ({ page }) => {
    await abrirVentas(page);
    await abrirCobro(page, [4]);
    await page.getByTestId("venta-cliente").selectOption("2");
    await page.getByTestId("venta-aplicar-credito").check();
    const error = page.getByTestId("venta-credito-error");
    await page.getByTestId("venta-monto-credito").fill("");
    await expect(error).toHaveText("Ingresá cuánto saldo a favor querés usar.");
    await page.getByTestId("venta-monto-credito").fill("0");
    await expect(error).toHaveText("El saldo a favor a usar debe ser mayor a 0.");
    await page.getByTestId("venta-monto-credito").fill("700");
    await expect(error).toContainText("No podés usar más de");
    await expect(error).toContainText(/660,00/);
    await page.getByTestId("venta-monto-credito").fill("600");
    await expect(error).toHaveText(/No puede superar el total de la venta \(.*590,00\)\./);
    await page.getByTestId("venta-medio-pago").selectOption("1");
    await page.getByTestId("venta-confirmar").click(); // con error no confirma
    expect(backend.enviados("POST", "/ventas")).toHaveLength(0);
    await page.getByTestId("venta-monto-credito").fill("200");
    await expect(error).toBeHidden();
  });

  test("usar parte del saldo: se envía el monto elegido y el resto se cobra con el medio de pago", async ({ page }) => {
    await abrirVentas(page);
    await abrirCobro(page, [4]);
    await page.getByTestId("venta-cliente").selectOption("2");
    await page.getByTestId("venta-aplicar-credito").check();
    await page.getByTestId("venta-monto-credito").fill("200");
    await page.getByTestId("venta-medio-pago").selectOption("1");
    await page.getByTestId("venta-confirmar").click();
    await expect(page.getByTestId("venta-confirmada")).toContainText("Saldo a favor aplicado");
    expect(backend.enviados("POST", "/ventas")[0]).toMatchObject({ tipo: "CONTADO", cliente_id: 2, medio_pago_id: 1, saldo_a_favor_usado: 200 });
    expect(backend.estado.clientes.find((c) => c.id === 2).saldo_a_favor).toBe(460);
  });

  test("si el saldo a favor cubre todo, no se pide medio de pago", async ({ page }) => {
    await abrirVentas(page);
    await abrirCobro(page, [4]);
    await page.getByTestId("venta-cliente").selectOption("2");
    await page.getByTestId("venta-aplicar-credito").check();
    await expect(page.locator("#medio_pago")).toBeHidden();
    await page.getByTestId("venta-confirmar").click();
    await expect(page.getByTestId("venta-confirmada")).toBeVisible();
    expect(backend.enviados("POST", "/ventas")[0]).toMatchObject({ medio_pago_id: null, saldo_a_favor_usado: 590 });
    await expect(page.getByTestId("venta-confirmada")).toContainText("Saldo a favor");
  });

  test("cambiar de cliente desmarca la casilla", async ({ page }) => {
    await abrirVentas(page);
    await abrirCobro(page, [4]);
    await page.getByTestId("venta-cliente").selectOption("2");
    await page.getByTestId("venta-aplicar-credito").check();
    await page.getByTestId("venta-cliente").selectOption("1");
    await page.getByTestId("venta-cliente").selectOption("2");
    await expect(page.getByTestId("venta-aplicar-credito")).not.toBeChecked();
    await expect(page.getByTestId("venta-cobrar-total")).toHaveText(/590,00/);
  });
});

test.describe("Nueva venta: IVA según la categoría del negocio y del cliente", () => {
  const ivaCon = async (page, cliente) => {
    await abrirCobro(page, [5]); // Yerba $ 3.100
    if (cliente) await page.getByTestId("venta-cliente").selectOption(cliente);
    return page.getByTestId("venta-iva");
  };

  test("negocio Responsable Inscripto: discrimina con cliente RI y Monotributista (con leyenda) e incluye con los demás", async ({ page }) => {
    await abrirVentas(page, "ADMIN", { categoriaNegocio: "RESPONSABLE_INSCRIPTO" });
    const iva = await ivaCon(page, "1"); // RI
    await expect(iva).toContainText("Importe neto gravado");
    await expect(iva).toContainText(/2\.561,98/);
    await expect(iva).toContainText(/538,02/);
    await expect(page.getByTestId("venta-leyenda-iva")).toHaveCount(0);
    await page.getByTestId("venta-cliente").selectOption("3"); // Monotributista
    await expect(page.getByTestId("venta-iva")).toContainText("Importe neto gravado");
    await expect(page.getByTestId("venta-leyenda-iva")).toHaveText("El crédito fiscal discriminado en el presente comprobante no puede ser computado");
    await page.getByTestId("venta-cliente").selectOption("4"); // Exento
    await expect(page.getByTestId("venta-iva")).toHaveText("El precio incluye IVA.");
    await page.getByTestId("venta-cliente").selectOption("2"); // Consumidor final
    await expect(page.getByTestId("venta-iva")).toHaveText("El precio incluye IVA.");
    await page.getByTestId("venta-cliente").selectOption(""); // Consumidor final por defecto
    await expect(page.getByTestId("venta-iva")).toHaveText("El precio incluye IVA.");
  });

  test("negocio Monotributista: no discrimina IVA con ningún cliente", async ({ page }) => {
    await abrirVentas(page, "ADMIN", { categoriaNegocio: "MONOTRIBUTISTA" });
    const iva = await ivaCon(page, "1");
    await expect(iva).toHaveText("IVA no discriminado: el impuesto está unificado en la cuota fija del negocio.");
    await expect(page.getByTestId("venta-cobrar-total")).toHaveText(/3\.100,00/);
  });

  test("negocio Exento: no genera débito fiscal", async ({ page }) => {
    await abrirVentas(page, "ADMIN", { categoriaNegocio: "EXENTO" });
    const iva = await ivaCon(page, "3");
    await expect(iva).toHaveText("Negocio exento: no se genera débito fiscal ni se adiciona IVA.");
  });

  test("el total no cambia al discriminar el IVA", async ({ page }) => {
    await abrirVentas(page);
    await ivaCon(page, "1");
    await expect(page.getByTestId("venta-cobrar-total")).toHaveText(/3\.100,00/);
  });

  test("al confirmar se muestra el IVA que calculó el Backend", async ({ page }) => {
    await abrirVentas(page);
    await abrirCobro(page, [5]);
    await page.getByTestId("venta-tipo").selectOption("CUENTA_CORRIENTE");
    await page.getByTestId("venta-cliente").selectOption("3"); // Monotributista
    await page.getByTestId("venta-confirmar").click();
    await expect(page.getByTestId("venta-confirmada").getByTestId("venta-leyenda-iva")).toBeVisible();
  });
});

test.describe("Nueva venta: rol Cajero", () => {
  test("puede vender y solo recibe el nombre de cada cliente; el IVA lo calcula el Backend", async ({ page }) => {
    await abrirVentas(page, "CAJERO");
    await abrirCobro(page, [3]);
    await expect(page.locator("[data-testid=venta-cliente] option")).toHaveText(["Consumidor final", "Almacén Don Pedro S.R.L.", "Fundación Manos Unidas", "Kiosco El Sol (Carlos Gómez)", "María Fernanda López"]);
    const html = await page.content();
    expect(html).not.toContain("RESPONSABLE_INSCRIPTO");
    expect(html).not.toContain("MONOTRIBUTISTA");
    await page.getByTestId("venta-cliente").selectOption("1");
    await expect(page.getByTestId("venta-iva")).toHaveText("El IVA lo calcula el sistema al confirmar la venta.");
    // el Cajero no pide "Mi negocio" (no tiene permiso)
    expect(backend.llamadas.some((l) => l.ruta === "/auth/negocio")).toBe(false);
    await page.getByTestId("venta-medio-pago").selectOption("1");
    await page.getByTestId("venta-confirmar").click();
    await expect(page.getByTestId("venta-confirmada")).toBeVisible();
    await expect(page.getByTestId("venta-ver-historial")).toBeVisible();
  });

  test("también puede cobrar a un cliente con saldo a favor", async ({ page }) => {
    await abrirVentas(page, "CAJERO");
    await abrirCobro(page, [4]);
    await page.getByTestId("venta-cliente").selectOption("2");
    await expect(page.getByTestId("venta-credito-aviso")).toContainText(/660,00 a favor/);
  });
});

test.describe("Nueva venta: carga y navegación", () => {
  test("si no se pueden cargar los productos lo avisa", async ({ page }) => {
    backend = await simularBackendVentas(page, { rol: "ADMIN" });
    backend.fallar("GET /productos", { status: 500, body: { mensaje: "Error al listar los productos" } });
    await iniciarSesionComo(page, "ADMIN");
    await page.goto("/ventas.html");
    await expect(page.getByTestId("venta-error-carga")).toHaveText("Error al listar los productos");
  });

  test("el botón 'Historial de ventas' lleva al historial", async ({ page }) => {
    await abrirVentas(page);
    await expect(page.getByTestId("venta-historial")).toHaveText("Historial de ventas");
    await page.getByTestId("venta-historial").click();
    await expect(page).toHaveURL(/historial-ventas\.html$/);
  });

  test("mientras llegan los productos muestra 'Cargando productos…'", async ({ page }) => {
    backend = await simularBackendVentas(page, { rol: "ADMIN" });
    backend.demorar("GET /productos", 700);
    await iniciarSesionComo(page, "ADMIN");
    await page.goto("/ventas.html");
    await expect(page.getByTestId("venta-cargando")).toHaveText("Cargando productos…");
    await expect(page.getByTestId("venta-producto-3")).toBeVisible();
    await expect(page.getByTestId("venta-cargando")).toHaveCount(0);
  });

  test("sin sesión, Nueva venta redirige al login", async ({ page }) => {
    await page.goto("/ventas.html");
    await expect(page).toHaveURL(/login\.html$/);
  });
});

test.describe("Nueva venta: más casos del carrito y del cobro", () => {
  test("el buscador no distingue mayúsculas de minúsculas", async ({ page }) => {
    await abrirVentas(page);
    await page.getByTestId("venta-buscador").fill("YERBA");
    await expect(page.getByTestId("venta-disponibles")).toHaveText("1 disponible");
    await page.getByTestId("venta-buscador").fill("");
    await expect(page.getByTestId("venta-disponibles")).toHaveText("5 disponibles");
  });

  test("el botón − no baja la cantidad de 1", async ({ page }) => {
    await abrirVentas(page);
    await agregar(page, 3, 3, 3);
    await expect(page.getByTestId("venta-cantidad-3")).toHaveValue("3");
    await page.getByTestId("venta-menos-3").click();
    await page.getByTestId("venta-menos-3").click();
    await page.getByTestId("venta-menos-3").click();
    await expect(page.getByTestId("venta-cantidad-3")).toHaveValue("1");
    await expect(page.getByTestId("venta-items-contador")).toHaveText("1 ítem");
  });

  test("con un solo producto en stock el aviso va en singular", async ({ page }) => {
    await abrirVentas(page, "ADMIN", { semilla: (estado) => (estado.productos.find((p) => p.id === 1).cantidad = 1) });
    await agregar(page, 1, 1);
    await expect(page.getByTestId("venta-cantidad-1")).toHaveValue("1");
    await expect(page.getByTestId("venta-mas-1")).toBeDisabled();
    await expect(page.getByTestId("venta-stock-insuficiente-1")).toHaveText("Solo queda 1 en stock");
  });

  test("el aviso de 'Cobrar' sin productos desaparece al agregar uno", async ({ page }) => {
    await abrirVentas(page);
    await page.getByTestId("venta-cobrar").click();
    await expect(page.getByTestId("venta-aviso")).toBeVisible();
    await agregar(page, 3);
    await expect(page.getByTestId("venta-aviso")).toHaveCount(0);
  });

  test("'Cancelar' cierra el modal sin vender y el carrito queda como estaba", async ({ page }) => {
    await abrirVentas(page);
    await abrirCobro(page, [3, 4]);
    await page.getByTestId("modal-cancelar").click();
    await expect(page.getByTestId("venta-confirmar")).toHaveCount(0);
    await expect(page.getByTestId("venta-items-contador")).toHaveText("2 ítems");
    expect(backend.enviados("POST", "/ventas")).toHaveLength(0);
    await page.getByTestId("venta-cobrar").click();
    await expect(page.getByTestId("venta-confirmar")).toBeVisible();
  });

  test("mientras confirma, 'Cancelar' también se deshabilita", async ({ page }) => {
    await abrirVentas(page);
    backend.demorar("POST /ventas", 600);
    await abrirCobro(page);
    await page.getByTestId("venta-medio-pago").selectOption("1");
    await page.getByTestId("venta-confirmar").click();
    await expect(page.getByTestId("modal-cancelar")).toBeDisabled();
    await expect(page.getByTestId("venta-confirmada")).toBeVisible();
  });

  test("las etiquetas del cliente cambian con el tipo de venta", async ({ page }) => {
    await abrirVentas(page);
    await abrirCobro(page);
    await expect(page.locator("label[for=cliente]")).toHaveText("Cliente");
    await expect(page.getByText("En una venta de contado se usa Consumidor final por defecto.")).toBeVisible();
    await page.getByTestId("venta-tipo").selectOption("CUENTA_CORRIENTE");
    await expect(page.locator("label[for=cliente]")).toHaveText("Cliente *");
    await expect(page.getByText("Obligatorio: elegí un cliente ya registrado.")).toBeVisible();
    await page.getByTestId("venta-tipo").selectOption("CONTADO");
    await expect(page.locator("label[for=cliente]")).toHaveText("Cliente");
  });

  test("los errores del cobro se limpian al cambiar el medio de pago o el tipo de venta", async ({ page }) => {
    await abrirVentas(page);
    await abrirCobro(page);
    await page.getByTestId("venta-confirmar").click();
    await expect(page.locator("#error-medio_pago")).toBeVisible();
    await page.getByTestId("venta-medio-pago").selectOption("1");
    await expect(page.locator("#error-medio_pago")).toBeHidden();
    await expect(page.getByTestId("formulario-errores")).toHaveText("");

    await page.getByTestId("venta-tipo").selectOption("CUENTA_CORRIENTE");
    await page.getByTestId("venta-confirmar").click();
    await expect(page.locator("#error-cliente")).toBeVisible();
    await page.getByTestId("venta-tipo").selectOption("CONTADO");
    await expect(page.locator("#error-cliente")).toBeHidden();
    await expect(page.getByTestId("formulario-errores")).toHaveText("");
  });

  test("sin medios de pago creados lo avisa en la lista y no deja confirmar", async ({ page }) => {
    await abrirVentas(page, "ADMIN", { semilla: (estado) => (estado.medios = []) });
    await abrirCobro(page);
    await expect(page.locator("[data-testid=venta-medio-pago] option")).toHaveText(["Sin medios de pago. Creá uno en Configuración > Medios de pago"]);
    await page.getByTestId("venta-confirmar").click();
    await expect(page.locator("#error-medio_pago")).toHaveText("Seleccioná el medio de pago de la venta.");
    expect(backend.enviados("POST", "/ventas")).toHaveLength(0);
  });

  test("un producto que quedó sin stock durante el cobro se marca 'Sin stock' en el carrito", async ({ page }) => {
    await abrirVentas(page);
    await abrirCobro(page, [3, 4]);
    backend.estado.productos.find((p) => p.id === 3).cantidad = 0;
    await page.getByTestId("venta-medio-pago").selectOption("1");
    await page.getByTestId("venta-confirmar").click();
    await expect(page.getByTestId("venta-alerta-stock")).toBeVisible();
    await expect(page.getByTestId("venta-sin-stock-3")).toBeVisible();
    await expect(page.getByTestId("venta-sin-stock-4")).toBeHidden();
    await expect(page.getByTestId("venta-producto-3")).toBeDisabled();
  });

  test("el aviso de stock se borra al volver a armar la venta", async ({ page }) => {
    await abrirVentas(page);
    await abrirCobro(page, [3]);
    backend.estado.productos.find((p) => p.id === 3).cantidad = 0;
    await page.getByTestId("venta-medio-pago").selectOption("1");
    await page.getByTestId("venta-confirmar").click();
    await expect(page.getByTestId("venta-alerta-stock")).toBeVisible();
    await page.getByTestId("venta-producto-4").click();
    await expect(page.getByTestId("venta-alerta-stock")).toHaveCount(0);
  });

  test("la venta confirmada muestra el total y el tipo de venta", async ({ page }) => {
    await abrirVentas(page);
    await abrirCobro(page, [3, 3]);
    await page.getByTestId("venta-medio-pago").selectOption("1");
    await page.getByTestId("venta-confirmar").click();
    await expect(page.getByTestId("venta-confirmada")).toContainText("Contado");
    await expect(page.getByTestId("venta-confirmada")).toContainText(/Total.*1\.960,00/s);
    await expect(page.getByTestId("venta-confirmada")).toContainText("Fecha y hora");
  });
});

test.describe("Nueva venta: errores del Backend al confirmar", () => {
  const confirmarConMedio = async (page, cliente) => {
    await abrirCobro(page);
    if (cliente) await page.getByTestId("venta-cliente").selectOption(cliente);
    await page.getByTestId("venta-medio-pago").selectOption("1");
    await page.getByTestId("venta-confirmar").click();
  };

  test("si rechaza los productos (items), cierra el modal y lo avisa arriba", async ({ page }) => {
    await abrirVentas(page);
    backend.fallar("POST /ventas", { status: 400, body: { status: "error", mensaje: "Error de validación", errores: { items: "Hay un producto que no existe." } } });
    await confirmarConMedio(page);
    await expect(page.getByTestId("venta-aviso")).toHaveText("Hay un producto que no existe.");
    await expect(page.getByTestId("venta-confirmar")).toHaveCount(0);
    await expect(page.getByTestId("venta-items-contador")).toHaveText("1 ítem");
  });

  test("si rechaza al cliente, el error sale junto al campo y el modal sigue abierto", async ({ page }) => {
    await abrirVentas(page);
    backend.fallar("POST /ventas", { status: 400, body: { status: "error", mensaje: "Error de validación", errores: { cliente_id: "El cliente no está registrado." } } });
    await confirmarConMedio(page, "1");
    await expect(page.locator("#error-cliente")).toHaveText("El cliente no está registrado.");
    await expect(page.locator("#error-medio_pago")).toBeHidden();
    await expect(page.getByTestId("venta-confirmar")).toBeEnabled();
  });

  // Falla de la pantalla: el resumen nombra también "medio de pago" aunque solo falló el cliente, porque al armar los
  // errores se deja la clave `medio_pago` con valor vacío y el resumen cuenta todas las claves. Se activa al corregirla.
  test.fixme("el resumen de errores nombra solo el campo que falló", async ({ page }) => {
    await abrirVentas(page);
    backend.fallar("POST /ventas", { status: 400, body: { status: "error", mensaje: "Error de validación", errores: { cliente_id: "El cliente no está registrado." } } });
    await confirmarConMedio(page, "1");
    await expect(page.getByTestId("formulario-errores")).toHaveText("Revisá estos datos: cliente.");
  });

  test("un error del servidor con mensaje propio lo muestra y deja reintentar", async ({ page }) => {
    await abrirVentas(page);
    backend.fallar("POST /ventas", { status: 500, body: { status: "error", mensaje: "Error interno del servidor" } });
    await confirmarConMedio(page);
    await expect(page.locator(".gastos-toast")).toContainText("Error interno del servidor");
    await expect(page.getByTestId("venta-confirmar")).toBeEnabled();
    await expect(page.getByTestId("venta-confirmar")).toHaveText("Confirmar venta");
    await expect(page.getByTestId("modal-cancelar")).toBeEnabled();
  });

  test("un error del servidor sin mensaje usa el texto por defecto", async ({ page }) => {
    await abrirVentas(page);
    backend.fallar("POST /ventas", { status: 500, body: {} });
    await confirmarConMedio(page);
    await expect(page.locator(".gastos-toast")).toContainText("No se pudo confirmar la venta. Intentá de nuevo.");
    expect(backend.enviados("POST", "/ventas")).toHaveLength(1);
  });

  // Si el Backend no responde al pedir los medios de pago, el modal igual abre y el desplegable avisa que no hay medios.
  test("si no se pueden cargar los medios de pago, el modal abre y avisa que no hay medios", async ({ page }) => {
    await abrirVentas(page);
    backend.fallar("GET /medios-pago", { status: 500, body: { mensaje: "Error al listar los medios de pago" } });
    await abrirCobro(page);
    await expect(page.locator("[data-testid=venta-medio-pago] option")).toHaveText(["Sin medios de pago. Creá uno en Configuración > Medios de pago"]);
    await page.getByTestId("venta-confirmar").click();
    await expect(page.locator("#error-medio_pago")).toBeVisible();
    expect(backend.enviados("POST", "/ventas")).toHaveLength(0);
  });
});
