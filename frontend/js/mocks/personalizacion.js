// --- DATOS SIMULADOS DE PERSONALIZACIÓN (hasta que Back publique la API) ---
// Mientras tanto los datos viven en memoria y se pierden al recargar. Cuando exista el Backend solo hay
// que reemplazar el contenido de estas funciones por llamadas a fetchAPI (cada una ya es asíncrona):
//   negocio:      PUT    /negocio
//   personal:     GET/POST /personal · PUT /personal/{id} · PATCH /personal/{id}/habilitar | /deshabilitar · DELETE /personal/{id}
//   categorías:   GET/POST /categorias · PUT/DELETE /categorias/{id}
//   medios pago:  GET/POST /medios-pago · PUT/DELETE /medios-pago/{id}
// Los nombres de campo son los de las tablas de la base: auth.emprendimientos (nombre_comercial),
// auth.usuarios y finanzas.medios_pago (es_predeterminado).

const errorDeCampo = (campo, mensaje) => Object.assign(new Error(mensaje), { errores: { [campo]: mensaje } });

// --- Negocio -----------------------------------------------------------------------
const negocio = {
  identificador: "kioscochicha",
  nombre_comercial: "Kiosco Chicha",
  rubro: "Kiosco",
  categoria_impositiva: "MONOTRIBUTISTA",
  fecha_registro: "2026-01-15T14:00:00Z",
};

export const servicioNegocio = {
  obtener: async () => ({ ...negocio }),
  guardar: async (datos) => Object.assign(negocio, datos) && { ...negocio },
};

// --- Personal ----------------------------------------------------------------------
const personal = [
  { id: 1, usuario: "propietario1", correo: "ana@kioscochicha.com", nombre: "Ana", apellido: "Pérez", dni: "30123456", rol: "PROPIETARIO", activo: true, fecha_creacion: "2026-01-15T14:00:00Z" },
  { id: 2, usuario: "admin2", correo: "luis@kioscochicha.com", nombre: "Luis", apellido: "Gómez", dni: null, rol: "ADMIN", activo: true, fecha_creacion: "2026-02-03T10:30:00Z" },
  { id: 3, usuario: "cajero1", correo: "sofia@kioscochicha.com", nombre: "Sofía", apellido: "Díaz", dni: "40222333", rol: "CAJERO", activo: true, fecha_creacion: "2026-02-20T12:15:00Z" },
  { id: 4, usuario: "cajero2", correo: "marcos@kioscochicha.com", nombre: "Marcos", apellido: "Ruiz", dni: null, rol: "CAJERO", activo: false, fecha_creacion: "2026-03-10T09:45:00Z" },
];
let siguienteIdPersona = 5;

const verificarRepetidos = (datos, idActual = null) => {
  const otros = personal.filter((p) => p.id !== idActual);
  if (otros.some((p) => p.usuario === datos.usuario)) {
    throw errorDeCampo("usuario", "Ese usuario ya existe en este negocio.");
  }
  if (otros.some((p) => p.correo.toLowerCase() === datos.correo.toLowerCase())) {
    throw errorDeCampo("correo", "Ese correo ya está registrado en este negocio.");
  }
};

const buscarPersona = (id) => personal.find((p) => p.id === id);

export const servicioPersonal = {
  listar: async () => personal.map((p) => ({ ...p })),
  crear: async (datos) => {
    verificarRepetidos(datos);
    const { password, ...resto } = datos; // la contraseña nunca se guarda ni se devuelve
    const persona = { id: siguienteIdPersona++, ...resto, activo: true, fecha_creacion: new Date().toISOString() };
    personal.push(persona);
    return { ...persona };
  },
  actualizar: async (id, datos) => {
    verificarRepetidos(datos, id);
    const { password, ...resto } = datos;
    return { ...Object.assign(buscarPersona(id), resto) };
  },
  habilitar: async (id) => ({ ...Object.assign(buscarPersona(id), { activo: true }) }),
  deshabilitar: async (id) => ({ ...Object.assign(buscarPersona(id), { activo: false }) }),
  eliminar: async (id) => {
    personal.splice(personal.indexOf(buscarPersona(id)), 1);
  },
};

// --- Listas maestras ---------------------------------------------------------------
// Se guardan en el navegador (localStorage) para que otras pantallas, como Gastos, vean los mismos medios de
// pago y categorías que se cargan en Configuración. Es solo para esta etapa: con el Backend publicado, se
// leen de la API y se borra esto. Al cerrar sesión se limpia (todas las claves "trazzo_" se borran).
const CLAVE_LISTAS = "trazzo_mock_listas";

