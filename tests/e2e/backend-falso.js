// --- BACKEND FALSO PARA LOS TESTS E2E ---
// Simula, dentro del navegador de Playwright, los endpoints del Gateway que usan Mi negocio, Configuración
// (Personal y Medios de pago) y Gastos, con las reglas que tiene el Backend real y los formatos de error por
// campo que acordaron ({ errores: { campo: mensaje } }). Parte de los mismos datos de ejemplo de siempre.
//
//   const backend = await simularBackend(page, { rol: "PROPIETARIO", semilla: (estado) => { ... } });
//   backend.llamadas                         -> todo lo que pidió la pantalla ({ metodo, ruta, query, body })
//   backend.enviados("POST", "/gastos")      -> los cuerpos enviados a ese endpoint (los ids van como :id)
//   backend.fallar("PUT /auth/negocio", { status: 500, body: {...} })   -> responde otra cosa a ese endpoint
//   backend.demorar("POST /gastos", 600)     -> tarda en responder (milisegundos)
//   backend.estado                           -> los datos en memoria, para armar o revisar casos
//
// El archivo es independiente de helpers.js: lee la dirección de la API de frontend/js/config.js.

const fs = require("fs");
const path = require("path");

const API = (() => {
  const config = fs.readFileSync(path.join(__dirname, "../../frontend/js/config.js"), "utf8");
  const encontrada = /API_URL\s*=\s*['"]([^'"]+)['"]/.exec(config);
  if (!encontrada) throw new Error("No se encontró API_URL en frontend/js/config.js");
  return encontrada[1];
})();

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  "access-control-expose-headers": "*",
};

const ZONA = "America/Argentina/Buenos_Aires";
const hoyEnBuenosAires = (fecha) => fecha.toLocaleDateString("en-CA", { timeZone: ZONA });

const gasto = (id, fecha, concepto, monto, creado) => ({
  id, fecha, concepto, monto, medio_pago_id: null, activo: true,
  creado_por: "admin1", creado_en: creado, modificado_por: null, modificado_en: null,
});

// Datos de ejemplo (los mismos que usaban los tests con los datos simulados).
const semillaInicial = () => ({
  negocio: { identificador: "kioscochicha", nombre_comercial: "Kiosco Chicha", rubro: "Kiosco", categoria_impositiva: "MONOTRIBUTISTA", fecha_registro: "2026-01-15T14:00:00+00:00" },
  personal: [
    { id: 1, usuario: "propietario1", correo: "ana@kioscochicha.com", nombre: "Ana", apellido: "Pérez", dni: "30123456", rol: "PROPIETARIO", activo: true, fecha_creacion: "2026-01-15T14:00:00+00:00" },
    { id: 2, usuario: "admin2", correo: "luis@kioscochicha.com", nombre: "Luis", apellido: "Gómez", dni: null, rol: "ADMIN", activo: true, fecha_creacion: "2026-02-03T10:30:00+00:00" },
    { id: 3, usuario: "cajero1", correo: "sofia@kioscochicha.com", nombre: "Sofía", apellido: "Díaz", dni: "40222333", rol: "CAJERO", activo: true, fecha_creacion: "2026-02-20T12:15:00+00:00" },
    { id: 4, usuario: "cajero2", correo: "marcos@kioscochicha.com", nombre: "Marcos", apellido: "Ruiz", dni: null, rol: "CAJERO", activo: false, fecha_creacion: "2026-03-10T09:45:00+00:00" },
  ],
  medios: [
    { id: 1, nombre: "Efectivo", es_predeterminado: true, activo: true },
    { id: 2, nombre: "Transferencia", es_predeterminado: false, activo: true },
  ],
  gastos: [
    gasto(1, "2026-03-01", "Alquiler del local", 450000, "2026-03-01T10:00:00+00:00"),
    gasto(2, "2026-03-05", "Luz", 38250.5, "2026-03-05T11:30:00+00:00"),
    gasto(3, "2026-03-05", "Internet", 21000, "2026-03-05T11:35:00+00:00"),
    gasto(4, "2026-03-12", "Flete de mercadería", 15500.75, "2026-03-12T16:00:00+00:00"),
    gasto(5, "2026-04-01", "Alquiler del local", 450000, "2026-04-01T10:00:00+00:00"),
    gasto(6, "2026-04-02", "Viáticos", 8300, "2026-04-02T09:15:00+00:00"),
    gasto(7, "2026-04-10", "Reparación de heladera", 12000, "2026-04-10T14:00:00+00:00"),
  ],
});

