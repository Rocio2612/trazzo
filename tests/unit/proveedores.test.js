import { describe, expect, it } from "vitest";
import {
  armarPayloadProveedor,
  buscarProveedores,
  digitoVerificadorCuit,
  filtrarProveedores,
  formatearDocumento,
  MOTIVO_CON_MOVIMIENTOS,
  puedeEliminarProveedor,
  soloDigitos,
  validarCuit,
  validarDocumento,
  validarProveedor,
} from "../../frontend/js/proveedores.js";
import { PROVEEDORES_EJEMPLO } from "../../frontend/js/mocks/proveedores.js";

const valido = {
  nombre: "Envases del Sur S.A.",
  tipo_documento: "CUIT",
  numero_documento: "30-71234567-1",
  categoria_impositiva: "RESPONSABLE_INSCRIPTO",
};

describe("dígito verificador del CUIT", () => {
  it.each([
    ["2012345678", 6],
    ["3071234567", 1],
    ["3050000173", 5],
    ["2011111111", 2],
    ["2720123456", 0],
  ])("a %s le corresponde el dígito %i", (primeros10, digito) => {
    expect(digitoVerificadorCuit(primeros10)).toBe(digito);
  });

  it("devuelve null cuando ese CUIT no puede existir (resto 1)", () => {
    expect(digitoVerificadorCuit("3069345023")).toBeNull();
  });
});

describe("validarCuit", () => {
  it.each(["30712345671", "30-71234567-1", "20-12345678-6", "20123456786", "33712345670"])("acepta %s", (cuit) => {
    expect(validarCuit(cuit)).toBeNull();
  });

  it("rechaza un dígito verificador incorrecto", () => {
    expect(validarCuit("30-71234567-2")).toBe("El CUIT no es válido: el dígito verificador no coincide.");
  });

  it("exige 11 números", () => {
    expect(validarCuit("3071234567")).toBe("El CUIT debe tener 11 números.");
    expect(validarCuit("307123456712")).toBe("El CUIT debe tener 11 números.");
  });

  it("rechaza un prefijo que no existe", () => {
    expect(validarCuit("10-71234567-1")).toBe("El CUIT no es válido: el prefijo no existe.");
  });
});

describe("validarDocumento", () => {
  it("pide el tipo y el número", () => {
    expect(validarDocumento("", "30712345671")).toEqual({ tipo_documento: "Elija el tipo de documento." });
    expect(validarDocumento("CUIT", "")).toEqual({ numero_documento: "Rellene el número de CUIT." });
  });

  it("el DNI debe tener 7 u 8 números", () => {
    expect(validarDocumento("DNI", "30123456")).toEqual({});
    expect(validarDocumento("DNI", "30.123.456")).toEqual({});
    expect(validarDocumento("DNI", "123")).toEqual({ numero_documento: "El DNI debe tener 7 u 8 números." });
  });

  it("el CUIL se valida con el mismo dígito verificador y lo nombra en el mensaje", () => {
    expect(validarDocumento("CUIL", "20-12345678-6")).toEqual({});
    expect(validarDocumento("CUIL", "20-12345678-5").numero_documento).toContain("El CUIL no es válido");
  });

  it("rechaza letras", () => {
    expect(validarDocumento("CUIT", "30-7123456A-1")).toEqual({ numero_documento: "Solo se admiten números." });
  });
});

describe("formatos del documento", () => {
  it("soloDigitos quita guiones, puntos y espacios", () => {
    expect(soloDigitos("30-71234567-1")).toBe("30712345671");
    expect(soloDigitos(" 30.123.456 ")).toBe("30123456");
  });

  it("muestra el CUIT con guiones y el DNI con puntos", () => {
    expect(formatearDocumento("CUIT", "30712345671")).toBe("30-71234567-1");
    expect(formatearDocumento("CUIL", "20123456786")).toBe("20-12345678-6");
    expect(formatearDocumento("DNI", "30123456")).toBe("30.123.456");
  });
});

describe("validarProveedor", () => {
  it("acepta la ficha mínima: nombre, documento y categoría impositiva", () => {
    expect(validarProveedor(valido)).toEqual({});
  });

  it("marca como faltantes los obligatorios, con su razón", () => {
    expect(validarProveedor({})).toEqual({
      nombre: "Rellene el nombre o razón social.",
      tipo_documento: "Elija el tipo de documento.",
      categoria_impositiva: "Elija la categoría impositiva.",
    });
  });

  it("teléfono, correo y descripción son opcionales", () => {
    expect(validarProveedor({ ...valido, telefono: "", correo: "", descripcion_compra: "" })).toEqual({});
  });

  it("valida el formato del teléfono y del correo si se cargan", () => {
    expect(validarProveedor({ ...valido, telefono: "11 4444-5555" })).toEqual({});
    expect(validarProveedor({ ...valido, telefono: "abc" }).telefono).toBeDefined();
    expect(validarProveedor({ ...valido, correo: "sin-arroba" }).correo).toBe("El correo no es válido.");
    expect(validarProveedor({ ...valido, correo: "a@b.com" })).toEqual({});
  });

  it("no admite Consumidor Final como categoría del proveedor", () => {
    expect(validarProveedor({ ...valido, categoria_impositiva: "CONSUMIDOR_FINAL" }).categoria_impositiva).toBeDefined();
  });

  it("la descripción no tiene largo máximo (es TEXT en la base)", () => {
    expect(validarProveedor({ ...valido, descripcion_compra: "a".repeat(501) })).toEqual({});
  });
});

describe("armarPayloadProveedor", () => {
  it("manda el documento solo con números y lo opcional vacío como null", () => {
    expect(armarPayloadProveedor({ ...valido, nombre: "  Envases  ", telefono: "", correo: " ", descripcion_compra: "" })).toEqual({
      nombre: "Envases",
      tipo_documento: "CUIT",
      numero_documento: "30712345671",
      telefono: null,
      correo: null,
      categoria_impositiva: "RESPONSABLE_INSCRIPTO",
      descripcion_compra: null,
    });
  });
});

