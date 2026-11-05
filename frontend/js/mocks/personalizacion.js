// --- DATOS SIMULADOS DE PERSONALIZACIÓN (hasta que Back publique la API) ---
// Mientras tanto los datos viven en memoria y se pierden al recargar. Cuando exista el Backend solo hay
// que reemplazar el contenido de estas funciones por llamadas a fetchAPI (cada una ya es asíncrona):
//   negocio:      PUT    /negocio
//   personal:     GET/POST /personal · PUT /personal/{id} · PATCH /personal/{id}/habilitar | /deshabilitar · DELETE /personal/{id}
//   categorías:   GET/POST /categorias · PUT/DELETE /categorias/{id}
//   medios pago:  GET/POST /medios-pago · PUT/DELETE /medios-pago/{id}
// Los nombres de campo son provisorios hasta cerrar el contrato con Back.

const errorDeCampo = (campo, mensaje) => Object.assign(new Error(mensaje), { errores: { [campo]: mensaje } });

// --- Negocio -----------------------------------------------------------------------
const negocio = {
  identificador: "kioscochicha",
  nombre: "Kiosco Chicha",
  rubro: "Kiosco",
  categoria_impositiva: "MONOTRIBUTISTA",
};

export const servicioNegocio = {
  obtener: async () => ({ ...negocio }),
  guardar: async (datos) => Object.assign(negocio, datos) && { ...negocio },
};

// --- Personal ----------------------------------------------------------------------
const personal = [
  { id: 1, usuario: "propietario1", correo: "ana@kioscochicha.com", nombre: "Ana", apellido: "Pérez", dni: "30123456", rol: "PROPIETARIO", activo: true },
  { id: 2, usuario: "admin2", correo: "luis@kioscochicha.com", nombre: "Luis", apellido: "Gómez", dni: null, rol: "ADMIN", activo: true },
  { id: 3, usuario: "cajero1", correo: "sofia@kioscochicha.com", nombre: "Sofía", apellido: "Díaz", dni: "40222333", rol: "CAJERO", activo: true },
  { id: 4, usuario: "cajero2", correo: "marcos@kioscochicha.com", nombre: "Marcos", apellido: "Ruiz", dni: null, rol: "CAJERO", activo: false },
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
    const persona = { id: siguienteIdPersona++, ...resto, activo: true };
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
const listas = {
  categorias: [
    { id: 1, nombre: "Remeras" },
    { id: 2, nombre: "Pantalones" },
  ],
  medios_pago: [
    { id: 1, nombre: "Efectivo", por_defecto: true },
    { id: 2, nombre: "Transferencia", por_defecto: false },
  ],
};
let siguienteIdLista = 10;

export const servicioLista = (tipo) => ({
  listar: async () => listas[tipo].map((e) => ({ ...e })),
  crear: async (nombre) => {
    const elemento = { id: siguienteIdLista++, nombre, por_defecto: false };
    listas[tipo].push(elemento);
    return { ...elemento };
  },
  actualizar: async (id, nombre) => ({ ...Object.assign(listas[tipo].find((e) => e.id === id), { nombre }) }),
  eliminar: async (id) => {
    const elemento = listas[tipo].find((e) => e.id === id);
    if (elemento.por_defecto) throw new Error("Efectivo es el medio de pago por defecto y no se puede eliminar.");
    listas[tipo].splice(listas[tipo].indexOf(elemento), 1);
  },
});
