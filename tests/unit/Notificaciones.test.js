import { describe, it, expect } from "vitest";
import {
  textoAlerta,
  textoContador,
} from "../../frontend/js/notificaciones.js";

describe("textoAlerta", () => {
  it("arma 'producto, quedan N'", () => {
    expect(textoAlerta({ producto_nombre: "Collar", stock_actual: 2 })).toBe(
      "Collar, quedan 2",
    );
    expect(textoAlerta({ nombre: "Pulsera", cantidad: 0 })).toBe(
      "Pulsera, quedan 0",
    );
  });
  it("usa el mensaje del Backend si viene armado", () => {
    expect(textoAlerta({ mensaje: "Stock bajo: Collar (2)" })).toBe(
      "Stock bajo: Collar (2)",
    );
  });
  it("sin stock informado muestra solo el nombre", () =>
    expect(textoAlerta({ producto: "Anillo" })).toBe("Anillo"));
});

describe("textoContador", () => {
  it("topea en 99+", () => {
    expect(textoContador(5)).toBe("5");
    expect(textoContador(120)).toBe("99+");
  });
});
