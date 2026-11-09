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

// Para comparar textos sin distinguir mayúsculas ni tildes ("Pérez" = "perez").
const sinTildes = (texto) =>
  String(texto ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");

// Largo máximo del correo (mismo criterio que el correo de los usuarios: VARCHAR(120)).
export const CORREO_MAXIMO = 120;

// Sin espacios, con una sola @, sin puntos seguidos ni al principio o al final de cada parte, y un dominio con punto.
export const CORREO_VALIDO = /^[^\s@.]+(\.[^\s@.]+)*@([^\s@.]+\.)+[^\s@.]{2,}$/;

// Correo de una persona del personal (auth.usuarios). La base solo admite letras sin tilde, números y . _ % + -
// antes de la @, y letras, números, puntos y guiones después, con un final de dominio de solo letras
// (chk_usuario_correo_formato). Esta regla es la misma pero más estricta con los puntos, así que todo lo que
// acepta la pantalla lo acepta la base.
export const CORREO_PERSONAL_VALIDO = /^[A-Za-z0-9%+_-]+(\.[A-Za-z0-9%+_-]+)*@([A-Za-z0-9-]+\.)+[A-Za-z]{2,}$/;

// --- Campos de una persona ---------------------------------------------------------

// Cómo se nombra a una persona en la lista y en los avisos. En la base `nombre` y `apellido` pueden ser NULL
// (por ejemplo, el Propietario que se crea al registrar el negocio): sin ninguno de los dos se usa el usuario.
export const nombreCompleto = (persona) =>
  [persona.nombre, persona.apellido]
    .map((parte) => String(parte ?? "").trim())
    .filter(Boolean)
    .join(" ") || String(persona.usuario ?? "");

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
  // El espacio no cuenta como símbolo especial.
  if (!/[^A-Za-z0-9\s]/.test(clave)) return "La contraseña debe incluir al menos un símbolo especial.";
  return null;
};

export const validarCorreo = (valor) => {
  if (vacio(valor)) return "Rellene el correo.";
  const correo = String(valor).trim();
  if (correo.length > CORREO_MAXIMO) return `El correo no puede superar los ${CORREO_MAXIMO} caracteres.`;
  return CORREO_PERSONAL_VALIDO.test(correo) ? null : "El correo no es válido.";
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
  // El Propietario no se crea (en el alta no se ofrece ese rol), pero existe y se puede editar: conserva su rol.
  const rolesValidos = esNuevo ? [ROLES.ADMIN, ROLES.CAJERO] : [ROLES.PROPIETARIO, ROLES.ADMIN, ROLES.CAJERO];
  poner("rol", rolesValidos.includes(datos.rol) ? null : "Elija el rol.");
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

// Búsqueda por nombre, apellido, usuario o correo, sin distinguir mayúsculas ni tildes.
export const buscarPersonal = (personal, texto) => {
  const buscado = sinTildes(texto).trim();
  if (!buscado) return personal;
  return personal.filter((p) => [p.nombre, p.apellido, p.usuario, p.correo].some((campo) => sinTildes(campo).includes(buscado)));
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
  if (vacio(datos.nombre_comercial)) errores.nombre_comercial = "Rellene el nombre o razón social.";
  else if (String(datos.nombre_comercial).trim().length > 100) errores.nombre_comercial = "El nombre no puede superar los 100 caracteres.";
  if (String(datos.rubro ?? "").trim().length > 50) errores.rubro = "El rubro no puede superar los 50 caracteres.";
  if (!CATEGORIAS_IMPOSITIVAS.some((c) => c.valor === datos.categoria_impositiva)) {
    errores.categoria_impositiva = "Elija la categoría impositiva.";
  }
  return errores;
};

export const armarPayloadNegocio = (datos) => ({
  nombre_comercial: String(datos.nombre_comercial ?? "").trim(),
  rubro: vacio(datos.rubro) ? null : String(datos.rubro).trim(),
  categoria_impositiva: datos.categoria_impositiva,
});

// --- Listas maestras (categorías y medios de pago) ---------------------------------

// `existentes` son los nombres ya cargados (sin contar el que se está editando).
// `articulo` completa el mensaje de repetido: "Ya existe una categoría con ese nombre."
// `maximo` es el largo de la columna: 100 en productos.categorias y 50 en finanzas.medios_pago.
export const validarNombreLista = (valor, existentes = [], articulo = "un elemento", maximo = 50) => {
  if (vacio(valor)) return "Rellene el nombre.";
  const nombre = String(valor).trim();
  if (nombre.length > maximo) return `El nombre no puede superar los ${maximo} caracteres.`;
  const repetido = existentes.some((n) => String(n).trim().toLowerCase() === nombre.toLowerCase());
  return repetido ? `Ya existe ${articulo} con ese nombre.` : null;
};
