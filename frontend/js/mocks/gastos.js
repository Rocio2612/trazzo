// --- DATOS SIMULADOS DE GASTOS (hasta que Back publique /api/gastos) ---
// Mismo formato que va a devolver la API: dinero como texto con 2 decimales, fechas en aaaa-mm-dd
// y listas como { items, total, pagina }. Los nombres de campo son los de la tabla finanzas.gastos_operativos:
// creado_por y modificado_por son el nombre del usuario (texto), y modificado_* queda vacío hasta que se edita.
// `activo` es verdadero mientras el gasto existe: eliminar un gasto lo deja en falso (la lista y los totales
// solo cuentan los activos).

import { buscarGastos, filtrarGastos } from "../gastos.js";

const auditoria = (usuario, en) => ({
  activo: true,
  creado_por: usuario,
  creado_en: en,
  modificado_por: null,
  modificado_en: null,
});

export const GASTOS_EJEMPLO = [
  { id: 1, fecha: "2026-03-01", concepto: "Alquiler del local", monto: "450000.00", medio_pago_id: null, medio_pago_nombre: null, ...auditoria("admin1", "2026-03-01T10:00:00Z") },
  { id: 2, fecha: "2026-03-05", concepto: "Luz", monto: "38250.50", medio_pago_id: null, medio_pago_nombre: null, ...auditoria("admin1", "2026-03-05T11:30:00Z") },
  { id: 3, fecha: "2026-03-05", concepto: "Internet", monto: "21000.00", medio_pago_id: null, medio_pago_nombre: null, ...auditoria("admin1", "2026-03-05T11:35:00Z") },
  { id: 4, fecha: "2026-03-12", concepto: "Flete de mercadería", monto: "15500.75", medio_pago_id: null, medio_pago_nombre: null, ...auditoria("admin1", "2026-03-12T16:00:00Z") },
  { id: 5, fecha: "2026-04-01", concepto: "Alquiler del local", monto: "450000.00", medio_pago_id: null, medio_pago_nombre: null, ...auditoria("admin1", "2026-04-01T10:00:00Z") },
  { id: 6, fecha: "2026-04-02", concepto: "Viáticos", monto: "8300.00", medio_pago_id: null, medio_pago_nombre: null, ...auditoria("admin1", "2026-04-02T09:15:00Z") },
  { id: 7, fecha: "2026-04-10", concepto: "Reparación de heladera", monto: "12000.00", medio_pago_id: null, medio_pago_nombre: null, ...auditoria("admin1", "2026-04-10T14:00:00Z") },
];

// Simula GET /api/gastos?q=&desde=&hasta=&pagina= (solo los gastos activos: los eliminados no se listan)
export const listarGastosSimulado = (gastos, { q, desde, hasta, pagina = 1, porPagina = 20 } = {}) => {
  const activos = gastos.filter((g) => g.activo !== false);
  const filtrados = buscarGastos(filtrarGastos(activos, { desde, hasta }), q);
  const numeroDePagina = Math.max(1, Number(pagina) || 1);
  const inicio = (numeroDePagina - 1) * porPagina;
  return {
    items: filtrados.slice(inicio, inicio + porPagina),
    total: filtrados.length,
    pagina: numeroDePagina,
  };
};
