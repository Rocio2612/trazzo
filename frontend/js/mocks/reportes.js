// --- DATOS SIMULADOS DE REPORTES (solo para los tests) ---
// Simulan lo que calcularía el Backend a partir de Ventas, Cuenta Corriente, Productos, Bienes de Uso, Insumos y Gastos:
//   GET /reportes?periodo=hoy|mes|anio  ->  respuesta de `servicioReportes.obtener` (ver abajo)
// Solo el Admin entra a Reportes (el Backend responde 403 al Cajero). Los nombres de campo son provisorios hasta cerrar el contrato con Back.
// Todo es de solo lectura. Los ejemplos son los mismos del prototipo: las compras de productos (reposiciones) se arman con la fecha de
// hoy y el resto lleva fechas fijas de 2026.
//
// Respuesta: { periodo, servicios_caidos: [], ingresos, vendido_saldado, ventas_por_saldar, cmv, ganancia_bruta,
//              gastos_operativos, bienes_de_uso, ganancia_neta, inventario_actual, por_cobrar,
//              desglose_inversion: [ { producto, unidades, costo_unitario, inversion } ] }
// Si un servicio interno falla, el Backend lo lista en `servicios_caidos` ("transacciones", "finanzas" o "productos") y manda
// `null` en lo que depende de él. Para probarlo: sessionStorage["trazzo_reportes_falla"] = "finanzas" (o el que sea).

import { fechaIsoDeHoy } from "../formatos.js";

const MEDIO_SALDO_A_FAVOR = "Saldo a favor";
const CLAVE_FALLA = "trazzo_reportes_falla";
const PERIODOS = ["hoy", "mes", "anio"];

const redondear = (n) => Math.round(n * 100) / 100;
const suma = (lista, valorDe) => redondear(lista.reduce((total, x) => total + valorDe(x), 0));

const HOY = fechaIsoDeHoy();
const fechaRelativa = ({ dias = 0, meses = 0, anios = 0 } = {}) => {
  const f = new Date();
  f.setFullYear(f.getFullYear() + anios, f.getMonth() + meses, f.getDate() + dias);
  return fechaIsoDeHoy(f);
};
// Las unidades sin compra registrada se toman como stock inicial, cargado al empezar el año.
const FECHA_STOCK_INICIAL = `${HOY.slice(0, 4)}-01-01`;

const enPeriodo = (iso, periodo) => {
  if (!iso) return true;
  if (periodo === "hoy") return iso === HOY;
  if (periodo === "mes") return iso.slice(0, 7) === HOY.slice(0, 7);
  return iso.slice(0, 4) === HOY.slice(0, 4);
};

// --- Datos de ejemplo --------------------------------------------------------------------------------
// [nombre, costo, stock]
const PRODUCTOS = [
  [1, "Sifón de soda 1.5 l", 850, 2],
  [2, "Bidón de agua 20 l", 1400, 0],
  [3, "Detergente 750 ml", 620, 24],
  [4, "Lavandina 1 l", 380, 40],
  [5, "Bolsas de residuos x10", 450, 18],
  [6, "Vaso descartable x50", 900, 12],
  [7, "Jabón líquido 500 ml", 540, 30],
  [8, "Esponja x3", 210, 55],
  [9, "Papel higiénico x4", 780, 26],
  [10, "Yerba mate 1 kg", 2100, 15],
  [11, "Azúcar 1 kg", 700, 33],
  [12, "Aceite 900 ml", 1900, 21],
  [13, "Fideos 500 g", 480, 44],
  [14, "Gaseosa cola 2.25 l", 1500, 18],
].map(([id, nombre, costo, stock]) => ({ id, nombre, costo, stock }));

// [producto_id, cantidad, cuándo]
const REPOSICIONES = [
  [1, 12, { dias: 0 }], [2, 6, { dias: 0 }], [4, 24, { dias: -3 }], [3, 36, { dias: -9 }], [10, 12, { dias: -15 }],
  [1, 20, { dias: -20 }], [12, 12, { meses: -1 }], [14, 24, { meses: -2 }], [4, 30, { meses: -3 }], [6, 20, { meses: -5 }],
  [9, 40, { meses: -7 }], [1, 18, { anios: -1 }], [2, 10, { anios: -1, meses: -2 }], [4, 20, { anios: -1, meses: -4 }],
].map(([producto_id, cantidad, cuando], i) => ({ id: i + 1, producto_id, cantidad, fecha: fechaRelativa(cuando) }));

