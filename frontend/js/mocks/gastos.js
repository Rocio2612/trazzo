// --- DATOS SIMULADOS DE GASTOS (hasta que Back publique /api/gastos) ---
// Mismo formato que va a devolver la API: dinero como texto con 2 decimales, fechas en aaaa-mm-dd
// y listas como { items, total, pagina }. Los nombres de campo son provisorios hasta cerrar el contrato.

import { buscarGastos, filtrarGastos } from "../gastos.js";

const auditoria = (usuario, en) => ({
  creado_por: 1,
  creado_por_nombre: usuario,
  creado_en: en,
  modificado_por: 1,
  modificado_por_nombre: usuario,
  modificado_en: en,
});

export const GASTOS_EJEMPLO = [
  { id: 1, fecha: "2026-03-01", concepto: "Alquiler del local", monto: "450000.00", medio_pago_id: null, medio_pago_nombre: null, oculto: false, ...auditoria("admin1", "2026-03-01T10:00:00Z") },
  { id: 2, fecha: "2026-03-05", concepto: "Luz", monto: "38250.50", medio_pago_id: null, medio_pago_nombre: null, oculto: false, ...auditoria("admin1", "2026-03-05T11:30:00Z") },
  { id: 3, fecha: "2026-03-05", concepto: "Internet", monto: "21000.00", medio_pago_id: null, medio_pago_nombre: null, oculto: false, ...auditoria("admin1", "2026-03-05T11:35:00Z") },
  { id: 4, fecha: "2026-03-12", concepto: "Flete de mercadería", monto: "15500.75", medio_pago_id: null, medio_pago_nombre: null, oculto: false, ...auditoria("admin1", "2026-03-12T16:00:00Z") },
  { id: 5, fecha: "2026-04-01", concepto: "Alquiler del local", monto: "450000.00", medio_pago_id: null, medio_pago_nombre: null, oculto: false, ...auditoria("admin1", "2026-04-01T10:00:00Z") },
  { id: 6, fecha: "2026-04-02", concepto: "Viáticos", monto: "8300.00", medio_pago_id: null, medio_pago_nombre: null, oculto: false, ...auditoria("admin1", "2026-04-02T09:15:00Z") },
  { id: 7, fecha: "2026-04-10", concepto: "Reparación de heladera", monto: "12000.00", medio_pago_id: null, medio_pago_nombre: null, oculto: true, ...auditoria("admin1", "2026-04-10T14:00:00Z") },
];

// Simula GET /api/gastos?q=&desde=&hasta=&ocultos=&pagina=
export const listarGastosSimulado = (gastos, { q, desde, hasta, ocultos = false, pagina = 1, porPagina = 20 } = {}) => {
  const filtrados = buscarGastos(filtrarGastos(gastos, { desde, hasta, ocultos }), q);
  const numeroDePagina = Math.max(1, Number(pagina) || 1);
  const inicio = (numeroDePagina - 1) * porPagina;
  return {
    items: filtrados.slice(inicio, inicio + porPagina),
    total: filtrados.length,
    pagina: numeroDePagina,
  };
};