describe("buscar y filtrar", () => {
  it("busca por nombre sin distinguir mayúsculas ni tildes", () => {
    expect(buscarProveedores(PROVEEDORES_EJEMPLO, "RAUL").map((p) => p.id)).toEqual([2]);
    expect(buscarProveedores(PROVEEDORES_EJEMPLO, "gimenez").map((p) => p.id)).toEqual([3]);
  });

  it("busca por documento con o sin guiones", () => {
    expect(buscarProveedores(PROVEEDORES_EJEMPLO, "30-71234567-1").map((p) => p.id)).toEqual([1]);
    expect(buscarProveedores(PROVEEDORES_EJEMPLO, "71234567").map((p) => p.id)).toEqual([1, 4]);
  });

  it("busca por descripción de compra", () => {
    expect(buscarProveedores(PROVEEDORES_EJEMPLO, "cartón").map((p) => p.id)).toEqual([1]);
  });

  it("sin texto devuelve todo y sin coincidencias devuelve vacío", () => {
    expect(buscarProveedores(PROVEEDORES_EJEMPLO, "  ")).toHaveLength(PROVEEDORES_EJEMPLO.length);
    expect(buscarProveedores(PROVEEDORES_EJEMPLO, "zzz")).toEqual([]);
  });

  it("por defecto muestra los visibles y con ocultos: true solo los ocultos", () => {
    expect(filtrarProveedores(PROVEEDORES_EJEMPLO).map((p) => p.id)).toEqual([1, 2, 3]);
    expect(filtrarProveedores(PROVEEDORES_EJEMPLO, { ocultos: true }).map((p) => p.id)).toEqual([4, 5]);
  });
});

describe("puedeEliminarProveedor", () => {
  it("no se elimina si no está oculto", () => {
    expect(puedeEliminarProveedor({ activo: true, tiene_movimientos: false })).toEqual({ permitido: false, motivo: "Primero hay que ocultarlo." });
  });

  it("oculto pero con productos o reposiciones: solo se puede ocultar", () => {
    expect(puedeEliminarProveedor({ activo: false, tiene_movimientos: true })).toEqual({ permitido: false, motivo: MOTIVO_CON_MOVIMIENTOS });
  });

  it("oculto y sin movimientos: se puede eliminar", () => {
    expect(puedeEliminarProveedor({ activo: false, tiene_movimientos: false }).permitido).toBe(true);
  });
});

describe("datos simulados", () => {
  it("todos los CUIT y CUIL de ejemplo son válidos", () => {
    PROVEEDORES_EJEMPLO.forEach((p) => {
      expect(validarDocumento(p.tipo_documento, p.numero_documento)).toEqual({});
    });
  });
});

// ---------------------------------------------------------------------------
// Pruebas ampliadas: documento, ficha, payload, búsqueda, filtros, servicio simulado y helper de selects
// ---------------------------------------------------------------------------

import { afterEach, vi } from "vitest";
import { cargarProveedores, llenarSelectProveedores } from "../../frontend/js/servicios/proveedores.js";
import {
  CATEGORIAS_PROVEEDOR,
  ETIQUETA_CATEGORIA_CORTA,
  NOMBRE_PROVEEDOR_MAXIMO,
  TELEFONO_PROVEEDOR_MAXIMO,
  TIPOS_DOCUMENTO,
} from "../../frontend/js/proveedores.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("constantes", () => {
  it("los tipos de documento son CUIT, CUIL y DNI", () => {
    expect(TIPOS_DOCUMENTO.map((t) => t.valor)).toEqual(["CUIT", "CUIL", "DNI"]);
  });

  it("un proveedor no puede ser Consumidor Final: solo hay tres categorías", () => {
    expect(CATEGORIAS_PROVEEDOR.map((c) => c.valor)).toEqual(["RESPONSABLE_INSCRIPTO", "MONOTRIBUTISTA", "EXENTO"]);
  });

  it("cada categoría tiene su etiqueta corta para la tabla", () => {
    CATEGORIAS_PROVEEDOR.forEach((c) => expect(ETIQUETA_CATEGORIA_CORTA[c.valor]).toBeTruthy());
  });
});

describe("soloDigitos: casos límite", () => {
  it("null, undefined y vacío dan texto vacío", () => {
    expect(soloDigitos(null)).toBe("");
    expect(soloDigitos(undefined)).toBe("");
    expect(soloDigitos("")).toBe("");
  });

  it("descarta letras y símbolos, y acepta números", () => {
    expect(soloDigitos("a1b2-c3.4 5/6")).toBe("123456");
    expect(soloDigitos(123)).toBe("123");
  });
});

describe("validarCuit: casos límite", () => {
  it.each(["30 71234567 1", "30.71234567.1", " 30712345671 "])("acepta el CUIT escrito como «%s»", (cuit) => {
    expect(validarCuit(cuit)).toBeNull();
  });

  it.each([[""], [null], [undefined], ["---"]])("un CUIT vacío (%j) no tiene 11 números", (cuit) => {
    expect(validarCuit(cuit)).toBe("El CUIT debe tener 11 números.");
  });

  it.each(["00", "10", "21", "25", "26", "28", "29", "31", "32", "35", "40", "50", "99"])(
    "rechaza el prefijo %s",
    (prefijo) => {
      expect(validarCuit(`${prefijo}712345671`)).toBe("El CUIT no es válido: el prefijo no existe.");
    },
  );

  it.each(["20", "23", "24", "27", "30", "33", "34"])("el prefijo %s existe (el error, si hay, es otro)", (prefijo) => {
    expect(validarCuit(`${prefijo}123456780`)).not.toBe("El CUIT no es válido: el prefijo no existe.");
  });

  it("un CUIT cuyo resto da 1 no puede ser válido con ningún dígito", () => {
    for (let d = 0; d <= 9; d++) {
      expect(validarCuit(`3069345023${d}`)).toBe("El CUIT no es válido: el dígito verificador no coincide.");
    }
  });

  it("cambiar un solo dígito de un CUIT válido lo invalida", () => {
    expect(validarCuit("30712345671")).toBeNull();
    expect(validarCuit("30712345681")).not.toBeNull();
    expect(validarCuit("31712345671")).not.toBeNull();
  });
});

