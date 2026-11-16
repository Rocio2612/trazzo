// js/utils/productosUtils.js

export const calcularPrecioVenta = (
  precioCompra,
  rentabilidad = 0,
  iva = 21,
) => {
  if (!precioCompra || precioCompra <= 0) return 0;
  const neto = precioCompra * (1 + rentabilidad / 100);
  const conIva = neto * (1 + iva / 100);
  return Number(conIva.toFixed(2));
};

export const precioMenorAlCosto = (precioVenta, precioCompra) => {
  if (!precioVenta || !precioCompra) return false;
  return parseFloat(precioVenta) < parseFloat(precioCompra);
};

export const calcularMontoReposicion = (cantidad, ultimoPrecioCompra) => {
  if (
    !cantidad ||
    !ultimoPrecioCompra ||
    cantidad <= 0 ||
    ultimoPrecioCompra <= 0
  )
    return 0;
  return Number((cantidad * ultimoPrecioCompra).toFixed(2));
};

export const formatearMoneda = (valor) => {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
  }).format(valor);
};

/**
 * Escapa caracteres especiales para prevenir XSS.
 */
export const escaparHTML = (texto) => {
  if (texto === null || texto === undefined) return "";
  return String(texto)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
};

/**
 * Evalúa el estado del stock.
 * @returns {"SIN_STOCK" | "BAJO" | "OK"}
 */
export const estadoStock = (cantidad, minimo) => {
  if (cantidad <= 0) return "SIN_STOCK";
  if (cantidad <= minimo) return "BAJO";
  return "OK";
};

/**
 * Decodifica el payload de un token JWT (sin verificar firma) y devuelve el rol.
 */
export const rolDesdeToken = (token) => {
  if (!token) return null;
  try {
    const payloadBase64 = token.split(".")[1];
    if (!payloadBase64) return null;
    // base64url a base64
    const base64 = payloadBase64.replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(base64));
    return payload.rol ? payload.rol.toUpperCase() : null;
  } catch {
    return null;
  }
};

/**
 * Devuelve true si el rol es ADMIN o PROPIETARIO.
 */
export const esRolAdmin = (rol) => {
  if (!rol) return false;
  const r = rol.toUpperCase();
  return r === "ADMIN" || r === "PROPIETARIO";
};

/**
 * Formatea una fecha YYYY-MM-DD a DD-MM-YYYY.
 */
export const formatearFecha = (fechaISO) => {
  if (!fechaISO) return "—";
  const partes = fechaISO.split("T")[0].split("-"); // por si viene con hora
  if (partes.length !== 3) return fechaISO;
  return `${partes[2]}-${partes[1]}-${partes[0]}`;
};

/**
 * Parsea una fecha YYYY-MM-DD a un objeto Date local.
 */
export const parsearFecha = (fechaISO) => {
  if (!fechaISO) return null;
  const partes = fechaISO.split("T")[0].split("-");
  if (partes.length !== 3) return null;
  // new Date(año, mesIndex, dia)
  return new Date(
    parseInt(partes[0]),
    parseInt(partes[1]) - 1,
    parseInt(partes[2]),
  );
};
