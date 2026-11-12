// --- SERVICIO DE GASTOS OPERATIVOS (módulo ES) ---
// Habla con el Backend (finanzas-service, a través del Gateway): /gastos.
// Requiere api.js cargado antes (fetchAPI). Las respuestas vienen envueltas: acá se desenvuelven.

export const servicioGastos = {
  // Gastos del período (desde y hasta en aaaa-mm-dd, inclusivos y opcionales), del más nuevo al más viejo, y el
  // resumen del mismo período: { gastos: [...], resumen: { total_gastos, cantidad_operaciones } }.
  listar: async ({ desde, hasta } = {}) => {
    const filtros = new URLSearchParams();
    if (desde) filtros.set("desde", desde);
    if (hasta) filtros.set("hasta", hasta);
    const consulta = filtros.toString();
    const data = await fetchAPI(`/gastos${consulta ? `?${consulta}` : ""}`);
    return { gastos: data.gastos ?? [], resumen: data.resumen ?? { total_gastos: 0, cantidad_operaciones: 0 } };
  },

  // { fecha, concepto, monto, medio_pago_id } -> el gasto creado.
  crear: async (datos) => (await fetchAPI("/gastos", "POST", datos)).gasto,

  // Mismos campos que al crear. El Backend todavía tiene que publicar PUT /gastos/{id}.
  actualizar: async (id, datos) => (await fetchAPI(`/gastos/${id}`, "PUT", datos)).gasto,

  // El Backend borra el gasto de verdad (no se puede deshacer).
  eliminar: (id) => fetchAPI(`/gastos/${id}`, "DELETE"),
};
