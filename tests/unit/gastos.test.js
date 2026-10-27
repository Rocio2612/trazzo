import { describe, expect, it } from "vitest";
import {
  armarPayloadGasto,
  buscarGastos,
  etiquetaPeriodo,
  filtrarGastos,
  resumirGastos,
  validarGasto,
} from "../../frontend/js/gastos.js";
import { GASTOS_EJEMPLO, listarGastosSimulado } from "../../frontend/js/mocks/gastos.js";

const hoy = new Date(2026, 5, 15, 10, 0);
const valido = { fecha: "05-03-2026", concepto: "Luz", monto: "38250.50" };

describe("validarGasto", () => {
  it("acepta un gasto completo, con la fecha en dd-mm-aaaa", () => {
    expect(validarGasto(valido, hoy)).toEqual({});
  });

  it("acepta la fecha en aaaa-mm-dd (input de tipo date)", () => {
    expect(validarGasto({ ...valido, fecha: "2026-03-05" }, hoy)).toEqual({});
  });

  it("el medio de pago es opcional", () => {
    expect(validarGasto({ ...valido, medio_pago_id: null }, hoy)).toEqual({});
    expect(validarGasto({ ...valido, medio_pago_id: 3 }, hoy)).toEqual({});
  });

  it("marca como faltantes los tres obligatorios", () => {
    expect(validarGasto({}, hoy)).toEqual({
      fecha: "Completá la fecha.",
      concepto: "Completá el concepto.",
      monto: "Completá el monto.",
    });
  });

  it("un concepto con solo espacios cuenta como vacío", () => {
    expect(validarGasto({ ...valido, concepto: "   " }, hoy).concepto).toBe("Completá el concepto.");
  });

  it("rechaza una fecha inexistente o con otro formato", () => {
    expect(validarGasto({ ...valido, fecha: "31-02-2026" }, hoy).fecha).toBe("La fecha no es una fecha válida.");
    expect(validarGasto({ ...valido, fecha: "5/3/2026" }, hoy).fecha).toBe("La fecha no es una fecha válida.");
  });

  it("rechaza una fecha futura", () => {
    expect(validarGasto({ ...valido, fecha: "16-06-2026" }, hoy).fecha).toBe("La fecha no puede ser futura.");
  });

  it("acepta la fecha de hoy", () => {
    expect(validarGasto({ ...valido, fecha: "15-06-2026" }, hoy)).toEqual({});
  });

  it.each([
    ["0", "El monto debe ser mayor a 0."],
    ["-50", "El monto debe ser mayor a 0."],
    ["abc", "El monto debe ser un número."],
    ["10.123", "El monto admite hasta 2 decimales."],
    ["10000000000", "El monto es demasiado grande."],
  ])("rechaza el monto %s", (monto, mensaje) => {
    expect(validarGasto({ ...valido, monto }, hoy).monto).toBe(mensaje);
  });

  it("acepta montos con 1 o 2 decimales y el máximo de NUMERIC(12,2)", () => {
    expect(validarGasto({ ...valido, monto: "0.01" }, hoy)).toEqual({});
    expect(validarGasto({ ...valido, monto: "100.5" }, hoy)).toEqual({});
    expect(validarGasto({ ...valido, monto: "9999999999.99" }, hoy)).toEqual({});
  });
});

describe("armarPayloadGasto", () => {
  it("convierte la fecha a aaaa-mm-dd y el monto a número", () => {
    expect(armarPayloadGasto({ fecha: "05-03-2026", concepto: " Luz ", monto: "38250.50" })).toEqual({
      fecha: "2026-03-05",
      concepto: "Luz",
      monto: 38250.5,
      medio_pago_id: null,
    });
  });

  it("deja pasar el medio de pago elegido y trata el vacío como sin medio de pago", () => {
    expect(armarPayloadGasto({ ...valido, medio_pago_id: 2 }).medio_pago_id).toBe(2);
    expect(armarPayloadGasto({ ...valido, medio_pago_id: "" }).medio_pago_id).toBeNull();
  });

  it("no envía quién lo creó ni totales: eso lo resuelve el Backend", () => {
    const payload = armarPayloadGasto({ ...valido, creado_por: 99, total: 1 });
    expect(Object.keys(payload).sort()).toEqual(["concepto", "fecha", "medio_pago_id", "monto"]);
  });
});

