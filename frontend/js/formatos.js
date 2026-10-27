// --- FORMATOS DE FECHAS Y DINERO (módulo ES) ---
// Uso: <script type="module"> import { fechaParaMostrar } from "./js/formatos.js"; </script>
// Las fechas se muestran como dd-mm-aaaa y viajan al Backend como aaaa-mm-dd.

const esFechaReal = (anio, mes, dia) => {
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  return (
    fecha.getUTCFullYear() === anio &&
    fecha.getUTCMonth() === mes - 1 &&
    fecha.getUTCDate() === dia
  );
};

// Convierte a número un valor de formulario o del Backend ("1234.50"). Devuelve NaN si no lo es.
export const aNumero = (valor) => {
  if (typeof valor === "number") return valor;
  if (typeof valor === "string" && /^-?\d+(\.\d+)?$/.test(valor.trim())) {
    return Number(valor.trim());
  }
  return NaN;
};

// "2026-03-05" -> "05-03-2026". Devuelve "" si no es una fecha válida.
export const fechaParaMostrar = (iso) => {
  const partes = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ""));
  if (!partes) return "";
  const [, anio, mes, dia] = partes;
  return esFechaReal(Number(anio), Number(mes), Number(dia)) ? `${dia}-${mes}-${anio}` : "";
};

// "05-03-2026" -> "2026-03-05". Devuelve null si no es una fecha válida.
export const fechaParaEnviar = (texto) => {
  const partes = /^(\d{2})-(\d{2})-(\d{4})$/.exec(String(texto ?? "").trim());
  if (!partes) return null;
  const [, dia, mes, anio] = partes;
  return esFechaReal(Number(anio), Number(mes), Number(dia)) ? `${anio}-${mes}-${dia}` : null;
};

// Fecha de hoy en aaaa-mm-dd, con la hora local del usuario.
export const fechaIsoDeHoy = (ahora = new Date()) => {
  const mes = String(ahora.getMonth() + 1).padStart(2, "0");
  const dia = String(ahora.getDate()).padStart(2, "0");
  return `${ahora.getFullYear()}-${mes}-${dia}`;
};

const FORMATO_DINERO = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
});

// 1234.5 -> "$ 1.234,50". Devuelve "" si el valor no es un número.
export const formatearDinero = (valor) => {
  const numero = aNumero(valor);
  return Number.isFinite(numero) ? FORMATO_DINERO.format(numero) : "";
};
