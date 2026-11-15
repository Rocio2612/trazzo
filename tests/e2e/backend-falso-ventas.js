// --- BACKEND FALSO DE VENTAS PARA LOS TESTS E2E ---
// Simula, dentro del navegador de Playwright, los endpoints que usan las pantallas Nueva venta e Historial de ventas
// (ver frontend/js/servicios/ventas.js), con las reglas que va a tener el Backend real: el stock se descuenta al confirmar
// y vuelve al anular, el número de venta lo asigna el servidor, el saldo a favor se descuenta, y los rechazos tienen el
// mismo formato ({ mensaje } para el bloqueo por stock y { errores: { campo: mensaje } } para los datos inválidos).
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
    {
      id: 4, numero: "00001-00000454", tipo: "CONTADO", cliente_id: null, cliente_nombre: null, fecha_hora: haceDias(5),
      total: 590, saldo: 0, medio_pago: "Efectivo", credito_aplicado: 0, anulada: false, oculto: true,
      items: [{ producto_id: 4, producto: "Lavandina 1 l", precio: 590, cantidad: 1 }],
      iva: { modo: "INCLUIDO", neto: null, iva: null, leyenda: null, texto: "El precio incluye IVA." },
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

// IVA según la categoría del negocio y la del cliente (las mismas reglas que el módulo de Ventas).
const calcularIva = (total, categoriaNegocio, categoriaCliente) => {
  if (categoriaNegocio === "MONOTRIBUTISTA") return { modo: "NINGUNO", neto: null, iva: null, leyenda: null, texto: "IVA no discriminado: el impuesto está unificado en la cuota fija del negocio." };
  if (categoriaNegocio === "EXENTO") return { modo: "NINGUNO", neto: null, iva: null, leyenda: null, texto: "Negocio exento: no se genera débito fiscal ni se adiciona IVA." };
  if (categoriaCliente === "RESPONSABLE_INSCRIPTO" || categoriaCliente === "MONOTRIBUTISTA") {
    const neto = redondear(total / 1.21);
    return { modo: "DISCRIMINA", neto, iva: redondear(total - neto), leyenda: categoriaCliente === "MONOTRIBUTISTA" ? "El crédito fiscal discriminado en el presente comprobante no puede ser computado" : null, texto: null };
  }
  return { modo: "INCLUIDO", neto: null, iva: null, leyenda: null, texto: "El precio incluye IVA." };
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

  const listarVentas = () => [200, { status: "ok", ventas: estado.ventas }];
  const listarProductos = () => [200, { status: "ok", items: estado.productos }];
  const listarMedios = () => [200, { status: "ok", medios_pago: estado.medios }];
  const negocio = () => [200, { status: "ok", negocio: { identificador: "kiosco", nombre_comercial: "Kiosco", rubro: "Kiosco", categoria_impositiva: estado.negocio.categoria_impositiva } }];
  // Al Cajero nunca le llegan la categoría impositiva ni otros datos del cliente: solo el nombre y su saldo a favor.
  const listarClientes = () => [200, { status: "ok", clientes: estado.clientes.map((c) => (esAdmin ? { ...c } : { id: c.id, nombre: c.nombre, saldo_a_favor: c.saldo_a_favor })) }];

  const crearVenta = (_p, body) => {
    const items = Array.isArray(body.items) ? body.items : [];
    const errores = {};
    if (items.length === 0) errores.items = "Seleccioná al menos un producto.";
    if (!["CONTADO", "CUENTA_CORRIENTE"].includes(body.tipo)) errores.tipo = "Elegí el tipo de venta.";
    if (items.some((i) => !Number.isInteger(i.cantidad) || i.cantidad < 1)) errores.items = "Cada producto necesita una cantidad entera mayor a 0.";
    const comprador = body.cliente_id ? cliente(body.cliente_id) : null;
    if (body.cliente_id && !comprador) errores.cliente_id = "El cliente no está registrado.";
    if (body.tipo === "CUENTA_CORRIENTE" && !body.cliente_id) errores.cliente_id = "Seleccioná un cliente registrado para una venta a cuenta corriente.";
    const lineas = items.map((i) => ({ ...i, producto: producto(i.producto_id) }));
    if (lineas.some((l) => !l.producto)) errores.items = "Hay un producto que no existe.";
    if (Object.keys(errores).length) return error(400, "Error de validación en los datos enviados", errores);

    const total = redondear(lineas.reduce((suma, l) => suma + l.producto.precio_venta * l.cantidad, 0));
    const credito = Number(body.saldo_a_favor_usado) || 0;
    if (credito > 0) {
      if (!comprador || credito > comprador.saldo_a_favor) return error(400, "Error de validación en los datos enviados", { saldo_a_favor_usado: "El saldo a favor a usar supera el que tiene el cliente." });
      if (credito > total) return error(400, "Error de validación en los datos enviados", { saldo_a_favor_usado: "El saldo a favor a usar supera el total de la venta." });
    }
    const aCobrar = redondear(total - credito);
    if (body.tipo === "CONTADO" && aCobrar > 0 && !estado.medios.some((m) => m.id === Number(body.medio_pago_id))) {
      return error(400, "Error de validación en los datos enviados", { medio_pago_id: "Seleccioná el medio de pago de la venta." });
    }
    // Bloqueo por stock: la venta no se crea y no cambia nada. El mensaje lleva el nombre del producto y su stock del momento.
    const sinStock = lineas.find((l) => l.producto.cantidad < l.cantidad);
    if (sinStock) return error(409, `No se puede confirmar la venta: "${sinStock.producto.nombre}" no tiene stock suficiente (stock actual: ${sinStock.producto.cantidad}).`);

    lineas.forEach((l) => (l.producto.cantidad -= l.cantidad));
    if (comprador) comprador.saldo_a_favor = redondear(comprador.saldo_a_favor - credito);
    const siguiente = Math.max(450, ...estado.ventas.map((v) => Number(v.numero.split("-")[1]))) + 1;
    const nueva = {
      id: Math.max(0, ...estado.ventas.map((v) => v.id)) + 1,
      numero: `00001-${String(siguiente).padStart(8, "0")}`,
      tipo: body.tipo,
      cliente_id: comprador?.id ?? null,
      cliente_nombre: comprador?.nombre ?? null,
      fecha_hora: new Date().toISOString(),
      total,
      saldo: body.tipo === "CONTADO" ? 0 : aCobrar,
      medio_pago: body.tipo === "CONTADO" && aCobrar > 0 ? estado.medios.find((m) => m.id === Number(body.medio_pago_id)).nombre : null,
      credito_aplicado: credito,
      anulada: false,
      oculto: false,
      items: lineas.map((l) => ({ producto_id: l.producto.id, producto: l.producto.nombre, precio: l.producto.precio_venta, cantidad: l.cantidad })),
      iva: calcularIva(total, estado.negocio.categoria_impositiva, comprador ? comprador.categoria_impositiva : "CONSUMIDOR_FINAL"),
    };
    estado.ventas.push(nueva);
    return [201, { status: "ok", mensaje: "Venta confirmada", venta: nueva }];
  };

  const anularVenta = ({ id }) => {
    const v = venta(id);
    if (!v) return error(404, "Venta no encontrada");
    if (v.anulada) return error(409, "La venta ya está anulada");
    v.anulada = true;
    v.saldo = 0;
    v.items.forEach((i) => {
      const p = producto(i.producto_id);
      if (p) p.cantidad += i.cantidad; // el stock vuelve
    });
    return [200, { status: "ok", mensaje: "Venta anulada", venta: v }];
  };

  const ocultarVenta = ({ id }, body) => {
    const v = venta(id);
    if (!v) return error(404, "Venta no encontrada");
    v.oculto = Boolean(body.oculto);
    return [200, { status: "ok", venta: v }];
  };

  const ticket = ({ id }) => (venta(id) ? [200, "%PDF-1.4 ticket de prueba", "application/pdf"] : error(404, "Venta no encontrada"));

  // [método, patrón, manejador]. Los segmentos ":id" se pasan como parámetros.
  const rutas = [
    ["GET", "/ventas", listarVentas],
    ["POST", "/ventas", crearVenta],
    ["POST", "/ventas/:id/anular", anularVenta],
    ["PATCH", "/ventas/:id/ocultar", ocultarVenta],
    ["GET", "/ventas/:id/ticket", ticket],
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
      const [status, cuerpo, tipo] = manejador(params, body);
      if (tipo) return route.fulfill({ status, headers: { ...CORS, "content-type": tipo }, body: cuerpo });
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