describe("buscarGastos", () => {
  it("busca por concepto sin distinguir mayúsculas", () => {
    expect(buscarGastos(GASTOS_EJEMPLO, "ALQUILER").map((g) => g.id)).toEqual([1, 5]);
  });

  it("busca también por medio de pago", () => {
    const gastos = [{ id: 1, concepto: "Luz", monto: "1.00", medio_pago_nombre: "Transferencia" }];
    expect(buscarGastos(gastos, "transfer")).toHaveLength(1);
  });

  it("sin texto devuelve todo y sin coincidencias devuelve vacío", () => {
    expect(buscarGastos(GASTOS_EJEMPLO, "  ")).toHaveLength(GASTOS_EJEMPLO.length);
    expect(buscarGastos(GASTOS_EJEMPLO, "zzz")).toEqual([]);
  });
});

describe("filtrarGastos", () => {
  it("por defecto oculta los gastos ocultos", () => {
    const ids = filtrarGastos(GASTOS_EJEMPLO).map((g) => g.id);
    expect(ids).not.toContain(7);
    expect(ids).toHaveLength(6);
  });

  it("con ocultos: true muestra solo los ocultos", () => {
    expect(filtrarGastos(GASTOS_EJEMPLO, { ocultos: true }).map((g) => g.id)).toEqual([7]);
  });

  it("el rango de fechas incluye los dos extremos", () => {
    const ids = filtrarGastos(GASTOS_EJEMPLO, { desde: "2026-03-05", hasta: "2026-03-12" }).map((g) => g.id);
    expect(ids).toEqual([2, 3, 4]);
  });
});

