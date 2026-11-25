// --- SERVICIO DE REPORTES (módulo ES) ---
// Habla con el Backend (reportes-service, a través del Gateway): GET /reportes?periodo=hoy|mes|anio.
// Requiere api.js cargado antes (fetchAPI). Solo lectura.

export const servicioReportes = {
    obtener: async ({ periodo = "mes" } = {}) => {
        const filtros = new URLSearchParams({ periodo });
        return fetchAPI(`/reportes?${filtros.toString()}`);
    },
};
