const API = "http://192.168.1.43:5000/api"; // debe coincidir con frontend/js/config.js

const base64url = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");

// JWT sin firma válida: el front solo lee el payload (el Backend es quien valida).
const jwtFalso = (rol, extra = {}) =>
  `${base64url({ alg: "HS256", typ: "JWT" })}.${base64url({
    usuario_id: 1,
    usuario: "usuario1",
    negocio_id: 1,
    rol,
    ...extra,
  })}.firma`;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
};

// Simula la API. `rutas` es { "POST /auth/login": { status, body } }.
// Devuelve la lista de llamadas recibidas (método, ruta, headers y body).
// Una ruta no definida responde 404 para que el test falle si el front llama de más.
// Con `{ abortar: true }` la conexión se corta (backend caído).
async function simularApi(page, rutas = {}) {
  const llamadas = [];
  await page.route(`${API}/**`, async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: CORS });
    }
    const ruta = new URL(request.url()).pathname.replace(/^\/api/, "");
    llamadas.push({
      metodo: request.method(),
      ruta,
      headers: request.headers(),
      body: request.postData() ? JSON.parse(request.postData()) : null,
    });
    const respuesta = rutas[`${request.method()} ${ruta}`];
    if (!respuesta) {
      return route.fulfill({
        status: 404,
        headers: CORS,
        json: { status: "error", mensaje: "Ruta no simulada" },
      });
    }
    if (respuesta.abortar) return route.abort();
    return route.fulfill({
      status: respuesta.status,
      headers: CORS,
      json: respuesta.body,
    });
  });
  return llamadas;
}

// Deja tokens guardados como si ya se hubiera iniciado sesión.
// Se parte de registro.html porque no redirige aunque haya token.
async function iniciarSesionComo(page, rol) {
  await page.goto("/registro.html");
  await page.evaluate((token) => {
    localStorage.setItem("trazzo_access_token", token);
    localStorage.setItem("trazzo_refresh_token", "refresh-falso");
  }, jwtFalso(rol));
}

const tokensGuardados = (page) =>
  page.evaluate(() => ({
    access: localStorage.getItem("trazzo_access_token"),
    refresh: localStorage.getItem("trazzo_refresh_token"),
  }));

module.exports = { jwtFalso, simularApi, iniciarSesionComo, tokensGuardados };