// Ventas: items [producto, precio, cantidad]. Son las mismas del módulo de Ventas y Cuenta Corriente (fechas fijas).
// Los pagos con medio "Saldo a favor" no son ingresos.
const VENTAS = [
  { id: 1, tipo: "CUENTA_CORRIENTE", iso: "2026-10-06", items: [["Gaseosa cola 2.25 l", 2300, 24], ["Yerba mate 1 kg", 3100, 10], ["Aceite 900 ml", 2700, 6]] },
  { id: 2, tipo: "CUENTA_CORRIENTE", iso: "2026-10-20", items: [["Aceite 900 ml", 2700, 12], ["Fideos 500 g", 760, 30], ["Azúcar 1 kg", 1050, 20]] },
  { id: 3, tipo: "CUENTA_CORRIENTE", iso: "2026-10-12", items: [["Sifón de soda 1.5 l", 1200, 6], ["Vaso descartable x50", 1350, 4], ["Bolsas de residuos x10", 700, 10]] },
  { id: 4, tipo: "CUENTA_CORRIENTE", iso: "2026-09-20", items: [["Detergente 750 ml", 980, 10], ["Lavandina 1 l", 590, 10]] },
  { id: 5, tipo: "CUENTA_CORRIENTE", iso: "2026-10-02", items: [["Azúcar 1 kg", 1050, 40], ["Aceite 900 ml", 2700, 10]] },
  { id: 6, tipo: "CUENTA_CORRIENTE", iso: "2026-10-18", items: [["Jabón líquido 500 ml", 890, 4], ["Esponja x3", 380, 6]] },
  { id: 7, tipo: "CUENTA_CORRIENTE", iso: "2026-11-03", items: [["Lavandina 1 l", 590, 4], ["Esponja x3", 380, 5]] },
  { id: 8, tipo: "CONTADO", iso: "2026-11-05", items: [["Papel higiénico x4", 1190, 2], ["Vaso descartable x50", 1350, 1]] },
  { id: 9, tipo: "CONTADO", iso: "2026-11-06", items: [["Bidón de agua 20 l", 2200, 2], ["Sifón de soda 1.5 l", 1200, 3]] },
  { id: 10, tipo: "CUENTA_CORRIENTE", iso: "2026-10-28", anulada: true, items: [["Yerba mate 1 kg", 3100, 5]] },
].map((v) => ({ ...v, anulada: Boolean(v.anulada) }));

// [venta_id, monto, medio, fecha, anulado]
const PAGOS = [
  [1, 40000, "Transferencia", "2026-10-10"], [3, 5000, "Efectivo", "2026-10-15"], [4, 10000, "Efectivo", "2026-09-25"], [4, 5700, "Transferencia", "2026-10-02"],
  [5, 69000, "Transferencia", "2026-10-05"], [6, 6500, "Efectivo", "2026-10-20"], [8, 3730, "Efectivo", "2026-11-05"], [9, 8000, "Tarjeta de débito", "2026-11-06"],
  [10, 5000, "Efectivo", "2026-10-29", true],
].map(([venta_id, monto, medio_pago, iso, anulado]) => ({ venta_id, monto, medio_pago, iso, anulado: Boolean(anulado) }));

// [monto, fecha]. Ocultar un gasto no cambia los reportes: se sigue contando (el último está oculto).
const GASTOS = [[450000, "2026-03-01"], [38250.5, "2026-03-05"], [21000, "2026-03-05"], [15500.75, "2026-03-12"], [450000, "2026-04-01"], [8300, "2026-04-02"], [12000, "2026-04-10"]].map(([monto, iso]) => ({ monto, iso }));

// [costo, cantidad, fecha]
const INSUMOS = [
  [8500, 5, "2026-03-04"], [120, 500, "2026-03-10"], [2300, 6, "2026-03-12"], [450, 40, "2026-03-20"], [950, 20, "2026-03-02"], [1100, 24, "2026-03-06"],
  [85, 1000, "2026-03-08"], [60, 2000, "2026-03-09"], [1800, 10, "2026-03-11"], [3200, 5, "2026-03-14"], [700, 30, "2026-03-18"],
].map(([costo, cantidad, iso]) => ({ costo, cantidad, iso }));

// [valor, cantidad, fecha de compra]
const BIENES = [
  [850000, 1, "2026-02-12"], [95000, 2, "2026-03-03"], [320000, 1, "2026-01-15"], [150000, 1, "2025-12-10"], [60000, 1, "2025-11-05"], [420000, 1, "2026-01-12"],
  [85000, 1, "2026-01-20"], [65000, 4, "2026-02-05"], [580000, 1, "2026-02-28"], [22000, 6, "2026-03-02"], [130000, 1, "2026-03-14"], [18000, 2, "2025-11-15"],
].map(([valor, cantidad, iso]) => ({ valor, cantidad, iso }));

