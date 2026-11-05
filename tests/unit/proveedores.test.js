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

  it("limita la descripción a 500 caracteres", () => {
    expect(validarProveedor({ ...valido, descripcion_compra: "a".repeat(501) }).descripcion_compra).toMatch(/500/);
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
    expect(puedeEliminarProveedor({ oculto: false, tiene_movimientos: false })).toEqual({ permitido: false, motivo: "Primero hay que ocultarlo." });
  });

  it("oculto pero con reposiciones o insumos: solo se puede ocultar", () => {
    expect(puedeEliminarProveedor({ oculto: true, tiene_movimientos: true })).toEqual({ permitido: false, motivo: MOTIVO_CON_MOVIMIENTOS });
  });

  it("oculto y sin movimientos: se puede eliminar", () => {
    expect(puedeEliminarProveedor({ oculto: true, tiene_movimientos: false }).permitido).toBe(true);
  });
});

describe("datos simulados", () => {
  it("todos los CUIT y CUIL de ejemplo son válidos", () => {
    PROVEEDORES_EJEMPLO.forEach((p) => {
      expect(validarDocumento(p.tipo_documento, p.numero_documento)).toEqual({});
    });
  });
});
