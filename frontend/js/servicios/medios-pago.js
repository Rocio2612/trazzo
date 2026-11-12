// --- SERVICIO Y HELPER DE MEDIOS DE PAGO (módulo ES) ---
// Habla con el Backend (finanzas-service, a través del Gateway): /medios-pago.
// Requiere api.js cargado antes (fetchAPI). Las respuestas vienen envueltas en
// { status, medios_pago: [...] } o { status, medio_pago: {...} }: acá se desenvuelven.
//
// - `servicioMediosPago`: lo usa Configuración > Medios de pago (listar, crear, editar y eliminar).
// - `cargarMediosPago`: lo usan los desplegables de "medio de pago" (Gastos, y luego Ventas y Pagos).
//
// Uso del helper:
//   import { cargarMediosPago } from "./servicios/medios-pago.js";
//   const medios = await cargarMediosPago();   // [{ id, nombre }]

// [{ id, nombre, es_predeterminado }]: solo los activos, con el predeterminado (Efectivo) primero.
const listar = async () => (await fetchAPI("/medios-pago")).medios_pago ?? [];

export const servicioMediosPago = {
  listar,
  crear: async (nombre) => (await fetchAPI("/medios-pago", "POST", { nombre })).medio_pago,
  actualizar: async (id, nombre) => (await fetchAPI(`/medios-pago/${id}`, "PUT", { nombre })).medio_pago,
  // El Backend borra el medio de verdad si nunca se usó y lo desactiva si ya tiene gastos; Efectivo no se elimina.
  eliminar: (id) => fetchAPI(`/medios-pago/${id}`, "DELETE"),
};

// Para los desplegables el id viaja como texto (así lo entrega el <select>). Si el Backend no responde, devuelve
// una lista vacía y el desplegable avisa que no hay medios.
export const cargarMediosPago = async () => {
  try {
    return (await listar()).map((m) => ({ id: String(m.id), nombre: m.nombre }));
  } catch {
    return [];
  }
};
