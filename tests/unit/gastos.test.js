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

  it("rechaza una fecha futura (la base exige fecha <= hoy)", () => {
    expect(validarGasto({ ...valido, fecha: "16-06-2026" }, hoy)).toEqual({ fecha: "La fecha no puede ser futura." });
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
  it("sin filtros devuelve todos los gastos", () => {
    expect(filtrarGastos(GASTOS_EJEMPLO)).toHaveLength(7);
  });

  it("el rango de fechas incluye los dos extremos", () => {
    const ids = filtrarGastos(GASTOS_EJEMPLO, { desde: "2026-03-05", hasta: "2026-03-12" }).map((g) => g.id);
    expect(ids).toEqual([2, 3, 4]);
  });
});

describe("resumirGastos (sumatoria del período)", () => {
  it("suma todo lo que hay en el período", () => {
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
    expect(lista).toMatchObject({ total: 7, pagina: 1 });
  });

  it("pagina, busca y filtra", () => {
    expect(listarGastosSimulado(GASTOS_EJEMPLO, { porPagina: 4, pagina: 2 }).items).toHaveLength(3);
    expect(listarGastosSimulado(GASTOS_EJEMPLO, { q: "luz" }).total).toBe(1);
    expect(listarGastosSimulado(GASTOS_EJEMPLO, { desde: "2026-04-01" }).total).toBe(3);
  });

  it("una página inválida se toma como la primera", () => {
    expect(listarGastosSimulado(GASTOS_EJEMPLO, { pagina: -3 }).pagina).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Pruebas ampliadas (casos límite de validación, payload, búsqueda, filtro y resumen)
// ---------------------------------------------------------------------------

describe("validarGasto: fecha", () => {
  it.each([[""], ["   "], [null], [undefined]])("una fecha vacía (%j) pide completarla", (fecha) => {
    expect(validarGasto({ ...valido, fecha }, hoy).fecha).toBe("Completá la fecha.");
  });

  it.each([
    ["00-01-2026"],
    ["32-01-2026"],
    ["15-13-2026"],
    ["29-02-2025"], // 2025 no es bisiesto
    ["2026-02-30"],
    ["2026-13-01"],
    ["05-03-26"],
    ["05/03/2026"],
    ["hoy"],
  ])("rechaza la fecha %s", (fecha) => {
    expect(validarGasto({ ...valido, fecha }, hoy).fecha).toBe("La fecha no es una fecha válida.");
  });

  it.each([["29-02-2024"], ["31-12-1999"], ["2024-02-29"], ["15-06-2026"], ["2026-06-15"]])("acepta la fecha %s (hoy o anterior)", (fecha) => {
    expect(validarGasto({ ...valido, fecha }, hoy)).toEqual({});
  });

  it.each([["16-06-2026"], ["2026-06-16"], ["01-07-2026"], ["01-01-2027"], ["01-01-2099"], ["29-02-2028"]])(
    "rechaza la fecha futura %s",
    (fecha) => {
      expect(validarGasto({ ...valido, fecha }, hoy).fecha).toBe("La fecha no puede ser futura.");
    },
  );

  it("el límite es el día de hoy: ayer y hoy sí, mañana no", () => {
    expect(validarGasto({ ...valido, fecha: "14-06-2026" }, hoy)).toEqual({});
    expect(validarGasto({ ...valido, fecha: "15-06-2026" }, hoy)).toEqual({});
    expect(validarGasto({ ...valido, fecha: "16-06-2026" }, hoy).fecha).toBeDefined();
  });

  it("el día de hoy vale aunque sea a última hora, y el siguiente no, aunque sea a primera hora", () => {
    const tarde = new Date(2026, 5, 15, 23, 59, 59);
    const temprano = new Date(2026, 5, 16, 0, 0, 1);
    expect(validarGasto({ ...valido, fecha: "15-06-2026" }, tarde)).toEqual({});
    expect(validarGasto({ ...valido, fecha: "16-06-2026" }, tarde).fecha).toBeDefined();
    expect(validarGasto({ ...valido, fecha: "16-06-2026" }, temprano)).toEqual({});
  });

  it("una fecha inválida sigue avisando que no es una fecha válida, no que es futura", () => {
    expect(validarGasto({ ...valido, fecha: "31-02-2099" }, hoy).fecha).toBe("La fecha no es una fecha válida.");
    expect(validarGasto({ ...valido, fecha: "" }, hoy).fecha).toBe("Completá la fecha.");
  });

  it("una fecha futura no oculta los errores de los otros campos", () => {
    const errores = validarGasto({ fecha: "01-01-2099", concepto: "", monto: "0" }, hoy);
    expect(Object.keys(errores).sort()).toEqual(["concepto", "fecha", "monto"]);
  });

  it("sin pasar «hoy» usa la fecha real: una fecha lejana en el futuro se rechaza y la de hoy se acepta", () => {
    const ahora = new Date();
    const dd = String(ahora.getDate()).padStart(2, "0");
    const mm = String(ahora.getMonth() + 1).padStart(2, "0");
    expect(validarGasto({ ...valido, fecha: `${dd}-${mm}-${ahora.getFullYear()}` })).toEqual({});
    expect(validarGasto({ ...valido, fecha: "01-01-2099" }).fecha).toBe("La fecha no puede ser futura.");
  });
});

describe("validarGasto: concepto", () => {
  it.each([[""], ["   "], ["\t\n"], [null], [undefined]])("un concepto vacío (%j) pide completarlo", (concepto) => {
    expect(validarGasto({ ...valido, concepto }, hoy).concepto).toBe("Completá el concepto.");
  });

  it.each([["123"], ["Café ñandú"], ["<b>x</b>"], ["a"], ["Alquiler (local) - 50% / mes"]])(
    "acepta el concepto %s",
    (concepto) => {
      expect(validarGasto({ ...valido, concepto }, hoy)).toEqual({});
    },
  );
});

describe("validarGasto: largo del concepto", () => {
  it("acepta un concepto de exactamente 100 caracteres", () => {
    expect(validarGasto({ ...valido, concepto: "a".repeat(100) }, hoy)).toEqual({});
  });

  it("rechaza uno de 101 caracteres", () => {
    expect(validarGasto({ ...valido, concepto: "a".repeat(101) }, hoy).concepto).toBe(
      "El concepto admite hasta 100 caracteres.",
    );
  });

  it("los espacios de los costados no cuentan para el largo", () => {
    expect(validarGasto({ ...valido, concepto: `   ${"a".repeat(100)}   ` }, hoy)).toEqual({});
  });
});

describe("validarGasto: monto", () => {
  it.each([[""], ["   "], [null], [undefined]])("un monto vacío (%j) pide completarlo", (monto) => {
    expect(validarGasto({ ...valido, monto }, hoy).monto).toBe("Completá el monto.");
  });

  it.each([["1,5"], ["+5"], [".5"], ["5."], ["1e3"], ["NaN"], ["Infinity"], ["12abc"], ["1 000"]])(
    "el monto %s no es un número válido",
    (monto) => {
      expect(validarGasto({ ...valido, monto }, hoy).monto).toBe("El monto debe ser un número.");
    },
  );

  it.each([["0.00"], ["-0.01"], ["-1000"]])("el monto %s no es mayor a 0", (monto) => {
    expect(validarGasto({ ...valido, monto }, hoy).monto).toBe("El monto debe ser mayor a 0.");
  });

  it("rechaza más de 2 decimales y montos que no entran en NUMERIC(12,2)", () => {
    expect(validarGasto({ ...valido, monto: "9999999999.999" }, hoy).monto).toBe("El monto admite hasta 2 decimales.");
    expect(validarGasto({ ...valido, monto: "10000000000.00" }, hoy).monto).toBe("El monto es demasiado grande.");
  });

  it("ignora los espacios alrededor y acepta ceros a la izquierda", () => {
    expect(validarGasto({ ...valido, monto: " 100 " }, hoy)).toEqual({});
    expect(validarGasto({ ...valido, monto: "007" }, hoy)).toEqual({});
  });

  it("solo informa el campo que está mal", () => {
    expect(Object.keys(validarGasto({ ...valido, monto: "0" }, hoy))).toEqual(["monto"]);
    expect(Object.keys(validarGasto({ ...valido, concepto: "" }, hoy))).toEqual(["concepto"]);
    expect(Object.keys(validarGasto({ ...valido, fecha: "31-02-2026" }, hoy))).toEqual(["fecha"]);
  });

  it("informa todos los campos mal a la vez", () => {
    expect(Object.keys(validarGasto({ fecha: "x", concepto: " ", monto: "-1" }, hoy)).sort()).toEqual([
      "concepto",
      "fecha",
      "monto",
    ]);
  });
});

describe("armarPayloadGasto: casos límite", () => {
  it("acepta la fecha ya en aaaa-mm-dd y no la modifica", () => {
    expect(armarPayloadGasto({ ...valido, fecha: "2026-03-05" }).fecha).toBe("2026-03-05");
  });

  it("convierte el monto escrito como texto a número", () => {
    expect(armarPayloadGasto({ ...valido, monto: "100.5" }).monto).toBe(100.5);
    expect(armarPayloadGasto({ ...valido, monto: "007" }).monto).toBe(7);
    expect(armarPayloadGasto({ ...valido, monto: " 20 " }).monto).toBe(20);
  });

  it("sin medio de pago (undefined, vacío o null) envía null", () => {
    expect(armarPayloadGasto({ ...valido }).medio_pago_id).toBeNull();
    expect(armarPayloadGasto({ ...valido, medio_pago_id: "" }).medio_pago_id).toBeNull();
    expect(armarPayloadGasto({ ...valido, medio_pago_id: null }).medio_pago_id).toBeNull();
  });

  it("el medio de pago elegido viaja como número entero (la base lo guarda como INT)", () => {
    expect(armarPayloadGasto({ ...valido, medio_pago_id: "3" }).medio_pago_id).toBe(3);
    expect(armarPayloadGasto({ ...valido, medio_pago_id: 3 }).medio_pago_id).toBe(3);
    expect(armarPayloadGasto({ ...valido, medio_pago_id: " 12 " }).medio_pago_id).toBe(12);
  });

  it.each([[""], ["  "], [null], [undefined], ["abc"], ["0"], ["-1"], ["2.5"], [0], [NaN]])(
    "un medio de pago vacío o que no es un id válido (%j) viaja como null",
    (medio_pago_id) => {
      expect(armarPayloadGasto({ ...valido, medio_pago_id }).medio_pago_id).toBeNull();
    },
  );

  it("el medio de pago nunca viaja como texto", () => {
    for (const id of ["1", "2", "15", 7]) expect(typeof armarPayloadGasto({ ...valido, medio_pago_id: id }).medio_pago_id).toBe("number");
  });

  it("recorta el concepto y no toca su contenido", () => {
    expect(armarPayloadGasto({ ...valido, concepto: "  <b>Luz</b> & gas  " }).concepto).toBe("<b>Luz</b> & gas");
  });

  it("no valida: con una fecha inválida la deja en null (por eso se valida antes)", () => {
    expect(armarPayloadGasto({ ...valido, fecha: "31-02-2026" }).fecha).toBeNull();
  });
});

describe("buscarGastos: casos límite", () => {
  it("ignora los espacios alrededor y las mayúsculas", () => {
    expect(buscarGastos(GASTOS_EJEMPLO, "  luz  ").map((g) => g.id)).toEqual([2]);
  });

  it("busca por parte de la palabra", () => {
    expect(buscarGastos(GASTOS_EJEMPLO, "alq").map((g) => g.id)).toEqual([1, 5]);
  });

  it("los símbolos de expresiones regulares se buscan como texto y no rompen", () => {
    expect(() => buscarGastos(GASTOS_EJEMPLO, "(")).not.toThrow();
    expect(buscarGastos(GASTOS_EJEMPLO, ".*")).toEqual([]);
    expect(buscarGastos(GASTOS_EJEMPLO, "[a-z]")).toEqual([]);
    expect(buscarGastos([{ concepto: "Pago (cuota 1/3)", monto: "1.00" }], "(cuota")).toHaveLength(1);
  });

  it("un gasto sin medio de pago ni concepto no rompe la búsqueda", () => {
    expect(buscarGastos([{ concepto: null, medio_pago_nombre: null }], "x")).toEqual([]);
    expect(buscarGastos([{ monto: "1.00" }], "x")).toEqual([]);
  });

  it("no distingue tildes: ni las del texto buscado ni las del gasto", () => {
    expect(buscarGastos(GASTOS_EJEMPLO, "reparacion").map((g) => g.id)).toEqual([7]);
    expect(buscarGastos(GASTOS_EJEMPLO, "REPARACIÓN").map((g) => g.id)).toEqual([7]);
    expect(buscarGastos(GASTOS_EJEMPLO, "viaticos").map((g) => g.id)).toEqual([6]);
    expect(buscarGastos(GASTOS_EJEMPLO, "alquilér").map((g) => g.id)).toEqual([1, 5]);
  });

  it("la ñ y la ü se comparan sin acento pero siguen funcionando", () => {
    const gastos = [{ concepto: "Cañería", monto: "1.00" }, { concepto: "Pingüino", monto: "1.00" }];
    expect(buscarGastos(gastos, "caneria")).toHaveLength(1);
    expect(buscarGastos(gastos, "pinguino")).toHaveLength(1);
    expect(buscarGastos(gastos, "cañería")).toHaveLength(1);
  });

  it("busca por el medio de pago sin distinguir tildes", () => {
    const gastos = [{ concepto: "Pago", monto: "1.00", medio_pago_nombre: "Débito" }];
    expect(buscarGastos(gastos, "debito")).toHaveLength(1);
  });

  it("null o undefined como texto devuelven todo", () => {
    expect(buscarGastos(GASTOS_EJEMPLO, null)).toHaveLength(7);
    expect(buscarGastos(GASTOS_EJEMPLO, undefined)).toHaveLength(7);
  });

  it("no modifica la lista original", () => {
    const copia = JSON.stringify(GASTOS_EJEMPLO);
    buscarGastos(GASTOS_EJEMPLO, "luz");
    expect(JSON.stringify(GASTOS_EJEMPLO)).toBe(copia);
  });
});

describe("filtrarGastos: casos límite", () => {
  it("solo con desde, incluye ese día y los posteriores", () => {
    expect(filtrarGastos(GASTOS_EJEMPLO, { desde: "2026-04-02" }).map((g) => g.id)).toEqual([6, 7]);
  });

  it("solo con hasta, incluye ese día y los anteriores", () => {
    expect(filtrarGastos(GASTOS_EJEMPLO, { hasta: "2026-03-05" }).map((g) => g.id)).toEqual([1, 2, 3]);
  });

  it("con desde mayor que hasta no devuelve nada", () => {
    expect(filtrarGastos(GASTOS_EJEMPLO, { desde: "2026-04-01", hasta: "2026-03-01" })).toEqual([]);
  });

  it("un día sin gastos devuelve vacío", () => {
    expect(filtrarGastos(GASTOS_EJEMPLO, { desde: "2026-03-20", hasta: "2026-03-20" })).toEqual([]);
  });
});

describe("resumirGastos: casos límite", () => {
  it("ignora los gastos con un monto que no es número", () => {
    const gastos = [
      { fecha: "2026-03-01", monto: "10.00" },
      { fecha: "2026-03-01", monto: "abc" },
      { fecha: "2026-03-01", monto: undefined },
      { fecha: "2026-03-01", monto: "5.50" },
    ];
    expect(resumirGastos(gastos)).toMatchObject({ total: 15.5, cantidad: 2 });
  });

  it("devuelve null en desde y hasta cuando no se pasan, y agrupa por día por defecto", () => {
    expect(resumirGastos(GASTOS_EJEMPLO)).toMatchObject({ desde: null, hasta: null, agrupar: "dia" });
  });

  it("suma muchos montos chicos sin errores de decimales", () => {
    const gastos = Array.from({ length: 100 }, () => ({ fecha: "2026-03-01", monto: "0.10" }));
    expect(resumirGastos(gastos).total).toBe(10);
  });

  it("suma el monto máximo permitido más un centavo sin perder precisión", () => {
    const gastos = [
      { fecha: "2026-03-01", monto: "9999999999.99" },
      { fecha: "2026-03-01", monto: "0.01" },
    ];
    expect(resumirGastos(gastos).total).toBe(10000000000);
  });

  it("separa el mismo mes de años distintos", () => {
    const gastos = [
      { fecha: "2025-12-31", monto: "1.00" },
      { fecha: "2026-12-01", monto: "2.00" },
    ];
    expect(resumirGastos(gastos, { agrupar: "mes" }).periodos.map((p) => p.periodo)).toEqual(["2025-12", "2026-12"]);
    expect(resumirGastos(gastos, { agrupar: "anio" }).periodos).toHaveLength(2);
  });

  it("no modifica la lista que recibe", () => {
    const gastos = Object.freeze(GASTOS_EJEMPLO.map((g) => Object.freeze({ ...g })));
    expect(() => resumirGastos(gastos, { agrupar: "mes" })).not.toThrow();
  });
});

describe("etiquetaPeriodo: casos límite", () => {
  it("rellena con cero el día y el mes", () => {
    expect(etiquetaPeriodo("2026-01-09", "dia")).toBe("09-01-2026");
    expect(etiquetaPeriodo("2026-01", "mes")).toBe("01-2026");
    expect(etiquetaPeriodo("2025-12", "mes")).toBe("12-2025");
  });
});

describe("listarGastosSimulado: casos límite", () => {
  it("una página más allá del final devuelve la lista vacía pero conserva el total", () => {
    expect(listarGastosSimulado(GASTOS_EJEMPLO, { porPagina: 4, pagina: 5 })).toMatchObject({ items: [], total: 7, pagina: 5 });
  });

  it("combina búsqueda y rango de fechas", () => {
    const lista = listarGastosSimulado(GASTOS_EJEMPLO, { q: "alquiler", desde: "2026-04-01" });
    expect(lista.items.map((g) => g.id)).toEqual([5]);
    expect(lista.total).toBe(1);
  });

  it("una página que no es número se toma como la primera", () => {
    expect(listarGastosSimulado(GASTOS_EJEMPLO, { pagina: "abc" }).pagina).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Nombres de campo de la base: creado_por / modificado_por (texto) en gastos.
// ---------------------------------------------------------------------------

describe("datos simulados con los nombres de la base", () => {
  it("creado_por es el nombre del usuario (texto) y no hay creado_por_nombre ni ids sueltos", () => {
    GASTOS_EJEMPLO.forEach((g) => {
      expect(typeof g.creado_por).toBe("string");
      expect(g.creado_por.length).toBeGreaterThan(0);
      expect(g).not.toHaveProperty("creado_por_nombre");
      expect(g).not.toHaveProperty("modificado_por_nombre");
    });
  });

  it("un gasto sin editar tiene modificado_por y modificado_en vacíos", () => {
    GASTOS_EJEMPLO.forEach((g) => {
      expect(g.modificado_por).toBeNull();
      expect(g.modificado_en).toBeNull();
      expect(g.creado_en).toBeTruthy();
    });
  });

  it("los campos de auditoría que usa la pantalla existen en todos los gastos", () => {
    GASTOS_EJEMPLO.forEach((g) => {
      for (const campo of ["id", "fecha", "concepto", "monto", "medio_pago_id", "creado_por", "creado_en", "modificado_por", "modificado_en"]) {
        expect(g, campo).toHaveProperty(campo);
      }
    });
  });
});
