export const servicioInsumos = {
  listar: async () => {
    const data = await fetchAPI("/bienes-gasto");
    return { 
      insumos: data.bienes_gasto ?? [], 
      resumen: data.resumen ?? { valor_inventario_total: 0, total_articulos: 0 } 
    };
  },
  crear: async (datos) => (await fetchAPI("/bienes-gasto", "POST", datos)).bien_gasto,
  reponer: async (id, datos) => await fetchAPI(`/bienes-gasto/${id}/reposicion`, "POST", datos),
  consumir: async (id, datos) => await fetchAPI(`/bienes-gasto/${id}/consumo`, "POST", datos),
  ocultar: (id) => fetchAPI(`/bienes-gasto/${id}/ocultar`, "PATCH"),
  eliminar: (id) => fetchAPI(`/bienes-gasto/${id}`, "DELETE"),
  // NUEVOS ENDPOINTS (Quedan listos para cuando el back los cree)
  editar: (id, datos) => fetchAPI(`/bienes-gasto/${id}`, "PUT", datos),
  restaurar: (id) => fetchAPI(`/bienes-gasto/${id}/restaurar`, "PATCH"),
};