describe("validarDocumento: casos límite", () => {
  it("un tipo desconocido, en minúscula o ausente pide elegir el tipo", () => {
    ["PASAPORTE", "cuit", undefined, null, ""].forEach((tipo) => {
      expect(validarDocumento(tipo, "30712345671")).toEqual({ tipo_documento: "Elija el tipo de documento." });
    });
  });

  it("el tipo tiene prioridad: sin tipo no se valida el número", () => {
    expect(validarDocumento("", "")).toEqual({ tipo_documento: "Elija el tipo de documento." });
  });

  it.each([["CUIT"], ["CUIL"], ["DNI"]])("un número de solo espacios o vacío pide completarlo (%s)", (tipo) => {
    expect(validarDocumento(tipo, "   ")).toEqual({ numero_documento: `Rellene el número de ${tipo}.` });
    expect(validarDocumento(tipo, null)).toEqual({ numero_documento: `Rellene el número de ${tipo}.` });
  });

  it.each([["1234567"], ["12345678"], ["12.345.678"], ["  30123456  "], ["1 234 567"]])("acepta el DNI %s", (dni) => {
    expect(validarDocumento("DNI", dni)).toEqual({});
  });

  it.each([["123456"], ["123456789"], ["-"], ["..."]])("rechaza el DNI %s por su cantidad de números", (dni) => {
    expect(validarDocumento("DNI", dni)).toEqual({ numero_documento: "El DNI debe tener 7 u 8 números." });
  });

  it.each([["3012345A"], ["30/123/456"], ["30,123,456"], ["٣٠١٢٣٤٥٦"], ["30_123_456"]])(
    "el DNI %s tiene caracteres que no son números",
    (dni) => {
      expect(validarDocumento("DNI", dni)).toEqual({ numero_documento: "Solo se admiten números." });
    },
  );

  it("el CUIT y el CUIL nombran su propio tipo en cada mensaje", () => {
    expect(validarDocumento("CUIT", "3071234567").numero_documento).toBe("El CUIT debe tener 11 números.");
    expect(validarDocumento("CUIL", "2012345678").numero_documento).toBe("El CUIL debe tener 11 números.");
    expect(validarDocumento("CUIL", "10-12345678-6").numero_documento).toBe("El CUIL no es válido: el prefijo no existe.");
    expect(validarDocumento("CUIL", "20-12345678-5").numero_documento).toBe(
      "El CUIL no es válido: el dígito verificador no coincide.",
    );
  });

  it("acepta CUIT y CUIL con guiones, puntos y espacios", () => {
    expect(validarDocumento("CUIT", "30 71234567 1")).toEqual({});
    expect(validarDocumento("CUIL", "20.12345678.6")).toEqual({});
  });
});

describe("formatearDocumento: casos límite", () => {
  it("DNI de 7 y de 8 números", () => {
    expect(formatearDocumento("DNI", "1234567")).toBe("1.234.567");
    expect(formatearDocumento("DNI", "30123456")).toBe("30.123.456");
  });

  it("vuelve a formatear un documento que ya tiene separadores", () => {
    expect(formatearDocumento("CUIT", "30-71234567-1")).toBe("30-71234567-1");
    expect(formatearDocumento("DNI", "30.123.456")).toBe("30.123.456");
  });

  it("un CUIT o CUIL incompleto se muestra sin guiones", () => {
    expect(formatearDocumento("CUIT", "3071234567")).toBe("3071234567");
    expect(formatearDocumento("CUIL", "301")).toBe("301");
  });

  it("valores vacíos o un tipo desconocido no rompen", () => {
    expect(formatearDocumento("CUIT", null)).toBe("");
    expect(formatearDocumento("DNI", undefined)).toBe("");
    expect(formatearDocumento("OTRO", "123-456")).toBe("123456");
  });
});

describe("validarProveedor: nombre", () => {
  it("acepta hasta 150 caracteres (VARCHAR(150) en la base) y rechaza 151", () => {
    expect(NOMBRE_PROVEEDOR_MAXIMO).toBe(150);
    expect(validarProveedor({ ...valido, nombre: "a".repeat(100) })).toEqual({});
    expect(validarProveedor({ ...valido, nombre: "a".repeat(101) })).toEqual({});
    expect(validarProveedor({ ...valido, nombre: "a".repeat(150) })).toEqual({});
    expect(validarProveedor({ ...valido, nombre: "a".repeat(151) }).nombre).toBe(
      "El nombre no puede superar los 150 caracteres.",
    );
  });

  it("los espacios de los costados no cuentan para el largo", () => {
    expect(validarProveedor({ ...valido, nombre: `  ${"a".repeat(150)}  ` })).toEqual({});
  });

  it.each([[""], ["   "], [null], [undefined]])("un nombre vacío (%j) pide completarlo", (nombre) => {
    expect(validarProveedor({ ...valido, nombre }).nombre).toBe("Rellene el nombre o razón social.");
  });

  it("acepta tildes, ñ, puntos, & y números", () => {
    expect(validarProveedor({ ...valido, nombre: "Peña & Hnos. S.R.L. 2000" })).toEqual({});
  });
});

describe("validarProveedor: teléfono", () => {
  it.each([["123456"], ["+54 9 11 4444-5555"], ["(011) 4444-5555"], ["11-4444-5555"], ["1".repeat(15)], [null], [undefined], ["  "]])(
    "acepta el teléfono %j",
    (telefono) => {
      expect(validarProveedor({ ...valido, telefono })).toEqual({});
    },
  );

  it.each([["12345"], ["1".repeat(16)], ["abc"], ["11 4444-5555 int. 23"], ["12345a6"], ["#123456"], ["---"]])(
    "rechaza el teléfono %j",
    (telefono) => {
      expect(validarProveedor({ ...valido, telefono }).telefono).toBe(
        "El teléfono debe tener entre 6 y 15 números (puede llevar +, espacios, guiones y paréntesis).",
      );
    },
  );
});

describe("validarProveedor: correo", () => {
  it.each([["a@b.co"], ["ventas@envasesdelsur.com"], ["nombre.apellido+tag@dominio.com.ar"], [" a@b.com "], [null], [""], ["  "]])(
    "acepta el correo %j",
    (correo) => {
      expect(validarProveedor({ ...valido, correo })).toEqual({});
    },
  );

  it.each([["sin-arroba"], ["a@b"], ["a@b.c"], ["a b@c.com"], ["a@@b.com"], ["@b.com"], ["a@"], ["a@ b.com"]])(
    "rechaza el correo %j",
    (correo) => {
      expect(validarProveedor({ ...valido, correo }).correo).toBe("El correo no es válido.");
    },
  );
});

