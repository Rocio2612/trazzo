// --- LÓGICA DE VENTAS (módulo ES) ---
// Cálculos, validaciones y textos de las pantallas Nueva venta e Historial de ventas. No toca el DOM ni habla con
// el Backend: lo dibuja js/ventas-pantalla.js / js/historial-ventas-pantalla.js y los datos vienen de servicios/ventas.js.
// El Backend repite todas las validaciones: esto es solo ayuda para quien escribe.

import { aNumero, fechaIsoDeHoy } from "./formatos.js";
import { formatearDinero } from "./formatos.js";

export const TASA_IVA = 0.21;
export const LEYENDA_CREDITO_FISCAL = "El crédito fiscal discriminado en el presente comprobante no puede ser computado";
export const MEDIO_SALDO_A_FAVOR = "Saldo a favor";

export const redondear = (numero, decimales = 2) => Math.round(numero * 10 ** decimales) / 10 ** decimales;

// --- Carrito ---------------------------------------------------------------------------------

export const MENSAJE_CANTIDAD = "Cantidad obligatoria: un número entero mayor a 0.";
export const MENSAJE_SIN_PRODUCTOS = "No seleccionaste ningún producto. Agregá al menos uno para cobrar la venta.";
export const MENSAJE_CANTIDADES = "Revisá las cantidades: cada producto necesita una cantidad entera mayor a 0.";

// La cantidad es obligatoria: un número entero mayor a 0 (llega como texto del campo).
export const cantidadValida = (texto) => /^\d+$/.test(String(texto ?? "").trim()) && Number(texto) >= 1;

export const subtotalDeItem = (precio, cantidad) => redondear(Number(precio) * Number(cantidad));

// carrito: [{ producto_id, cantidad (texto) }]; productos: los del Backend ({ id, precio_venta, ... }).
// Una cantidad inválida no suma hasta que se corrija.
export const totalDelCarrito = (carrito, productos) =>
  redondear(
    carrito.reduce((suma, item) => {
      const producto = productos.find((p) => p.id === item.producto_id);
      return producto && cantidadValida(item.cantidad) ? suma + Number(producto.precio_venta) * Number(item.cantidad) : suma;
    }, 0),
  );

// Aviso de stock de un producto del carrito:
// - stock 0: "Sin stock" (va al lado del nombre)
// - cantidad pedida mayor al stock: "Solo quedan N en stock" (va debajo del campo de cantidad)
// El bloqueo de la venta lo hace el Backend al confirmar; esto solo marca cada producto.
export const textoStockLimitado = (stock) => (Number(stock) === 1 ? "Solo queda 1 en stock" : `Solo quedan ${Number(stock)} en stock`);

export const avisoDeStock = (producto, cantidadPedida) => {
  const stock = Number(producto.cantidad);
  if (stock === 0) return { tipo: "SIN_STOCK", texto: "Sin stock" };
  if (Number(cantidadPedida) > stock) return { tipo: "INSUFICIENTE", texto: textoStockLimitado(stock) };
  return null;
};

// El carrito no deja pedir más de lo que hay: una cantidad válida mayor al stock se baja al stock.
// Devuelve la cantidad (texto) y si hubo que bajarla. Una cantidad inválida se deja como está (se marca con su error).
export const limitarAlStock = (cantidad, stock) => {
  if (cantidadValida(cantidad) && Number(cantidad) > Number(stock)) return { cantidad: String(Number(stock)), excedido: true };
  return { cantidad: String(cantidad ?? ""), excedido: false };
};

// --- IVA -------------------------------------------------------------------------------------
// Depende de la categoría impositiva del negocio y de la del cliente. El precio de catálogo ya incluye IVA (21 %):
// el total no cambia, la discriminación solo muestra cómo se compone.
//   Negocio RI: cliente RI o Monotributista -> discrimina (Monotributista con leyenda); Exento o Consumidor final -> incluido.
//   Negocio Monotributista -> no discrimina nunca. Negocio Exento -> sin débito fiscal.
// categoriaCliente: "CONSUMIDOR_FINAL" si no hay cliente; undefined si no se conoce (el Cajero no recibe la categoría de
// un cliente: en ese caso el Backend calcula el IVA al confirmar).
export const calcularIva = (total, categoriaNegocio, categoriaCliente) => {
  if (categoriaNegocio === "MONOTRIBUTISTA") return { modo: "NINGUNO", texto: "IVA no discriminado: el impuesto está unificado en la cuota fija del negocio." };
  if (categoriaNegocio === "EXENTO") return { modo: "NINGUNO", texto: "Negocio exento: no se genera débito fiscal ni se adiciona IVA." };
  if (categoriaNegocio !== "RESPONSABLE_INSCRIPTO" || categoriaCliente === undefined) {
    return { modo: "PENDIENTE", texto: "El IVA lo calcula el sistema al confirmar la venta." };
  }
  if (categoriaCliente === "RESPONSABLE_INSCRIPTO" || categoriaCliente === "MONOTRIBUTISTA") {
    const neto = redondear(total / (1 + TASA_IVA));
    return { modo: "DISCRIMINA", neto, iva: redondear(total - neto), leyenda: categoriaCliente === "MONOTRIBUTISTA" ? LEYENDA_CREDITO_FISCAL : null };
  }
  return { modo: "INCLUIDO", texto: "El precio incluye IVA." };
};

// --- Cobrar (modal) --------------------------------------------------------------------------

