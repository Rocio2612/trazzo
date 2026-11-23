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

describe("textoAlerta: casos límite", () => {
  it("un stock de 0 se muestra (no se confunde con 'sin dato')", () => {
    expect(textoAlerta({ producto_nombre: "Collar", stock_actual: 0 })).toBe("Collar, quedan 0");
    expect(textoAlerta({ producto_nombre: "Collar", cantidad: 0 })).toBe("Collar, quedan 0");
  });

  it("si vienen stock_actual y cantidad, usa stock_actual", () => {
    expect(textoAlerta({ producto_nombre: "Collar", stock_actual: 2, cantidad: 9 })).toBe("Collar, quedan 2");
  });

  it("si vienen varios nombres, prioriza producto_nombre, después producto y por último nombre", () => {
    expect(textoAlerta({ producto_nombre: "A", producto: "B", nombre: "C", stock_actual: 1 })).toBe("A, quedan 1");
    expect(textoAlerta({ producto: "B", nombre: "C", stock_actual: 1 })).toBe("B, quedan 1");
    expect(textoAlerta({ nombre: "C", stock_actual: 1 })).toBe("C, quedan 1");
  });

  it("sin ningún nombre dice 'Producto'", () => {
    expect(textoAlerta({ stock_actual: 3 })).toBe("Producto, quedan 3");
    expect(textoAlerta({})).toBe("Producto");
  });

  it("un mensaje vacío no se usa: arma el texto con el producto", () => {
    expect(textoAlerta({ mensaje: "", producto_nombre: "Collar", stock_actual: 2 })).toBe("Collar, quedan 2");
  });

  it("el mensaje del Backend tiene prioridad sobre los demás datos", () => {
    expect(textoAlerta({ mensaje: "Reponer ya", producto_nombre: "Collar", stock_actual: 2 })).toBe("Reponer ya");
  });

  it("acepta el stock como texto", () => {
    expect(textoAlerta({ producto_nombre: "Collar", stock_actual: "4" })).toBe("Collar, quedan 4");
  });
});

describe("textoContador: casos límite", () => {
  it("muestra el número exacto hasta 99", () => {
    expect(textoContador(0)).toBe("0");
    expect(textoContador(1)).toBe("1");
    expect(textoContador(99)).toBe("99");
  });

  it("desde 100 muestra 99+", () => {
    expect(textoContador(100)).toBe("99+");
    expect(textoContador(5000)).toBe("99+");
  });
});
