// --- LÓGICA DE PERSONALIZACIÓN (módulo ES, sin pantalla) ---
// Reglas del Módulo 3: datos del negocio, personal y listas maestras (categorías y medios de pago).
// Cada validador devuelve { campo: mensaje }; vacío si todo está bien. El Backend repite todas las
// reglas: esto es solo UX. Los nombres de campo son provisorios hasta cerrar el contrato con Back.

export const ROLES = { PROPIETARIO: "PROPIETARIO", ADMIN: "ADMIN", CAJERO: "CAJERO" };

// Los administradores ven "Administrador" y los cajeros "Empleado" (así se llama en la pantalla).
export const ETIQUETA_ROL = {
  PROPIETARIO: "Propietario",
  ADMIN: "Administrador",
  CAJERO: "Empleado",
};

export const CATEGORIAS_IMPOSITIVAS = [
  { valor: "RESPONSABLE_INSCRIPTO", texto: "Responsable Inscripto" },
  { valor: "MONOTRIBUTISTA", texto: "Monotributista" },
  { valor: "EXENTO", texto: "Exento" },
];

// Rubros generales (los mismos del registro y algunos más). Además se puede escribir uno propio.
export const RUBROS = ["Gastronomía", "Indumentaria", "Tecnología", "Kiosco", "Almacén", "Librería"];

const vacio = (valor) => valor === null || valor === undefined || String(valor).trim() === "";

// --- Campos de una persona ---------------------------------------------------------

export const validarUsuario = (valor) => {
  if (vacio(valor)) return "Rellene el usuario.";
  const usuario = String(valor);
  if (!/^[a-z0-9]+$/.test(usuario)) return "El usuario solo puede tener letras minúsculas y números, sin símbolos ni espacios.";
  if (usuario.length < 4 || usuario.length > 20) return "El usuario debe tener entre 4 y 20 caracteres.";
  return null;
};

export const validarContrasena = (valor) => {
  if (vacio(valor)) return "Rellene la contraseña.";
  const clave = String(valor);
  if (clave.length < 8 || clave.length > 64) return "La contraseña debe tener entre 8 y 64 caracteres.";
  if (!/[A-Z]/.test(clave)) return "La contraseña debe incluir al menos una letra mayúscula.";
  if (!/[a-z]/.test(clave)) return "La contraseña debe incluir al menos una letra minúscula.";
  if (!/\d/.test(clave)) return "La contraseña debe incluir al menos un número.";
  if (!/[^A-Za-z0-9]/.test(clave)) return "La contraseña debe incluir al menos un símbolo especial.";
  return null;
};

export const validarCorreo = (valor) => {
  if (vacio(valor)) return "Rellene el correo.";
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(valor).trim()) ? null : "El correo no es válido.";
};

// DNI: opcional. Si se carga, 7 u 8 números (sin puntos).
export const validarDni = (valor) => {
  if (vacio(valor)) return null;
  return /^\d{7,8}$/.test(String(valor).trim()) ? null : "El DNI debe tener 7 u 8 números, sin puntos.";
};

// Alta o edición de una persona del personal. En una edición la contraseña es opcional:
// vacía significa "no cambiar". Si se escribe, debe cumplir las mismas reglas.
export const validarPersona = (datos = {}, { esNuevo = true } = {}) => {
  const errores = {};
  const poner = (campo, mensaje) => {
    if (mensaje) errores[campo] = mensaje;
  };

  poner("usuario", validarUsuario(datos.usuario));
  poner("password", esNuevo || !vacio(datos.password) ? validarContrasena(datos.password) : null);
  poner("correo", validarCorreo(datos.correo));
  poner("nombre", vacio(datos.nombre) ? "Rellene el nombre." : null);
  poner("apellido", vacio(datos.apellido) ? "Rellene el apellido." : null);
  poner("dni", validarDni(datos.dni));
  poner("rol", [ROLES.ADMIN, ROLES.CAJERO].includes(datos.rol) ? null : "Elija el rol.");
  return errores;
};

// Datos que se envían al Backend. En una edición, sin contraseña no se manda el campo.
export const armarPayloadPersona = (datos, { esNuevo = true } = {}) => {
  const payload = {
    usuario: String(datos.usuario ?? "").trim(),
    correo: String(datos.correo ?? "").trim(),
    nombre: String(datos.nombre ?? "").trim(),
    apellido: String(datos.apellido ?? "").trim(),
    dni: vacio(datos.dni) ? null : String(datos.dni).trim(),
    rol: datos.rol,
  };
  if (esNuevo || !vacio(datos.password)) payload.password = datos.password;
  return payload;
};

