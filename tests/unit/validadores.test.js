import { describe, expect, it } from "vitest";
import {
  precioMenorAlCosto,
  validarEnteroNoNegativo,
  validarEnteroPositivo,
  validarFecha,
  validarFechaNoFutura,
  validarNumeroNoNegativo,
  validarNumeroPositivo,
  validarObligatorio,
} from "../../frontend/js/validadores.js";

describe("validarObligatorio", () => {
  it("acepta un valor con contenido", () => {
    expect(validarObligatorio("Sifón")).toBeNull();
    expect(validarObligatorio(0)).toBeNull();
  });

  it.each([[""], ["   "], [null], [undefined]])("rechaza un valor vacío (%j)", (valor) => {
    expect(validarObligatorio(valor, "El nombre")).toBe("Completá el nombre.");
  });
});

describe("validarNumeroPositivo (costo, precio, monto)", () => {
  it.each([["0.01"], [1], ["1500.50"]])("acepta %s", (valor) => {
    expect(validarNumeroPositivo(valor, "El costo")).toBeNull();
  });

  it.each([[0], ["0"], [-1], ["-5.5"]])("rechaza %s por no ser mayor a 0", (valor) => {
    expect(validarNumeroPositivo(valor, "El costo")).toBe("El costo debe ser mayor a 0.");
  });

  it("rechaza lo que no es un número", () => {
    expect(validarNumeroPositivo("abc", "El costo")).toBe("El costo debe ser un número.");
  });

  it("rechaza el valor vacío", () => {
    expect(validarNumeroPositivo("", "El costo")).toBe("Completá el costo.");
  });
});

describe("validarNumeroNoNegativo", () => {
  it("acepta 0 y positivos", () => {
    expect(validarNumeroNoNegativo(0)).toBeNull();
    expect(validarNumeroNoNegativo("2.5")).toBeNull();
  });

  it("rechaza negativos", () => {
    expect(validarNumeroNoNegativo(-0.1, "El precio")).toBe("El precio no puede ser menor a 0.");
  });
});

describe("validarEnteroNoNegativo (stock actual y mínimo)", () => {
  it("acepta 0 y enteros positivos", () => {
    expect(validarEnteroNoNegativo(0)).toBeNull();
    expect(validarEnteroNoNegativo("12")).toBeNull();
  });

  it("rechaza decimales", () => {
    expect(validarEnteroNoNegativo("2.5", "El stock")).toBe("El stock debe ser un número entero.");
  });

  it("rechaza negativos", () => {
    expect(validarEnteroNoNegativo(-1, "El stock")).toBe("El stock no puede ser menor a 0.");
  });

  it("rechaza el valor vacío", () => {
    expect(validarEnteroNoNegativo("", "El stock")).toBe("Completá el stock.");
  });
});

describe("validarEnteroPositivo (cantidades)", () => {
  it("acepta enteros mayores a 0", () => {
    expect(validarEnteroPositivo(1)).toBeNull();
    expect(validarEnteroPositivo("30")).toBeNull();
  });

  it("rechaza 0, negativos y decimales", () => {
    expect(validarEnteroPositivo(0, "La cantidad")).toBe("La cantidad debe ser mayor a 0.");
    expect(validarEnteroPositivo(-2, "La cantidad")).toBe("La cantidad debe ser mayor a 0.");
    expect(validarEnteroPositivo(1.5, "La cantidad")).toBe("La cantidad debe ser un número entero.");
  });
});

describe("validarFecha (aaaa-mm-dd)", () => {
  it("acepta una fecha real", () => {
    expect(validarFecha("2026-03-05")).toBeNull();
  });

  it("rechaza una fecha imposible", () => {
    expect(validarFecha("2026-02-30", "La fecha")).toBe("La fecha no es una fecha válida.");
  });

  it("rechaza el valor vacío", () => {
    expect(validarFecha("", "La fecha")).toBe("Completá la fecha.");
  });
});

describe("validarFechaNoFutura", () => {
  const hoy = new Date(2026, 5, 15, 10, 0);

  it("acepta hoy y días anteriores", () => {
    expect(validarFechaNoFutura("2026-06-15", "La fecha", hoy)).toBeNull();
    expect(validarFechaNoFutura("2025-01-01", "La fecha", hoy)).toBeNull();
  });

  it("rechaza mañana", () => {
    expect(validarFechaNoFutura("2026-06-16", "La fecha", hoy)).toBe("La fecha no puede ser futura.");
  });

  it("primero informa si la fecha no es válida", () => {
    expect(validarFechaNoFutura("2026-02-31", "La fecha", hoy)).toBe("La fecha no es una fecha válida.");
  });
});

describe("precioMenorAlCosto (aviso del modal de productos)", () => {
  it("avisa si el precio es menor al costo", () => {
    expect(precioMenorAlCosto(80, 100)).toBe(true);
    expect(precioMenorAlCosto("99.99", "100")).toBe(true);
  });

  it("no avisa si el precio es igual o mayor", () => {
    expect(precioMenorAlCosto(100, 100)).toBe(false);
    expect(precioMenorAlCosto(150, 100)).toBe(false);
  });

  it("no avisa si falta alguno de los dos valores", () => {
    expect(precioMenorAlCosto("", 100)).toBe(false);
    expect(precioMenorAlCosto(80, "abc")).toBe(false);
  });
});
