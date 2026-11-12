// --- SERVICIO DEL PERSONAL (módulo ES) ---
// Habla con el Backend (auth-service, a través del Gateway): /auth/personal.
// Requiere api.js cargado antes (fetchAPI). Los errores llegan como Error con status, mensaje y, cuando el
// Backend los manda, `errores` ({ campo: mensaje }): la pantalla los muestra junto a cada campo.

export const servicioPersonal = {
  // [{ id, usuario, correo, nombre, apellido, dni, rol, activo, fecha_creacion }]
  listar: async () => (await fetchAPI("/auth/personal")).personal,

  // El Backend devuelve la persona creada (sin correo ni dni): la pantalla vuelve a pedir la lista.
  crear: async (datos) => (await fetchAPI("/auth/personal", "POST", datos)).usuario,

  actualizar: (id, datos) => fetchAPI(`/auth/personal/${id}`, "PUT", datos),

  habilitar: (id) => fetchAPI(`/auth/personal/${id}/habilitar`, "PATCH"),

  deshabilitar: (id) => fetchAPI(`/auth/personal/${id}/deshabilitar`, "PATCH"),

  eliminar: (id) => fetchAPI(`/auth/personal/${id}`, "DELETE"),
};
