// --- DE DÓNDE SALEN LOS DATOS DE VENTAS (módulo ES) ---
// Las pantallas de Ventas piden todo desde acá. Mientras Back no publique /ventas, usan los datos simulados de
// mocks/ventas.js (así todos pueden ver las pantallas con ejemplos). Cuando Back publique las rutas, se pone
// USAR_MOCKS en false y las pantallas pasan a hablar con el Backend (servicios/ventas.js, servicios/medios-pago.js
// y servicios/negocio.js), sin tocar nada más. Los tests con API simulada eligen la API real guardando
// localStorage["trazzo_ventas_usar_api"] = "1" antes de abrir la pantalla.

const USAR_MOCKS = false;

const usarApi = () => {
  try {
    return !USAR_MOCKS || localStorage.getItem("trazzo_ventas_usar_api") === "1";
  } catch {
    return !USAR_MOCKS;
  }
};

// Se carga solo el origen elegido: con datos simulados no hace falta el resto.
const origen = usarApi()
  ? { ...(await import("./servicios/ventas.js")), ...(await import("./servicios/medios-pago.js")), ...(await import("./servicios/negocio.js")) }
  : await import("./mocks/ventas.js");

export const { servicioVentas, servicioClientesDeVentas, servicioProductosDeVentas, cargarMediosPago, servicioNegocio } = origen;
