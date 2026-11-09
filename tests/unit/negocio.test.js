import { afterEach, describe, expect, it, vi } from "vitest";
import {
  armarPayloadNegocio,
  CATEGORIAS_IMPOSITIVAS,
  RUBROS,
  validarNegocio,
} from "../../frontend/js/personalizacion.js";

// Pruebas de la pantalla "Mi negocio": reglas de validación, payload y servicio simulado.

const valido = { nombre: "Kiosco Chicha", rubro: "Kiosco", categoria_impositiva: "MONOTRIBUTISTA" };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("constantes de Mi negocio", () => {
  it("las categorías impositivas son tres y no incluyen Consumidor Final", () => {
    expect(CATEGORIAS_IMPOSITIVAS.map((c) => c.valor)).toEqual(["RESPONSABLE_INSCRIPTO", "MONOTRIBUTISTA", "EXENTO"]);
    expect(CATEGORIAS_IMPOSITIVAS.map((c) => c.texto)).toEqual(["Responsable Inscripto", "Monotributista", "Exento"]);
  });

  it("los rubros no se repiten y ninguno supera los 50 caracteres que admite el campo", () => {
    expect(new Set(RUBROS).size).toBe(RUBROS.length);
    RUBROS.forEach((r) => expect(r.length).toBeLessThanOrEqual(50));
  });

  it("todos los rubros de la lista pasan la validación", () => {
    RUBROS.forEach((rubro) => expect(validarNegocio({ ...valido, rubro })).toEqual({}));
  });
});

describe("validarNegocio: nombre o razón social", () => {
  it.each([[""], ["   "], ["\t\n"], [null], [undefined]])("un nombre vacío (%j) pide completarlo", (nombre) => {
    expect(validarNegocio({ ...valido, nombre }).nombre).toBe("Rellene el nombre o razón social.");
  });

  it("acepta exactamente 100 caracteres y rechaza 101", () => {
    expect(validarNegocio({ ...valido, nombre: "a".repeat(100) })).toEqual({});
    expect(validarNegocio({ ...valido, nombre: "a".repeat(101) }).nombre).toBe("El nombre no puede superar los 100 caracteres.");
  });

  it("los espacios de los costados no cuentan para el largo", () => {
    expect(validarNegocio({ ...valido, nombre: `   ${"a".repeat(100)}   ` })).toEqual({});
  });

  it.each([["Peña & Hijos S.R.L."], ["Kiosco 24 hs"], ["Café del Ñandú"], ["A"], ["<b>Kiosco</b>"]])(
    "acepta el nombre %s",
    (nombre) => {
      expect(validarNegocio({ ...valido, nombre })).toEqual({});
    },
  );
});

describe("validarNegocio: rubro", () => {
  it.each([[""], ["   "], [null], [undefined]])("el rubro es opcional (%j)", (rubro) => {
    expect(validarNegocio({ ...valido, rubro })).toEqual({});
  });

  it("acepta un rubro propio de hasta 50 caracteres y rechaza 51", () => {
    expect(validarNegocio({ ...valido, rubro: "a".repeat(50) })).toEqual({});
    expect(validarNegocio({ ...valido, rubro: "a".repeat(51) }).rubro).toBe("El rubro no puede superar los 50 caracteres.");
  });

  it("los espacios de los costados no cuentan para el largo del rubro", () => {
    expect(validarNegocio({ ...valido, rubro: ` ${"a".repeat(50)} ` })).toEqual({});
  });
});

describe("validarNegocio: categoría impositiva", () => {
  it.each([["RESPONSABLE_INSCRIPTO"], ["MONOTRIBUTISTA"], ["EXENTO"]])("acepta %s", (categoria_impositiva) => {
    expect(validarNegocio({ ...valido, categoria_impositiva })).toEqual({});
  });

  it.each([[""], ["CONSUMIDOR_FINAL"], ["exento"], ["Monotributista"], [null], [undefined], ["OTRA"]])(
    "rechaza %j",
    (categoria_impositiva) => {
      expect(validarNegocio({ ...valido, categoria_impositiva }).categoria_impositiva).toBe("Elija la categoría impositiva.");
    },
  );
});

