// Trazzo - Utilidades puras del módulo Productos (sin DOM ni red: se testean con Vitest).

export const redondear = (numero, decimales = 2) => {
  const factor = 10 ** decimales;
  return Math.round((Number(numero) + Number.EPSILON) * factor) / factor;
};

// Escapa texto antes de meterlo en innerHTML.
export const escaparHTML = (valor) =>
  String(valor ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

// Precio de venta sugerido = costo × (1 + rentabilidad/100) × (1 + IVA/100).
// Devuelve 0 si el costo no es un número positivo.
export const calcularPrecioVenta = (costo, rentabilidad = 0, iva = 0) => {
  const c = Number(costo);
  if (!Number.isFinite(c) || c <= 0) return 0;
  const r = Number(rentabilidad) || 0;
  const i = Number(iva) || 0;
  return redondear(c * (1 + r / 100) * (1 + i / 100));
};

// true si el precio de venta es menor al costo (el front solo avisa, no bloquea).
export const precioMenorAlCosto = (precioVenta, costo) => {
  const v = parseFloat(precioVenta);
  const c = parseFloat(costo);
  if (Number.isNaN(v) || Number.isNaN(c)) return false;
  return v < c;
};

// Monto total sugerido para una reposición = cantidad × último costo unitario.
export const calcularMontoReposicion = (cantidad, costoUnitario) => {
  const cant = Number(cantidad);
  const costo = Number(costoUnitario);
  if (
    !Number.isFinite(cant) ||
    !Number.isFinite(costo) ||
    cant <= 0 ||
    costo <= 0
  )
    return 0;
  return redondear(cant * costo);
};

const formateadorMoneda = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
});

// 1234.5 -> "$ 1.234,50". Valores vacíos o no numéricos -> "—".
export const formatearMoneda = (valor) => {
  if (valor === null || valor === undefined || valor === "") return "—";
  const n = Number(valor);
  return Number.isFinite(n) ? formateadorMoneda.format(n) : "—";
};

// "SIN_STOCK" | "BAJO" | "OK". NUMERIC puede llegar como texto ("10.00").
export const estadoStock = (cantidad, stockMinimo) => {
  const c = Number(cantidad);
  const m = Number(stockMinimo);
  if (c <= 0) return "SIN_STOCK";
  if (c <= m) return "BAJO";
  return "OK";
};

// Acepta "2026-11-15", "2026-11-15T00:00:00..." y el formato que arma Flask para un date
// ("Sun, 15 Nov 2026 00:00:00 GMT"). Devuelve una fecha local sin hora, o null.
export const parsearFecha = (valor) => {
  if (!valor) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(valor));
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const d = new Date(valor);
  if (Number.isNaN(d.getTime())) return null;
  // Medianoche GMT caería el día anterior en Argentina: se leen las partes UTC.
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};

export const formatearFecha = (valor) => {
  const d = parsearFecha(valor);
  return d
    ? d.toLocaleDateString("es-AR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      })
    : "—";
};

// Rol (en mayúsculas) que viene dentro del JWT, o null.
// TODO: reemplazar por obtenerSesion() de sesion.js cuando se confirme su forma.
// Ojo: solo decide qué botones se ven; el permiso real lo tiene que exigir el backend.
export const rolDesdeToken = (token) => {
  try {
    const payload = String(token || "").split(".")[1];
    if (!payload) return null;
    const b64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const datos = JSON.parse(new TextDecoder().decode(bytes));
    return String(datos.rol || datos.role || "").toUpperCase() || null;
  } catch {
    return null;
  }
};

export const esRolAdmin = (rol) =>
  ["ADMIN", "PROPIETARIO"].includes(String(rol || "").toUpperCase());

// fetchAPI lanza un Error con `status` si el servidor respondió con error, y un error del navegador
// (sin `status`, "Failed to fetch") si no hubo conexión. Mismo criterio que errores.js.
export const mensajeDeError = (
  error,
  textoPorDefecto = "Ocurrió un error.",
) => {
  if (error?.status === undefined)
    return "No se pudo conectar con el servidor.";
  if (!error.message || error.message === "Error en la petición")
    return textoPorDefecto;
  return error.message;
};
