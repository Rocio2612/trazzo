// --- SERVICIO DE CATEGORÍAS (módulo ES) ---
// Habla con el Backend (finanzas-service, a través del Gateway): /categorias.
// Requiere api.js cargado antes (fetchAPI). Las respuestas vienen envueltas en
// { status, categorias: [...] } o { status, categoria: {...} }: acá se desenvuelven.

const listar = async () => (await fetchAPI("/categorias")).categorias ?? [];

export const servicioCategorias = {
    listar,
    crear: async (nombre) => (await fetchAPI("/categorias", "POST", { nombre })).categoria,
    actualizar: async (id, nombre) => (await fetchAPI(`/categorias/${id}`, "PUT", { nombre })).categoria,
    eliminar: (id) => fetchAPI(`/categorias/${id}`, "DELETE"),
};

