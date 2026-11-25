// --- LÓGICA DE LA PANTALLA DE REPORTES (módulo ES, sin DOM) ---
// Qué tarjetas se muestran, de qué servicio depende cada una y los textos que no vienen del Backend.
// Los números los calcula el Backend (llegan por servicios/reportes.js): acá solo se decide cómo mostrarlos.

export const PERIODOS = [
  { valor: "hoy", texto: "Hoy" },
  { valor: "mes", texto: "Este mes" },
  { valor: "anio", texto: "Este año" },
];
export const PERIODO_INICIAL = "mes";

export const textoDePeriodo = (valor) => PERIODOS.find((p) => p.valor === valor)?.texto ?? "";

// Servicios internos de los que depende cada indicador. Si uno falla, el Backend lo informa en `servicios_caidos`
// y las tarjetas que dependen de él muestran "No se pudo calcular" mientras las demás siguen visibles.
export const SERVICIOS = { transacciones: "Transacciones", finanzas: "Finanzas", productos: "Productos" };

// `campo` es el nombre del dato en la respuesta del Backend. Las del período cambian con el filtro;
// las de "Estado actual" son siempre al día de hoy.
export const INDICADORES_PRINCIPALES = [
  { id: "ingresos", campo: "ingresos", titulo: "Ingresos", detalle: "Suma de los pagos realizados en el período.", depende: ["transacciones"], icono: "ingresos", tono: "azul" },
  { id: "vendido-saldado", campo: "vendido_saldado", titulo: "Total vendido y saldado", detalle: "Ventas confirmadas y saldadas (contado y cuenta corriente).", depende: ["transacciones"], icono: "vendido", tono: "azul", conPorSaldar: true },
  { id: "cmv", campo: "cmv", titulo: "CMV (Costo de Mercadería Vendida)", detalle: "Costo histórico de los productos que se vendieron.", depende: ["transacciones"], icono: "cmv", tono: "ambar" },
  { id: "ganancia-bruta", campo: "ganancia_bruta", titulo: "Ganancia bruta", detalle: "Ventas confirmadas (sin anuladas) menos CMV.", depende: ["transacciones"], icono: "ganancia", tono: "verde", negativoEnRojo: true },
  { id: "gastos", campo: "gastos_operativos", titulo: "Total de gastos operativos", detalle: "Alquiler, luz y demás gastos registrados.", depende: ["finanzas"], icono: "gastos", tono: "ambar" },
  { id: "bienes-uso", campo: "bienes_de_uso", titulo: "Inversión realizada en bienes de uso", detalle: "Compras de bienes de uso, según su fecha de compra.", depende: ["finanzas"], icono: "bienes", tono: "azul" },
  { id: "ganancia-neta", campo: "ganancia_neta", titulo: "Ganancia neta operativa estimada", detalle: "Ganancia bruta menos gastos operativos menos insumos.", depende: ["transacciones", "finanzas"], icono: "neta", tono: "verde", destacado: true, negativoEnRojo: true },
];

export const INDICADORES_ESTADO = [
  { id: "inventario", campo: "inventario_actual", titulo: "Inversión actual en inventario", detalle: "Costo unitario por unidades en stock, de los productos que todavía no se vendieron. Es capital, no una pérdida.", depende: ["productos"], icono: "inventario", tono: "azul", alDiaDeHoy: true },
  { id: "por-cobrar", campo: "por_cobrar", titulo: "Por cobrar", detalle: "Lo que los clientes todavía deben: total de cada venta a cuenta corriente confirmada menos lo que ya pagó.", depende: ["transacciones"], icono: "cobrar", tono: "azul", alDiaDeHoy: true },
];

export const TITULO_DESGLOSE = "Desglose de inversión por producto";
export const NOTA_DESGLOSE = "Este monto refleja capital acumulado, no es una pérdida. Solo se transformará en costo (CMV) a medida que los productos se vayan vendiendo.";
export const MENSAJE_SIN_DESGLOSE = "Sin inventario comprado en este período.";
export const MENSAJE_DESGLOSE_CAIDO = "No se pudo calcular";

export const textoVentasPorSaldar = (cantidad) =>
  Number(cantidad) === 1 ? "1 venta confirmada falta por saldar" : `${Number(cantidad) || 0} ventas confirmadas faltan por saldar`;

// Solo se consideran los servicios que conocemos (un nombre raro del Backend no rompe la pantalla).
export const serviciosCaidos = (datos) => (Array.isArray(datos?.servicios_caidos) ? datos.servicios_caidos.filter((s) => s in SERVICIOS) : []);

export const estaCaido = (indicador, caidos) => indicador.depende.some((servicio) => caidos.includes(servicio));

// Un valor negativo (pérdida) se muestra en rojo solo en las tarjetas que lo piden.
export const esNegativo = (indicador, valor) => Boolean(indicador.negativoEnRojo) && Number(valor) < 0;

// Títulos de lo que no se pudo calcular, para el aviso de arriba. Mismo orden que en la pantalla.
export const afectadosPorFalla = (caidos) => {
  if (caidos.length === 0) return [];
  const afectados = INDICADORES_PRINCIPALES.filter((i) => estaCaido(i, caidos)).map((i) => i.titulo);
  INDICADORES_ESTADO.forEach((i) => {
    if (estaCaido(i, caidos)) afectados.push(i.titulo);
    if (i.id === "inventario" && caidos.includes("productos")) afectados.push("Desglose de inversión");
  });
  return afectados;
};

export const textoAvisoParcial = (caidos) => {
  const nombres = caidos.map((s) => SERVICIOS[s]);
  const servicios = nombres.length > 1 ? `${nombres.slice(0, -1).join(", ")} y ${nombres.at(-1)}` : nombres[0];
  return `No se pudieron calcular algunos indicadores por una falla en ${servicios}.`;
};

// Total de la tabla de desglose.
export const totalDelDesglose = (desglose) => Math.round((desglose ?? []).reduce((suma, fila) => suma + Number(fila.inversion || 0), 0) * 100) / 100;