describe("validarProveedor: categoría impositiva, descripción y combinaciones", () => {
  it.each([["RESPONSABLE_INSCRIPTO"], ["MONOTRIBUTISTA"], ["EXENTO"]])("acepta la categoría %s", (categoria_impositiva) => {
    expect(validarProveedor({ ...valido, categoria_impositiva })).toEqual({});
  });

  it.each([[""], ["CONSUMIDOR_FINAL"], ["exento"], [undefined], [null], ["OTRA"]])("rechaza la categoría %j", (categoria_impositiva) => {
    expect(validarProveedor({ ...valido, categoria_impositiva }).categoria_impositiva).toBe("Elija la categoría impositiva.");
  });

  it.each([[500], [501], [5000], [100000]])("la descripción acepta %i caracteres: no tiene largo máximo", (largo) => {
    expect(validarProveedor({ ...valido, descripcion_compra: "a".repeat(largo) })).toEqual({});
  });

  it("la descripción larga viaja completa, recortada de los costados", () => {
    const larga = "palabra ".repeat(1000).trim();
    expect(armarPayloadProveedor({ ...valido, descripcion_compra: `  ${larga}  ` }).descripcion_compra).toBe(larga);
  });

  it("la descripción vacía o nula es válida", () => {
    expect(validarProveedor({ ...valido, descripcion_compra: null })).toEqual({});
    expect(validarProveedor({ ...valido, descripcion_compra: "   " })).toEqual({});
  });

  it("solo informa el campo que está mal", () => {
    expect(Object.keys(validarProveedor({ ...valido, nombre: "" }))).toEqual(["nombre"]);
    expect(Object.keys(validarProveedor({ ...valido, numero_documento: "1" }))).toEqual(["numero_documento"]);
    expect(Object.keys(validarProveedor({ ...valido, telefono: "x" }))).toEqual(["telefono"]);
    expect(Object.keys(validarProveedor({ ...valido, correo: "x" }))).toEqual(["correo"]);
  });

  it("informa todos los campos mal a la vez", () => {
    const errores = validarProveedor({
      nombre: "",
      tipo_documento: "CUIT",
      numero_documento: "1",
      telefono: "x",
      correo: "x",
      categoria_impositiva: "",
    });
    expect(Object.keys(errores).sort()).toEqual([
      "categoria_impositiva",
      "correo",
      "nombre",
      "numero_documento",
      "telefono",
    ]);
  });

  it("sin datos no revienta", () => {
    expect(() => validarProveedor()).not.toThrow();
    expect(() => validarProveedor(undefined)).not.toThrow();
  });
});

describe("armarPayloadProveedor: casos límite", () => {
  it("envía exactamente los campos de la ficha y nada más (ni id, ni activo, ni quién lo creó)", () => {
    const payload = armarPayloadProveedor({ ...valido, id: 9, activo: false, tiene_movimientos: true, creado_por_nombre: "x" });
    expect(Object.keys(payload).sort()).toEqual([
      "categoria_impositiva",
      "correo",
      "descripcion_compra",
      "nombre",
      "numero_documento",
      "telefono",
      "tipo_documento",
    ]);
  });

  it("el DNI viaja solo con números", () => {
    expect(armarPayloadProveedor({ ...valido, tipo_documento: "DNI", numero_documento: "30.123.456" }).numero_documento).toBe("30123456");
  });

  it("recorta teléfono, correo y descripción cuando existen", () => {
    const payload = armarPayloadProveedor({
      ...valido,
      telefono: " +54 11 4444-5555 ",
      correo: " a@b.com ",
      descripcion_compra: "  Gaseosas  ",
    });
    expect(payload).toMatchObject({ telefono: "+54 11 4444-5555", correo: "a@b.com", descripcion_compra: "Gaseosas" });
  });

  it("los opcionales ausentes (undefined o null) viajan como null", () => {
    expect(armarPayloadProveedor(valido)).toMatchObject({ telefono: null, correo: null, descripcion_compra: null });
    expect(armarPayloadProveedor({ ...valido, telefono: null, correo: null, descripcion_compra: null })).toMatchObject({
      telefono: null,
      correo: null,
      descripcion_compra: null,
    });
  });

  it("no toca el contenido del nombre ni de la descripción (HTML incluido)", () => {
    const payload = armarPayloadProveedor({ ...valido, nombre: " <b>Peña</b> ", descripcion_compra: "línea 1\nlínea 2" });
    expect(payload.nombre).toBe("<b>Peña</b>");
    expect(payload.descripcion_compra).toBe("línea 1\nlínea 2");
  });
});

describe("buscarProveedores: casos límite", () => {
  const ids = (texto, lista = PROVEEDORES_EJEMPLO) => buscarProveedores(lista, texto).map((p) => p.id);

  it("busca por teléfono tal como se muestra", () => {
    expect(ids("4444-5555")).toEqual([1]);
    expect(ids("11 5555")).toEqual([2]);
  });

  it("busca por correo", () => {
    expect(ids("marta@")).toEqual([3]);
    expect(ids("envasesdelsur.com")).toEqual([1]);
  });

  it("busca por parte del nombre, sin importar mayúsculas ni espacios de los costados", () => {
    expect(ids("  ENVASES  ")).toEqual([1]);
    expect(ids("coop")).toEqual([4]);
  });

  it("busca por documento: completo, parcial, sin guiones, con puntos o con espacios", () => {
    expect(ids("30712345671")).toEqual([1]);
    expect(ids("5000017")).toEqual([2]);
    expect(ids("30.712.345.671")).toEqual([1]);
    expect(ids("30 71234567 1")).toEqual([1]);
  });

  it("no distingue la ñ ni la ü de la n y la u", () => {
    const lista = [{ id: 1, nombre: "Peña Hermanos" }, { id: 2, nombre: "Pingüino SA" }];
    expect(ids("pena", lista)).toEqual([1]);
    expect(ids("PEÑA", lista)).toEqual([1]);
    expect(ids("pinguino", lista)).toEqual([2]);
  });

  it("los símbolos de expresiones regulares se buscan como texto y no rompen", () => {
    expect(() => buscarProveedores(PROVEEDORES_EJEMPLO, "(")).not.toThrow();
    expect(ids(".*")).toEqual([]);
    expect(ids("[a-z]")).toEqual([]);
    expect(ids("\\")).toEqual([]);
  });

  it("un proveedor con campos vacíos o ausentes no rompe la búsqueda", () => {
    expect(ids("x", [{ id: 1 }, { id: 2, nombre: null, telefono: null, correo: null, descripcion_compra: null, numero_documento: null }])).toEqual([]);
  });

  it("null y undefined como texto devuelven todo", () => {
    expect(ids(null)).toHaveLength(PROVEEDORES_EJEMPLO.length);
    expect(ids(undefined)).toHaveLength(PROVEEDORES_EJEMPLO.length);
  });

  it("no modifica la lista original", () => {
    const copia = JSON.stringify(PROVEEDORES_EJEMPLO);
    buscarProveedores(PROVEEDORES_EJEMPLO, "envases");
    expect(JSON.stringify(PROVEEDORES_EJEMPLO)).toBe(copia);
  });

  it("un texto con letras no trae resultados por culpa de los números que contiene", () => {
    // "zzz1" no está en ningún nombre, teléfono, correo ni descripción: la búsqueda debe dar vacío.
    expect(ids("zzz1")).toEqual([]);
    expect(ids("abc30")).toEqual([]);
  });
});