// --- Cálculo (lo que haría el Backend) ----------------------------------------------------------------
const productoPorNombre = (nombre) => PRODUCTOS.find((p) => p.nombre === nombre);
const totalVenta = (v) => suma(v.items, ([, precio, cantidad]) => precio * cantidad);
const saldoVenta = (v) => redondear(totalVenta(v) - suma(PAGOS.filter((p) => p.venta_id === v.id && !p.anulado), (p) => p.monto));
const costoVenta = (v) => suma(v.items, ([nombre, , cantidad]) => (productoPorNombre(nombre)?.costo ?? 0) * cantidad);

const calcular = (periodo) => {
  const confirmadas = VENTAS.filter((v) => !v.anulada && enPeriodo(v.iso, periodo));
  const cmv = suma(confirmadas, costoVenta);
  const gananciaBruta = redondear(suma(confirmadas, totalVenta) - cmv);
  const gastos = suma(GASTOS.filter((g) => enPeriodo(g.iso, periodo)), (g) => g.monto);
  const insumos = suma(INSUMOS.filter((i) => enPeriodo(i.iso, periodo)), (i) => i.costo * i.cantidad);
  return {
    ingresos: suma(PAGOS.filter((p) => !p.anulado && p.medio_pago !== MEDIO_SALDO_A_FAVOR && enPeriodo(p.iso, periodo)), (p) => p.monto),
    vendido_saldado: suma(confirmadas.filter((v) => saldoVenta(v) <= 0), totalVenta),
    ventas_por_saldar: confirmadas.filter((v) => saldoVenta(v) > 0).length,
    cmv,
    ganancia_bruta: gananciaBruta,
    gastos_operativos: gastos,
    bienes_de_uso: suma(BIENES.filter((b) => enPeriodo(b.iso, periodo)), (b) => b.valor * b.cantidad),
    ganancia_neta: redondear(gananciaBruta - gastos - insumos),
    inventario_actual: suma(PRODUCTOS, (p) => p.stock * p.costo),
    por_cobrar: suma(VENTAS.filter((v) => !v.anulada && v.tipo === "CUENTA_CORRIENTE"), saldoVenta),
  };
};

// El stock actual se atribuye a las compras más recientes de cada producto; en el período se cuentan las unidades
// que siguen en stock y se compraron en ese período.
const calcularDesglose = (periodo) =>
  PRODUCTOS.filter((p) => p.stock > 0)
    .map((p) => {
      const compras = REPOSICIONES.filter((r) => r.producto_id === p.id).sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : b.id - a.id));
      let restante = p.stock;
      let unidades = 0;
      for (const compra of compras) {
        if (restante <= 0) break;
        const toma = Math.min(restante, compra.cantidad);
        if (enPeriodo(compra.fecha, periodo)) unidades += toma;
        restante -= toma;
      }
      if (restante > 0 && enPeriodo(FECHA_STOCK_INICIAL, periodo)) unidades += restante;
      return { producto: p.nombre, unidades, costo_unitario: p.costo, inversion: redondear(unidades * p.costo) };
    })
    .filter((f) => f.unidades > 0)
    .sort((a, b) => b.inversion - a.inversion);

// Lo que depende de cada servicio (para simular que uno falle).
const DEPENDEN = {
  transacciones: ["ingresos", "vendido_saldado", "ventas_por_saldar", "cmv", "ganancia_bruta", "ganancia_neta", "por_cobrar"],
  finanzas: ["gastos_operativos", "bienes_de_uso", "ganancia_neta"],
  productos: ["inventario_actual"],
};

const servicioCaido = () => {
  try {
    const guardado = sessionStorage.getItem(CLAVE_FALLA);
    return guardado in DEPENDEN ? guardado : "";
  } catch {
    return "";
  }
};

export const servicioReportes = {
  // Simula GET /reportes?periodo=. Tarda un instante, como una consulta de verdad.
  obtener: async ({ periodo = "mes" } = {}) => {
    if (!PERIODOS.includes(periodo)) throw Object.assign(new Error("Período inválido."), { status: 400 });
    await new Promise((resolver) => setTimeout(resolver, 250));
    const datos = { periodo, servicios_caidos: [], ...calcular(periodo), desglose_inversion: calcularDesglose(periodo) };
    const caido = servicioCaido();
    if (caido) {
      datos.servicios_caidos = [caido];
      DEPENDEN[caido].forEach((campo) => (datos[campo] = null));
      if (caido === "productos") datos.desglose_inversion = null;
    }
    return datos;
  },
};