describe("validarNegocio: combinaciones", () => {
  it("solo informa el campo que está mal", () => {
    expect(Object.keys(validarNegocio({ ...valido, nombre: "" }))).toEqual(["nombre"]);
    expect(Object.keys(validarNegocio({ ...valido, rubro: "a".repeat(51) }))).toEqual(["rubro"]);
    expect(Object.keys(validarNegocio({ ...valido, categoria_impositiva: "" }))).toEqual(["categoria_impositiva"]);
  });

  it("informa todos los campos mal a la vez", () => {
    expect(Object.keys(validarNegocio({ nombre: "", rubro: "a".repeat(51), categoria_impositiva: "" })).sort()).toEqual([
      "categoria_impositiva",
      "nombre",
      "rubro",
    ]);
  });

  it("sin datos no revienta y pide lo obligatorio", () => {
    expect(() => validarNegocio()).not.toThrow();
    expect(Object.keys(validarNegocio(undefined)).sort()).toEqual(["categoria_impositiva", "nombre"]);
  });

  it("el identificador no se valida porque no se puede cambiar", () => {
    expect(validarNegocio({ ...valido, identificador: "cualquier cosa!!" })).toEqual({});
  });
});

describe("armarPayloadNegocio", () => {
  it("envía solo nombre, rubro y categoría: nunca el identificador", () => {
    const payload = armarPayloadNegocio({ ...valido, identificador: "kioscochicha", id: 7 });
    expect(Object.keys(payload).sort()).toEqual(["categoria_impositiva", "nombre", "rubro"]);
  });

  it("recorta el nombre y el rubro", () => {
    expect(armarPayloadNegocio({ ...valido, nombre: "  Kiosco  ", rubro: "  Pesquería  " })).toMatchObject({
      nombre: "Kiosco",
      rubro: "Pesquería",
    });
  });

  it.each([[""], ["   "], [null], [undefined]])("un rubro vacío (%j) viaja como null", (rubro) => {
    expect(armarPayloadNegocio({ ...valido, rubro }).rubro).toBeNull();
  });

  it("la categoría viaja tal cual y un nombre ausente queda vacío", () => {
    expect(armarPayloadNegocio({ ...valido, categoria_impositiva: "EXENTO" }).categoria_impositiva).toBe("EXENTO");
    expect(armarPayloadNegocio({ categoria_impositiva: "EXENTO" }).nombre).toBe("");
  });

  it("no modifica lo que recibe ni el contenido del nombre (HTML incluido)", () => {
    const datos = { ...valido, nombre: " <b>Kiosco</b> " };
    const copia = { ...datos };
    expect(armarPayloadNegocio(datos).nombre).toBe("<b>Kiosco</b>");
    expect(datos).toEqual(copia);
  });
});

// --- Servicio simulado (mocks/personalizacion.js): se carga de cero en cada prueba ---

const cargarServicio = async () => {
  vi.resetModules();
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  return (await import("../../frontend/js/mocks/personalizacion.js")).servicioNegocio;
};

describe("servicio simulado del negocio", () => {
  it("obtiene los datos del negocio con su identificador", async () => {
    const servicio = await cargarServicio();
    expect(await servicio.obtener()).toEqual({
      identificador: "kioscochicha",
      nombre: "Kiosco Chicha",
      rubro: "Kiosco",
      categoria_impositiva: "MONOTRIBUTISTA",
    });
  });

  it("devuelve copias: modificar lo que devuelve no cambia lo guardado", async () => {
    const servicio = await cargarServicio();
    (await servicio.obtener()).nombre = "ALTERADO";
    expect((await servicio.obtener()).nombre).toBe("Kiosco Chicha");
  });

  it("guardar cambia los datos y obtener los devuelve actualizados", async () => {
    const servicio = await cargarServicio();
    const guardado = await servicio.guardar({ nombre: "Otro Nombre", rubro: null, categoria_impositiva: "EXENTO" });
    expect(guardado).toMatchObject({ nombre: "Otro Nombre", rubro: null, categoria_impositiva: "EXENTO" });
    expect(await servicio.obtener()).toEqual(guardado);
  });

  it("guardar no cambia el identificador", async () => {
    const servicio = await cargarServicio();
    await servicio.guardar({ nombre: "X", rubro: "Y", categoria_impositiva: "EXENTO" });
    expect((await servicio.obtener()).identificador).toBe("kioscochicha");
  });

  it("lo que devuelve guardar es una copia", async () => {
    const servicio = await cargarServicio();
    const guardado = await servicio.guardar({ nombre: "X", rubro: "Y", categoria_impositiva: "EXENTO" });
    guardado.nombre = "ALTERADO";
    expect((await servicio.obtener()).nombre).toBe("X");
  });

  it("los datos de ejemplo pasan la validación", async () => {
    const servicio = await cargarServicio();
    const { identificador, ...editable } = await servicio.obtener();
    expect(identificador).toBeTruthy();
    expect(validarNegocio(editable)).toEqual({});
  });
});
