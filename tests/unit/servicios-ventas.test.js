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
  it("listar pide GET /ventas y devuelve las ventas (o vacío si no vino nada)", async () => {
    fetchAPI.mockResolvedValueOnce({ ventas: [{ id: 1, numero: "00001-00000458" }] });
    expect(await servicioVentas.listar()).toEqual([{ id: 1, numero: "00001-00000458" }]);
    fetchAPI.mockResolvedValueOnce({});
    expect(await servicioVentas.listar()).toEqual([]);
    expect(fetchAPI).toHaveBeenCalledWith("/ventas");
  });

  it("crear envía POST /ventas con los datos y devuelve la venta confirmada", async () => {
    const datos = { tipo: "CONTADO", cliente_id: null, medio_pago_id: 1, saldo_a_favor_usado: 0, items: [{ producto_id: 1, cantidad: 2 }] };
    fetchAPI.mockResolvedValue({ venta: { id: 9, numero: "00001-00000459" } });
    expect(await servicioVentas.crear(datos)).toEqual({ id: 9, numero: "00001-00000459" });
    expect(fetchAPI).toHaveBeenCalledWith("/ventas", "POST", datos);
  });

  it("anular envía POST /ventas/<id>/anular y devuelve la venta", async () => {
    fetchAPI.mockResolvedValue({ venta: { id: 9, anulada: true } });
    expect(await servicioVentas.anular(9)).toEqual({ id: 9, anulada: true });
    expect(fetchAPI).toHaveBeenCalledWith("/ventas/9/anular", "POST");
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

  it("los errores del Backend llegan tal cual a la pantalla (el 409 de stock y los 400 con errores por campo)", async () => {
    const sinStock = Object.assign(new Error("Stock insuficiente para Sifón"), { status: 409 });
    const invalida = Object.assign(new Error("Error de validación"), { status: 400, errores: { cliente_id: "El cliente no está registrado." } });
    fetchAPI.mockRejectedValueOnce(sinStock);
    await expect(servicioVentas.crear({})).rejects.toBe(sinStock);
    fetchAPI.mockRejectedValueOnce(invalida);
    await expect(servicioVentas.crear({})).rejects.toBe(invalida);
    fetchAPI.mockRejectedValueOnce(sinStock);
    await expect(servicioVentas.anular(1)).rejects.toBe(sinStock);
    fetchAPI.mockRejectedValueOnce(sinStock);
    await expect(servicioVentas.listar()).rejects.toBe(sinStock);
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
    fetchAPI.mockResolvedValue({ clientes: [{ id: 1, nombre: "Ana", saldo_a_favor: 100, categoria_impositiva: "EXENTO" }] });
    expect(await servicioClientesDeVentas.listar()).toEqual([{ id: 1, nombre: "Ana", saldo_a_favor: 100, categoria_impositiva: "EXENTO" }]);
    expect(fetchAPI).toHaveBeenCalledWith("/clientes");
  });

  it("el saldo a favor llega como número, aunque el Backend lo mande como texto", async () => {
    fetchAPI.mockResolvedValue({ clientes: [{ id: 1, nombre: "Ana", saldo_a_favor: "1500.50" }] });
    expect((await servicioClientesDeVentas.listar())[0].saldo_a_favor).toBe(1500.5);
  });

  it("sin saldo a favor (o con un valor que no es número) queda en 0", async () => {
    fetchAPI.mockResolvedValue({ clientes: [{ id: 1, nombre: "Ana" }, { id: 2, nombre: "Luis", saldo_a_favor: null }, { id: 3, nombre: "Eva", saldo_a_favor: "abc" }] });
    expect((await servicioClientesDeVentas.listar()).map((c) => c.saldo_a_favor)).toEqual([0, 0, 0]);
  });

  it("el Cajero recibe solo id, nombre y saldo a favor, y no se le agrega nada más", async () => {
    fetchAPI.mockResolvedValue({ clientes: [{ id: 1, nombre: "Ana", saldo_a_favor: 100 }] });
    expect(Object.keys((await servicioClientesDeVentas.listar())[0]).sort()).toEqual(["id", "nombre", "saldo_a_favor"]);
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
