// --- ROLES Y PERMISOS (solo UX) ---
// Ocultar elementos NO protege nada: el Backend es quien valida cada acción.
// Esta matriz refleja lo acordado en los módulos del sistema.

// Nombres de rol tal como llegan en el JWT (campo "rol").
// Pendiente de acordar con Back: si cambian, se modifican solo acá.
const ROL_ADMIN = ["ADMIN", "PROPIETARIO"];
const ROL_CAJERO = ["CAJERO"];

// Matriz rol × módulo × acción.
const PERMISOS = {
  admin: {
    personal: ["ver", "crear", "editar", "ocultar", "eliminar"],
    categorias: ["ver", "crear", "editar", "eliminar"],
    medios_pago: ["ver", "crear", "editar", "eliminar"],
    notificaciones: ["ver", "eliminar"],
    productos: ["ver", "crear", "editar", "reponer", "ocultar", "eliminar"],
    bienes_uso: ["ver", "crear", "editar", "ocultar", "eliminar"],
    insumos: ["ver", "crear", "editar", "ocultar", "eliminar"],
    gastos: ["ver", "crear", "editar", "eliminar"],
    clientes: ["ver", "crear", "editar", "ocultar", "eliminar"],
    ventas: ["ver", "crear", "editar", "ocultar", "eliminar"],
    cuentas_corrientes: ["ver", "crear", "editar", "ocultar", "eliminar"],
    proveedores: ["ver", "crear", "editar", "ocultar", "eliminar"],
    reportes: ["ver"],
  },
  cajero: {
    notificaciones: ["ver", "eliminar"],
    productos: ["ver", "crear", "editar", "reponer"],
    ventas: ["ver", "crear", "editar"],
  },
};

const decodificarToken = (token) => {
  try {
    const base64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    return null;
  }
};

// Devuelve "admin", "cajero" o null si no hay token o el rol es desconocido.
const obtenerRol = () => {
  const token = localStorage.getItem("trazzo_access_token");
  const payload = token ? decodificarToken(token) : null;
  if (!payload || !payload.rol) return null;
  const rol = String(payload.rol).toUpperCase();
  if (ROL_ADMIN.includes(rol)) return "admin";
  if (ROL_CAJERO.includes(rol)) return "cajero";
  return null;
};

// Por defecto se deniega: un rol desconocido no ve nada.
const puedeHacer = (modulo, accion = "ver") => {
  const rol = obtenerRol();
  const acciones = rol && PERMISOS[rol][modulo];
  return Boolean(acciones && acciones.includes(accion));
};

// Oculta los elementos con data-modulo="..." [data-accion="..."] sin permiso.
// Si no tienen data-accion se evalúa la acción "ver".
const aplicarPermisos = (raiz = document) => {
  raiz.querySelectorAll("[data-modulo]").forEach((el) => {
    const { modulo, accion } = el.dataset;
    if (!puedeHacer(modulo, accion || "ver")) {
      el.hidden = true;
      el.style.setProperty("display", "none", "important");
    }
  });
};

// Aplica los permisos al cargar y a lo que se renderice después (tablas, modales).
const iniciarPermisos = () => {
  aplicarPermisos();
  new MutationObserver(() => aplicarPermisos()).observe(document.body, {
    childList: true,
    subtree: true,
  });
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", iniciarPermisos);
} else {
  iniciarPermisos();
}
