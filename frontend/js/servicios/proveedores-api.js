// Servicio real de Proveedores (reemplaza a mocks/proveedores.js)
// Requiere api.js cargado antes (fetchAPI). API_URL ya incluye /api.

export const servicioProveedores = {
    // GET /proveedores?q=&ocultos=  → { status, items: [...] }
    listar: async ({ q = "", ocultos = false } = {}) => {
        const params = new URLSearchParams({ q, ocultos: String(ocultos) });
        const data = await fetchAPI(`/proveedores?${params}`);
        return data?.items || [];
    },

    // POST /proveedores
    crear: (datos) => fetchAPI("/proveedores", "POST", datos),

    // PUT /proveedores/{id}
    actualizar: (id, datos) => fetchAPI(`/proveedores/${id}`, "PUT", datos),

    // PATCH /proveedores/{id}/visibilidad  body: { activo }
    // La pantalla manda oculto=true para ocultar, y el backend espera activo (lo contrario).
    cambiarOculto: (id, oculto) => fetchAPI(`/proveedores/${id}/visibilidad`, "PATCH", { activo: !oculto }),

    // DELETE /proveedores/{id}
    eliminar: (id) => fetchAPI(`/proveedores/${id}`, "DELETE"),
};