describe("filtrarProveedores: casos límite", () => {
  it("un proveedor sin el campo activo cuenta como visible", () => {
    expect(filtrarProveedores([{ id: 1 }])).toHaveLength(1);
    expect(filtrarProveedores([{ id: 1 }], { ocultos: true })).toHaveLength(0);
  });

  it("devuelve una lista nueva y no modifica la original", () => {
    const original = [...PROVEEDORES_EJEMPLO];
    const resultado = filtrarProveedores(PROVEEDORES_EJEMPLO);
    expect(resultado).not.toBe(PROVEEDORES_EJEMPLO);
    expect(PROVEEDORES_EJEMPLO).toEqual(original);
  });

  it("sin proveedores devuelve una lista vacía", () => {
    expect(filtrarProveedores([])).toEqual([]);
    expect(filtrarProveedores([], { ocultos: true })).toEqual([]);
  });
});

describe("puedeEliminarProveedor: casos límite", () => {
  it("si no está oculto, primero hay que ocultarlo (aunque tenga movimientos)", () => {
    expect(puedeEliminarProveedor({ activo: true, tiene_movimientos: true })).toEqual({ permitido: false, motivo: "Primero hay que ocultarlo." });
  });

  it("el motivo con movimientos es el texto compartido", () => {
    expect(MOTIVO_CON_MOVIMIENTOS).toBe("Tiene productos o reposiciones asociados: solo se puede ocultar.");
  });

  it("los proveedores de ejemplo cumplen la regla", () => {
    const permitidos = PROVEEDORES_EJEMPLO.filter((p) => puedeEliminarProveedor(p).permitido).map((p) => p.id);
    expect(permitidos).toEqual([4]);
  });
});

describe("datos simulados: coherencia", () => {
  it("los ids no se repiten y no hay dos con el mismo tipo y número de documento", () => {
    const ids = PROVEEDORES_EJEMPLO.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    const documentos = PROVEEDORES_EJEMPLO.map((p) => `${p.tipo_documento}-${soloDigitos(p.numero_documento)}`);
    expect(new Set(documentos).size).toBe(documentos.length);
  });

  it("cada proveedor de ejemplo pasa la validación de la ficha", () => {
    PROVEEDORES_EJEMPLO.forEach((p) => {
      expect(validarProveedor(p)).toEqual({});
    });
  });
});

// --- Servicio simulado (mocks/proveedores.js): se carga de cero en cada prueba para no arrastrar datos ---

const cargarServicio = async (usuario = "tester") => {
  vi.resetModules();
  vi.stubGlobal("decodificarToken", () => ({ usuario_id: 9, usuario, rol: "ADMIN" }));
  vi.stubGlobal("localStorage", { getItem: () => "token" });
  return (await import("../../frontend/js/mocks/proveedores.js")).servicioProveedores;
};

const nuevo = { ...valido, numero_documento: "20111111112", nombre: "Nuevo SA", telefono: null, correo: null, descripcion_compra: null };

