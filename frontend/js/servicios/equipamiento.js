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
};