import { beforeEach, describe, expect, it, vi } from "vitest";

// Servicio simulado de categorías (mocks/categorias.js): todavía no hay API de categorías. Se guarda en localStorage,
// que acá se reemplaza por un almacenamiento en memoria; el módulo se carga de cero en cada prueba.

const CLAVE = "trazzo_mock_categorias";
let datos;

const cargarServicio = async (inicial = {}) => {
  vi.resetModules();
  datos = new Map(Object.entries(inicial));
  vi.stubGlobal("localStorage", {
    getItem: (clave) => (datos.has(clave) ? datos.get(clave) : null),
    setItem: (clave, valor) => datos.set(clave, String(valor)),
  });
  return (await import("../../frontend/js/mocks/categorias.js")).servicioCategorias;
};

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("servicio simulado de categorías", () => {
  it("parte de Remeras y Pantalones, sin «es_predeterminado»", async () => {
    const servicio = await cargarServicio();
    const categorias = await servicio.listar();
    expect(categorias.map((c) => c.nombre)).toEqual(["Remeras", "Pantalones"]);
    categorias.forEach((c) => expect(c).not.toHaveProperty("es_predeterminado"));
  });

  it("crear suma la categoría activa al final y la guarda", async () => {
    const servicio = await cargarServicio();
    const creada = await servicio.crear("Camperas");
    expect(creada).toMatchObject({ nombre: "Camperas", activo: true });
    expect((await servicio.listar()).map((c) => c.nombre)).toEqual(["Remeras", "Pantalones", "Camperas"]);
    expect(JSON.parse(datos.get(CLAVE)).map((c) => c.nombre)).toEqual(["Remeras", "Pantalones", "Camperas"]);
  });

  it("los ids nuevos no se repiten", async () => {
    const servicio = await cargarServicio();
    const a = await servicio.crear("A");
    const b = await servicio.crear("B");
    expect(new Set([1, 2, a.id, b.id]).size).toBe(4);
  });

  it("actualizar cambia el nombre", async () => {
    const servicio = await cargarServicio();
    expect(await servicio.actualizar(1, "Remeras nuevas")).toMatchObject({ id: 1, nombre: "Remeras nuevas" });
    expect((await servicio.listar())[0].nombre).toBe("Remeras nuevas");
  });

  it("devuelve copias: modificar lo que devuelve no cambia lo guardado", async () => {
    const servicio = await cargarServicio();
    (await servicio.listar())[0].nombre = "ALTERADO";
    expect((await servicio.listar())[0].nombre).toBe("Remeras");
  });

  it("si no hay almacenamiento o lo guardado está dañado, parte de las iniciales y funciona igual", async () => {
    const servicio = await cargarServicio({ [CLAVE]: "{esto no es json" });
    expect((await servicio.listar()).map((c) => c.nombre)).toEqual(["Remeras", "Pantalones"]);
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("bloqueado"); }, setItem: () => { throw new Error("bloqueado"); } });
    expect(await servicio.crear("Camperas")).toMatchObject({ nombre: "Camperas" });
  });
});

describe("categorías: eliminar desactiva (activo = false) en vez de borrar", () => {
  it("lo eliminado deja de listarse pero sigue guardado, inactivo", async () => {
    const servicio = await cargarServicio();
    await servicio.eliminar(2);
    expect((await servicio.listar()).map((c) => c.nombre)).toEqual(["Remeras"]);
    const guardado = JSON.parse(datos.get(CLAVE));
    expect(guardado).toHaveLength(2);
    expect(guardado.find((c) => c.id === 2).activo).toBe(false);
  });

  it("eliminar dos veces la misma no falla", async () => {
    const servicio = await cargarServicio();
    await servicio.eliminar(1);
    await expect(servicio.eliminar(1)).resolves.toBeUndefined();
    expect((await servicio.listar()).map((c) => c.id)).toEqual([2]);
  });

  it("una categoría guardada sin «activo» se ve como activa y una inactiva no se ve", async () => {
    const servicio = await cargarServicio({ [CLAVE]: JSON.stringify([{ id: 1, nombre: "Sin dato" }, { id: 2, nombre: "Vieja", activo: false }]) });
    expect((await servicio.listar()).map((c) => c.nombre)).toEqual(["Sin dato"]);
  });

  it("el nombre de lo eliminado sigue ocupado (el índice único de la base cuenta los desactivados)", async () => {
    const servicio = await cargarServicio();
    await servicio.eliminar(1);
    await expect(servicio.crear("Remeras")).rejects.toMatchObject({ errores: { nombre: expect.stringMatching(/Ya existe una categoría/) } });
    await expect(servicio.crear("  REMERAS  ")).rejects.toThrow(/Ya existe una categoría/);
    expect((await servicio.listar()).map((c) => c.nombre)).toEqual(["Pantalones"]);
  });

  it("al editar, el nombre de otra categoría (también eliminada) está ocupado, pero el propio no", async () => {
    const servicio = await cargarServicio();
    await servicio.eliminar(1);
    await expect(servicio.actualizar(2, "Remeras")).rejects.toMatchObject({ errores: { nombre: expect.any(String) } });
    await expect(servicio.actualizar(2, "Pantalones")).resolves.toMatchObject({ nombre: "Pantalones" });
    await expect(servicio.actualizar(2, "PANTALONES")).resolves.toMatchObject({ nombre: "PANTALONES" });
  });

  it("un rechazo no cambia lo guardado", async () => {
    const servicio = await cargarServicio();
    await servicio.eliminar(1);
    const antes = datos.get(CLAVE);
    await servicio.crear("Remeras").catch(() => {});
    await servicio.actualizar(2, "Remeras").catch(() => {});
    expect(datos.get(CLAVE)).toBe(antes);
  });
});