describe("servicio simulado de proveedores", () => {
  it("lista los visibles por defecto, los ocultos con ocultos: true y busca con q", async () => {
    const servicio = await cargarServicio();
    expect((await servicio.listar()).map((p) => p.id)).toEqual([1, 2, 3]);
    expect((await servicio.listar({ ocultos: true })).map((p) => p.id)).toEqual([4, 5]);
    expect((await servicio.listar({ q: "marta" })).map((p) => p.id)).toEqual([3]);
    expect((await servicio.listar({ q: "marta", ocultos: true }))).toEqual([]);
  });

  it("devuelve copias: modificar lo que devuelve no cambia los datos guardados", async () => {
    const servicio = await cargarServicio();
    (await servicio.listar())[0].nombre = "ALTERADO";
    expect((await servicio.listar())[0].nombre).toBe("Envases del Sur S.A.");
  });

  it("crear asigna el id siguiente y arranca visible y sin movimientos", async () => {
    const servicio = await cargarServicio();
    const creado = await servicio.crear(nuevo);
    expect(creado).toMatchObject({ id: 6, activo: true, tiene_movimientos: false });
    expect((await servicio.listar()).map((p) => p.id)).toEqual([1, 2, 3, 6]);
    expect((await servicio.crear({ ...nuevo, numero_documento: "27201234560" })).id).toBe(7);
  });

  it("no permite repetir el documento, aunque venga con otro formato", async () => {
    const servicio = await cargarServicio();
    await expect(servicio.crear({ ...nuevo, numero_documento: "30-71234567-1" })).rejects.toMatchObject({
      errores: { numero_documento: "Ya hay un proveedor con ese CUIT (30-71234567-1)." },
    });
  });

  it("el documento de un proveedor oculto también cuenta como repetido", async () => {
    const servicio = await cargarServicio();
    await expect(servicio.crear({ ...nuevo, numero_documento: "33712345670" })).rejects.toThrow(/Ya hay un proveedor con ese CUIT/);
  });

  it("el mismo número con otro tipo de documento no es repetido", async () => {
    const servicio = await cargarServicio();
    const creado = await servicio.crear({ ...nuevo, tipo_documento: "CUIL", numero_documento: "30712345671" });
    expect(creado.tipo_documento).toBe("CUIL");
  });

  it("un documento repetido no deja un proveedor a medias", async () => {
    const servicio = await cargarServicio();
    await servicio.crear({ ...nuevo, numero_documento: "30712345671" }).catch(() => {});
    expect(await servicio.listar()).toHaveLength(3);
  });

  it("actualizar cambia los campos y conserva si está activo y los movimientos", async () => {
    const servicio = await cargarServicio();
    const editado = await servicio.actualizar(1, { ...nuevo, numero_documento: "30712345671", nombre: "Envases Renovados" });
    expect(editado).toMatchObject({ id: 1, nombre: "Envases Renovados", activo: true, tiene_movimientos: true });
  });

  it("no guarda quién creó al proveedor: la tabla de la base no tiene ese dato", async () => {
    const servicio = await cargarServicio("cajera.ana");
    const creado = await servicio.crear(nuevo);
    expect(creado).not.toHaveProperty("creado_por_nombre");
    expect(creado).not.toHaveProperty("creado_por");
    (await servicio.listar({ ocultos: false })).forEach((p) => expect(p).not.toHaveProperty("creado_por_nombre"));
    (await servicio.listar({ ocultos: true })).forEach((p) => expect(p).not.toHaveProperty("creado_por_nombre"));
  });

  it("los datos de ejemplo tampoco traen quién los creó", () => {
    PROVEEDORES_EJEMPLO.forEach((p) => expect(Object.keys(p).some((k) => k.startsWith("creado"))).toBe(false));
  });

  it("al actualizar, el propio documento no cuenta como repetido, pero el de otro sí", async () => {
    const servicio = await cargarServicio();
    await expect(servicio.actualizar(1, { ...nuevo, numero_documento: "30-71234567-1" })).resolves.toBeDefined();
    await expect(servicio.actualizar(2, { ...nuevo, numero_documento: "30-71234567-1" })).rejects.toThrow(/Ya hay un proveedor/);
    expect((await servicio.listar()).find((p) => p.id === 2).numero_documento).toBe("30500001735");
  });

  it("cambiarOculto oculta y restaura, y la lista lo refleja", async () => {
    const servicio = await cargarServicio();
    await servicio.cambiarOculto(3, true);
    expect((await servicio.listar()).map((p) => p.id)).toEqual([1, 2]);
    expect((await servicio.listar({ ocultos: true })).map((p) => p.id)).toEqual([3, 4, 5]);
    await servicio.cambiarOculto(3, false);
    expect((await servicio.listar()).map((p) => p.id)).toEqual([1, 2, 3]);
  });

  it("no elimina a un proveedor con movimientos", async () => {
    const servicio = await cargarServicio();
    await expect(servicio.eliminar(5)).rejects.toThrow(MOTIVO_CON_MOVIMIENTOS);
    expect((await servicio.listar({ ocultos: true })).map((p) => p.id)).toEqual([4, 5]);
  });

  it("elimina a uno sin movimientos y deja libre su documento", async () => {
    const servicio = await cargarServicio();
    await servicio.eliminar(4);
    expect((await servicio.listar({ ocultos: true })).map((p) => p.id)).toEqual([5]);
    await expect(servicio.crear({ ...nuevo, numero_documento: "33712345670" })).resolves.toBeDefined();
  });
});

// --- Helper para los selects de otras pantallas (servicios/proveedores.js) ---

describe("cargarProveedores", () => {
  const respuesta = [
    { id: 2, nombre: "Zeta SA", categoria_impositiva: "EXENTO", activo: true, telefono: "1" },
    { id: 1, nombre: "Álvarez Hnos", categoria_impositiva: "MONOTRIBUTISTA", activo: true },
    { id: 3, nombre: "Oculto SA", categoria_impositiva: "EXENTO", activo: false },
    { id: 4, nombre: "Bebidas", categoria_impositiva: "RESPONSABLE_INSCRIPTO" },
  ];

  it("pide /proveedores, descarta los ocultos y deja solo id, nombre y categoría", async () => {
    const fetchAPI = vi.fn().mockResolvedValue(respuesta);
    vi.stubGlobal("fetchAPI", fetchAPI);
    const lista = await cargarProveedores();
    expect(fetchAPI).toHaveBeenCalledWith("/proveedores");
    expect(lista.map((p) => p.id)).not.toContain(3);
    expect(Object.keys(lista[0]).sort()).toEqual(["categoria_impositiva", "id", "nombre"]);
  });

  it("los ordena alfabéticamente en español (la Á va con la A)", async () => {
    vi.stubGlobal("fetchAPI", vi.fn().mockResolvedValue(respuesta));
    expect((await cargarProveedores()).map((p) => p.nombre)).toEqual(["Álvarez Hnos", "Bebidas", "Zeta SA"]);
  });

  it("acepta la lista dentro de { items }", async () => {
    vi.stubGlobal("fetchAPI", vi.fn().mockResolvedValue({ items: respuesta }));
    expect(await cargarProveedores()).toHaveLength(3);
  });

  it("si la API falla o responde algo raro devuelve una lista vacía", async () => {
    vi.stubGlobal("fetchAPI", vi.fn().mockRejectedValue(new Error("caído")));
    expect(await cargarProveedores()).toEqual([]);
    vi.stubGlobal("fetchAPI", vi.fn().mockResolvedValue(null));
    expect(await cargarProveedores()).toEqual([]);
    vi.stubGlobal("fetchAPI", vi.fn().mockResolvedValue({}));
    expect(await cargarProveedores()).toEqual([]);
  });
});