const base64urlADatos = (texto) => JSON.parse(Buffer.from(texto, "base64url").toString("utf8"));
const actorDe = (cabecera) => {
  try {
    return base64urlADatos(String(cabecera || "").replace(/^Bearer\s+/i, "").split(".")[1]);
  } catch {
    return null;
  }
};

const error = (status, mensaje, errores) => [status, { status: "error", mensaje, ...(errores ? { errores } : {}) }];
const sinTildes = (t) => String(t ?? "").trim().toLowerCase();
const siguienteId = (lista) => Math.max(0, ...lista.map((x) => x.id)) + 1;
const ES_ADMIN = (rol) => rol === "PROPIETARIO" || rol === "ADMIN";

async function simularBackend(page, { rol = "PROPIETARIO", semilla = null, ahora = null, hoy = null } = {}) {
  const estado = semillaInicial();
  if (semilla) semilla(estado);
  let proximoIdGasto = Math.max(0, ...estado.gastos.map((g) => g.id)) + 1;
  const llamadas = [];
  const fallas = [];
  const demoras = new Map();
  const instante = () => (ahora ? new Date(ahora) : new Date());
  const fechaDeHoy = () => hoy || hoyEnBuenosAires(instante());

  // ---------- Mi negocio ----------
  const negocioGET = () => [200, { status: "ok", negocio: { ...estado.negocio } }];
  const negocioPUT = (_a, _p, _q, body) => {
    const errores = {};
    if (body.nombre_comercial !== undefined && String(body.nombre_comercial).trim() === "") errores.nombre_comercial = "Rellene el nombre o razón social.";
    else if (String(body.nombre_comercial ?? "").trim().length > 100) errores.nombre_comercial = "El nombre no puede superar los 100 caracteres.";
    if (body.categoria_impositiva && !["RESPONSABLE_INSCRIPTO", "MONOTRIBUTISTA", "EXENTO"].includes(String(body.categoria_impositiva).trim().toUpperCase())) {
      errores.categoria_impositiva = "Elija la categoría impositiva.";
    }
    if (Object.keys(errores).length) return error(400, "Error de validación en los datos enviados", errores);
    // Igual que el Backend real: lo que no viene (o viene null) conserva el valor anterior; un rubro vacío ("") lo vacía.
    const n = estado.negocio;
    if (body.nombre_comercial) n.nombre_comercial = String(body.nombre_comercial).trim();
    if (body.rubro !== undefined && body.rubro !== null) n.rubro = body.rubro;
    if (body.categoria_impositiva) n.categoria_impositiva = String(body.categoria_impositiva).trim().toUpperCase();
    const { identificador, nombre_comercial, rubro, categoria_impositiva } = n;
    return [200, { status: "ok", mensaje: "Datos del negocio actualizados", negocio: { identificador, nombre_comercial, rubro, categoria_impositiva } }];
  };

  // ---------- Personal ----------
  const jerarquia = { PROPIETARIO: 1, ADMIN: 2 };
  const personalGET = () => {
    const lista = [...estado.personal].sort((a, b) => (jerarquia[a.rol] ?? 3) - (jerarquia[b.rol] ?? 3) || a.id - b.id);
    return [200, { status: "ok", personal: lista.map((p) => ({ ...p, nombre: p.nombre || "", apellido: p.apellido || "" })) }];
  };
  const personalPOST = (_a, _p, _q, body) => {
    const usuario = String(body.usuario ?? "").trim().toLowerCase();
    const correo = String(body.correo ?? "").trim().toLowerCase();
    const nombre = String(body.nombre ?? "").trim();
    const apellido = String(body.apellido ?? "").trim();
    const rolNuevo = String(body.rol || "CAJERO").trim().toUpperCase();
    if (!usuario || !correo || !body.password || !nombre || !apellido) return error(400, "Todos los campos obligatorios deben estar completos");
    if (!["ADMIN", "CAJERO"].includes(rolNuevo)) return error(400, "Rol inválido. Solo se pueden crear Administradores o Empleados");
    const repetidos = {};
    if (estado.personal.some((p) => p.usuario === usuario)) repetidos.usuario = "El nombre de usuario ya está registrado en este negocio.";
    if (estado.personal.some((p) => p.correo.toLowerCase() === correo)) repetidos.correo = "El correo ya está registrado en este negocio.";
    if (Object.keys(repetidos).length) return error(409, "El nombre de usuario o correo ya está en uso en este negocio", repetidos);
    const nuevo = { id: siguienteId(estado.personal), usuario, correo, nombre, apellido, dni: String(body.dni ?? "").trim() || null, rol: rolNuevo, activo: true, fecha_creacion: instante().toISOString() };
    estado.personal.push(nuevo);
    const { id, activo, fecha_creacion } = nuevo;
    return [201, { status: "ok", mensaje: "Usuario creado exitosamente", usuario: { id, usuario, nombre, apellido, rol: rolNuevo, activo, fecha_creacion } }];
  };
  const buscarPersona = (id) => estado.personal.find((p) => p.id === Number(id));
  const personalPUT = (actor, { id }, _q, body) => {
    const objetivo = buscarPersona(id);
    if (!objetivo) return error(404, "Usuario no encontrado");
    if (actor.rol === "ADMIN" && ["PROPIETARIO", "ADMIN"].includes(objetivo.rol) && actor.usuario_id !== objetivo.id) return error(403, "Solo el Propietario puede editar a otros administradores");
    const nuevoRol = body.rol || objetivo.rol;
    if (objetivo.rol === "PROPIETARIO" && nuevoRol !== "PROPIETARIO") return error(400, "No se puede cambiar el rol del Propietario");
    const correo = String(body.correo || objetivo.correo).trim().toLowerCase();
    if (estado.personal.some((p) => p.id !== objetivo.id && p.correo.toLowerCase() === correo)) {
      return error(409, "Este correo ya está en uso por otro empleado", { correo: "Este correo ya está en uso por otro empleado" });
    }
    // El nombre de usuario se ignora (no se puede cambiar); la contraseña no se guarda acá.
    Object.assign(objetivo, { nombre: String(body.nombre || objetivo.nombre).trim(), apellido: String(body.apellido || objetivo.apellido).trim(), correo, dni: String(body.dni ?? "").trim() || null, rol: nuevoRol });
    return [200, { status: "ok", mensaje: "Usuario actualizado correctamente" }];
  };
  const personalHabilitar = (_a, { id }) => {
    const objetivo = buscarPersona(id);
    if (objetivo) objetivo.activo = true;
    return [200, { status: "ok", mensaje: "Usuario habilitado correctamente" }];
  };
  const reglasDeBaja = (actor, objetivo, verbo, enviarPropio) => {
    if (actor.usuario_id === objetivo.id) return error(400, enviarPropio);
    if (objetivo.rol === "PROPIETARIO") return error(400, `El Propietario no puede ser ${verbo}`);
    if (actor.rol === "ADMIN" && objetivo.rol === "ADMIN") return error(403, `Solo el Propietario puede ${verbo === "deshabilitado" ? "gestionar" : "eliminar"} a otros administradores`);
    if (ES_ADMIN(objetivo.rol) && objetivo.activo && estado.personal.filter((p) => ES_ADMIN(p.rol) && p.activo).length <= 1) return error(409, "Siempre debe quedar al menos un administrador activo");
    return null;
  };
  const personalDeshabilitar = (actor, { id }) => {
    const objetivo = buscarPersona(id);
    if (!objetivo) return error(404, "Usuario no encontrado");
    const bloqueo = reglasDeBaja(actor, objetivo, "deshabilitado", "No podés deshabilitar tu propia cuenta");
    if (bloqueo) return bloqueo;
    objetivo.activo = false;
    return [200, { status: "ok", mensaje: "Usuario deshabilitado y sesiones revocadas" }];
  };
  const personalEliminar = (actor, { id }) => {
    const objetivo = buscarPersona(id);
    if (!objetivo) return error(404, "Usuario no encontrado");
    const bloqueo = reglasDeBaja(actor, objetivo, "eliminado", "No podés eliminar tu propia cuenta");
    if (bloqueo) return bloqueo;
    estado.personal.splice(estado.personal.indexOf(objetivo), 1);
    return [200, { status: "ok", mensaje: "Usuario eliminado correctamente" }];
  };

  // ---------- Medios de pago ----------
  const medioPublico = ({ id, nombre, es_predeterminado }) => ({ id, nombre, es_predeterminado });
  const mediosGET = () => {
    if (!estado.medios.some((m) => sinTildes(m.nombre) === "efectivo")) estado.medios.push({ id: siguienteId(estado.medios), nombre: "Efectivo", es_predeterminado: true, activo: true });
    const activos = estado.medios.filter((m) => m.activo).sort((a, b) => Number(b.es_predeterminado) - Number(a.es_predeterminado) || a.nombre.localeCompare(b.nombre, "es"));
    return [200, { status: "ok", medios_pago: activos.map(medioPublico) }];
  };
  const mediosPOST = (_a, _p, _q, body) => {
    const nombre = String(body.nombre ?? "").trim();
    if (!nombre) return error(400, "El nombre del medio de pago es obligatorio", { nombre: "El nombre del medio de pago es obligatorio" });
    if (nombre.length > 50) return error(400, "El nombre no puede superar los 50 caracteres", { nombre: "El nombre no puede superar los 50 caracteres" });
    const igual = estado.medios.find((m) => sinTildes(m.nombre) === sinTildes(nombre));
    if (igual && igual.activo) return error(409, "Ya existe un medio de pago con ese nombre", { nombre: "Ya existe un medio de pago con ese nombre" });
    if (igual) {
      // Un medio eliminado (desactivado) se reactiva al volver a crearlo con el mismo nombre.
      igual.activo = true;
      igual.nombre = nombre;
      return [201, { status: "ok", mensaje: "Medio de pago creado", medio_pago: medioPublico(igual) }];
    }
    const nuevo = { id: siguienteId(estado.medios), nombre, es_predeterminado: false, activo: true };
    estado.medios.push(nuevo);
    return [201, { status: "ok", mensaje: "Medio de pago creado", medio_pago: medioPublico(nuevo) }];
  };
  const mediosPUT = (_a, { id }, _q, body) => {
    const nombre = String(body.nombre ?? "").trim();
    if (!nombre) return error(400, "El nombre es obligatorio", { nombre: "El nombre es obligatorio" });
    const medio = estado.medios.find((m) => m.id === Number(id));
    if (!medio) return error(404, "Medio de pago no encontrado");
    if (estado.medios.some((m) => m.id !== medio.id && sinTildes(m.nombre) === sinTildes(nombre))) {
      return error(409, "Ya existe otro medio de pago con ese nombre", { nombre: "Ya existe otro medio de pago con ese nombre" });
    }
    medio.nombre = nombre;
    return [200, { status: "ok", mensaje: "Medio de pago actualizado", medio_pago: medioPublico(medio) }];
  };
  const mediosDELETE = (_a, { id }) => {
    const medio = estado.medios.find((m) => m.id === Number(id));
    if (!medio) return error(404, "Medio de pago no encontrado");
    if (medio.es_predeterminado) return error(400, "El medio de pago Efectivo no puede eliminarse");
    // Si ya se usó en gastos se desactiva (para conservar el historial); si no, se borra de verdad.
    if (estado.gastos.some((g) => g.medio_pago_id === medio.id)) medio.activo = false;
    else estado.medios.splice(estado.medios.indexOf(medio), 1);
    return [200, { status: "ok", mensaje: "Medio de pago eliminado exitosamente" }];
  };

  // ---------- Gastos ----------
  const nombreDelMedio = (id) => estado.medios.find((m) => m.id === id)?.nombre ?? null;
  const gastoPublico = (g) => ({
    id: g.id, fecha: g.fecha, concepto: g.concepto, monto: g.monto, medio_pago_id: g.medio_pago_id,
    medio_pago_nombre: nombreDelMedio(g.medio_pago_id), creado_por: g.creado_por, creado_en: g.creado_en,
    modificado_por: g.modificado_por, modificado_en: g.modificado_en,
  });
  const gastosGET = (_a, _p, query) => {
    const lista = estado.gastos
      .filter((g) => (!query.desde || g.fecha >= query.desde) && (!query.hasta || g.fecha <= query.hasta))
      .sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : b.id - a.id));
    const total = lista.reduce((suma, g) => suma + g.monto, 0);
    return [200, { status: "ok", gastos: lista.map(gastoPublico), resumen: { total_gastos: Math.round(total * 100) / 100, cantidad_operaciones: lista.length } }];
  };
  const validarGasto = (body, parcial = null) => {
    const errores = {};
    const concepto = String(body.concepto ?? parcial?.concepto ?? "").trim();
    const monto = Number(body.monto ?? parcial?.monto ?? 0);
    const fecha = body.fecha || parcial?.fecha || fechaDeHoy();
    if (!concepto) errores.concepto = "El concepto del gasto es obligatorio";
    if (!Number.isFinite(monto) || monto <= 0) errores.monto = "El monto del gasto debe ser mayor a cero";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || Number.isNaN(Date.parse(fecha))) errores.fecha = "Formato de fecha inválido (use YYYY-MM-DD)";
    else if (fecha > fechaDeHoy()) errores.fecha = "No se pueden registrar gastos con fecha futura";
    return { errores, concepto, monto, fecha };
  };
  const gastosPOST = (actor, _p, _q, body) => {
    const { errores, concepto, monto, fecha } = validarGasto(body);
    if (Object.keys(errores).length) return error(400, "Error de validación en los datos enviados", errores);
    const nuevo = { id: proximoIdGasto++, fecha, concepto, monto, medio_pago_id: body.medio_pago_id ?? null, activo: true, creado_por: actor.usuario || "admin", creado_en: instante().toISOString(), modificado_por: null, modificado_en: null };
    estado.gastos.push(nuevo);
    return [201, { status: "ok", mensaje: "Gasto registrado exitosamente", gasto: gastoPublico(nuevo) }];
  };
  const gastosPUT = (actor, { id }, _q, body) => {
    const existente = estado.gastos.find((g) => g.id === Number(id));
    if (!existente) return error(404, "Gasto no encontrado");
    const { errores, concepto, monto, fecha } = validarGasto(body, existente);
    if (Object.keys(errores).length) return error(400, "Error de validación en los datos enviados", errores);
    Object.assign(existente, { fecha, concepto, monto, modificado_por: actor.usuario || "admin", modificado_en: instante().toISOString() });
    // Sin la clave medio_pago_id se conserva el que tenía; con null se quita.
    if ("medio_pago_id" in body) existente.medio_pago_id = body.medio_pago_id ?? null;
    return [200, { status: "ok", mensaje: "Gasto actualizado correctamente", gasto: gastoPublico(existente) }];
  };
  const gastosDELETE = (_a, { id }) => {
    const existente = estado.gastos.find((g) => g.id === Number(id));
    if (!existente) return error(404, "Gasto no encontrado");
    estado.gastos.splice(estado.gastos.indexOf(existente), 1);
    return [200, { status: "ok", mensaje: "Gasto eliminado correctamente" }];
  };

  // ---------- Tabla de rutas ----------
  // [método, patrón, quién puede (null = cualquier sesión), manejador]
  const RUTAS = [
    ["GET", "/auth/negocio", ["PROPIETARIO", "ADMIN"], negocioGET],
    ["PUT", "/auth/negocio", ["PROPIETARIO", "ADMIN"], negocioPUT],
    ["GET", "/auth/personal", ["PROPIETARIO", "ADMIN"], personalGET],
    ["POST", "/auth/personal", ["PROPIETARIO", "ADMIN"], personalPOST],
    ["PUT", "/auth/personal/:id", ["PROPIETARIO", "ADMIN"], personalPUT],
    ["PATCH", "/auth/personal/:id/habilitar", ["PROPIETARIO", "ADMIN"], personalHabilitar],
    ["PATCH", "/auth/personal/:id/deshabilitar", ["PROPIETARIO", "ADMIN"], personalDeshabilitar],
    ["DELETE", "/auth/personal/:id", ["PROPIETARIO", "ADMIN"], personalEliminar],
    ["GET", "/medios-pago", null, mediosGET],
    ["POST", "/medios-pago", ["PROPIETARIO", "ADMIN"], mediosPOST],
    ["PUT", "/medios-pago/:id", ["PROPIETARIO", "ADMIN"], mediosPUT],
    ["DELETE", "/medios-pago/:id", ["PROPIETARIO", "ADMIN"], mediosDELETE],
    ["GET", "/gastos", ["PROPIETARIO", "ADMIN"], gastosGET],
    ["POST", "/gastos", ["PROPIETARIO", "ADMIN"], gastosPOST],
    ["PUT", "/gastos/:id", ["PROPIETARIO", "ADMIN"], gastosPUT],
    ["DELETE", "/gastos/:id", ["PROPIETARIO", "ADMIN"], gastosDELETE],
  ].map(([metodo, patron, roles, manejador]) => ({ metodo, patron, roles, manejador, regex: new RegExp(`^${patron.replace(":id", "(?<id>\\d+)")}$`) }));

  await page.route(`${API}/**`, async (route) => {
    const peticion = route.request();
    if (peticion.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });

    const url = new URL(peticion.url());
    const ruta = url.pathname.replace(/^\/api/, "");
    const metodo = peticion.method();
    const query = Object.fromEntries(url.searchParams);
    const texto = peticion.postData();
    const body = texto ? JSON.parse(texto) : null;
    llamadas.push({ metodo, ruta, query, body, headers: peticion.headers() });

    const generica = ruta.replace(/\/\d+/g, "/:id");
    const claves = [`${metodo} ${ruta}`, `${metodo} ${generica}`];
    const pausa = claves.map((c) => demoras.get(c)).find((ms) => ms);
    if (pausa) await new Promise((resolver) => setTimeout(resolver, pausa));

    const falla = fallas.find((f) => claves.includes(f.clave) && f.restantes > 0);
    let respuesta = null;
    if (falla) {
      falla.restantes -= 1;
      respuesta = typeof falla.respuesta === "function" ? falla.respuesta(llamadas[llamadas.length - 1]) : falla.respuesta;
    } else if (ruta === "/auth/yo") {
      respuesta = { status: 200, body: {} };
    } else {
      const actor = actorDe(peticion.headers().authorization) ?? { rol };
      const definida = RUTAS.find((r) => r.metodo === metodo && r.regex.test(ruta));
      if (!definida) respuesta = { status: 404, body: { status: "error", mensaje: "Ruta no simulada" } };
      else if (definida.roles && !definida.roles.includes(actor.rol)) respuesta = { status: 403, body: { status: "error", mensaje: "Acceso denegado para su rol" } };
      else {
        const [status, cuerpo] = definida.manejador(actor, definida.regex.exec(ruta).groups ?? {}, query, body ?? {});
        respuesta = { status, body: cuerpo };
      }
    }
    if (respuesta.abortar) return route.abort();
    return route.fulfill({ status: respuesta.status, headers: { ...CORS, ...respuesta.headers }, json: respuesta.body });
  });

  return {
    estado,
    llamadas,
    // Cuerpos enviados a un endpoint, en orden. La ruta lleva :id en lugar del número (ej.: "PUT", "/auth/personal/:id").
    enviados: (metodo, patron) => llamadas.filter((l) => l.metodo === metodo && l.ruta.replace(/\/\d+/g, "/:id") === patron).map((l) => l.body),
    // Todas las llamadas a un endpoint (con query y cuerpo).
    peticiones: (metodo, patron) => llamadas.filter((l) => l.metodo === metodo && l.ruta.replace(/\/\d+/g, "/:id") === patron),
    // Hace que ese endpoint (ej.: "PUT /auth/negocio" o "DELETE /gastos/:id") responda otra cosa: { status, body }.
    fallar: (clave, respuesta, { veces = Infinity } = {}) => fallas.push({ clave, respuesta, restantes: veces }),
    demorar: (clave, milisegundos) => demoras.set(clave, milisegundos),
  };
}

// Respuesta de error con el formato del Backend (con o sin errores por campo).
const respuestaDeError = (status, mensaje, errores) => ({ status, body: { status: "error", mensaje, ...(errores ? { errores } : {}) } });

module.exports = { simularBackend, respuestaDeError, semillaInicial, hoyEnBuenosAires };
