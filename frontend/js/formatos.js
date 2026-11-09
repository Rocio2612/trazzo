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

// --- Fechas con hora (TIMESTAMPTZ de la base) ---------------------------------------------------

const dosDigitos = (numero) => String(numero).padStart(2, "0");

// Convierte lo que devuelve la base en una fecha local. "2026-03-05T11:30:00Z" es un instante, y se ve en la
// hora de quien mira. Un texto solo con día ("2026-03-05", sin hora) es una fecha de calendario: se toma como
// ese día a las 00:00 locales, para que la zona horaria no lo corra un día. Devuelve null si no es una fecha.
const aFechaLocal = (valor) => {
  if (valor === null || valor === undefined || String(valor).trim() === "") return null;
  const soloDia = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(valor).trim());
  if (soloDia) {
    const [anio, mes, dia] = [Number(soloDia[1]), Number(soloDia[2]), Number(soloDia[3])];
    const fecha = new Date(anio, mes - 1, dia);
    // new Date corrige solo los días que no existen (el 45 de un mes se vuelve otro mes): se rechazan.
    return fecha.getFullYear() === anio && fecha.getMonth() === mes - 1 && fecha.getDate() === dia ? fecha : null;
  }
  const fecha = new Date(valor);
  return Number.isNaN(fecha.getTime()) ? null : fecha;
};

// "2026-03-05T11:30:00Z" -> "05-03-2026 08:30" (en Argentina). Devuelve "" si no es una fecha válida.
export const fechaHoraParaMostrar = (valor) => {
  const fecha = aFechaLocal(valor);
  if (!fecha) return "";
  const dia = `${dosDigitos(fecha.getDate())}-${dosDigitos(fecha.getMonth() + 1)}-${fecha.getFullYear()}`;
  return `${dia} ${dosDigitos(fecha.getHours())}:${dosDigitos(fecha.getMinutes())}`;
};

// Solo el día: "2026-03-05T11:30:00Z" -> "05-03-2026". Devuelve "" si no es una fecha válida.
export const fechaDeMarcaParaMostrar = (valor) => fechaHoraParaMostrar(valor).slice(0, 10);
