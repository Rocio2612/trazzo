// --- VALIDADORES COMUNES (módulo ES) ---
// Cada validador devuelve null si el valor es válido, o el mensaje de error para mostrar
// junto al campo. El Backend repite todas las validaciones: esto es solo UX.
// `nombre` es cómo se nombra el campo en el mensaje (ej.: "El costo").

import { aNumero, fechaIsoDeHoy, fechaParaMostrar } from "./formatos.js";

const estaVacio = (valor) => valor === null || valor === undefined || String(valor).trim() === "";

// "Completá el costo.": la frase sirve con nombres masculinos y femeninos.
export const validarObligatorio = (valor, nombre = "Este campo") =>
  estaVacio(valor) ? `Completá ${nombre.charAt(0).toLowerCase()}${nombre.slice(1)}.` : null;

// Obligatorio y numérico: base de los validadores de números.
const validarNumero = (valor, nombre) => {
  const falta = validarObligatorio(valor, nombre);
  if (falta) return falta;
  return Number.isFinite(aNumero(valor)) ? null : `${nombre} debe ser un número.`;
};

// Mayor a 0 (costo, precio, monto).
export const validarNumeroPositivo = (valor, nombre = "El valor") =>
  validarNumero(valor, nombre) ||
  (aNumero(valor) > 0 ? null : `${nombre} debe ser mayor a 0.`);

// 0 o mayor.
export const validarNumeroNoNegativo = (valor, nombre = "El valor") =>
  validarNumero(valor, nombre) ||
  (aNumero(valor) >= 0 ? null : `${nombre} no puede ser menor a 0.`);

// Entero 0 o mayor (stock actual, stock mínimo).
export const validarEnteroNoNegativo = (valor, nombre = "El valor") =>
  validarNumero(valor, nombre) ||
  (!Number.isInteger(aNumero(valor)) ? `${nombre} debe ser un número entero.` : null) ||
  (aNumero(valor) >= 0 ? null : `${nombre} no puede ser menor a 0.`);

// Entero mayor a 0 (cantidades).
export const validarEnteroPositivo = (valor, nombre = "El valor") =>
  validarNumero(valor, nombre) ||
  (!Number.isInteger(aNumero(valor)) ? `${nombre} debe ser un número entero.` : null) ||
  (aNumero(valor) > 0 ? null : `${nombre} debe ser mayor a 0.`);

// Fecha en aaaa-mm-dd (lo que devuelve un <input type="date">).
export const validarFecha = (iso, nombre = "La fecha") =>
  validarObligatorio(iso, nombre) ||
  (fechaParaMostrar(iso) ? null : `${nombre} no es una fecha válida.`);

// Fecha válida y que no sea posterior a hoy.
export const validarFechaNoFutura = (iso, nombre = "La fecha", ahora = new Date()) =>
  validarFecha(iso, nombre) ||
  (String(iso).slice(0, 10) > fechaIsoDeHoy(ahora) ? `${nombre} no puede ser futura.` : null);

// Aviso (no error) para el modal de productos: el precio de venta es menor al costo.
export const precioMenorAlCosto = (precio, costo) => {
  const p = aNumero(precio);
  const c = aNumero(costo);
  return Number.isFinite(p) && Number.isFinite(c) && p < c;
};