describe("resumirGastos (sumatoria del período)", () => {
  it("suma todo lo que hay en el período, incluidos los gastos ocultos", () => {
    const resumen = resumirGastos(GASTOS_EJEMPLO);
    expect(resumen.total).toBe(450000 + 38250.5 + 21000 + 15500.75 + 450000 + 8300 + 12000);
    expect(resumen.cantidad).toBe(7);
  });

  it("agrupa por día", () => {
    const { periodos } = resumirGastos(GASTOS_EJEMPLO, { agrupar: "dia", desde: "2026-03-01", hasta: "2026-03-31" });
    expect(periodos).toEqual([
      { periodo: "2026-03-01", total: 450000, cantidad: 1 },
      { periodo: "2026-03-05", total: 59250.5, cantidad: 2 },
      { periodo: "2026-03-12", total: 15500.75, cantidad: 1 },
    ]);
  });

  it("agrupa por mes", () => {
    const { periodos } = resumirGastos(GASTOS_EJEMPLO, { agrupar: "mes" });
    expect(periodos).toEqual([
      { periodo: "2026-03", total: 524751.25, cantidad: 4 },
      { periodo: "2026-04", total: 470300, cantidad: 3 },
    ]);
  });

  it("agrupa por año", () => {
    const { periodos, total } = resumirGastos(GASTOS_EJEMPLO, { agrupar: "anio" });
    expect(periodos).toEqual([{ periodo: "2026", total, cantidad: 7 }]);
  });

  it("ordena los períodos de menor a mayor aunque los gastos vengan desordenados", () => {
    const desordenados = [
      { fecha: "2026-05-01", monto: "1.00" },
      { fecha: "2025-12-31", monto: "2.00" },
      { fecha: "2026-01-15", monto: "3.00" },
    ];
    expect(resumirGastos(desordenados, { agrupar: "mes" }).periodos.map((p) => p.periodo)).toEqual([
      "2025-12",
      "2026-01",
      "2026-05",
    ]);
  });

  it("respeta desde y hasta, incluyendo los extremos", () => {
    const resumen = resumirGastos(GASTOS_EJEMPLO, { desde: "2026-03-05", hasta: "2026-03-05" });
    expect(resumen.total).toBe(59250.5);
    expect(resumen.cantidad).toBe(2);
  });

  it("sin gastos en el período el total es 0", () => {
    expect(resumirGastos(GASTOS_EJEMPLO, { desde: "2030-01-01" })).toMatchObject({ total: 0, cantidad: 0, periodos: [] });
    expect(resumirGastos([]).total).toBe(0);
  });

  it("no arrastra errores de decimales al sumar", () => {
    const gastos = [
      { fecha: "2026-03-01", monto: "0.10" },
      { fecha: "2026-03-01", monto: "0.20" },
    ];
    expect(resumirGastos(gastos).total).toBe(0.3);
  });

  it("editar el monto o la fecha de un gasto cambia la sumatoria", () => {
    const antes = resumirGastos(GASTOS_EJEMPLO, { agrupar: "mes" });
    const editados = GASTOS_EJEMPLO.map((g) => (g.id === 2 ? { ...g, monto: "50000.00", fecha: "2026-04-05" } : g));
    const despues = resumirGastos(editados, { agrupar: "mes" });

    expect(despues.total).toBe(antes.total - 38250.5 + 50000);
    expect(despues.periodos.find((p) => p.periodo === "2026-03").total).toBe(524751.25 - 38250.5);
    expect(despues.periodos.find((p) => p.periodo === "2026-04").total).toBe(470300 + 50000);
  });

  it("eliminar un gasto lo saca de la sumatoria", () => {
    const sinLuz = GASTOS_EJEMPLO.filter((g) => g.id !== 2);
    expect(resumirGastos(sinLuz).total).toBe(resumirGastos(GASTOS_EJEMPLO).total - 38250.5);
  });

  it("ocultar un gasto no cambia la sumatoria", () => {
    const luzOculta = GASTOS_EJEMPLO.map((g) => (g.id === 2 ? { ...g, oculto: true } : g));
    expect(resumirGastos(luzOculta).total).toBe(resumirGastos(GASTOS_EJEMPLO).total);
  });

  it("rechaza una agrupación que no existe", () => {
    expect(() => resumirGastos(GASTOS_EJEMPLO, { agrupar: "semana" })).toThrow(RangeError);
  });
});

describe("etiquetaPeriodo", () => {
  it("muestra cada agrupación con su formato", () => {
    expect(etiquetaPeriodo("2026-03-05", "dia")).toBe("05-03-2026");
    expect(etiquetaPeriodo("2026-03", "mes")).toBe("03-2026");
    expect(etiquetaPeriodo("2026", "anio")).toBe("2026");
  });
});

describe("datos simulados", () => {
  it("todos los gastos de ejemplo cumplen las reglas del formulario", () => {
    GASTOS_EJEMPLO.forEach((g) => {
      expect(validarGasto({ fecha: g.fecha, concepto: g.concepto, monto: g.monto }, hoy)).toEqual({});
    });
  });

  it("la lista simulada tiene el formato { items, total, pagina }", () => {
    const lista = listarGastosSimulado(GASTOS_EJEMPLO);
    expect(Object.keys(lista).sort()).toEqual(["items", "pagina", "total"]);
    expect(lista).toMatchObject({ total: 6, pagina: 1 });
  });

  it("pagina, busca y filtra", () => {
    expect(listarGastosSimulado(GASTOS_EJEMPLO, { porPagina: 4, pagina: 2 }).items).toHaveLength(2);
    expect(listarGastosSimulado(GASTOS_EJEMPLO, { q: "luz" }).total).toBe(1);
    expect(listarGastosSimulado(GASTOS_EJEMPLO, { ocultos: true }).total).toBe(1);
    expect(listarGastosSimulado(GASTOS_EJEMPLO, { desde: "2026-04-01" }).total).toBe(2);
  });

  it("una página inválida se toma como la primera", () => {
    expect(listarGastosSimulado(GASTOS_EJEMPLO, { pagina: -3 }).pagina).toBe(1);
  });
});
