export const servicioEquipamiento = {
  listar: async () => {
    const data = await fetchAPI("/bienes-uso");
    return { 
      bienes: data.bienes_uso ?? [], 
      resumen: data.resumen ?? { patrimonio_total: 0, unidades_totales: 0, cantidad_bienes: 0 } 
    };
  },
  crear: async (datos) => (await fetchAPI("/bienes-uso", "POST", datos)).bien_uso,
  ocultar: (id) => fetchAPI(`/bienes-uso/${id}/ocultar`, "PATCH"),
  eliminar: (id) => fetchAPI(`/bienes-uso/${id}`, "DELETE"),
  // NUEVOS ENDPOINTS (Quedan listos para cuando el back los cree)
  editar: (id, datos) => fetchAPI(`/bienes-uso/${id}`, "PUT", datos),
  restaurar: (id) => fetchAPI(`/bienes-uso/${id}/restaurar`, "PATCH"),
};