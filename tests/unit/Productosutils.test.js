import { describe, it, expect } from "vitest";
import {
  calcularPrecioVenta,
  esPrecioMenorAlCosto,
  montoSugeridoReposicion,
  validarCantidadBaja,
  filtrarProductos,
} from "../../frontend/js/productosUtils.js";
import { formatearDinero } from "../../frontend/js/formatos.js";

describe("calcularPrecioVenta", () => {
  it("con rentabilidad 30 % e IVA 21 %", () =>
    expect(calcularPrecioVenta(1000, 30, 21)).toBe(1573));
  it("sin rentabilidad toma 0 %", () => {
    expect(calcularPrecioVenta(1000, undefined, 21)).toBe(1210);
    expect(calcularPrecioVenta(1000, "", 21)).toBe(1210);
    expect(calcularPrecioVenta(1000, 0, 21)).toBe(1210);
  });
  it("con IVA 0 %", () => {
    expect(calcularPrecioVenta(1000, 30, 0)).toBe(1300);
    expect(calcularPrecioVenta(1000, 0, 0)).toBe(1000);
  });
  it("con IVA 10,5 %", () => {
    expect(calcularPrecioVenta(1000, 0, 10.5)).toBe(1105);
    expect(calcularPrecioVenta(1000, 30, "10.5")).toBe(1436.5);
  });
  it("IVA 27 % y redondeo a 2 decimales", () => {
    expect(calcularPrecioVenta(1000, 0, 27)).toBe(1270);
    expect(calcularPrecioVenta(333.33, 10, 21)).toBe(443.66);
  });
  it("devuelve null si no hay un costo válido", () => {
    expect(calcularPrecioVenta("", 30, 21)).toBeNull();
    expect(calcularPrecioVenta(0, 30, 21)).toBeNull();
    expect(calcularPrecioVenta(-5, 30, 21)).toBeNull();
  });
});

describe("otras funciones de productos", () => {
  it("avisa si el precio es menor al costo", () => {
    expect(esPrecioMenorAlCosto(90, 100)).toBe(true);
    expect(esPrecioMenorAlCosto(100, 100)).toBe(false);
    expect(esPrecioMenorAlCosto("", 100)).toBe(false);
  });
  it("monto sugerido de reposición = cantidad × último costo", () => {
    expect(montoSugeridoReposicion(10, 125.5)).toBe(1255);
    expect(montoSugeridoReposicion("", 100)).toBeNull();
  });
  it("la baja no puede dejar el stock negativo", () => {
    expect(validarCantidadBaja(3, 5)).toBeNull();
    expect(validarCantidadBaja(5, 5)).toBeNull();
    expect(validarCantidadBaja(6, 5)).toMatch(/negativo/);
    expect(validarCantidadBaja(0, 5)).not.toBeNull();
    expect(validarCantidadBaja(1.5, 5)).not.toBeNull();
  });
  it("filtra por texto sin tildes y por stock bajo", () => {
    const lista = [
      { nombre: "Cinturón", stock_actual: 1, stock_minimo: 2 },
      {
        nombre: "Billetera",
        stock_actual: 9,
        stock_minimo: 2,
        proveedor_nombre: "Cuero SA",
      },
    ];
    expect(filtrarProductos(lista, { texto: "cinturon" })).toHaveLength(1);
    expect(filtrarProductos(lista, { texto: "cuero" })[0].nombre).toBe(
      "Billetera",
    );
    expect(
      filtrarProductos(lista, { soloStockBajo: true }).map((p) => p.nombre),
    ).toEqual(["Cinturón"]);
  });
});

describe("formatearDinero", () => {
  // Intl puede usar espacio no separable: se normaliza antes de comparar.
  const plano = (t) => t.replace(/\s/g, " ");
  it("formato argentino", () => {
    expect(plano(formatearDinero("1234.5"))).toBe("$ 1.234,50");
    expect(plano(formatearDinero(1573))).toBe("$ 1.573,00");
  });
  it("devuelve vacío si no es un número", () =>
    expect(formatearDinero("abc")).toBe(""));
});
