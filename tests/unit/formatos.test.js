import { describe, expect, it } from "vitest";
import {
  aNumero,
  fechaIsoDeHoy,
  fechaParaEnviar,
  fechaParaMostrar,
  formatearDinero,
} from "../../frontend/js/formatos.js";

// Intl usa un espacio sin separación entre el símbolo y el número.
const sinEspaciosEspeciales = (texto) => texto.replace(/ /g, " ");

describe("fechaParaMostrar (aaaa-mm-dd -> dd-mm-aaaa)", () => {
  it("convierte una fecha del Backend", () => {
    expect(fechaParaMostrar("2026-03-05")).toBe("05-03-2026");
  });

  it("acepta una fecha con hora y no le aplica la zona horaria", () => {
    expect(fechaParaMostrar("2026-03-05T23:30:00Z")).toBe("05-03-2026");
  });

  it("acepta el 29 de febrero solo en año bisiesto", () => {
    expect(fechaParaMostrar("2028-02-29")).toBe("29-02-2028");
    expect(fechaParaMostrar("2026-02-29")).toBe("");
  });

  it.each([["2026-02-30"], ["2026-13-01"], ["2026-00-10"], ["05-03-2026"], ["abc"], [""], [null], [undefined]])(
    "devuelve vacío si no es una fecha válida (%s)",
    (valor) => {
      expect(fechaParaMostrar(valor)).toBe("");
    },
  );
});

describe("fechaParaEnviar (dd-mm-aaaa -> aaaa-mm-dd)", () => {
  it("convierte lo que escribe el usuario", () => {
    expect(fechaParaEnviar("05-03-2026")).toBe("2026-03-05");
  });

  it("ignora espacios alrededor", () => {
    expect(fechaParaEnviar("  05-03-2026 ")).toBe("2026-03-05");
  });

  it.each([["31-02-2026"], ["29-02-2026"], ["00-03-2026"], ["05-13-2026"], ["5-3-2026"], ["2026-03-05"], ["05/03/2026"], [""], [null]])(
    "devuelve null si no es una fecha válida (%s)",
    (valor) => {
      expect(fechaParaEnviar(valor)).toBeNull();
    },
  );

  it("ida y vuelta devuelve la misma fecha", () => {
    expect(fechaParaEnviar(fechaParaMostrar("2026-12-31"))).toBe("2026-12-31");
  });
});

describe("fechaIsoDeHoy", () => {
  it("usa el día local y completa con ceros", () => {
    expect(fechaIsoDeHoy(new Date(2026, 0, 7, 23, 59))).toBe("2026-01-07");
  });
});

describe("formatearDinero (es-AR)", () => {
  it("usa punto para los miles y coma para los decimales", () => {
    expect(sinEspaciosEspeciales(formatearDinero(1234.5))).toBe("$ 1.234,50");
    expect(sinEspaciosEspeciales(formatearDinero(1234567.89))).toBe("$ 1.234.567,89");
  });

  it("muestra siempre dos decimales", () => {
    expect(sinEspaciosEspeciales(formatearDinero(0))).toBe("$ 0,00");
    expect(sinEspaciosEspeciales(formatearDinero(10))).toBe("$ 10,00");
  });

  it("acepta el texto numérico que manda el Backend", () => {
    expect(sinEspaciosEspeciales(formatearDinero("1500.00"))).toBe("$ 1.500,00");
  });

  it("muestra los negativos con signo", () => {
    expect(sinEspaciosEspeciales(formatearDinero(-1234.5))).toBe("-$ 1.234,50");
  });

  it.each([[""], ["abc"], [null], [undefined], [NaN], [Infinity]])("devuelve vacío si no es un número (%s)", (valor) => {
    expect(formatearDinero(valor)).toBe("");
  });
});

describe("aNumero", () => {
  it.each([
    ["12", 12],
    [" 12.5 ", 12.5],
    ["-3", -3],
    [7, 7],
  ])("convierte %s", (valor, esperado) => {
    expect(aNumero(valor)).toBe(esperado);
  });

  it.each([[""], ["1,5"], ["1e3"], ["12abc"], [null], [undefined], [{}]])("devuelve NaN si no es un número (%s)", (valor) => {
    expect(aNumero(valor)).toBeNaN();
  });
});
