// --- SERVICIO DE "MI NEGOCIO" (módulo ES) ---
// Habla con el Backend (auth-service, a través del Gateway): GET y PUT /auth/negocio.
// Requiere api.js cargado antes (fetchAPI), que ya manda el token y renueva la sesión.
// Las respuestas vienen envueltas en { status, negocio: {...} }: acá se desenvuelven.

export const servicioNegocio = {
  // { identificador, nombre_comercial, rubro, categoria_impositiva, fecha_registro }
  obtener: async () => (await fetchAPI("/auth/negocio")).negocio,

  // Devuelve el negocio actualizado (el Backend no incluye fecha_registro en esta respuesta).
  guardar: async (datos) => {
    // El Backend ignora un rubro null (conserva el anterior), así que "Sin especificar" viaja como texto vacío.
    const cuerpo = { ...datos, rubro: datos.rubro ?? "" };
    return (await fetchAPI("/auth/negocio", "PUT", cuerpo)).negocio;
  },
};