// Como en la base (productos.categorias y finanzas.medios_pago), cada elemento tiene `activo`: eliminar un elemento
// lo deja inactivo en vez de borrarlo, así lo ya cargado (productos, ventas, gastos) conserva su categoría o medio
// de pago. Los inactivos no se listan ni se ofrecen en otras pantallas, pero su nombre sigue ocupado.
const LISTAS_INICIALES = () => ({
  categorias: [
    { id: 1, nombre: "Remeras", activo: true },
    { id: 2, nombre: "Pantalones", activo: true },
  ],
  medios_pago: [
    { id: 1, nombre: "Efectivo", es_predeterminado: true, activo: true },
    { id: 2, nombre: "Transferencia", es_predeterminado: false, activo: true },
  ],
});

const TEXTOS = {
  categorias: { articulo: "una categoría", eliminado: "eliminada" },
  medios_pago: { articulo: "un medio de pago", eliminado: "eliminado" },
};

const estaActivo = (elemento) => elemento.activo !== false;

// Las listas guardadas antes de usar los nombres de la base traían `por_defecto`: se pasan a `es_predeterminado`
// (solo los medios de pago lo tienen; las categorías no).
const actualizarFormato = (listas) => {
  listas.medios_pago.forEach((m) => {
    if ("por_defecto" in m) {
      m.es_predeterminado = Boolean(m.por_defecto);
      delete m.por_defecto;
    }
  });
  listas.categorias.forEach((c) => delete c.por_defecto);
  return listas;
};

const leerListas = () => {
  try {
    const guardado = JSON.parse(localStorage.getItem(CLAVE_LISTAS));
    if (guardado && Array.isArray(guardado.categorias) && Array.isArray(guardado.medios_pago)) return actualizarFormato(guardado);
  } catch {
    // Sin almacenamiento o con datos dañados: se parte de las listas iniciales.
  }
  return LISTAS_INICIALES();
};

const guardarListas = (listas) => {
  try {
    localStorage.setItem(CLAVE_LISTAS, JSON.stringify(listas));
  } catch {
    // Sin almacenamiento: la pantalla funciona igual, pero otras pantallas no ven los cambios.
  }
};

// Lectura síncrona de una lista guardada ("categorias" o "medios_pago"), para el helper de otras pantallas.
// Solo trae los elementos activos: los eliminados no se ofrecen para registros nuevos.
export const listarListaMock = (tipo) => leerListas()[tipo].filter(estaActivo).map((e) => ({ ...e }));

// La base exige un nombre único por negocio sin distinguir mayúsculas, y el índice cuenta también los elementos
// desactivados (uq_categoria_nombre_tenant, uq_medio_pago_nombre_tenant): un nombre eliminado sigue ocupado.
const nombreOcupado = (lista, nombre, idActual = null) =>
  lista.some((e) => e.id !== idActual && e.nombre.trim().toLowerCase() === nombre.trim().toLowerCase());

const errorNombreOcupado = (tipo) =>
  errorDeCampo("nombre", `Ya existe ${TEXTOS[tipo].articulo} con ese nombre (puede estar ${TEXTOS[tipo].eliminado}).`);

export const servicioLista = (tipo) => ({
  listar: async () => listarListaMock(tipo),
  crear: async (nombre) => {
    const listas = leerListas();
    if (nombreOcupado(listas[tipo], nombre)) throw errorNombreOcupado(tipo);
    const todosLosIds = [...listas.categorias, ...listas.medios_pago].map((e) => e.id);
    // Solo los medios de pago tienen "es_predeterminado"; las categorías no.
    const elemento = { id: Math.max(9, ...todosLosIds) + 1, nombre, activo: true, ...(tipo === "medios_pago" ? { es_predeterminado: false } : {}) };
    listas[tipo].push(elemento);
    guardarListas(listas);
    return { ...elemento };
  },
  actualizar: async (id, nombre) => {
    const listas = leerListas();
    if (nombreOcupado(listas[tipo], nombre, id)) throw errorNombreOcupado(tipo);
    const elemento = Object.assign(listas[tipo].find((e) => e.id === id), { nombre });
    guardarListas(listas);
    return { ...elemento };
  },
  eliminar: async (id) => {
    const listas = leerListas();
    const elemento = listas[tipo].find((e) => e.id === id);
    if (elemento.es_predeterminado) throw new Error("Efectivo es el medio de pago por defecto y no se puede eliminar.");
    elemento.activo = false;
    guardarListas(listas);
  },
});