describe("llenarSelectProveedores", () => {
  class OpcionFalsa {
    constructor(texto, valor) {
      this.text = texto;
      this.value = valor;
    }
  }
  const crearSelect = () => ({
    opciones: [],
    value: "",
    disabled: false,
    replaceChildren(primera) {
      this.opciones = [primera];
    },
    append(opcion) {
      this.opciones.push(opcion);
    },
  });
  const lista = [
    { id: 1, nombre: "Ana" },
    { id: 2, nombre: "Beto" },
  ];

  it("arma una opción vacía y una por proveedor, y habilita el select", () => {
    vi.stubGlobal("Option", OpcionFalsa);
    const select = crearSelect();
    llenarSelectProveedores(select, lista);
    expect(select.opciones.map((o) => [o.text, o.value])).toEqual([
      ["Elegir proveedor…", ""],
      ["Ana", "1"],
      ["Beto", "2"],
    ]);
    expect(select.disabled).toBe(false);
    expect(select.value).toBe("");
  });

  it("deja elegido el proveedor pedido (por ejemplo al editar)", () => {
    vi.stubGlobal("Option", OpcionFalsa);
    const select = crearSelect();
    llenarSelectProveedores(select, lista, { valor: 2 });
    expect(select.value).toBe("2");
  });

  it("sin proveedores muestra «Sin proveedores» y deshabilita el select", () => {
    vi.stubGlobal("Option", OpcionFalsa);
    const select = crearSelect();
    llenarSelectProveedores(select, []);
    expect(select.opciones.map((o) => o.text)).toEqual(["Sin proveedores"]);
    expect(select.disabled).toBe(true);
  });

  it("permite cambiar el texto de la opción vacía y tolera un valor nulo", () => {
    vi.stubGlobal("Option", OpcionFalsa);
    const select = crearSelect();
    llenarSelectProveedores(select, lista, { textoVacio: "Todos", valor: null });
    expect(select.opciones[0].text).toBe("Todos");
    expect(select.value).toBe("");
  });

  it("al llenarlo de nuevo reemplaza las opciones anteriores", () => {
    vi.stubGlobal("Option", OpcionFalsa);
    const select = crearSelect();
    llenarSelectProveedores(select, lista);
    llenarSelectProveedores(select, [lista[0]]);
    expect(select.opciones).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Mejoras: CUIL solo con prefijos de persona, correo más estricto y con largo máximo,
// y búsqueda de teléfono por sus números.
// ---------------------------------------------------------------------------

import { CORREO_MAXIMO } from "../../frontend/js/proveedores.js";

describe("CUIL: solo prefijos de persona", () => {
  it.each(["30", "33", "34"])("un CUIL con el prefijo de empresa %s se rechaza", (prefijo) => {
    expect(validarDocumento("CUIL", `${prefijo}-71234567-1`)).toEqual({
      numero_documento: "El CUIL no es válido: el prefijo debe ser 20, 23, 24 o 27.",
    });
  });

  it("el prefijo de empresa se avisa antes que un dígito verificador incorrecto", () => {
    expect(validarDocumento("CUIL", "30-71234567-2").numero_documento).toBe("El CUIL no es válido: el prefijo debe ser 20, 23, 24 o 27.");
  });

  it.each(["20", "23", "24", "27"])("el prefijo de persona %s no da error de prefijo", (prefijo) => {
    const { numero_documento } = validarDocumento("CUIL", `${prefijo}123456780`);
    expect(numero_documento ?? "").not.toMatch(/prefijo/);
  });

  it("los CUIL válidos de siempre se siguen aceptando", () => {
    expect(validarDocumento("CUIL", "20-12345678-6")).toEqual({});
    expect(validarDocumento("CUIL", "27-20123456-0")).toEqual({});
  });

  it("un prefijo que no existe sigue diciendo que no existe", () => {
    expect(validarDocumento("CUIL", "10-12345678-6").numero_documento).toBe("El CUIL no es válido: el prefijo no existe.");
  });

  it("el CUIT sigue aceptando los prefijos de empresa y de persona", () => {
    expect(validarDocumento("CUIT", "30-71234567-1")).toEqual({});
    expect(validarDocumento("CUIT", "20-12345678-6")).toEqual({});
    expect(validarDocumento("CUIT", "27-20123456-0")).toEqual({});
  });

  it("la ficha completa de un CUIL con prefijo 30 informa el error en el número", () => {
    expect(validarProveedor({ ...valido, tipo_documento: "CUIL", numero_documento: "30-71234567-1" })).toEqual({
      numero_documento: "El CUIL no es válido: el prefijo debe ser 20, 23, 24 o 27.",
    });
  });
});

describe("correo: reglas más estrictas y largo máximo", () => {
  it.each([["a@b..com"], ["a..b@c.com"], [".a@b.com"], ["a.@b.com"], ["a@.b.com"], ["a@b.com."], ["a@b@c.com"], ["a@b .com"]])(
    "rechaza el correo %j",
    (correo) => {
      expect(validarProveedor({ ...valido, correo }).correo).toBe("El correo no es válido.");
    },
  );

  it.each([["a.b@c.com"], ["a.b.c@d.e.com"], ["a-b_c@x-y.com"], ["nombre.apellido+tag@mail.empresa.com.ar"], ["ñandu@correo.com"]])(
    "acepta el correo %j",
    (correo) => {
      expect(validarProveedor({ ...valido, correo })).toEqual({});
    },
  );

  it("el largo máximo es 120", () => {
    expect(CORREO_MAXIMO).toBe(120);
  });

  it("acepta un correo de exactamente 120 caracteres y rechaza uno de 121", () => {
    const de120 = `${"a".repeat(114)}@b.com`;
    expect(de120).toHaveLength(120);
    expect(validarProveedor({ ...valido, correo: de120 })).toEqual({});
    expect(validarProveedor({ ...valido, correo: `a${de120}` }).correo).toBe("El correo no puede superar los 120 caracteres.");
  });

  it("los espacios de los costados no cuentan para el largo", () => {
    expect(validarProveedor({ ...valido, correo: `  ${"a".repeat(114)}@b.com  ` })).toEqual({});
  });
});

describe("búsqueda: teléfono por sus números", () => {
  const ids = (texto, lista = PROVEEDORES_EJEMPLO) => buscarProveedores(lista, texto).map((p) => p.id);

  it("encuentra el teléfono escrito sin espacios ni guiones", () => {
    expect(ids("114444")).toEqual([1]);
    expect(ids("1144445555")).toEqual([1]);
    expect(ids("44445555")).toEqual([1]);
  });

  it("encuentra el teléfono con otros separadores", () => {
    expect(ids("(11) 4444-5555")).toEqual([1]);
    expect(ids("11.5555.6666")).toEqual([2]);
  });

  it("un texto con letras no se compara por números, ni en el documento ni en el teléfono", () => {
    expect(ids("tel114444")).toEqual([]);
    expect(ids("zzz1")).toEqual([]);
    expect(ids("abc30")).toEqual([]);
  });

  it("buscar por números no rompe con proveedores sin teléfono ni documento", () => {
    expect(ids("123", [{ id: 1 }, { id: 2, telefono: null, numero_documento: null }])).toEqual([]);
  });

  it("buscar el documento sigue andando con y sin guiones", () => {
    expect(ids("30-71234567-1")).toEqual([1]);
    expect(ids("30712345671")).toEqual([1]);
    expect(ids("71234567")).toEqual([1, 4]);
  });
});

// ---------------------------------------------------------------------------
// Nombres de campo de la base: `activo` (en vez de `oculto`) en proveedores.
// ---------------------------------------------------------------------------

import { estaOculto } from "../../frontend/js/proveedores.js";

describe("proveedores: «activo» en vez de «oculto» (como en la base)", () => {
  it("un proveedor está oculto cuando activo es falso, y visible cuando es verdadero", () => {
    expect(estaOculto({ activo: false })).toBe(true);
    expect(estaOculto({ activo: true })).toBe(false);
  });

  it("si el dato no viene se toma como visible (el valor por defecto de la columna es verdadero)", () => {
    expect(estaOculto({})).toBe(false);
    expect(estaOculto({ activo: undefined })).toBe(false);
    expect(estaOculto({ activo: null })).toBe(false);
  });

  it("el campo viejo «oculto» ya no cuenta para nada", () => {
    expect(estaOculto({ oculto: true })).toBe(false);
    expect(filtrarProveedores([{ id: 1, oculto: true }])).toHaveLength(1);
  });

  it("los datos de ejemplo usan «activo» y no «oculto»", () => {
    PROVEEDORES_EJEMPLO.forEach((p) => {
      expect(p).toHaveProperty("activo");
      expect(p).not.toHaveProperty("oculto");
    });
    expect(PROVEEDORES_EJEMPLO.filter((p) => p.activo === false).map((p) => p.id)).toEqual([4, 5]);
  });

  it("la ficha que se envía no incluye «activo»: ocultar es una acción aparte", () => {
    expect(armarPayloadProveedor({ ...valido, activo: false })).not.toHaveProperty("activo");
  });

  it("ocultar deja activo en falso y restaurar lo devuelve a verdadero", async () => {
    const servicio = await cargarServicio();
    expect((await servicio.cambiarOculto(3, true)).activo).toBe(false);
    expect((await servicio.listar({ ocultos: true })).find((p) => p.id === 3).activo).toBe(false);
    expect((await servicio.cambiarOculto(3, false)).activo).toBe(true);
    expect((await servicio.listar()).find((p) => p.id === 3).activo).toBe(true);
  });

  it("un proveedor nuevo queda activo y no tiene el campo viejo", async () => {
    const servicio = await cargarServicio();
    const creado = await servicio.crear(nuevo);
    expect(creado.activo).toBe(true);
    expect(creado).not.toHaveProperty("oculto");
  });

  it("ocultar y restaurar no agrega campos raros a la ficha", async () => {
    const servicio = await cargarServicio();
    await servicio.cambiarOculto(1, true);
    const ficha = (await servicio.listar({ ocultos: true })).find((p) => p.id === 1);
    expect(ficha).not.toHaveProperty("oculto");
    expect(Object.keys(ficha).sort()).toEqual(Object.keys(PROVEEDORES_EJEMPLO[0]).sort());
  });

  it("solo se elimina a quien tiene activo en falso y no tiene movimientos", () => {
    expect(puedeEliminarProveedor({ activo: true, tiene_movimientos: false }).permitido).toBe(false);
    expect(puedeEliminarProveedor({ activo: false, tiene_movimientos: true }).permitido).toBe(false);
    expect(puedeEliminarProveedor({ activo: false, tiene_movimientos: false }).permitido).toBe(true);
    expect(puedeEliminarProveedor({ tiene_movimientos: false }).motivo).toBe("Primero hay que ocultarlo.");
  });
});

describe("cargarProveedores: respeta «activo»", () => {
  it("descarta solo los que tienen activo en falso, y deja a los que no traen el dato", async () => {
    vi.stubGlobal(
      "fetchAPI",
      vi.fn().mockResolvedValue([
        { id: 1, nombre: "Activo", categoria_impositiva: "EXENTO", activo: true },
        { id: 2, nombre: "Inactivo", categoria_impositiva: "EXENTO", activo: false },
        { id: 3, nombre: "Sin dato", categoria_impositiva: "EXENTO" },
      ]),
    );
    expect((await cargarProveedores()).map((p) => p.nombre)).toEqual(["Activo", "Sin dato"]);
  });
});

// ---------------------------------------------------------------------------
// Largo del teléfono según la base (VARCHAR(50)).
// ---------------------------------------------------------------------------

describe("teléfono del proveedor: largo de la base", () => {
  it("el máximo es 50", () => {
    expect(TELEFONO_PROVEEDOR_MAXIMO).toBe(50);
  });

  it("acepta un teléfono de exactamente 50 caracteres (con pocos números y muchos espacios)", () => {
    const de50 = `1144445555${" ".repeat(39)}1`;
    expect(de50).toHaveLength(50);
    expect(validarProveedor({ ...valido, telefono: de50 })).toEqual({});
  });

  it("uno de 51 caracteres se rechaza por el largo", () => {
    const de51 = `1144445555${" ".repeat(40)}1`;
    expect(de51).toHaveLength(51);
    expect(validarProveedor({ ...valido, telefono: de51 }).telefono).toBe("El teléfono no puede superar los 50 caracteres.");
  });

  it("un teléfono de más de 50 caracteres se rechaza por el largo, no por los números", () => {
    expect(validarProveedor({ ...valido, telefono: `11 ${"-".repeat(60)}` }).telefono).toBe(
      "El teléfono no puede superar los 50 caracteres.",
    );
  });

  it("los espacios de los costados no cuentan para el largo", () => {
    expect(validarProveedor({ ...valido, telefono: ` ${"1".repeat(12)} ` })).toEqual({});
  });

  it("sigue exigiendo entre 6 y 15 números aunque el campo admita 50 caracteres", () => {
    expect(validarProveedor({ ...valido, telefono: "1".repeat(16) }).telefono).toMatch(/entre 6 y 15 números/);
    expect(validarProveedor({ ...valido, telefono: "12345" }).telefono).toMatch(/entre 6 y 15 números/);
  });
});
