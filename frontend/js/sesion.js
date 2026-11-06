// --- DATOS DE LA SESIÓN ACTUAL (módulo ES) ---
// Lee el token que guardó el login. Requiere roles.js cargado antes (decodificarToken).
// Es solo para mostrar y ocultar cosas: el Backend es quien valida cada acción.

// { id, usuario, rol } con el rol tal como viene en el token ("PROPIETARIO", "ADMIN" o "CAJERO").
export const obtenerSesion = () => {
  const payload = decodificarToken(localStorage.getItem("trazzo_access_token"));
  return {
    id: payload?.usuario_id ?? null,
    usuario: payload?.usuario || "",
    rol: String(payload?.rol || "").toUpperCase(),
  };
};
