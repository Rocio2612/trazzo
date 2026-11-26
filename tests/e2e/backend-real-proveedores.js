const fs = require("fs");
const path = require("path");
const { expect, request } = require("@playwright/test");

// APOYO PARA LOS TESTS DE PROVEEDORES CONTRA EL BACKEND REAL (proveedores.spec.js)
//
// Antes de cada test deja el directorio de proveedores del negocio de prueba en un estado conocido (SEMILLAS),
// usando la misma API que usa la pantalla. Para eso ELIMINA los proveedores que sobren, así que solo funciona
// con un negocio cuyo identificador contenga "prueba" o "test".

const env = process.env;

// La URL de la API sale de frontend/js/config.js, igual que en helpers.js.
const API = (() => {
  const config = fs.readFileSync(path.join(__dirname, "../../frontend/js/config.js"), "utf8");
  const encontrada = /API_URL\s*=\s*['"]([^'"]+)['"]/.exec(config);
  if (!encontrada) throw new Error("No se encontró API_URL en frontend/js/config.js");
  return encontrada[1];
})();

// El gateway también sirve el frontend: las pantallas se abren desde ahí, como en el uso real.
const ORIGEN = API.replace(/\/api\/?$/, "");

const NEGOCIO = env.TRAZZO_ID_NEGOCIO || "";
const PROPIETARIO = { usuario: env.TRAZZO_USUARIO, password: env.TRAZZO_PASSWORD };
const CUENTAS = {
  PROPIETARIO,
  // Sin un Administrador aparte, las pantallas se prueban con el Propietario (tiene los mismos permisos).
  ADMIN: env.TRAZZO_ADMIN_USUARIO ? { usuario: env.TRAZZO_ADMIN_USUARIO, password: env.TRAZZO_ADMIN_PASSWORD } : PROPIETARIO,
  CAJERO: { usuario: env.TRAZZO_CAJERO_USUARIO, password: env.TRAZZO_CAJERO_PASSWORD },
};
const HAY_BACKEND = env.TRAZZO_BACKEND_REAL === "1" && Boolean(NEGOCIO && PROPIETARIO.usuario && PROPIETARIO.password);
const HAY_CAJERO = HAY_BACKEND && Boolean(CUENTAS.CAJERO.usuario && CUENTAS.CAJERO.password);

// Estado inicial de cada test: 3 visibles y 2 ocultos. `conMovimientos` indica que tiene un producto asociado
// (por eso no se puede eliminar). El id lo pone la base: se pide con la clave.
const SEMILLAS = [
  { clave: "envases", nombre: "Envases del Sur S.A.", tipo_documento: "CUIT", numero_documento: "30712345671", telefono: "11 4444-5555", correo: "ventas@envasesdelsur.com", categoria_impositiva: "RESPONSABLE_INSCRIPTO", descripcion_compra: "Distribuidor de envases y cajas de cartón", activo: true, conMovimientos: true },
  { clave: "bebidas", nombre: "Bebidas Don Raúl", tipo_documento: "CUIT", numero_documento: "30500001735", telefono: "11 5555-6666", correo: "", categoria_impositiva: "RESPONSABLE_INSCRIPTO", descripcion_compra: "Proveedor de bebidas línea blanca", activo: true, conMovimientos: true },
  { clave: "marta", nombre: "Marta Giménez", tipo_documento: "CUIL", numero_documento: "20123456786", telefono: "", correo: "marta@correo.com", categoria_impositiva: "MONOTRIBUTISTA", descripcion_compra: "Verduras y frutas de estación", activo: true, conMovimientos: false },
  { clave: "cooperativa", nombre: "Cooperativa La Esperanza", tipo_documento: "CUIT", numero_documento: "33712345670", telefono: "11 6666-7777", correo: "", categoria_impositiva: "EXENTO", descripcion_compra: "", activo: false, conMovimientos: false },
  { clave: "libreria", nombre: "Librería Central", tipo_documento: "CUIT", numero_documento: "30700000016", telefono: "", correo: "", categoria_impositiva: "RESPONSABLE_INSCRIPTO", descripcion_compra: "Papelería y útiles", activo: false, conMovimientos: true },
];

const CAMPOS = ["nombre", "tipo_documento", "numero_documento", "categoria_impositiva", "telefono", "correo", "descripcion_compra"];
const ficha = (semilla) => Object.fromEntries(CAMPOS.map((campo) => [campo, semilla[campo]]));
const mismoDocumento = (a, b) => a.tipo_documento === b.tipo_documento && a.numero_documento === b.numero_documento;

