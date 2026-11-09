// --- LÓGICA DEL MÓDULO DE GASTOS OPERATIVOS (módulo ES, sin pantalla) ---
// Reglas tomadas del Módulo 8 y del Sprint 2:
// - Obligatorios: fecha (la elige el usuario; puede ser de hoy o anterior, nunca futura: la base lo exige con
//   chk_gasto_fecha_no_futura), concepto (texto libre) y monto > 0. Opcional: medio de pago.
// - No modifican el inventario.
// - Los totales NUNCA se guardan: se calculan siempre sumando la lista, así que editar la fecha
//   o el monto de un gasto se refleja solo en la sumatoria.
// - Los gastos solo se editan o se eliminan (con confirmación): no se ocultan.
// Los nombres de campo (medio_pago_id, …) son provisorios hasta cerrar el contrato con Back.

import { aNumero, fechaParaEnviar, fechaParaMostrar } from "./formatos.js";
import { validarFechaNoFutura, validarNumeroPositivo, validarObligatorio } from "./validadores.js";

export const AGRUPACIONES = ["dia", "mes", "anio"];

// Dinero en NUMERIC(12,2): hasta 10 dígitos enteros y 2 decimales.
const MONTO_MAXIMO = 9999999999.99;

// Largo máximo del concepto (provisorio: confirmar con Back el tamaño de la columna).
export const CONCEPTO_MAXIMO = 100;

const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;

// La fecha del formulario puede venir como dd-mm-aaaa (texto) o aaaa-mm-dd (<input type="date">).
// Devuelve aaaa-mm-dd, o null si no es una fecha válida.
const fechaAIso = (valor) => {
  const texto = String(valor ?? "").trim();
  if (FECHA_ISO.test(texto)) return fechaParaMostrar(texto) ? texto : null;
  return fechaParaEnviar(texto);
};

// Devuelve { campo: mensaje } con los errores del formulario; vacío si todo está bien.
// Los mismos nombres de campo que usa el Backend en { errores: { campo: mensaje } }.
// `ahora` es "hoy" para decidir si la fecha es futura (se puede pasar uno fijo en las pruebas).
export const validarGasto = (datos = {}, ahora = new Date()) => {
  const errores = {};

  const iso = fechaAIso(datos.fecha);
  const errorFecha = iso
    ? validarFechaNoFutura(iso, "La fecha", ahora) || ""
    : validarObligatorio(datos.fecha, "La fecha") || "La fecha no es una fecha válida.";
  if (errorFecha) errores.fecha = errorFecha;

  let errorConcepto = validarObligatorio(datos.concepto, "El concepto");
  if (!errorConcepto && String(datos.concepto).trim().length > CONCEPTO_MAXIMO) {
    errorConcepto = `El concepto admite hasta ${CONCEPTO_MAXIMO} caracteres.`;
  }
  if (errorConcepto) errores.concepto = errorConcepto;

  let errorMonto = validarNumeroPositivo(datos.monto, "El monto");
  if (!errorMonto && !/^\d+(\.\d{1,2})?$/.test(String(datos.monto).trim())) {
    errorMonto = "El monto admite hasta 2 decimales.";
  }
  if (!errorMonto && aNumero(datos.monto) > MONTO_MAXIMO) {
    errorMonto = "El monto es demasiado grande.";
  }
  if (errorMonto) errores.monto = errorMonto;

  return errores;
};

// El desplegable entrega el medio de pago como texto ("2"); la base lo guarda como número entero (INT).
// Sin medio de pago (vacío o algo que no es un id válido) viaja null.
const aIdEntero = (valor) => {
  if (valor === null || valor === undefined || String(valor).trim() === "") return null;
  const numero = Number(valor);
  return Number.isInteger(numero) && numero > 0 ? numero : null;
};

// Datos que se envían al Backend al crear o editar un gasto. Se arma solo con los campos
// del formulario: el Backend saca quién lo hizo del token y calcula todo lo demás.
export const armarPayloadGasto = (datos) => ({
  fecha: fechaAIso(datos.fecha),
  concepto: String(datos.concepto ?? "").trim(),
  monto: aNumero(datos.monto),
  medio_pago_id: aIdEntero(datos.medio_pago_id),
});

// Para comparar textos sin distinguir mayúsculas ni tildes ("Reparación" = "reparacion").
const sinTildes = (texto) =>
  String(texto ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");

// Búsqueda (?q=): sin distinguir mayúsculas ni tildes, por concepto o por medio de pago.
export const buscarGastos = (gastos, texto) => {
  const buscado = sinTildes(texto).trim();
  if (!buscado) return gastos;
  return gastos.filter((g) => [g.concepto, g.medio_pago_nombre].some((campo) => sinTildes(campo).includes(buscado)));
};

// Filtro de la lista: rango de fechas (aaaa-mm-dd, inclusivo).
export const filtrarGastos = (gastos, { desde, hasta } = {}) =>
  gastos.filter((g) => (!desde || g.fecha >= desde) && (!hasta || g.fecha <= hasta));

const aCentavos = (monto) => Math.round(aNumero(monto) * 100);

const clavePeriodo = (fecha, agrupar) => fecha.slice(0, { dia: 10, mes: 7, anio: 4 }[agrupar]);

// Total del período y total por día, mes o año (agrupar: "dia", "mes" o "anio").
// Suma en centavos para no arrastrar errores de decimales.
export const resumirGastos = (gastos, { desde, hasta, agrupar = "dia" } = {}) => {
  if (!AGRUPACIONES.includes(agrupar)) {
    throw new RangeError(`agrupar debe ser uno de: ${AGRUPACIONES.join(", ")}`);
  }

  const porPeriodo = new Map();
  let totalCentavos = 0;
  let cantidad = 0;

  gastos.forEach((g) => {
    const centavos = aCentavos(g.monto);
    if (!Number.isFinite(centavos)) return;
    if ((desde && g.fecha < desde) || (hasta && g.fecha > hasta)) return;

    const periodo = clavePeriodo(g.fecha, agrupar);
    const actual = porPeriodo.get(periodo) || { centavos: 0, cantidad: 0 };
    porPeriodo.set(periodo, { centavos: actual.centavos + centavos, cantidad: actual.cantidad + 1 });
    totalCentavos += centavos;
    cantidad += 1;
  });

  return {
    agrupar,
    desde: desde ?? null,
    hasta: hasta ?? null,
    total: totalCentavos / 100,
    cantidad,
    periodos: [...porPeriodo.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([periodo, { centavos, cantidad: n }]) => ({ periodo, total: centavos / 100, cantidad: n })),
  };
};

// Cómo se muestra un período del resumen: "05-03-2026", "03-2026" o "2026".
export const etiquetaPeriodo = (periodo, agrupar) => {
  if (agrupar === "dia") return fechaParaMostrar(periodo);
  if (agrupar === "mes") return `${periodo.slice(5, 7)}-${periodo.slice(0, 4)}`;
  return periodo;
};
