// --- MENSAJE REUTILIZABLE "SIN CATEGORÍAS" / "SIN MEDIOS DE PAGO" (módulo ES) ---
// Se muestra en las pantallas que ofrecen una lista de opciones (Productos, Ventas, Gastos, Pagos)
// cuando el Admin todavía no cargó ninguna, para que sepan dónde crearlas (Administración > Configuración).
//
// Uso:
//   import { crearSinOpciones } from "./componentes/sin-opciones.js";
//   if (categorias.length === 0) contenedor.append(crearSinOpciones("categorias"));
//
// Por defecto lleva un enlace a la pestaña correspondiente. Un Empleado no puede entrar a Configuración,
// así que para él (puedeHacer("categorias", "crear") es falso) se muestra solo el texto.

export const TIPOS_SIN_OPCIONES = {
  categorias: {
    texto: "Sin categorías",
    ayuda: "Todavía no hay categorías cargadas.",
    destino: "configuracion.html#categorias",
    modulo: "categorias",
  },
  medios_pago: {
    texto: "Sin medios de pago",
    ayuda: "Todavía no hay medios de pago cargados.",
    destino: "configuracion.html#medios-pago",
    modulo: "medios_pago",
  },
};

export function crearSinOpciones(tipo = "categorias", { conEnlace = true } = {}) {
  const datos = TIPOS_SIN_OPCIONES[tipo];
  if (!datos) throw new RangeError(`tipo debe ser uno de: ${Object.keys(TIPOS_SIN_OPCIONES).join(", ")}`);

  const contenedor = document.createElement("p");
  contenedor.className = "sin-opciones";
  contenedor.dataset.testid = `sin-opciones-${tipo}`;

  const texto = document.createElement("strong");
  texto.textContent = datos.texto;
  contenedor.append(texto, ` · ${datos.ayuda}`);

  // `puedeHacer` viene de roles.js (script común de todas las pantallas).
  const puedeCrear = typeof puedeHacer === "function" && puedeHacer(datos.modulo, "crear");
  if (conEnlace && puedeCrear) {
    const enlace = document.createElement("a");
    enlace.href = datos.destino;
    enlace.textContent = "Crear ahora";
    contenedor.append(" ", enlace);
  }
  return contenedor;
}