// Búsqueda por nombre, apellido, usuario o correo, sin distinguir mayúsculas.
export const buscarPersonal = (personal, texto) => {
  const buscado = String(texto ?? "").trim().toLowerCase();
  if (!buscado) return personal;
  return personal.filter((p) =>
    [p.nombre, p.apellido, p.usuario, p.correo].some((campo) => String(campo ?? "").toLowerCase().includes(buscado)),
  );
};

// --- Qué puede hacer quien mira la lista --------------------------------------------
// `actor` es { id, rol } de la sesión; `objetivo` es la fila; `personal` es la lista completa.
// Cada función devuelve { permitido, motivo }: el motivo explica por qué no (para avisarlo).

export const MOTIVO_ULTIMO_ADMIN = "Siempre debe quedar al menos un administrador activo.";

const SI = { permitido: true, motivo: "" };
const NO = (motivo) => ({ permitido: false, motivo });

const esAdministrador = (persona) => persona.rol === ROLES.PROPIETARIO || persona.rol === ROLES.ADMIN;

// Cuántos administradores (propietario incluido) están habilitados.
export const contarAdministradoresActivos = (personal) =>
  personal.filter((p) => esAdministrador(p) && p.activo).length;

// Editar: el Propietario edita a todos; un administrador, a los empleados y a sí mismo.
export const puedeEditarPersona = (actor, objetivo) => {
  if (actor.rol === ROLES.PROPIETARIO) return SI;
  if (objetivo.id === actor.id || objetivo.rol === ROLES.CAJERO) return SI;
  return NO("Solo el Propietario puede editar a otros administradores.");
};

// Habilitar, deshabilitar y eliminar comparten las reglas de base.
const puedeGestionar = (actor, objetivo) => {
  if (objetivo.rol === ROLES.PROPIETARIO) return NO("El Propietario no se puede deshabilitar ni eliminar.");
  if (objetivo.id === actor.id) return NO("No podés hacerlo sobre tu propia cuenta.");
  if (objetivo.rol === ROLES.ADMIN && actor.rol !== ROLES.PROPIETARIO) {
    return NO("Solo el Propietario puede gestionar a otros administradores.");
  }
  return SI;
};

export const puedeHabilitarPersona = (actor, objetivo) => {
  if (objetivo.activo) return NO("Ya está habilitado.");
  return puedeGestionar(actor, objetivo);
};

export const puedeDeshabilitarPersona = (actor, objetivo, personal) => {
  if (!objetivo.activo) return NO("Ya está deshabilitado.");
  const base = puedeGestionar(actor, objetivo);
  if (!base.permitido) return base;
  if (esAdministrador(objetivo) && contarAdministradoresActivos(personal) <= 1) {
    return NO(MOTIVO_ULTIMO_ADMIN);
  }
  return SI;
};

export const puedeEliminarPersona = (actor, objetivo, personal) => {
  const base = puedeGestionar(actor, objetivo);
  if (!base.permitido) return base;
  if (esAdministrador(objetivo) && objetivo.activo && contarAdministradoresActivos(personal) <= 1) {
    return NO(MOTIVO_ULTIMO_ADMIN);
  }
  return SI;
};

// --- Datos del negocio -------------------------------------------------------------

export const validarNegocio = (datos = {}) => {
  const errores = {};
  if (vacio(datos.nombre)) errores.nombre = "Rellene el nombre o razón social.";
  else if (String(datos.nombre).trim().length > 100) errores.nombre = "El nombre no puede superar los 100 caracteres.";
  if (String(datos.rubro ?? "").trim().length > 50) errores.rubro = "El rubro no puede superar los 50 caracteres.";
  if (!CATEGORIAS_IMPOSITIVAS.some((c) => c.valor === datos.categoria_impositiva)) {
    errores.categoria_impositiva = "Elija la categoría impositiva.";
  }
  return errores;
};

export const armarPayloadNegocio = (datos) => ({
  nombre: String(datos.nombre ?? "").trim(),
  rubro: vacio(datos.rubro) ? null : String(datos.rubro).trim(),
  categoria_impositiva: datos.categoria_impositiva,
});

// --- Listas maestras (categorías y medios de pago) ---------------------------------

// `existentes` son los nombres ya cargados (sin contar el que se está editando).
// `articulo` completa el mensaje de repetido: "Ya existe una categoría con ese nombre."
export const validarNombreLista = (valor, existentes = [], articulo = "un elemento") => {
  if (vacio(valor)) return "Rellene el nombre.";
  const nombre = String(valor).trim();
  if (nombre.length > 50) return "El nombre no puede superar los 50 caracteres.";
  const repetido = existentes.some((n) => String(n).trim().toLowerCase() === nombre.toLowerCase());
  return repetido ? `Ya existe ${articulo} con ese nombre.` : null;
};
