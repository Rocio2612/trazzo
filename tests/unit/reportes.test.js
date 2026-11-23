import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  afectadosPorFalla,
  esNegativo,
  estaCaido,
  INDICADORES_ESTADO,
  INDICADORES_PRINCIPALES,
  MENSAJE_DESGLOSE_CAIDO,
  MENSAJE_SIN_DESGLOSE,
  NOTA_DESGLOSE,
  PERIODO_INICIAL,
  PERIODOS,
  SERVICIOS,
  serviciosCaidos,
  textoAvisoParcial,
  textoDePeriodo,
  textoVentasPorSaldar,
  TITULO_DESGLOSE,
  totalDelDesglose,
} from "../../frontend/js/reportes.js";

const TODOS = [...INDICADORES_PRINCIPALES, ...INDICADORES_ESTADO];

describe("períodos y tarjetas", () => {
  it("hay tres períodos: Hoy, Este mes y Este año", () => {
    expect(PERIODOS.map((p) => p.valor)).toEqual(["hoy", "mes", "anio"]);
    expect(textoDePeriodo("mes")).toBe("Este mes");
    expect(textoDePeriodo("anio")).toBe("Este año");
    expect(textoDePeriodo("otro")).toBe("");
  });

  it("hay 7 indicadores principales y 2 de 'Estado actual', sin repetirse", () => {
    expect(INDICADORES_PRINCIPALES).toHaveLength(7);
    expect(INDICADORES_ESTADO).toHaveLength(2);
    expect(new Set(TODOS.map((i) => i.id)).size).toBe(9);
    expect(new Set(TODOS.map((i) => i.campo)).size).toBe(9);
  });

  it("cada tarjeta depende de servicios que existen y tiene título y detalle", () => {
    for (const indicador of TODOS) {
      expect(indicador.titulo).toBeTruthy();
      expect(indicador.detalle).toBeTruthy();
      expect(indicador.depende.length).toBeGreaterThan(0);
      indicador.depende.forEach((servicio) => expect(Object.keys(SERVICIOS)).toContain(servicio));
    }
  });

  it("solo las de 'Estado actual' son 'Al día de hoy' y solo la ganancia neta es la destacada", () => {
    expect(INDICADORES_ESTADO.every((i) => i.alDiaDeHoy)).toBe(true);
    expect(INDICADORES_PRINCIPALES.some((i) => i.alDiaDeHoy)).toBe(false);
    expect(INDICADORES_PRINCIPALES.filter((i) => i.destacado).map((i) => i.id)).toEqual(["ganancia-neta"]);
  });
});

describe("ventas por saldar", () => {
  it("usa singular y plural", () => {
    expect(textoVentasPorSaldar(1)).toBe("1 venta confirmada falta por saldar");
    expect(textoVentasPorSaldar(0)).toBe("0 ventas confirmadas faltan por saldar");
    expect(textoVentasPorSaldar(4)).toBe("4 ventas confirmadas faltan por saldar");
    expect(textoVentasPorSaldar(undefined)).toBe("0 ventas confirmadas faltan por saldar");
  });
});

describe("valores negativos", () => {
  const bruta = INDICADORES_PRINCIPALES.find((i) => i.id === "ganancia-bruta");
  const ingresos = INDICADORES_PRINCIPALES.find((i) => i.id === "ingresos");

  it("una ganancia negativa va en rojo; cero y positiva no", () => {
    expect(esNegativo(bruta, -1)).toBe(true);
    expect(esNegativo(bruta, 0)).toBe(false);
    expect(esNegativo(bruta, 5610)).toBe(false);
  });

  it("las tarjetas que no lo piden nunca van en rojo", () => {
    expect(esNegativo(ingresos, -1)).toBe(false);
  });
});

