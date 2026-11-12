// --- DATOS SIMULADOS DE CATEGORÍAS (hasta que Back publique la API) ---
// Es lo único de Configuración que todavía no tiene Backend (Mi negocio, Personal y Medios de pago ya usan la API).
// Los datos se guardan en el navegador (localStorage) y se pierden al cerrar sesión. Cuando exista el Backend solo hay
// que reemplazar el contenido de estas funciones por llamadas a fetchAPI (cada una ya es asíncrona):
//   categorías:   GET/POST /categorias · PUT/DELETE /categorias/{id}
// Los nombres de campo son los de la tabla productos.categorias. Como en la base, cada categoría tiene `activo`:
// eliminarla la deja inactiva (lo ya cargado conserva su categoría) y su nombre sigue ocupado, porque el índice único
// cuenta también las desactivadas.

const CLAVE = "trazzo_mock_categorias";

const INICIALES = () => [
  { id: 1, nombre: "Remeras", activo: true },
  { id: 2, nombre: "Pantalones", activo: true },
];

const errorDeCampo = (campo, mensaje) => Object.assign(new Error(mensaje), { errores: { [campo]: mensaje } });
const estaActiva = (categoria) => categoria.activo !== false;

const leer = () => {
  try {
    const guardado = JSON.parse(localStorage.getItem(CLAVE));
    if (Array.isArray(guardado)) return guardado;
  } catch {
    // Sin almacenamiento o con datos dañados: se parte de las categorías iniciales.
  }
  return INICIALES();
};

const guardar = (categorias) => {
  try {
    localStorage.setItem(CLAVE, JSON.stringify(categorias));
  } catch {
    // Sin almacenamiento: la pantalla funciona igual, pero no se conservan los cambios.
  }
};

const nombreOcupado = (categorias, nombre, idActual = null) =>
  categorias.some((c) => c.id !== idActual && c.nombre.trim().toLowerCase() === nombre.trim().toLowerCase());

const errorNombreOcupado = () => errorDeCampo("nombre", "Ya existe una categoría con ese nombre (puede estar eliminada).");

export const servicioCategorias = {
  listar: async () => leer().filter(estaActiva).map((c) => ({ ...c })),

  crear: async (nombre) => {
    const categorias = leer();
    if (nombreOcupado(categorias, nombre)) throw errorNombreOcupado();
    const categoria = { id: Math.max(9, ...categorias.map((c) => c.id)) + 1, nombre, activo: true };
    categorias.push(categoria);
    guardar(categorias);
    return { ...categoria };
  },

  actualizar: async (id, nombre) => {
    const categorias = leer();
    if (nombreOcupado(categorias, nombre, id)) throw errorNombreOcupado();
    const categoria = Object.assign(categorias.find((c) => c.id === id), { nombre });
    guardar(categorias);
    return { ...categoria };
  },

  eliminar: async (id) => {
    const categorias = leer();
    categorias.find((c) => c.id === id).activo = false;
    guardar(categorias);
  },
};
