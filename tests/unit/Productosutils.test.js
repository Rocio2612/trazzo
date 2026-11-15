// Tests unitarios (Vitest) de js/utils/productosUtils.js
// Ajustá la ruta del import si tu carpeta de tests está en otro lugar.
import { describe, it, expect } from "vitest";
import {
  redondear,
  escaparHTML,
  calcularPrecioVenta,
  precioMenorAlCosto,
  calcularMontoReposicion,
  formatearMoneda,
  estadoStock,
  parsearFecha,
  formatearFecha,
  rolDesdeToken,
  esRolAdmin,
  mensajeDeError,
} from "../js/utils/productosUtils.js";

// Arma un JWT de prueba (la firma no se valida en el front).
const jwtCon = (payload) => {
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64(payload)}.firma`;
};
const sinEspaciosRaros = (texto) => texto.replace(/\s/g, " ");

describe("calcularPrecioVenta", () => {
  it("aplica rentabilidad e IVA", () => {
    expect(calcularPrecioVenta(1000, 50, 21)).toBe(1815);
  });
  it("sin rentabilidad ni IVA devuelve el costo", () => {
    expect(calcularPrecioVenta(1000)).toBe(1000);
    expect(calcularPrecioVenta(1000, 0, 0)).toBe(1000);
  });
  it("redondea a 2 decimales", () => {
    expect(calcularPrecioVenta(99.99, 33.3, 10.5)).toBe(147.28);
  });
  it("devuelve 0 con costo inválido", () => {
    expect(calcularPrecioVenta(0, 50, 21)).toBe(0);
    expect(calcularPrecioVenta(-5, 50, 21)).toBe(0);
    expect(calcularPrecioVenta("abc", 50, 21)).toBe(0);
    expect(calcularPrecioVenta("", 50, 21)).toBe(0);
  });
  it("trata rentabilidad e IVA no numéricos como 0", () => {
    expect(calcularPrecioVenta(100, "x", "y")).toBe(100);
  });
});

describe("precioMenorAlCosto", () => {
  it("true si el precio de venta es menor al costo", () => {
    expect(precioMenorAlCosto(90, 100)).toBe(true);
    expect(precioMenorAlCosto("90", "100")).toBe(true);
  });
  it("false si es igual o mayor", () => {
    expect(precioMenorAlCosto(100, 100)).toBe(false);
    expect(precioMenorAlCosto(150, 100)).toBe(false);
  });
  it("false si falta algún valor", () => {
    expect(precioMenorAlCosto("", 100)).toBe(false);
    expect(precioMenorAlCosto(100, "")).toBe(false);
  });
});

describe("calcularMontoReposicion", () => {
  it("multiplica cantidad por costo", () => {
    expect(calcularMontoReposicion(5, 1000)).toBe(5000);
    expect(calcularMontoReposicion("3", "10.5")).toBe(31.5);
  });
  it("devuelve 0 con datos inválidos", () => {
    expect(calcularMontoReposicion(0, 1000)).toBe(0);
    expect(calcularMontoReposicion(5, 0)).toBe(0);
    expect(calcularMontoReposicion("", 1000)).toBe(0);
    expect(calcularMontoReposicion(-2, 1000)).toBe(0);
  });
});

describe("formatearMoneda", () => {
  it("formatea en pesos argentinos", () => {
    expect(sinEspaciosRaros(formatearMoneda(1234.5))).toBe("$ 1.234,50");
    expect(sinEspaciosRaros(formatearMoneda(0))).toBe("$ 0,00");
  });
  it("acepta NUMERIC que llega como texto", () => {
    expect(sinEspaciosRaros(formatearMoneda("1000.00"))).toBe("$ 1.000,00");
  });
  it("devuelve — para vacío o no numérico", () => {
    expect(formatearMoneda(null)).toBe("—");
    expect(formatearMoneda(undefined)).toBe("—");
    expect(formatearMoneda("")).toBe("—");
    expect(formatearMoneda("abc")).toBe("—");
  });
});

describe("estadoStock", () => {
  it("sin stock cuando es 0", () => {
    expect(estadoStock(0, 5)).toBe("SIN_STOCK");
    expect(estadoStock("0.00", 5)).toBe("SIN_STOCK");
  });
  it("bajo cuando llega al mínimo o menos", () => {
    expect(estadoStock(5, 5)).toBe("BAJO");
    expect(estadoStock(2, 5)).toBe("BAJO");
  });
  it("ok cuando supera el mínimo", () => {
    expect(estadoStock(6, 5)).toBe("OK");
    expect(estadoStock("10.00", "2.00")).toBe("OK");
  });
});

describe("fechas", () => {
  it("parsea fecha ISO sin correrse de día", () => {
    const d = parsearFecha("2026-11-15");
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([
      2026, 10, 15,
    ]);
  });
  it("parsea ISO con hora", () => {
    const d = parsearFecha("2026-11-15T00:00:00");
    expect(d.getDate()).toBe(15);
  });
  it("parsea el formato de Flask para un date (GMT) sin correrse de día", () => {
    const d = parsearFecha("Sun, 15 Nov 2026 00:00:00 GMT");
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([
      2026, 10, 15,
    ]);
  });
  it("devuelve null con valores inválidos", () => {
    expect(parsearFecha(null)).toBeNull();
    expect(parsearFecha("")).toBeNull();
    expect(parsearFecha("no es fecha")).toBeNull();
  });
  it("formatearFecha usa dd/mm/aaaa y — si no hay fecha", () => {
    expect(formatearFecha("2026-11-05")).toBe("05/11/2026");
    expect(formatearFecha(null)).toBe("—");
  });
});

describe("rolDesdeToken / esRolAdmin", () => {
  it("lee el rol del JWT en mayúsculas", () => {
    expect(rolDesdeToken(jwtCon({ rol: "admin" }))).toBe("ADMIN");
    expect(rolDesdeToken(jwtCon({ role: "Cajero" }))).toBe("CAJERO");
  });
  it("lee caracteres con tilde del payload", () => {
    expect(rolDesdeToken(jwtCon({ rol: "propietario", nombre: "José" }))).toBe(
      "PROPIETARIO",
    );
  });
  it("devuelve null con token inválido o sin rol", () => {
    expect(rolDesdeToken(null)).toBeNull();
    expect(rolDesdeToken("")).toBeNull();
    expect(rolDesdeToken("abc")).toBeNull();
    expect(rolDesdeToken("a.%%%.c")).toBeNull();
    expect(rolDesdeToken(jwtCon({ sub: "1" }))).toBeNull();
  });
  it("solo ADMIN y PROPIETARIO son admin", () => {
    expect(esRolAdmin("ADMIN")).toBe(true);
    expect(esRolAdmin("propietario")).toBe(true);
    expect(esRolAdmin("CAJERO")).toBe(false);
    expect(esRolAdmin(null)).toBe(false);
  });
});

describe("escaparHTML / redondear", () => {
  it("escapa caracteres peligrosos", () => {
    expect(escaparHTML('<img src=x onerror="alert(1)">')).toBe(
      "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;",
    );
    expect(escaparHTML("Tom & Jerry's")).toBe("Tom &amp; Jerry&#39;s");
  });
  it("tolera null y undefined", () => {
    expect(escaparHTML(null)).toBe("");
    expect(escaparHTML(undefined)).toBe("");
  });
  it("redondea con precisión", () => {
    expect(redondear(1.005)).toBe(1.01);
    expect(redondear(2.345, 1)).toBe(2.3);
  });
});

describe("mensajeDeError", () => {
  it("sin status = sin conexión", () => {
    expect(mensajeDeError(new TypeError("Failed to fetch"), "x")).toBe(
      "No se pudo conectar con el servidor.",
    );
  });
  it("usa el texto por defecto si el mensaje es el genérico de fetchAPI", () => {
    const e = Object.assign(new Error("Error en la petición"), { status: 500 });
    expect(mensajeDeError(e, "No se pudo guardar.")).toBe(
      "No se pudo guardar.",
    );
  });
  it("usa el mensaje del servidor cuando existe", () => {
    const e = Object.assign(new Error("Stock insuficiente"), { status: 409 });
    expect(mensajeDeError(e, "x")).toBe("Stock insuficiente");
  });
});