export const TIPOS = { CONTADO: "Contado", CUENTA_CORRIENTE: "Cuenta corriente" };
export const textoTipo = (tipo) => TIPOS[tipo] ?? String(tipo ?? "");

// Cuánto saldo a favor se puede usar como máximo: lo que tiene el cliente, sin pasar del total de la venta.
export const creditoMaximo = (credito, total) => redondear(Math.min(Number(credito) || 0, Number(total) || 0));

// Valida cuánto saldo a favor se quiere usar. Devuelve el mensaje o null si está bien.
export const validarCreditoAUsar = (texto, credito, total) => {
  const limpio = String(texto ?? "").trim();
  if (!limpio) return "Ingresá cuánto saldo a favor querés usar.";
  const n = aNumero(limpio);
  if (!Number.isFinite(n)) return "El saldo a favor a usar debe ser un número.";
  if (n <= 0) return "El saldo a favor a usar debe ser mayor a 0.";
  if (n > credito) return `No podés usar más de ${formatearDinero(credito)}: es el saldo a favor que tiene el cliente.`;
  if (n > total) return `No puede superar el total de la venta (${formatearDinero(total)}).`;
  return null;
};

// Datos obligatorios del cobro. `aCobrar` es lo que queda por cobrar después de usar saldo a favor: si es 0 no se pide
// medio de pago. Devuelve { campo: mensaje } (vacío si está todo bien).
export const validarCobro = ({ tipo, clienteId, medioPagoId, aCobrar }) => {
  const errores = {};
  if (tipo === "CUENTA_CORRIENTE" && !clienteId) errores.cliente = "Seleccioná un cliente registrado para una venta a cuenta corriente.";
  if (tipo === "CONTADO" && aCobrar > 0 && !medioPagoId) errores.medio_pago = "Seleccioná el medio de pago de la venta.";
  return errores;
};

// "Revisá estos datos: cliente, medio de pago."
export const NOMBRES_DE_CAMPOS = { cliente: "cliente", medio_pago: "medio de pago", credito: "saldo a favor a usar" };
export const resumenDeErrores = (errores) => {
  const faltan = Object.keys(errores).map((campo) => NOMBRES_DE_CAMPOS[campo] ?? campo);
  return faltan.length ? `Revisá estos datos: ${faltan.join(", ")}.` : "";
};

// Cuerpo del POST /ventas. La fecha, la hora y el número de venta los pone el Backend: no se envían. El precio de cada
// producto tampoco: lo toma el Backend del catálogo (y guarda el precio y el costo de ese instante).
export const armarPayloadVenta = ({ items, tipo, clienteId, medioPagoId, creditoUsado = 0 }) => ({
  tipo,
  cliente_id: clienteId ? Number(clienteId) : null,
  medio_pago_id: tipo === "CONTADO" && medioPagoId ? Number(medioPagoId) : null,
  saldo_a_favor_usado: creditoUsado > 0 ? redondear(creditoUsado) : 0,
  items: items.map((i) => ({ producto_id: i.producto_id, cantidad: Number(i.cantidad) })),
});

// --- Historial -------------------------------------------------------------------------------

export const OPCIONES_PERIODO = [
  { valor: "todas", texto: "Todas las ventas" },
  { valor: "hoy", texto: "Hoy" },
  { valor: "mes", texto: "Este mes" },
  { valor: "anio", texto: "Este año" },
];

export const textoEstado = (venta) => (venta.anulada ? "Anulada" : "Confirmada");
export const nombreCliente = (venta) => venta.cliente_nombre || "Consumidor final";

// "2026-11-05T12:10:00Z" -> "2026-11-05" (con la fecha local de quien mira)
export const fechaLocalIso = (valor) => {
  const fecha = new Date(valor);
  return Number.isNaN(fecha.getTime()) ? "" : fechaIsoDeHoy(fecha);
};

export const enPeriodo = (fechaHora, periodo, hoyIso = fechaIsoDeHoy()) => {
  if (!periodo || periodo === "todas") return true;
  const dia = fechaLocalIso(fechaHora);
  if (!dia) return false;
  if (periodo === "hoy") return dia === hoyIso;
  if (periodo === "mes") return dia.slice(0, 7) === hoyIso.slice(0, 7);
  if (periodo === "anio") return dia.slice(0, 4) === hoyIso.slice(0, 4);
  return true;
};

// El número se encuentra con o sin guion (00001-00000458 o 0000100000458).
const textoBuscable = (venta) => `${venta.numero} ${String(venta.numero).replace("-", "")} ${nombreCliente(venta)} ${textoTipo(venta.tipo)}`.toLowerCase();

// filtros: { texto, estado ("" | CONFIRMADA | ANULADA | CONTADO | CUENTA_CORRIENTE), periodo, ocultos }
// Las ventas ocultas solo se ven con "Ver ocultos". Primero las más recientes.
export const filtrarVentas = (ventas, { texto = "", estado = "", periodo = "todas", ocultos = false } = {}, hoyIso = fechaIsoDeHoy()) => {
  const q = texto.trim().toLowerCase();
  return ventas
    .filter((v) => Boolean(v.oculto) === ocultos)
    .filter((v) => enPeriodo(v.fecha_hora, periodo, hoyIso))
    .filter((v) => !estado || (estado === "ANULADA" ? v.anulada : estado === "CONFIRMADA" ? !v.anulada : v.tipo === estado))
    .filter((v) => !q || textoBuscable(v).includes(q))
    .sort((a, b) => (new Date(b.fecha_hora) - new Date(a.fecha_hora)) || b.id - a.id);
};
