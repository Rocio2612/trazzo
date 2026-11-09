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

// ---------------------------------------------------------------------------
// Fechas con hora (TIMESTAMPTZ de la base): se ven en la hora local de quien mira.
// Las pruebas arman las fechas con la hora local para no depender de la zona horaria de la computadora.
// ---------------------------------------------------------------------------

import { fechaDeMarcaParaMostrar, fechaHoraParaMostrar } from "../../frontend/js/formatos.js";

describe("fechaHoraParaMostrar", () => {
  it("muestra día-mes-año y hora:minutos en la hora local", () => {
    expect(fechaHoraParaMostrar(new Date(2026, 2, 5, 8, 30).toISOString())).toBe("05-03-2026 08:30");
  });

  it("rellena con cero el día, el mes, la hora y los minutos", () => {
    expect(fechaHoraParaMostrar(new Date(2026, 0, 2, 3, 4).toISOString())).toBe("02-01-2026 03:04");
  });

  it("la medianoche y el último minuto del día", () => {
    expect(fechaHoraParaMostrar(new Date(2026, 11, 31, 0, 0).toISOString())).toBe("31-12-2026 00:00");
    expect(fechaHoraParaMostrar(new Date(2026, 11, 31, 23, 59).toISOString())).toBe("31-12-2026 23:59");
  });

  it("acepta un objeto Date y un número de milisegundos", () => {
    expect(fechaHoraParaMostrar(new Date(2026, 5, 15, 10, 5))).toBe("15-06-2026 10:05");
    expect(fechaHoraParaMostrar(new Date(2026, 5, 15, 10, 5).getTime())).toBe("15-06-2026 10:05");
  });

  it("un instante con zona (Z o -03:00) se convierte a la hora local, sin importar cómo venga escrito", () => {
    const instante = new Date(2026, 2, 5, 8, 30);
    expect(fechaHoraParaMostrar(instante.toISOString())).toBe(fechaHoraParaMostrar(instante.toISOString().replace("Z", "+00:00")));
  });

  it("un texto solo con el día se toma como ese día a las 00:00, sin correrse por la zona horaria", () => {
    expect(fechaHoraParaMostrar("2026-03-05")).toBe("05-03-2026 00:00");
    expect(fechaDeMarcaParaMostrar("2026-03-05")).toBe("05-03-2026");
    expect(fechaDeMarcaParaMostrar("2026-12-31")).toBe("31-12-2026");
  });

  it.each([[null], [undefined], [""], ["   "], ["hoy"], ["2026-13-45"], [NaN], ["no es una fecha"]])("devuelve vacío si no es una fecha (%j)", (valor) => {
    expect(fechaHoraParaMostrar(valor)).toBe("");
    expect(fechaDeMarcaParaMostrar(valor)).toBe("");
  });
});

describe("fechaDeMarcaParaMostrar", () => {
  it("muestra solo el día", () => {
    expect(fechaDeMarcaParaMostrar(new Date(2026, 2, 5, 23, 59).toISOString())).toBe("05-03-2026");
  });

  it("es el mismo día que la fecha con hora", () => {
    const valor = new Date(2026, 8, 9, 12, 0).toISOString();
    expect(fechaHoraParaMostrar(valor).startsWith(fechaDeMarcaParaMostrar(valor))).toBe(true);
  });
});

describe("fechaHoraParaMostrar: días que no existen", () => {
  it.each([["2026-02-30"], ["2026-04-31"], ["2025-02-29"], ["2026-00-10"], ["2026-12-00"], ["2026-13-01"]])("rechaza %s en vez de corregirla", (valor) => {
    expect(fechaHoraParaMostrar(valor)).toBe("");
  });

  it("acepta el 29 de febrero de un año bisiesto", () => {
    expect(fechaDeMarcaParaMostrar("2024-02-29")).toBe("29-02-2024");
  });
});
