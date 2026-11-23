import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { servicioProductos, servicioReposiciones } from "../../frontend/js/servicios/producto.js";
import { servicioInsumos } from "../../frontend/js/servicios/insumos.js";
import { servicioEquipamiento } from "../../frontend/js/servicios/equipamiento.js";

// Servicios de Productos, Reposiciones, Insumos y Equipamiento. Llaman a `fetchAPI` (global de api.js): acá se reemplaza
// por una función simulada y se mira a qué endpoint, con qué método y con qué cuerpo habla cada uno, y cómo desenvuelve
// la respuesta.

let fetchAPI;
beforeEach(() => {
  fetchAPI = vi.fn();
  vi.stubGlobal("fetchAPI", fetchAPI);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("servicioProductos", () => {
  it("listar pide solo los bienes de cambio y devuelve los productos", async () => {
    fetchAPI.mockResolvedValue({ status: "ok", items: [{ id: 1, nombre: "Sifón" }] });
    expect(await servicioProductos.listar()).toEqual([{ id: 1, nombre: "Sifón" }]);
    expect(fetchAPI).toHaveBeenCalledWith("/productos?tipo_producto=BIEN_DE_CAMBIO");
  });

  it("listar acepta que el Backend mande directamente un arreglo", async () => {
    fetchAPI.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    expect(await servicioProductos.listar()).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("listar devuelve una lista vacía si no vino nada o si la sesión venció", async () => {
    fetchAPI.mockResolvedValueOnce({ status: "ok" });
    expect(await servicioProductos.listar()).toEqual([]);
    fetchAPI.mockResolvedValueOnce(undefined);
    expect(await servicioProductos.listar()).toEqual([]);
  });

  it("listar agrega el texto buscado, 'stock bajo' y 'ocultos' solo cuando se piden", async () => {
    fetchAPI.mockResolvedValue({ items: [] });
    await servicioProductos.listar({ q: "sifón" });
    await servicioProductos.listar({ stockBajo: true });
    await servicioProductos.listar({ ocultos: true });
    await servicioProductos.listar({ q: "a b", stockBajo: true, ocultos: true });
    expect(fetchAPI.mock.calls.map((c) => c[0])).toEqual([
      "/productos?tipo_producto=BIEN_DE_CAMBIO&q=sif%C3%B3n",
      "/productos?tipo_producto=BIEN_DE_CAMBIO&stock_bajo=true",
      "/productos?tipo_producto=BIEN_DE_CAMBIO&ocultos=true",
      "/productos?tipo_producto=BIEN_DE_CAMBIO&q=a+b&stock_bajo=true&ocultos=true",
    ]);
  });

  it("listar con un texto vacío no manda el parámetro q", async () => {
    fetchAPI.mockResolvedValue({ items: [] });
    await servicioProductos.listar({ q: "" });
    expect(fetchAPI).toHaveBeenCalledWith("/productos?tipo_producto=BIEN_DE_CAMBIO");
  });

  it("crear envía POST /productos con los datos y devuelve el producto", async () => {
    const datos = { nombre: "Sifón", precio_compra: 850, cantidad: 10 };
    fetchAPI.mockResolvedValue({ status: "ok", producto: { id: 9, nombre: "Sifón" } });
    expect(await servicioProductos.crear(datos)).toEqual({ id: 9, nombre: "Sifón" });
    expect(fetchAPI).toHaveBeenCalledWith("/productos", "POST", datos);
  });

  it("actualizar envía PUT /productos/<id> con los datos y devuelve el producto", async () => {
    const datos = { nombre: "Sifón 1 l", precio_venta: 1500 };
    fetchAPI.mockResolvedValue({ status: "ok", producto: { id: 9, nombre: "Sifón 1 l" } });
    expect(await servicioProductos.actualizar(9, datos)).toEqual({ id: 9, nombre: "Sifón 1 l" });
    expect(fetchAPI).toHaveBeenCalledWith("/productos/9", "PUT", datos);
  });

  it("crear y actualizar no fallan si la sesión venció (fetchAPI devuelve undefined)", async () => {
    fetchAPI.mockResolvedValue(undefined);
    expect(await servicioProductos.crear({})).toBeUndefined();
    expect(await servicioProductos.actualizar(1, {})).toBeUndefined();
  });

  it("reponer envía POST /productos/<id>/reposicion", async () => {
    const datos = { cantidad: 5, monto_total: 4250, proveedor_id: 1 };
    fetchAPI.mockResolvedValue({ status: "ok" });
    await servicioProductos.reponer(3, datos);
    expect(fetchAPI).toHaveBeenCalledWith("/productos/3/reposicion", "POST", datos);
  });

  it("registrarBaja envía POST /productos/<id>/baja", async () => {
    const datos = { cantidad: 2, motivo: "roto" };
    fetchAPI.mockResolvedValue({ status: "ok" });
    await servicioProductos.registrarBaja(3, datos);
    expect(fetchAPI).toHaveBeenCalledWith("/productos/3/baja", "POST", datos);
  });

  it("ocultar envía PATCH /productos/<id>/ocultar", async () => {
    fetchAPI.mockResolvedValue({ status: "ok" });
    await servicioProductos.ocultar(3);
    expect(fetchAPI).toHaveBeenCalledWith("/productos/3/ocultar", "PATCH");
  });

  it("eliminar envía DELETE /productos/<id>", async () => {
    fetchAPI.mockResolvedValue({ status: "ok" });
    await servicioProductos.eliminar(3);
    expect(fetchAPI).toHaveBeenCalledWith("/productos/3", "DELETE");
  });

  it("los errores del Backend llegan tal cual a la pantalla (por ejemplo el 409 de eliminar)", async () => {
    const error = Object.assign(new Error("El producto tiene movimientos y no se puede eliminar."), { status: 409 });
    fetchAPI.mockRejectedValue(error);
    await expect(servicioProductos.eliminar(3)).rejects.toBe(error);
    await expect(servicioProductos.listar()).rejects.toBe(error);
    await expect(servicioProductos.crear({})).rejects.toBe(error);
    await expect(servicioProductos.reponer(3, {})).rejects.toBe(error);
    await expect(servicioProductos.registrarBaja(3, {})).rejects.toBe(error);
    await expect(servicioProductos.ocultar(3)).rejects.toBe(error);
  });
});

describe("servicioReposiciones", () => {
  it("listar pide GET /reposiciones y devuelve la lista", async () => {
    fetchAPI.mockResolvedValue([{ id: 1, producto_nombre: "Sifón" }]);
    expect(await servicioReposiciones.listar()).toEqual([{ id: 1, producto_nombre: "Sifón" }]);
    expect(fetchAPI).toHaveBeenCalledWith("/reposiciones");
  });

  it("listar acepta la lista dentro de 'items' y devuelve vacío si no vino nada o la sesión venció", async () => {
    fetchAPI.mockResolvedValueOnce({ items: [{ id: 2 }] });
    expect(await servicioReposiciones.listar()).toEqual([{ id: 2 }]);
    fetchAPI.mockResolvedValueOnce({});
    expect(await servicioReposiciones.listar()).toEqual([]);
    fetchAPI.mockResolvedValueOnce(undefined);
    expect(await servicioReposiciones.listar()).toEqual([]);
  });

  it("anular envía PATCH /reposiciones/<id>/anular", async () => {
    fetchAPI.mockResolvedValue({ status: "ok" });
    await servicioReposiciones.anular(4);
    expect(fetchAPI).toHaveBeenCalledWith("/reposiciones/4/anular", "PATCH");
  });

  it("el 409 de anular (stock insuficiente) llega tal cual a la pantalla", async () => {
    const error = Object.assign(new Error("El stock actual es menor a la cantidad a restar."), { status: 409 });
    fetchAPI.mockRejectedValue(error);
    await expect(servicioReposiciones.anular(4)).rejects.toBe(error);
  });
});

describe("servicioInsumos", () => {
  it("listar pide GET /bienes-gasto y devuelve los insumos con su resumen", async () => {
    const resumen = { valor_inventario_total: 7000, total_articulos: 2 };
    fetchAPI.mockResolvedValue({ status: "ok", bienes_gasto: [{ id: 1, nombre: "Papel" }], resumen });
    expect(await servicioInsumos.listar()).toEqual({ insumos: [{ id: 1, nombre: "Papel" }], resumen });
    expect(fetchAPI).toHaveBeenCalledWith("/bienes-gasto");
  });

  it("si la respuesta no trae insumos ni resumen, devuelve vacío y en cero", async () => {
    fetchAPI.mockResolvedValue({ status: "ok" });
    expect(await servicioInsumos.listar()).toEqual({ insumos: [], resumen: { valor_inventario_total: 0, total_articulos: 0 } });
  });

  it("crear envía POST /bienes-gasto y devuelve el insumo creado", async () => {
    const datos = { nombre: "Tinta", costo_unitario: 150, cantidad: 4 };
    fetchAPI.mockResolvedValue({ status: "ok", bien_gasto: { id: 5, nombre: "Tinta" } });
    expect(await servicioInsumos.crear(datos)).toEqual({ id: 5, nombre: "Tinta" });
    expect(fetchAPI).toHaveBeenCalledWith("/bienes-gasto", "POST", datos);
  });

  it("reponer y consumir envían POST a su endpoint con los datos", async () => {
    fetchAPI.mockResolvedValue({ status: "ok" });
    await servicioInsumos.reponer(5, { cantidad: 3, costo_unitario: 160 });
    await servicioInsumos.consumir(5, { cantidad: 2 });
    expect(fetchAPI.mock.calls).toEqual([
      ["/bienes-gasto/5/reposicion", "POST", { cantidad: 3, costo_unitario: 160 }],
      ["/bienes-gasto/5/consumo", "POST", { cantidad: 2 }],
    ]);
  });

  it("ocultar, restaurar y eliminar van a su endpoint con su método", async () => {
    fetchAPI.mockResolvedValue({ status: "ok" });
    await servicioInsumos.ocultar(5);
    await servicioInsumos.restaurar(5);
    await servicioInsumos.eliminar(5);
    expect(fetchAPI.mock.calls).toEqual([
      ["/bienes-gasto/5/ocultar", "PATCH"],
      ["/bienes-gasto/5/restaurar", "PATCH"],
      ["/bienes-gasto/5", "DELETE"],
    ]);
  });

  it("editar envía PUT /bienes-gasto/<id> con los datos", async () => {
    const datos = { nombre: "Tinta negra" };
    fetchAPI.mockResolvedValue({ status: "ok" });
    await servicioInsumos.editar(5, datos);
    expect(fetchAPI).toHaveBeenCalledWith("/bienes-gasto/5", "PUT", datos);
  });

  it("los errores del Backend llegan tal cual a la pantalla", async () => {
    const error = Object.assign(new Error("Error de validación"), { status: 400, errores: { costo_unitario: "Debe ser mayor a cero" } });
    fetchAPI.mockRejectedValue(error);
    await expect(servicioInsumos.crear({})).rejects.toBe(error);
    await expect(servicioInsumos.listar()).rejects.toBe(error);
    await expect(servicioInsumos.reponer(1, {})).rejects.toBe(error);
    await expect(servicioInsumos.consumir(1, {})).rejects.toBe(error);
  });
});

describe("servicioEquipamiento", () => {
  it("listar pide GET /bienes-uso y devuelve los equipos con su resumen", async () => {
    const resumen = { patrimonio_total: 1070000, unidades_totales: 4, cantidad_bienes: 3 };
    fetchAPI.mockResolvedValue({ status: "ok", bienes_uso: [{ id: 1, nombre: "Heladera" }], resumen });
    expect(await servicioEquipamiento.listar()).toEqual({ bienes: [{ id: 1, nombre: "Heladera" }], resumen });
    expect(fetchAPI).toHaveBeenCalledWith("/bienes-uso");
  });

  it("si la respuesta no trae equipos ni resumen, devuelve vacío y en cero", async () => {
    fetchAPI.mockResolvedValue({ status: "ok" });
    expect(await servicioEquipamiento.listar()).toEqual({ bienes: [], resumen: { patrimonio_total: 0, unidades_totales: 0, cantidad_bienes: 0 } });
  });

  it("crear envía POST /bienes-uso y devuelve el equipo creado", async () => {
    const datos = { nombre: "Balanza", costo_adquisicion: 30000, cantidad: 1 };
    fetchAPI.mockResolvedValue({ status: "ok", bien_uso: { id: 7, nombre: "Balanza" } });
    expect(await servicioEquipamiento.crear(datos)).toEqual({ id: 7, nombre: "Balanza" });
    expect(fetchAPI).toHaveBeenCalledWith("/bienes-uso", "POST", datos);
  });

  it("ocultar, restaurar y eliminar van a su endpoint con su método", async () => {
    fetchAPI.mockResolvedValue({ status: "ok" });
    await servicioEquipamiento.ocultar(7);
    await servicioEquipamiento.restaurar(7);
    await servicioEquipamiento.eliminar(7);
    expect(fetchAPI.mock.calls).toEqual([
      ["/bienes-uso/7/ocultar", "PATCH"],
      ["/bienes-uso/7/restaurar", "PATCH"],
      ["/bienes-uso/7", "DELETE"],
    ]);
  });

  it("editar envía PUT /bienes-uso/<id> con los datos", async () => {
    const datos = { nombre: "Balanza digital" };
    fetchAPI.mockResolvedValue({ status: "ok" });
    await servicioEquipamiento.editar(7, datos);
    expect(fetchAPI).toHaveBeenCalledWith("/bienes-uso/7", "PUT", datos);
  });

  it("los errores del Backend llegan tal cual a la pantalla", async () => {
    const error = Object.assign(new Error("Error de validación"), { status: 400, errores: { cantidad: "Debe ser mayor a cero" } });
    fetchAPI.mockRejectedValue(error);
    await expect(servicioEquipamiento.crear({})).rejects.toBe(error);
    await expect(servicioEquipamiento.listar()).rejects.toBe(error);
    await expect(servicioEquipamiento.editar(1, {})).rejects.toBe(error);
  });
});