describe("servicios que fallan", () => {
  it("solo se toman los servicios conocidos", () => {
    expect(serviciosCaidos({ servicios_caidos: ["finanzas", "inventado"] })).toEqual(["finanzas"]);
    expect(serviciosCaidos({})).toEqual([]);
    expect(serviciosCaidos({ servicios_caidos: "finanzas" })).toEqual([]);
    expect(serviciosCaidos(null)).toEqual([]);
  });

  it("una tarjeta está caída si algún servicio del que depende falló", () => {
    const neta = INDICADORES_PRINCIPALES.find((i) => i.id === "ganancia-neta");
    const gastos = INDICADORES_PRINCIPALES.find((i) => i.id === "gastos");
    expect(estaCaido(neta, ["finanzas"])).toBe(true);
    expect(estaCaido(neta, ["transacciones"])).toBe(true);
    expect(estaCaido(neta, ["productos"])).toBe(false);
    expect(estaCaido(gastos, ["transacciones"])).toBe(false);
    expect(estaCaido(gastos, [])).toBe(false);
  });

  it("sin fallas no hay nada afectado", () => {
    expect(afectadosPorFalla([])).toEqual([]);
  });

  it("Finanzas afecta gastos, bienes de uso y ganancia neta", () => {
    expect(afectadosPorFalla(["finanzas"])).toEqual(["Total de gastos operativos", "Inversión realizada en bienes de uso", "Ganancia neta operativa estimada"]);
  });

  it("Productos afecta el inventario y el desglose", () => {
    expect(afectadosPorFalla(["productos"])).toEqual(["Inversión actual en inventario", "Desglose de inversión"]);
  });

  it("Transacciones afecta ventas, ganancias y 'Por cobrar'", () => {
    expect(afectadosPorFalla(["transacciones"])).toEqual([
      "Ingresos",
      "Total vendido y saldado",
      "CMV (Costo de Mercadería Vendida)",
      "Ganancia bruta",
      "Ganancia neta operativa estimada",
      "Por cobrar",
    ]);
  });

  it("el aviso nombra el servicio y lo que no se pudo calcular", () => {
    const texto = textoAvisoParcial(["finanzas"]);
    expect(texto).toContain("falla en el servicio de Finanzas");
    expect(texto).toContain("Total de gastos operativos");
    expect(texto).toContain("Los demás indicadores se muestran con normalidad.");
  });

  it("con dos servicios caídos los nombra a los dos", () => {
    expect(textoAvisoParcial(["finanzas", "productos"])).toContain("servicio de Finanzas y Productos");
  });
});

describe("total del desglose", () => {
  it("suma las inversiones con dos decimales", () => {
    expect(totalDelDesglose([{ inversion: 14880 }, { inversion: 9120 }, { inversion: 1700 }])).toBe(25700);
    expect(totalDelDesglose([{ inversion: 0.1 }, { inversion: 0.2 }])).toBe(0.3);
  });

  it("sin filas es 0", () => {
    expect(totalDelDesglose([])).toBe(0);
    expect(totalDelDesglose(undefined)).toBe(0);
  });
});

