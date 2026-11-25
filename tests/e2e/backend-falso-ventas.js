// --- BACKEND FALSO DE VENTAS PARA LOS TESTS E2E ---
// Simula, dentro del navegador de Playwright, los endpoints que usan las pantallas Nueva venta e Historial de ventas
// (ver frontend/js/servicios/ventas.js), respondiendo con el mismo formato que el Backend real: el stock se descuenta al
// confirmar y vuelve al anular, el número de venta lo asigna el servidor y los rechazos llegan como { mensaje }. Igual
// que el real, no descuenta saldo a favor, no oculta ventas, no manda el IVA ni los productos de las ventas de contado.
// `estado` guarda cada venta con todos sus datos y las rutas devuelven solo lo que devuelve el Backend.
//
//   const backend = await simularBackendVentas(page, { rol: "ADMIN", categoriaNegocio: "RESPONSABLE_INSCRIPTO" });
//   backend.llamadas                       -> todo lo que pidió la pantalla ({ metodo, ruta, body })
//   backend.enviados("POST", "/ventas")    -> los cuerpos enviados a ese endpoint
//   backend.estado                         -> los datos en memoria (productos, clientes, ventas)
//   backend.fallar("GET /ventas", { status: 500, body: { mensaje: "..." } })
//   backend.demorar("POST /ventas", 600)   -> tarda en responder (milisegundos)
//
// Es independiente de backend-falso.js (el de Gastos, Personal, etc.). Lee la dirección de la API de frontend/js/config.js.

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

const redondear = (n) => Math.round(n * 100) / 100;
const haceDias = (dias) => new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString();

// Datos de ejemplo. Los productos tienen stock 2 (Sifón), 0 (Bidón), 24, 40 y 15; María Fernanda López tiene $ 660 a favor.
const semillaInicial = (categoriaNegocio) => ({
  negocio: { categoria_impositiva: categoriaNegocio },
  productos: [
    { id: 1, nombre: "Sifón de soda 1.5 l", categoria_nombre: "Bebidas", cantidad: 2, precio_venta: 1200, precio_compra: 850 },
    { id: 2, nombre: "Bidón de agua 20 l", categoria_nombre: "Bebidas", cantidad: 0, precio_venta: 2200, precio_compra: 1400 },
    { id: 3, nombre: "Detergente 750 ml", categoria_nombre: "Limpieza", cantidad: 24, precio_venta: 980, precio_compra: 620 },
    { id: 4, nombre: "Lavandina 1 l", categoria_nombre: "Limpieza", cantidad: 40, precio_venta: 590, precio_compra: 380 },
    { id: 5, nombre: "Yerba mate 1 kg", categoria_nombre: "Almacén", cantidad: 15, precio_venta: 3100, precio_compra: 2100 },
  ],
  clientes: [
    { id: 1, nombre: "Almacén Don Pedro S.R.L.", saldo_a_favor: 0, categoria_impositiva: "RESPONSABLE_INSCRIPTO" },
    { id: 2, nombre: "María Fernanda López", saldo_a_favor: 660, categoria_impositiva: "CONSUMIDOR_FINAL" },
    { id: 3, nombre: "Kiosco El Sol (Carlos Gómez)", saldo_a_favor: 0, categoria_impositiva: "MONOTRIBUTISTA" },
    { id: 4, nombre: "Fundación Manos Unidas", saldo_a_favor: 0, categoria_impositiva: "EXENTO" },
  ],
  medios: [
    { id: 1, nombre: "Efectivo", es_predeterminado: true, activo: true },
    { id: 2, nombre: "Transferencia", es_predeterminado: false, activo: true },
  ],
  ventas: [
    {
      id: 1, numero: "00001-00000451", tipo: "CUENTA_CORRIENTE", cliente_id: 1, cliente_nombre: "Almacén Don Pedro S.R.L.", fecha_hora: haceDias(40),
      total: 6200, saldo: 6200, medio_pago: null, credito_aplicado: 0, anulada: false, oculto: false,
      items: [{ producto_id: 5, producto: "Yerba mate 1 kg", precio: 3100, cantidad: 2 }],
      iva: { modo: "DISCRIMINA", neto: 5123.97, iva: 1076.03, leyenda: null, texto: null },
    },
    {
      id: 2, numero: "00001-00000452", tipo: "CONTADO", cliente_id: null, cliente_nombre: null, fecha_hora: haceDias(0),
      total: 3730, saldo: 0, medio_pago: "Efectivo", credito_aplicado: 0, anulada: false, oculto: false,
      items: [{ producto_id: 3, producto: "Detergente 750 ml", precio: 980, cantidad: 3 }, { producto_id: 4, producto: "Lavandina 1 l", precio: 590, cantidad: 1 }],
      iva: { modo: "INCLUIDO", neto: null, iva: null, leyenda: null, texto: "El precio incluye IVA." },
    },
    {
      id: 3, numero: "00001-00000453", tipo: "CUENTA_CORRIENTE", cliente_id: 3, cliente_nombre: "Kiosco El Sol (Carlos Gómez)", fecha_hora: haceDias(20),
      total: 2400, saldo: 0, medio_pago: null, credito_aplicado: 0, anulada: true, oculto: false,
      items: [{ producto_id: 1, producto: "Sifón de soda 1.5 l", precio: 1200, cantidad: 2 }],
      iva: { modo: "DISCRIMINA", neto: 1983.47, iva: 416.53, leyenda: "El crédito fiscal discriminado en el presente comprobante no puede ser computado", texto: null },
    },
  ],
});

