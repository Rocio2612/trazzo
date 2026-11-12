// --- MENSAJES DE ERROR DE LAS LLAMADAS AL BACKEND (módulo ES) ---
// fetchAPI lanza un Error con `status` cuando el servidor respondió con un error, y un error del navegador
// (sin `status`, en inglés: "Failed to fetch") cuando no hubo conexión. Esto deja un mensaje claro para el usuario.

const MENSAJE_POR_DEFECTO_DE_FETCHAPI = "Error en la petición";

export const mensajeDeError = (error, textoPorDefecto) => {
  if (error?.status === undefined) return "No se pudo conectar con el servidor.";
  if (!error.message || error.message === MENSAJE_POR_DEFECTO_DE_FETCHAPI) return textoPorDefecto;
  return error.message;
};
