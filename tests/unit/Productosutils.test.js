import { describe, it, expect } from "vitest";
import {
  calcularPrecioVenta,
  precioMenorAlCosto,
  calcularMontoReposicion,
  formatearMoneda,
} from "../../frontend/js/utils/productosUtils.js";

describe("Utilidades de Productos", () => {
  // Pruebas de la Fórmula de Precio de Venta
  describe("calcularPrecioVenta", () => {
    it("calcula el precio con rentabilidad e IVA 21%", () => {
      // 1000 * 1.30 (30% rent) = 1300 * 1.21 (21% iva) = 1573
      expect(calcularPrecioVenta(1000, 30, 21)).toBe(1573);
    });

    it("calcula el precio sin rentabilidad (0%)", () => {
      // 1000 * 1.00 = 1000 * 1.21 = 1210
      expect(calcularPrecioVenta(1000, 0, 21)).toBe(1210);
    });

    it("calcula el precio con IVA 10.5%", () => {
      // 1000 * 1.00 = 1000 * 1.105 = 1105
      expect(calcularPrecioVenta(1000, 0, 10.5)).toBe(1105);
    });

    it("calcula el precio con IVA 0%", () => {
      expect(calcularPrecioVenta(1000, 50, 0)).toBe(1500);
    });

    it("devuelve 0 si el precio de compra es inválido", () => {
      expect(calcularPrecioVenta(0, 30, 21)).toBe(0);
      expect(calcularPrecioVenta(-100, 30, 21)).toBe(0);
    });
  });

  // Pruebas del Aviso de Precio
  describe("precioMenorAlCosto", () => {
    it("devuelve true si el precio de venta es menor al costo", () => {
      expect(precioMenorAlCosto(800, 1000)).toBe(true);
    });

    it("devuelve false si el precio de venta es mayor o igual al costo", () => {
      expect(precioMenorAlCosto(1000, 1000)).toBe(false);
      expect(precioMenorAlCosto(1200, 1000)).toBe(false);
    });
  });

  // Pruebas de Monto de Reposición
  describe("calcularMontoReposicion", () => {
    it("multiplica correctamente cantidad por costo", () => {
      expect(calcularMontoReposicion(5, 150.5)).toBe(752.5);
    });

    it("devuelve 0 si los datos son inválidos", () => {
      expect(calcularMontoReposicion(0, 150)).toBe(0);
      expect(calcularMontoReposicion(5, -10)).toBe(0);
    });
  });

  // Pruebas de Formato
  describe("formatearMoneda", () => {
    it("formatea a moneda argentina", () => {
      // Dependiendo de la configuración del sistema, el resultado puede variar un poco (espacios, etc.)
      // Pero validamos que contenga el símbolo $ y los decimales.
      const resultado = formatearMoneda(1500.5);
      expect(resultado).toContain("$");
      expect(resultado).toContain("1.500,50");
    });
  });
});