const error = (status, mensaje, errores) => [status, { status: "error", mensaje, ...(errores ? { errores } : {}) }];

const decodificarRol = (cabecera) => {
  try {
    const carga = String(cabecera || "").replace(/^Bearer\s+/i, "").split(".")[1];
    return JSON.parse(Buffer.from(carga, "base64url").toString("utf8")).rol;
  } catch {
    return null;
  }
};

async function simularBackendVentas(page, { rol = "ADMIN", categoriaNegocio = "RESPONSABLE_INSCRIPTO", semilla = null } = {}) {
  const estado = semillaInicial(categoriaNegocio);
  if (semilla) semilla(estado);
  const llamadas = [];
  const fallas = new Map();
  const demoras = new Map();
  const esAdmin = rol === "PROPIETARIO" || rol === "ADMIN";

  const producto = (id) => estado.productos.find((p) => p.id === Number(id));
  const cliente = (id) => estado.clientes.find((c) => c.id === Number(id));
  const venta = (id) => estado.ventas.find((v) => v.id === Number(id));

  const listarVentas = () => [200, {
    status: "ok",
    items: estado.ventas.map((v) => ({
      id: v.id,
      numero_venta: v.numero.split("-")[1],
      tipo_venta: v.tipo,
      total: v.total.toFixed(2),
      estado: v.anulada ? "ANULADA" : "CONFIRMADA",
      fecha_hora: new Date(v.fecha_hora).toUTCString(),
      cliente: v.cliente_nombre,
    })),
  }];
  const cuentasCorrientes = () => [200, {
    status: "ok",
    items: estado.ventas
      .filter((v) => v.tipo === "CUENTA_CORRIENTE")
      .map((v) => ({ venta_id: v.id, saldo_pendiente: v.saldo, productos: v.items.map((i) => ({ nombre: i.producto, precio: i.precio, cantidad: i.cantidad, subtotal: redondear(i.precio * i.cantidad) })) })),
  }];
  const listarPagos = () => [200, { status: "ok", items: estado.ventas.filter((v) => v.medio_pago).map((v) => ({ venta_id: v.id, medio_pago: v.medio_pago, monto: v.total })) }];
  const listarProductos = () => [200, { status: "ok", items: estado.productos }];
  const listarMedios = () => [200, { status: "ok", medios_pago: estado.medios }];
  const negocio = () => [200, { status: "ok", negocio: { identificador: "kiosco", nombre_comercial: "Kiosco", rubro: "Kiosco", categoria_impositiva: estado.negocio.categoria_impositiva } }];
  // Al Cajero nunca le llegan la categoría impositiva ni otros datos del cliente: solo el nombre.
  const listarClientes = () => [200, { status: "ok", items: estado.clientes.map((c) => (esAdmin ? { ...c } : { id: c.id, nombre: c.nombre })) }];

  const crearVenta = (_p, body) => {
    const items = Array.isArray(body.items) ? body.items : [];
    const comprador = body.cliente_id ? cliente(body.cliente_id) : null;
    if (items.length === 0) return error(400, "El carrito está vacío");
    if (!["CONTADO", "CUENTA_CORRIENTE"].includes(body.tipo_venta)) return error(400, "Tipo de venta inválido");
    if (body.tipo_venta === "CUENTA_CORRIENTE" && !body.cliente_id) return error(400, "Venta Cta Cte requiere cliente");
    if (body.tipo_venta === "CONTADO" && !body.medio_pago_id) return error(400, "Venta de contado requiere medio de pago");

    const lineas = items.map((i) => ({ ...i, producto: producto(i.producto_id) }));
    // Bloqueo por stock: la venta no se crea y no cambia nada.
    const sinStock = lineas.find((l) => !l.producto || l.producto.cantidad < l.cantidad);
    if (sinStock) return error(409, `Stock insuficiente para el producto ${sinStock.producto_id}`);

    const total = redondear(lineas.reduce((suma, l) => suma + l.producto.precio_venta * l.cantidad, 0));
    lineas.forEach((l) => (l.producto.cantidad -= l.cantidad));
    const siguiente = Math.max(450, ...estado.ventas.map((v) => Number(v.numero.split("-")[1]))) + 1;
    const nueva = {
      id: Math.max(0, ...estado.ventas.map((v) => v.id)) + 1,
      numero: `00001-${String(siguiente).padStart(8, "0")}`,
      tipo: body.tipo_venta,
      cliente_id: comprador?.id ?? null,
      cliente_nombre: comprador?.nombre ?? null,
      fecha_hora: new Date().toISOString(),
      total,
      saldo: body.tipo_venta === "CONTADO" ? 0 : total,
      medio_pago: body.tipo_venta === "CONTADO" ? estado.medios.find((m) => m.id === Number(body.medio_pago_id))?.nombre : null,
      anulada: false,
      items: lineas.map((l) => ({ producto_id: l.producto.id, producto: l.producto.nombre, precio: l.producto.precio_venta, cantidad: l.cantidad })),
    };
    estado.ventas.push(nueva);
    return [201, { status: "ok", mensaje: "Venta confirmada", venta_id: nueva.id, numero: String(siguiente).padStart(8, "0"), total }];
  };

  const anularVenta = ({ id }) => {
    const v = venta(id);
    if (!v || v.anulada) return error(404, "Venta no encontrada o ya anulada");
    v.anulada = true;
    v.saldo = 0;
    v.items.forEach((i) => {
      const p = producto(i.producto_id);
      if (p) p.cantidad += i.cantidad; // el stock vuelve
    });
    return [200, { status: "ok", mensaje: "Venta anulada, stock repuesto y pagos anulados" }];
  };

  // El Backend todavía no tiene esta ruta.
  const ocultarVenta = () => [404, {}];

  // [método, patrón, manejador]. Los segmentos ":id" se pasan como parámetros.
  const rutas = [
    ["GET", "/ventas", listarVentas],
    ["POST", "/ventas", crearVenta],
    ["PATCH", "/ventas/:id/anular", anularVenta],
    ["PATCH", "/ventas/:id/ocultar", ocultarVenta],
    ["GET", "/pagos/cuentas-corrientes", cuentasCorrientes],
    ["GET", "/pagos", listarPagos],
    ["GET", "/clientes", listarClientes],
    ["GET", "/productos", listarProductos],
    ["GET", "/medios-pago", listarMedios],
    ["GET", "/auth/negocio", negocio],
    ["GET", "/auth/yo", () => [200, { status: "ok" }]],
    ["GET", "/notificaciones/contador", () => [200, { cantidad: 0 }]],
    ["GET", "/notificaciones", () => [200, []]],
  ];

  const coincide = (patron, ruta) => {
    const a = patron.split("/");
    const b = ruta.split("/");
    if (a.length !== b.length) return null;
    const params = {};
    for (let i = 0; i < a.length; i++) {
      if (a[i].startsWith(":")) params[a[i].slice(1)] = b[i];
      else if (a[i] !== b[i]) return null;
    }
    return params;
  };

  // Las pantallas usan datos de ejemplo propios (mocks/ventas.js); estos tests quieren la API (simulada acá).
  await page.addInitScript(() => localStorage.setItem("trazzo_ventas_usar_api", "1"));
  await page.route(`${API}/**`, async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const ruta = new URL(request.url()).pathname.replace(/^\/api/, "");
    const metodo = request.method();
    const body = request.postData() ? JSON.parse(request.postData()) : null;
    llamadas.push({ metodo, ruta, body, rol: decodificarRol(request.headers().authorization) });
    const clave = `${metodo} ${ruta}`;
    const espera = demoras.get(`${metodo} ${rutas.find(([m, p]) => m === metodo && coincide(p, ruta))?.[1] ?? ruta}`);
    if (espera) await new Promise((resolver) => setTimeout(resolver, espera));
    const forzada = fallas.get(clave) ?? fallas.get(`${metodo} ${rutas.find(([m, p]) => m === metodo && coincide(p, ruta))?.[1] ?? ruta}`);
    if (forzada) return route.fulfill({ status: forzada.status, headers: CORS, json: forzada.body });
    for (const [m, patron, manejador] of rutas) {
      if (m !== metodo) continue;
      const params = coincide(patron, ruta);
      if (!params) continue;
      const [status, cuerpo] = manejador(params, body);
      return route.fulfill({ status, headers: CORS, json: cuerpo });
    }
    return route.fulfill({ status: 404, headers: CORS, json: { status: "error", mensaje: "Ruta no simulada" } });
  });

  return {
    llamadas,
    estado,
    enviados: (metodo, ruta) => llamadas.filter((l) => l.metodo === metodo && l.ruta === ruta).map((l) => l.body),
    fallar: (clave, respuesta) => fallas.set(clave, respuesta),
    demorar: (clave, milisegundos) => demoras.set(clave, milisegundos),
  };
}

module.exports = { simularBackendVentas };
