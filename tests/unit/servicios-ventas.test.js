import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { servicioClientesDeVentas, servicioProductosDeVentas, servicioVentas } from "../../frontend/js/servicios/ventas.js";

// Servicios de Ventas: ventas, clientes para elegir al cobrar y productos para vender. Llaman a `fetchAPI` (global de
// api.js): acá se reemplaza por una función simulada y se mira a qué endpoint, con qué método y con qué cuerpo habla cada
// uno, y cómo desenvuelve la respuesta. La descarga del ticket usa `fetch`, el DOM y localStorage: también se simulan.

let fetchAPI;
beforeEach(() => {
  fetchAPI = vi.fn();
  vi.stubGlobal("fetchAPI", fetchAPI);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("servicioVentas", () => {
  const VENTA = { id: 9, numero_venta: "00000459", tipo_venta: "CONTADO", total: "300.00", estado: "CONFIRMADA", fecha_hora: "Wed, 25 Nov 2026 12:00:00 GMT", cliente: null, oculto: false, productos: [{ producto: "Sifón", cantidad: 2, precio: 150, iva: 21 }] };
  const falla = Object.assign(new Error("Error interno"), { status: 500 });
  // Responde según la ruta pedida; lo que no se indique viene vacío.
  const backend = (respuestas) => fetchAPI.mockImplementation(async (ruta, metodo = "GET") => {
    const respuesta = respuestas[`${metodo} ${ruta.split("?")[0]}`] ?? { items: [] };
    if (respuesta instanceof Error) throw respuesta;
    return respuesta;
  });

  it("listar traduce los nombres de los campos del Backend", async () => {
    backend({ "GET /ventas": { items: [VENTA] }, "GET /pagos": { items: [{ venta_id: 9, medio_pago: "Efectivo" }] } });
    expect(await servicioVentas.listar()).toEqual([
      { id: 9, numero: "00001-00000459", tipo: "CONTADO", cliente_nombre: null, fecha_hora: VENTA.fecha_hora, total: 300, saldo: undefined, medio_pago: "Efectivo", credito_aplicado: 0, anulada: false, oculto: false, items: [{ producto: "Sifón", precio: 150, cantidad: 2 }], iva: null },
    ]);
    expect(fetchAPI).toHaveBeenCalledWith("/ventas");
    expect(fetchAPI).toHaveBeenCalledWith("/pagos?todos=true&incluir_ocultos=true");
  });

  it("listar completa las ventas a cuenta corriente con su saldo, sin medio de pago, y respeta si están ocultas", async () => {
    backend({
      "GET /ventas": { items: [{ ...VENTA, tipo_venta: "CUENTA_CORRIENTE", estado: "ANULADA", cliente: "Ana", oculto: true }] },
      "GET /pagos/cuentas-corrientes": { items: [{ venta_id: 9, saldo_pendiente: 120 }] },
      "GET /pagos": { items: [{ venta_id: 9, medio_pago: "Efectivo" }] },
    });
    expect((await servicioVentas.listar())[0]).toMatchObject({ cliente_nombre: "Ana", anulada: true, saldo: 120, medio_pago: null, oculto: true, items: [{ producto: "Sifón", precio: 150, cantidad: 2 }] });
  });

  it("listar devuelve vacío si no hay ventas, sin pedir nada más", async () => {
    backend({});
    expect(await servicioVentas.listar()).toEqual([]);
    expect(fetchAPI).toHaveBeenCalledTimes(1);
  });

  it("listar muestra las ventas aunque fallen los pagos o la cuenta corriente", async () => {
    backend({ "GET /ventas": { items: [VENTA] }, "GET /pagos": falla, "GET /pagos/cuentas-corrientes": falla });
    expect((await servicioVentas.listar())[0]).toMatchObject({ id: 9, medio_pago: null, saldo: undefined });
  });

  const DATOS = { tipo: "CONTADO", cliente_id: null, medio_pago_id: 1, saldo_a_favor_usado: 0, items: [{ producto_id: 1, cantidad: 2 }] };
  const CREADA = { status: "ok", venta_id: 9, numero: "00000459", total: 300 };

  it("crear envía tipo_venta y devuelve la venta guardada que está en el listado", async () => {
    backend({ "POST /ventas": CREADA, "GET /ventas": { items: [VENTA] }, "GET /pagos": { items: [{ venta_id: 9, medio_pago: "Efectivo" }] } });
    expect(await servicioVentas.crear(DATOS)).toMatchObject({ id: 9, numero: "00001-00000459", medio_pago: "Efectivo", fecha_hora: VENTA.fecha_hora });
    const { tipo, ...resto } = DATOS;
    expect(fetchAPI).toHaveBeenCalledWith("/ventas", "POST", { ...resto, tipo_venta: tipo });
  });

  it("crear no falla si la venta se guardó pero no se puede releer", async () => {
    backend({ "POST /ventas": CREADA, "GET /ventas": falla });
    expect(await servicioVentas.crear({ ...DATOS, tipo: "CUENTA_CORRIENTE", cliente_id: 3 })).toMatchObject({ id: 9, numero: "00001-00000459", tipo: "CUENTA_CORRIENTE", total: 300, cliente_nombre: "Cliente registrado" });
  });

  it("anular envía PATCH /ventas/<id>/anular", async () => {
    fetchAPI.mockResolvedValue({ status: "ok" });
    await servicioVentas.anular(9);
    expect(fetchAPI).toHaveBeenCalledWith("/ventas/9/anular", "PATCH");
  });

  it("ocultar envía PATCH /ventas/<id>/ocultar con { oculto } y devuelve la venta", async () => {
    fetchAPI.mockResolvedValue({ venta: { id: 9, oculto: true } });
    expect(await servicioVentas.ocultar(9, true)).toEqual({ id: 9, oculto: true });
    await servicioVentas.ocultar(9, false);
    expect(fetchAPI.mock.calls).toEqual([
      ["/ventas/9/ocultar", "PATCH", { oculto: true }],
      ["/ventas/9/ocultar", "PATCH", { oculto: false }],
    ]);
  });

  it("el error de stock llega con el nombre del producto en vez de su número", async () => {
    const sinStock = Object.assign(new Error("Stock insuficiente para el producto 1"), { status: 409 });
    backend({ "POST /ventas": sinStock, "GET /productos": { items: [{ id: 1, nombre: "Sifón", cantidad: 0, precio_venta: 150 }] } });
    await expect(servicioVentas.crear(DATOS)).rejects.toThrow('Stock insuficiente para el producto "Sifón"');
  });

  it("los demás errores del Backend llegan tal cual a la pantalla", async () => {
    const invalida = Object.assign(new Error("Tipo de venta inválido"), { status: 400 });
    fetchAPI.mockRejectedValue(invalida);
    await expect(servicioVentas.crear(DATOS)).rejects.toBe(invalida);
    await expect(servicioVentas.anular(1)).rejects.toBe(invalida);
    await expect(servicioVentas.listar()).rejects.toBe(invalida);
  });
});

describe("servicioVentas.descargarTicket", () => {
  let enlace;
  let fetchSimulado;

  beforeEach(() => {
    vi.useFakeTimers();
    enlace = { click: vi.fn(), remove: vi.fn() };
    fetchSimulado = vi.fn();
    vi.stubGlobal("API_URL", "http://127.0.0.1:5000/api");
    vi.stubGlobal("localStorage", { getItem: vi.fn(() => "token-abc") });
    vi.stubGlobal("fetch", fetchSimulado);
    vi.stubGlobal("document", { createElement: vi.fn(() => enlace), body: { append: vi.fn() } });
    vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:ticket"), revokeObjectURL: vi.fn() });
  });

  it("pide GET /ventas/<id>/ticket con el token de la sesión", async () => {
    fetchSimulado.mockResolvedValue({ ok: true, blob: async () => "pdf" });
    await servicioVentas.descargarTicket(9, "00001-00000459");
    expect(fetchSimulado).toHaveBeenCalledWith("http://127.0.0.1:5000/api/ventas/9/ticket", { headers: { Authorization: "Bearer token-abc" } });
    expect(localStorage.getItem).toHaveBeenCalledWith("trazzo_access_token");
  });

  it("baja el archivo como ticket-<número>.pdf, hace clic en el enlace y lo saca de la página", async () => {
    fetchSimulado.mockResolvedValue({ ok: true, blob: async () => "pdf" });
    await servicioVentas.descargarTicket(9, "00001-00000459");
    expect(document.createElement).toHaveBeenCalledWith("a");
    expect(enlace.href).toBe("blob:ticket");
    expect(enlace.download).toBe("ticket-00001-00000459.pdf");
    expect(document.body.append).toHaveBeenCalledWith(enlace);
    expect(enlace.click).toHaveBeenCalledTimes(1);
    expect(enlace.remove).toHaveBeenCalledTimes(1);
  });

  it("sin número usa el id de la venta para nombrar el archivo", async () => {
    fetchSimulado.mockResolvedValue({ ok: true, blob: async () => "pdf" });
    await servicioVentas.descargarTicket(9);
    expect(enlace.download).toBe("ticket-9.pdf");
  });

  it("libera el archivo temporal un segundo después", async () => {
    fetchSimulado.mockResolvedValue({ ok: true, blob: async () => "pdf" });
    await servicioVentas.descargarTicket(9, "X");
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:ticket");
  });

  it("si el Backend responde con error, lanza un error con su mensaje y su status, y no descarga nada", async () => {
    fetchSimulado.mockResolvedValue({ ok: false, status: 404, json: async () => ({ mensaje: "La venta no existe." }) });
    const error = await servicioVentas.descargarTicket(9).catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("La venta no existe.");
    expect(error.status).toBe(404);
    expect(enlace.click).not.toHaveBeenCalled();
  });

  it("si el error no trae mensaje (o no es JSON), usa el texto por defecto", async () => {
    fetchSimulado.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    await expect(servicioVentas.descargarTicket(9)).rejects.toThrow("No se pudo descargar el ticket.");
    fetchSimulado.mockResolvedValueOnce({ ok: false, status: 502, json: async () => { throw new Error("no es JSON"); } });
    await expect(servicioVentas.descargarTicket(9)).rejects.toThrow("No se pudo descargar el ticket.");
  });
});

describe("servicioClientesDeVentas", () => {
  it("listar pide GET /clientes y devuelve los clientes", async () => {
    fetchAPI.mockResolvedValue({ items: [{ id: 1, nombre: "Ana", categoria_impositiva: "EXENTO" }] });
    expect(await servicioClientesDeVentas.listar()).toEqual([{ id: 1, nombre: "Ana", categoria_impositiva: "EXENTO", saldo_a_favor: 0 }]);
    expect(fetchAPI).toHaveBeenCalledWith("/clientes");
  });

  it("entrega el saldo a favor en 0 porque el Backend todavía no lo descuenta", async () => {
    fetchAPI.mockResolvedValue({ items: [{ id: 1, nombre: "Ana", saldo_a_favor: 1500.5 }, { id: 2, nombre: "Luis" }] });
    expect((await servicioClientesDeVentas.listar()).map((c) => c.saldo_a_favor)).toEqual([0, 0]);
  });

  it("si la respuesta no trae clientes, devuelve una lista vacía", async () => {
    fetchAPI.mockResolvedValue({ status: "ok" });
    expect(await servicioClientesDeVentas.listar()).toEqual([]);
  });

  it("un error del Backend llega tal cual a la pantalla", async () => {
    const error = Object.assign(new Error("Error interno del servidor"), { status: 500 });
    fetchAPI.mockRejectedValue(error);
    await expect(servicioClientesDeVentas.listar()).rejects.toBe(error);
  });
});

describe("servicioProductosDeVentas", () => {
  it("listar pide solo los bienes de cambio", async () => {
    fetchAPI.mockResolvedValue({ items: [] });
    await servicioProductosDeVentas.listar();
    expect(fetchAPI).toHaveBeenCalledWith("/productos?tipo_producto=BIEN_DE_CAMBIO");
  });

  it("devuelve la cantidad y el precio de venta como números, aunque el Backend los mande como texto", async () => {
    fetchAPI.mockResolvedValue({ items: [{ id: 1, nombre: "Sifón", cantidad: "24", precio_venta: "1200.50", stock_minimo: 6 }] });
    expect(await servicioProductosDeVentas.listar()).toEqual([{ id: 1, nombre: "Sifón", cantidad: 24, precio_venta: 1200.5, stock_minimo: 6 }]);
  });

  it("si la respuesta no trae productos o la sesión venció, devuelve una lista vacía", async () => {
    fetchAPI.mockResolvedValueOnce({ status: "ok" });
    expect(await servicioProductosDeVentas.listar()).toEqual([]);
    fetchAPI.mockResolvedValueOnce(undefined);
    expect(await servicioProductosDeVentas.listar()).toEqual([]);
  });

  it("un error del Backend llega tal cual a la pantalla", async () => {
    const error = Object.assign(new Error("Error interno del servidor"), { status: 500 });
    fetchAPI.mockRejectedValue(error);
    await expect(servicioProductosDeVentas.listar()).rejects.toBe(error);
  });
});