// Los datos de ejemplo (mocks/reportes.js) simulan al Backend. Se fija el reloj el 15-11-2026 porque "Hoy", "Este mes" y "Este año"
// dependen de la fecha. Solo se finge la fecha: los temporizadores siguen andando.
describe("datos de ejemplo de Reportes (simulan GET /reportes)", () => {
  let servicioReportes;

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-15T12:00:00"));
    ({ servicioReportes } = await import("../../frontend/js/mocks/reportes.js"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("'Este mes': los números de los ejemplos", async () => {
    const d = await servicioReportes.obtener({ periodo: "mes" });
    expect(d).toMatchObject({
      periodo: "mes",
      servicios_caidos: [],
      ingresos: 11730,
      vendido_saldado: 11730,
      ventas_por_saldar: 1,
      cmv: 10380,
      ganancia_bruta: 5610,
      gastos_operativos: 0,
      bienes_de_uso: 0,
      ganancia_neta: 5610,
      inventario_actual: 241330,
      por_cobrar: 156800,
    });
    expect(d.desglose_inversion.map((f) => f.producto)).toEqual(["Detergente 750 ml", "Lavandina 1 l", "Sifón de soda 1.5 l"]);
  });

  it("'Este año': incluye gastos, bienes de uso e insumos, y la ganancia neta da negativa", async () => {
    const d = await servicioReportes.obtener({ periodo: "anio" });
    expect(d).toMatchObject({ ingresos: 147930, vendido_saldado: 102270, ventas_por_saldar: 4, cmv: 203600, ganancia_bruta: 101130, gastos_operativos: 995051.25, bienes_de_uso: 2967000 });
    // neta = bruta - gastos - insumos (439.700 de insumos)
    expect(d.ganancia_neta).toBe(-1333621.25);
    expect(d.desglose_inversion).toHaveLength(13);
  });

  it("'Hoy': sin movimientos, salvo las compras de hoy en el desglose", async () => {
    const d = await servicioReportes.obtener({ periodo: "hoy" });
    expect([d.ingresos, d.cmv, d.ganancia_bruta, d.gastos_operativos, d.ganancia_neta]).toEqual([0, 0, 0, 0, 0]);
    expect(d.desglose_inversion).toEqual([{ producto: "Sifón de soda 1.5 l", unidades: 2, costo_unitario: 850, inversion: 1700 }]);
  });

  it("las ventas anuladas y los pagos anulados no cuentan; 'Estado actual' no cambia con el período", async () => {
    const [hoy, mes, anio] = await Promise.all(["hoy", "mes", "anio"].map((periodo) => servicioReportes.obtener({ periodo })));
    for (const d of [hoy, mes, anio]) {
      expect(d.inventario_actual).toBe(241330);
      expect(d.por_cobrar).toBe(156800);
    }
    // El pago anulado de $ 5.000 (venta 10, anulada) no está en los ingresos del año.
    expect(anio.ingresos).toBe(147930);
  });

  it("un período inválido se rechaza con error 400", async () => {
    await expect(servicioReportes.obtener({ periodo: "semana" })).rejects.toMatchObject({ status: 400 });
  });

  it("si falla un servicio, lo informa y manda null en lo que depende de él", async () => {
    vi.stubGlobal("sessionStorage", { getItem: (clave) => (clave === "trazzo_reportes_falla" ? "finanzas" : null) });
    const d = await servicioReportes.obtener({ periodo: "mes" });
    expect(d.servicios_caidos).toEqual(["finanzas"]);
    expect([d.gastos_operativos, d.bienes_de_uso, d.ganancia_neta]).toEqual([null, null, null]);
    expect(d.ingresos).toBe(11730);
    expect(d.desglose_inversion).toHaveLength(3);
  });

  it("si falla Productos, el desglose no viene", async () => {
    vi.stubGlobal("sessionStorage", { getItem: () => "productos" });
    const d = await servicioReportes.obtener({ periodo: "mes" });
    expect(d.servicios_caidos).toEqual(["productos"]);
    expect(d.inventario_actual).toBeNull();
    expect(d.desglose_inversion).toBeNull();
  });
});

// --- Casos que faltaban: constantes de la pantalla ---

describe("constantes de Reportes", () => {
  it("la pantalla abre en el período 'Este mes', que es uno de los períodos disponibles", () => {
    expect(PERIODO_INICIAL).toBe("mes");
    expect(PERIODOS.map((p) => p.valor)).toContain(PERIODO_INICIAL);
  });

  it("el desglose tiene título y aclara que el monto no es una pérdida", () => {
    expect(TITULO_DESGLOSE).toBe("Desglose de inversión por producto");
    expect(NOTA_DESGLOSE).toContain("no es una pérdida");
    expect(NOTA_DESGLOSE).toContain("CMV");
  });

  it("el desglose vacío y el desglose caído tienen cada uno su mensaje", () => {
    expect(MENSAJE_SIN_DESGLOSE).toBe("Sin inventario comprado en este período.");
    expect(MENSAJE_DESGLOSE_CAIDO).toBe("No se pudo calcular el desglose: falla en el servicio de Productos.");
    expect(MENSAJE_SIN_DESGLOSE).not.toBe(MENSAJE_DESGLOSE_CAIDO);
  });
});
