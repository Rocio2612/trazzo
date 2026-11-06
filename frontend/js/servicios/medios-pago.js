// --- HELPER DE MEDIOS DE PAGO PARA OTRAS PANTALLAS (módulo ES) ---
// Lo usan los desplegables de "medio de pago" (Gastos, y luego Ventas y Pagos). Devuelve los medios de pago
// que el Admin creó en Configuración > Medios de pago.
//
// Uso:
//   import { cargarMediosPago } from "./servicios/medios-pago.js";
//   const medios = await cargarMediosPago();   // [{ id, nombre }]
//
// Requiere api.js cargado antes (fetchAPI).
//
// TEMPORAL: mientras el Backend no publique GET /medios-pago, si la API no responde se usan los medios de pago
// guardados por la pantalla de Configuración (mocks/personalizacion.js). Cuando exista la API, se borra el
// bloque "catch" y el import del mock.

import { listarListaMock } from "../mocks/personalizacion.js";

const normalizar = (lista) => lista.map((m) => ({ id: String(m.id), nombre: m.nombre }));

export const cargarMediosPago = async () => {
  try {
    const data = await fetchAPI("/medios-pago");
    return normalizar(Array.isArray(data) ? data : data?.items || []);
  } catch {
    return normalizar(listarListaMock("medios_pago"));
  }
};
