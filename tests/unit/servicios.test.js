import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mensajeDeError } from "../../frontend/js/servicios/errores.js";
import { servicioNegocio } from "../../frontend/js/servicios/negocio.js";
import { servicioPersonal } from "../../frontend/js/servicios/personal.js";
import { cargarMediosPago, servicioMediosPago } from "../../frontend/js/servicios/medios-pago.js";
import { servicioGastos } from "../../frontend/js/servicios/gastos.js";

// Los servicios llaman a `fetchAPI` (global de api.js): acá se reemplaza por una función simulada y se mira a qué
// endpoint, con qué método y con qué cuerpo habla cada uno, y cómo desenvuelve la respuesta.

let fetchAPI;
beforeEach(() => {
  fetchAPI = vi.fn();
  vi.stubGlobal("fetchAPI", fetchAPI);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("mensajeDeError", () => {
  it("sin conexión (el error del navegador no tiene status) avisa en español", () => {
    expect(mensajeDeError(new TypeError("Failed to fetch"), "No se pudo guardar.")).toBe("No se pudo conectar con el servidor.");
    expect(mensajeDeError(undefined, "x")).toBe("No se pudo conectar con el servidor.");
  });

  it("si el Backend mandó un mensaje, lo muestra", () => {
    expect(mensajeDeError(Object.assign(new Error("El correo ya está registrado"), { status: 409 }), "x")).toBe("El correo ya está registrado");
  });

  it("si el mensaje es el genérico de fetchAPI o está vacío, usa el texto por defecto", () => {
    expect(mensajeDeError(Object.assign(new Error("Error en la petición"), { status: 500 }), "No se pudo guardar.")).toBe("No se pudo guardar.");
    expect(mensajeDeError(Object.assign(new Error(""), { status: 500 }), "No se pudo guardar.")).toBe("No se pudo guardar.");
  });
});

describe("servicioNegocio", () => {
  it("obtener pide GET /auth/negocio y devuelve el negocio sin el envoltorio", async () => {
    fetchAPI.mockResolvedValue({ status: "ok", negocio: { identificador: "kiosco", nombre_comercial: "Kiosco" } });
    expect(await servicioNegocio.obtener()).toEqual({ identificador: "kiosco", nombre_comercial: "Kiosco" });
    expect(fetchAPI).toHaveBeenCalledWith("/auth/negocio");
  });

  it("guardar envía PUT /auth/negocio y devuelve el negocio actualizado", async () => {
    fetchAPI.mockResolvedValue({ status: "ok", negocio: { nombre_comercial: "Otro" } });
    const datos = { nombre_comercial: "Otro", rubro: "Kiosco", categoria_impositiva: "EXENTO" };
    expect(await servicioNegocio.guardar(datos)).toEqual({ nombre_comercial: "Otro" });
    expect(fetchAPI).toHaveBeenCalledWith("/auth/negocio", "PUT", datos);
  });

  it("un rubro null viaja como texto vacío (el Backend ignora null y conservaría el anterior)", async () => {
    fetchAPI.mockResolvedValue({ negocio: {} });
    await servicioNegocio.guardar({ nombre_comercial: "X", rubro: null, categoria_impositiva: "EXENTO" });
    expect(fetchAPI.mock.calls[0][2].rubro).toBe("");
  });

  it("no modifica el objeto que recibe", async () => {
    fetchAPI.mockResolvedValue({ negocio: {} });
    const datos = { nombre_comercial: "X", rubro: null, categoria_impositiva: "EXENTO" };
    await servicioNegocio.guardar(datos);
    expect(datos.rubro).toBeNull();
  });

  it("los errores del Backend llegan tal cual a la pantalla", async () => {
    const error = Object.assign(new Error("Datos inválidos"), { status: 400, errores: { nombre_comercial: "Rellene el nombre." } });
    fetchAPI.mockRejectedValue(error);
    await expect(servicioNegocio.guardar({})).rejects.toBe(error);
  });
});

describe("servicioPersonal", () => {
  it("listar pide GET /auth/personal y devuelve la lista", async () => {
    fetchAPI.mockResolvedValue({ status: "ok", personal: [{ id: 1 }, { id: 2 }] });
    expect(await servicioPersonal.listar()).toEqual([{ id: 1 }, { id: 2 }]);
    expect(fetchAPI).toHaveBeenCalledWith("/auth/personal");
  });

  it("crear envía POST /auth/personal y devuelve la persona creada", async () => {
    fetchAPI.mockResolvedValue({ status: "ok", usuario: { id: 9, usuario: "julia123" } });
    const datos = { usuario: "julia123", password: "Clave#2026" };
    expect(await servicioPersonal.crear(datos)).toEqual({ id: 9, usuario: "julia123" });
    expect(fetchAPI).toHaveBeenCalledWith("/auth/personal", "POST", datos);
  });

  it("actualizar, habilitar, deshabilitar y eliminar van a su endpoint con su método", async () => {
    fetchAPI.mockResolvedValue({ status: "ok" });
    await servicioPersonal.actualizar(3, { apellido: "Díaz" });
    await servicioPersonal.habilitar(4);
    await servicioPersonal.deshabilitar(3);
    await servicioPersonal.eliminar(3);
    expect(fetchAPI.mock.calls).toEqual([
      ["/auth/personal/3", "PUT", { apellido: "Díaz" }],
      ["/auth/personal/4/habilitar", "PATCH"],
      ["/auth/personal/3/deshabilitar", "PATCH"],
      ["/auth/personal/3", "DELETE"],
    ]);
  });
});

describe("servicioMediosPago", () => {
  it("listar pide GET /medios-pago y devuelve la lista (o vacía si no vino)", async () => {
    fetchAPI.mockResolvedValueOnce({ medios_pago: [{ id: 1, nombre: "Efectivo", es_predeterminado: true }] });
    expect(await servicioMediosPago.listar()).toEqual([{ id: 1, nombre: "Efectivo", es_predeterminado: true }]);
    fetchAPI.mockResolvedValueOnce({ status: "ok" });
    expect(await servicioMediosPago.listar()).toEqual([]);
    expect(fetchAPI).toHaveBeenCalledWith("/medios-pago");
  });

  it("crear y actualizar envían solo el nombre y devuelven el medio de pago", async () => {
    fetchAPI.mockResolvedValue({ medio_pago: { id: 5, nombre: "Débito" } });
    expect(await servicioMediosPago.crear("Débito")).toEqual({ id: 5, nombre: "Débito" });
    expect(await servicioMediosPago.actualizar(5, "Tarjeta")).toEqual({ id: 5, nombre: "Débito" });
    expect(fetchAPI.mock.calls).toEqual([
      ["/medios-pago", "POST", { nombre: "Débito" }],
      ["/medios-pago/5", "PUT", { nombre: "Tarjeta" }],
    ]);
  });

  it("eliminar va a DELETE /medios-pago/<id>", async () => {
    fetchAPI.mockResolvedValue({ status: "ok" });
    await servicioMediosPago.eliminar(5);
    expect(fetchAPI).toHaveBeenCalledWith("/medios-pago/5", "DELETE");
  });
});

describe("cargarMediosPago (para los desplegables)", () => {
  it("devuelve { id (texto), nombre } en el orden del Backend", async () => {
    fetchAPI.mockResolvedValue({ medios_pago: [{ id: 1, nombre: "Efectivo", es_predeterminado: true }, { id: 2, nombre: "Transferencia", es_predeterminado: false }] });
    expect(await cargarMediosPago()).toEqual([{ id: "1", nombre: "Efectivo" }, { id: "2", nombre: "Transferencia" }]);
  });

  it("si el Backend falla devuelve una lista vacía en vez de romper", async () => {
    fetchAPI.mockRejectedValue(new TypeError("Failed to fetch"));
    expect(await cargarMediosPago()).toEqual([]);
  });
});

describe("servicioGastos", () => {
  it("listar sin período pide GET /gastos y devuelve gastos y resumen", async () => {
    const resumen = { total_gastos: 100, cantidad_operaciones: 1 };
    fetchAPI.mockResolvedValue({ status: "ok", gastos: [{ id: 1 }], resumen });
    expect(await servicioGastos.listar()).toEqual({ gastos: [{ id: 1 }], resumen });
    expect(fetchAPI).toHaveBeenCalledWith("/gastos");
  });

  it("listar con período manda desde y hasta como parámetros", async () => {
    fetchAPI.mockResolvedValue({ gastos: [] });
    await servicioGastos.listar({ desde: "2026-03-01", hasta: "2026-03-31" });
    expect(fetchAPI).toHaveBeenCalledWith("/gastos?desde=2026-03-01&hasta=2026-03-31");
    await servicioGastos.listar({ desde: "2026-03-01" });
    expect(fetchAPI).toHaveBeenLastCalledWith("/gastos?desde=2026-03-01");
  });

  it("si la respuesta no trae gastos ni resumen, devuelve vacío y en cero", async () => {
    fetchAPI.mockResolvedValue({ status: "ok" });
    expect(await servicioGastos.listar()).toEqual({ gastos: [], resumen: { total_gastos: 0, cantidad_operaciones: 0 } });
  });

  it("crear, actualizar y eliminar van a su endpoint con su método", async () => {
    fetchAPI.mockResolvedValue({ gasto: { id: 8 } });
    const datos = { fecha: "2026-04-10", concepto: "Luz", monto: 100, medio_pago_id: null };
    expect(await servicioGastos.crear(datos)).toEqual({ id: 8 });
    expect(await servicioGastos.actualizar(8, datos)).toEqual({ id: 8 });
    await servicioGastos.eliminar(8);
    expect(fetchAPI.mock.calls).toEqual([
      ["/gastos", "POST", datos],
      ["/gastos/8", "PUT", datos],
      ["/gastos/8", "DELETE"],
    ]);
  });
});