// El access token dura 15 minutos: se pide uno nuevo antes de que venza.
const VIGENCIA_SESION = 10 * 60 * 1000;

const crearServidor = () => {
  let contexto;
  const sesiones = {};

  const sesion = async (rol = "PROPIETARIO") => {
    const guardada = sesiones[rol];
    if (guardada && Date.now() - guardada.desde < VIGENCIA_SESION) return guardada;
    const { usuario, password } = CUENTAS[rol];
    const respuesta = await contexto.post(`${API}/auth/login`, { data: { id_negocio: NEGOCIO, usuario, password } });
    expect(respuesta.status(), `El login de ${usuario} debería dar 200 (revisá las credenciales)`).toBe(200);
    sesiones[rol] = { ...(await respuesta.json()), desde: Date.now() };
    return sesiones[rol];
  };

  // Hace un pedido a la API y devuelve { status, body }. Con token: null va sin autorización.
  const llamar = async (metodo, ruta, { rol = "PROPIETARIO", token, data } = {}) => {
    const autorizacion = token === undefined ? (await sesion(rol)).access_token : token;
    const headers = { "Content-Type": "application/json" };
    if (autorizacion) headers.Authorization = `Bearer ${autorizacion}`;
    const respuesta = await contexto.fetch(`${API}${ruta}`, { method: metodo, headers, data });
    return { status: respuesta.status(), body: await respuesta.json().catch(() => ({})) };
  };

  // Hace un pedido que tiene que salir bien (se usa para preparar los datos).
  const exigir = async (metodo, ruta, data) => {
    const { status, body } = await llamar(metodo, ruta, { data });
    expect(status < 300, `${metodo} ${ruta} respondió ${status}: ${body.mensaje}`).toBe(true);
    return body;
  };

  // Todos los proveedores del negocio, visibles y ocultos.
  const listar = async () => [
    ...(await exigir("GET", "/proveedores?ocultos=false")).items,
    ...(await exigir("GET", "/proveedores?ocultos=true")).items,
  ];

  // Deja el directorio como en SEMILLAS y devuelve { clave: id }.
  const reiniciar = async () => {
    const actuales = await listar();

    for (const sobrante of actuales.filter((p) => !SEMILLAS.some((s) => mismoDocumento(s, p)))) {
      if (sobrante.activo) await exigir("PATCH", `/proveedores/${sobrante.id}/visibilidad`, { activo: false });
      await exigir("DELETE", `/proveedores/${sobrante.id}`);
    }

    const ids = {};
    for (const semilla of SEMILLAS) {
      let actual = actuales.find((p) => mismoDocumento(semilla, p));
      if (!actual) {
        const { proveedor } = await exigir("POST", "/proveedores", ficha(semilla));
        actual = { ...ficha(semilla), id: proveedor.id, activo: true, tiene_movimientos: false };
      } else if (CAMPOS.some((campo) => (actual[campo] || "") !== semilla[campo])) {
        await exigir("PUT", `/proveedores/${actual.id}`, ficha(semilla));
      }
      if (semilla.conMovimientos && !actual.tiene_movimientos) {
        await exigir("POST", "/productos", { nombre: `Producto de prueba (${semilla.clave})`, proveedor_id: actual.id, precio_compra: 100, precio_venta: 150 });
      }
      if (actual.activo !== semilla.activo) await exigir("PATCH", `/proveedores/${actual.id}/visibilidad`, { activo: semilla.activo });
      ids[semilla.clave] = actual.id;
    }
    return ids;
  };

  return {
    llamar,
    listar,
    reiniciar,
    async conectar() {
      if (!/prueba|test/i.test(NEGOCIO)) {
        throw new Error(`Estos tests eliminan proveedores: usá un negocio de prueba (identificador con "prueba" o "test"), no "${NEGOCIO}".`);
      }
      contexto = await request.newContext();
    },
    async desconectar() {
      await contexto?.dispose();
    },
    // Deja la sesión real guardada en el navegador. Se parte de registro.html porque no redirige aunque haya token.
    async iniciarSesionEn(page, rol) {
      const { access_token, refresh_token } = await sesion(rol);
      await page.goto("/registro.html");
      await page.evaluate(
        ([access, refresh]) => {
          localStorage.setItem("trazzo_access_token", access);
          localStorage.setItem("trazzo_refresh_token", refresh);
        },
        [access_token, refresh_token],
      );
    },
  };
};

module.exports = { crearServidor, ORIGEN, HAY_BACKEND, HAY_CAJERO, SEMILLAS, USUARIO: PROPIETARIO.usuario };
