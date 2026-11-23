// --- BACKEND FALSO DE PRODUCTOS, CLIENTES Y NOTIFICACIONES PARA LOS TESTS E2E ---
// Simula, dentro del navegador de Playwright, los endpoints que usan las pantallas Productos (/productos), Clientes
// (/clientes) y la campana de Notificaciones (/notificaciones), más /proveedores. Responde con el formato del Backend real:
//   GET /productos?tipo_producto=BIEN_DE_CAMBIO&q=&stock_bajo=true&ocultos=true -> { status, items: [...] }
//   GET /clientes?ocultos=true -> { status, items: [...] }        GET /notificaciones -> [...]
//
//   const backend = await simularCatalogo(page, { rol: "ADMIN" });
//   backend.llamadas                         -> todo lo que pidió la pantalla ({ metodo, ruta, consulta, body })
//   backend.enviados("POST", "/productos")   -> los cuerpos enviados a esa ruta (los números de id se cuentan como /:id)
//   backend.consultas("GET", "/productos")   -> los parámetros de la dirección de cada GET ({ q, stock_bajo, ... })
//   backend.estado                           -> datos en memoria (productos, clientes, proveedores, alertas)
//   backend.fallar("GET /productos", { status: 500, body: { mensaje: "..." } })   (también { abortar: true })
//   backend.demorar("GET /productos", 600)  o  backend.demorar("GET /productos", (consulta) => (consulta.q ? 800 : 0))
//
// Una ruta que no existe responde 404, igual que el Backend real.

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

const error = (status, mensaje, errores) => [status, { status: "error", mensaje, ...(errores ? { errores } : {}) }];
const MENSAJE_VALIDACION = "Error de validación en los datos enviados";
const MOTIVOS_BAJA = ["roto", "perdido", "no_utilizado"];

const semillaInicial = () => ({
  proveedores: [
    { id: 1, nombre: "Distribuidora Norte", categoria_impositiva: "RESPONSABLE_INSCRIPTO", activo: true },
    { id: 2, nombre: "Librería Central", categoria_impositiva: "MONOTRIBUTISTA", activo: true },
    { id: 3, nombre: "Proveedor Oculto SA", categoria_impositiva: "EXENTO", activo: false },
  ],
  // Productos: 1 con stock normal, 2 con stock bajo (3 de mínimo 5), 3 sin stock, 4 oculto.
  productos: [
    { id: 1, nombre: "Sifón de soda", categoria_nombre: "Bebidas", precio_compra: 850, iva_alicuota: 21, rentabilidad: 30, precio_venta: 1337.05, cantidad: 24, stock_minimo: 6, proveedor_id: 1, proveedor_nombre: "Distribuidora Norte", activo: true, creado_en: "2026-11-05T15:30:00Z", creado_por: "admin1" },
    { id: 2, nombre: "Detergente 750 ml", categoria_nombre: "Limpieza", precio_compra: 620, iva_alicuota: 21, rentabilidad: 20, precio_venta: 900, cantidad: 3, stock_minimo: 5, proveedor_id: 2, proveedor_nombre: "Librería Central", activo: true, creado_en: "2026-10-20T12:00:00Z", creado_por: "admin1" },
    { id: 3, nombre: "Yerba mate 1 kg", categoria_nombre: null, precio_compra: 2100, iva_alicuota: 10.5, rentabilidad: 0, precio_venta: 2900, cantidad: 0, stock_minimo: 2, proveedor_id: 1, proveedor_nombre: "Distribuidora Norte", activo: true, creado_en: "2026-09-02T09:00:00Z", creado_por: "cajero1" },
    { id: 4, nombre: "Lavandina 1 l", categoria_nombre: "Limpieza", precio_compra: 380, iva_alicuota: 21, rentabilidad: 0, precio_venta: 520, cantidad: 10, stock_minimo: 2, proveedor_id: 2, proveedor_nombre: "Librería Central", activo: false, creado_en: "2026-08-10T09:00:00Z", creado_por: "admin1" },
  ],
  // Los productos con movimientos no se pueden eliminar (el Backend responde 409).
  productosConMovimientos: [1, 2],
  clientes: [
    { id: 1, nombre: "Ana Pérez", tipo_documento: "DNI", numero_documento: "30111222", categoria_impositiva: "CONSUMIDOR_FINAL", telefono: "11 4555-1234", correo: "ana@correo.com", domicilio: "Calle Falsa 123", cantidad_ventas: 3, saldo_cuenta_corriente: 1500, activo: true },
    { id: 2, nombre: "Almacén Don José", tipo_documento: "CUIT", numero_documento: "20-12345678-6", categoria_impositiva: "RESPONSABLE_INSCRIPTO", telefono: "11 4000-9999", correo: "donjose@almacen.com", domicilio: "Av. Siempreviva 742", cantidad_ventas: 0, saldo_cuenta_corriente: 0, activo: true },
    { id: 3, nombre: "Luis Gómez", cantidad_ventas: 0, saldo_cuenta_corriente: -300, activo: true },
    { id: 4, nombre: "Panadería La Espiga", tipo_documento: "CUIT", numero_documento: "30-71234567-8", categoria_impositiva: "MONOTRIBUTISTA", telefono: "11 4777-1111", correo: "laespiga@pan.com", domicilio: "Mitre 55", cantidad_ventas: 0, saldo_cuenta_corriente: 0, activo: false },
    { id: 5, nombre: "Kiosco El Sol", tipo_documento: "DNI", numero_documento: "28999111", categoria_impositiva: "EXENTO", telefono: "11 4888-2222", correo: "elsol@kiosco.com", domicilio: "San Martín 10", cantidad_ventas: 4, saldo_cuenta_corriente: 0, activo: false },
  ],
  alertas: [
    { id: 7, producto_nombre: "Collar", stock_actual: 2 },
    { id: 8, producto_nombre: "Correa", stock_actual: 0 },
  ],
});

// Alta y edición de productos (el Backend no deja cambiar el stock ni el costo al editar).
const validarProducto = (body, { esNuevo, proveedores }) => {
  const errores = {};
  if (!String(body.nombre ?? "").trim()) errores.nombre = "El nombre es obligatorio";
  if (esNuevo && !(Number(body.precio_compra) > 0)) errores.precio_compra = "El precio de compra debe ser mayor a cero";
  if (!(Number(body.precio_venta) > 0)) errores.precio_venta = "El precio de venta debe ser mayor a cero";
  if (esNuevo && !(Number.isInteger(Number(body.cantidad)) && Number(body.cantidad) >= 0)) errores.cantidad = "El stock debe ser un entero mayor o igual a cero";
  if (!(Number.isInteger(Number(body.stock_minimo)) && Number(body.stock_minimo) >= 0)) errores.stock_minimo = "El stock mínimo debe ser un entero mayor o igual a cero";
  if (!proveedores.some((p) => p.id === Number(body.proveedor_id))) errores.proveedor_id = "El proveedor no existe";
  return errores;
};

async function simularCatalogo(page, { rol = "ADMIN", semilla } = {}) {
  const estado = semillaInicial();
  semilla?.(estado);
  const llamadas = [];
  const fallas = new Map();
  const demoras = new Map();
  let proximoProducto = 100;
  let proximoCliente = 100;

  const producto = (id) => estado.productos.find((p) => p.id === Number(id));
  const cliente = (id) => estado.clientes.find((c) => c.id === Number(id));
  const sinEncontrar = (cosa) => error(404, `${cosa} no encontrado`);
  const nombreRepetido = (nombre, exceptoId) =>
    estado.productos.some((p) => p.id !== exceptoId && p.nombre.trim().toLowerCase() === String(nombre).trim().toLowerCase());

  // El Cajero recibe de cada cliente solo el id y el nombre.
  const paraRol = (c) => (rol === "CAJERO" ? { id: c.id, nombre: c.nombre } : c);

  const listarProductos = (params, body, consulta) => {
    const q = (consulta.q || "").toLowerCase();
    let lista = estado.productos.filter((p) => (consulta.ocultos === "true" ? !p.activo : p.activo));
    if (q) lista = lista.filter((p) => p.nombre.toLowerCase().includes(q));
    if (consulta.stock_bajo === "true") lista = lista.filter((p) => p.cantidad <= p.stock_minimo);
    return [200, { status: "ok", items: lista }];
  };

  const crearProducto = (params, body) => {
    const errores = validarProducto(body, { esNuevo: true, proveedores: estado.proveedores });
    if (Object.keys(errores).length) return error(400, MENSAJE_VALIDACION, errores);
    if (nombreRepetido(body.nombre)) return error(409, "Ya existe un producto con ese nombre.");
    const proveedor = estado.proveedores.find((p) => p.id === Number(body.proveedor_id));
    const nuevo = {
      id: proximoProducto++,
      nombre: body.nombre.trim(),
      categoria_nombre: null,
      precio_compra: Number(body.precio_compra),
      iva_alicuota: Number(body.iva_alicuota),
      rentabilidad: Number(body.rentabilidad) || 0,
      precio_venta: Number(body.precio_venta),
      cantidad: Number(body.cantidad),
      stock_minimo: Number(body.stock_minimo),
      proveedor_id: proveedor.id,
      proveedor_nombre: proveedor.nombre,
      activo: true,
      creado_en: "2026-11-23T12:00:00Z",
      creado_por: "admin1",
    };
    estado.productos.push(nuevo);
    return [201, { status: "ok", producto: nuevo }];
  };

  const editarProducto = ({ id }, body) => {
    const p = producto(id);
    if (!p) return sinEncontrar("Producto");
    const errores = validarProducto(body, { esNuevo: false, proveedores: estado.proveedores });
    if (Object.keys(errores).length) return error(400, MENSAJE_VALIDACION, errores);
    if (nombreRepetido(body.nombre, p.id)) return error(409, "Ya existe un producto con ese nombre.");
    const proveedor = estado.proveedores.find((x) => x.id === Number(body.proveedor_id));
    Object.assign(p, {
      nombre: body.nombre.trim(),
      iva_alicuota: Number(body.iva_alicuota),
      rentabilidad: Number(body.rentabilidad) || 0,
      precio_venta: Number(body.precio_venta),
      stock_minimo: Number(body.stock_minimo),
      proveedor_id: proveedor.id,
      proveedor_nombre: proveedor.nombre,
    });
    return [200, { status: "ok", producto: p }];
  };

  const reponer = ({ id }, body) => {
    const p = producto(id);
    if (!p) return sinEncontrar("Producto");
    const errores = {};
    if (!(Number.isInteger(Number(body.cantidad)) && Number(body.cantidad) >= 1)) errores.cantidad = "La cantidad debe ser un entero mayor a cero";
    if (!(Number(body.monto_total) > 0)) errores.monto_total = "El monto total debe ser mayor a cero";
    if (!estado.proveedores.some((x) => x.id === Number(body.proveedor_id))) errores.proveedor_id = "El proveedor no existe";
    if (Object.keys(errores).length) return error(400, MENSAJE_VALIDACION, errores);
    p.cantidad += Number(body.cantidad);
    p.precio_compra = Math.round((Number(body.monto_total) / Number(body.cantidad)) * 100) / 100;
    return [201, { status: "ok", mensaje: "Reposición registrada" }];
  };

  const registrarBaja = ({ id }, body) => {
    const p = producto(id);
    if (!p) return sinEncontrar("Producto");
    const errores = {};
    if (!(Number.isInteger(Number(body.cantidad)) && Number(body.cantidad) >= 1)) errores.cantidad = "La cantidad debe ser un entero mayor a cero";
    if (!MOTIVOS_BAJA.includes(body.motivo)) errores.motivo = "El motivo no es válido";
    if (Object.keys(errores).length) return error(400, MENSAJE_VALIDACION, errores);
    if (Number(body.cantidad) > p.cantidad) return error(409, "No hay stock suficiente para registrar la baja.");
    p.cantidad -= Number(body.cantidad);
    return [201, { status: "ok", mensaje: "Baja registrada" }];
  };

  const ocultarProducto = ({ id }) => {
    const p = producto(id);
    if (!p) return sinEncontrar("Producto");
    p.activo = false;
    return [200, { status: "ok", mensaje: "Producto oculto" }];
  };

  const eliminarProducto = ({ id }) => {
    const p = producto(id);
    if (!p) return sinEncontrar("Producto");
    if (estado.productosConMovimientos.includes(p.id)) return error(409, "El producto tiene movimientos y no se puede eliminar.");
    estado.productos.splice(estado.productos.indexOf(p), 1);
    return [200, { status: "ok", mensaje: "Producto eliminado" }];
  };

  const documentoRepetido = (body, exceptoId) =>
    estado.clientes.some((c) => c.id !== exceptoId && c.numero_documento && c.numero_documento === body.numero_documento);

  const crearCliente = (params, body) => {
    if (documentoRepetido(body)) return error(409, "Ya existe un cliente con ese documento.");
    const nuevo = { id: proximoCliente++, cantidad_ventas: 0, saldo_cuenta_corriente: 0, activo: true, ...body };
    estado.clientes.push(nuevo);
    return [201, { status: "ok", cliente: nuevo }];
  };

  const editarCliente = ({ id }, body) => {
    const c = cliente(id);
    if (!c) return sinEncontrar("Cliente");
    if (documentoRepetido(body, c.id)) return error(409, "Ya existe un cliente con ese documento.");
    Object.assign(c, body);
    return [200, { status: "ok", cliente: c }];
  };

  const cambiarVisibilidad = ({ id }) => {
    const c = cliente(id);
    if (!c) return sinEncontrar("Cliente");
    c.activo = !c.activo;
    return [200, { status: "ok", cliente: c }];
  };

  const eliminarCliente = ({ id }) => {
    const c = cliente(id);
    if (!c) return sinEncontrar("Cliente");
    if (c.cantidad_ventas > 0 || c.saldo_cuenta_corriente !== 0) {
      return error(409, "No se puede eliminar el cliente porque tiene ventas registradas o saldo en cuenta corriente.");
    }
    estado.clientes.splice(estado.clientes.indexOf(c), 1);
    return [200, { status: "ok", mensaje: "Cliente eliminado" }];
  };

  // [método, ruta, función(parámetros de la ruta, cuerpo, parámetros de la dirección) -> [status, cuerpo]]
  const rutas = [
    ["GET", "/productos", listarProductos],
    ["POST", "/productos", crearProducto],
    ["PUT", "/productos/:id", editarProducto],
    ["POST", "/productos/:id/reposicion", reponer],
    ["POST", "/productos/:id/baja", registrarBaja],
    ["PATCH", "/productos/:id/ocultar", ocultarProducto],
    ["DELETE", "/productos/:id", eliminarProducto],
    ["GET", "/proveedores", () => [200, { status: "ok", items: estado.proveedores }]],
    ["GET", "/clientes", (p, b, consulta) => [200, { status: "ok", items: estado.clientes.filter((c) => (consulta.ocultos === "true" ? !c.activo : c.activo)).map(paraRol) }]],
    ["GET", "/clientes/:id", ({ id }) => (cliente(id) ? [200, paraRol(cliente(id))] : sinEncontrar("Cliente"))],
    ["POST", "/clientes", crearCliente],
    ["PUT", "/clientes/:id", editarCliente],
    ["PATCH", "/clientes/:id/visibilidad", cambiarVisibilidad],
    ["DELETE", "/clientes/:id", eliminarCliente],
    ["GET", "/notificaciones/contador", () => [200, { cantidad: estado.alertas.length }]],
    ["GET", "/notificaciones", () => [200, estado.alertas]],
    [
      "PATCH",
      "/notificaciones/:id/eliminar-vista",
      ({ id }) => {
        estado.alertas = estado.alertas.filter((a) => a.id !== Number(id));
        return [200, { ok: true }];
      },
    ],
    ["GET", "/auth/yo", () => [200, { status: "ok" }]],
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

  await page.route(`${API}/**`, async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const url = new URL(request.url());
    // La dirección sin el prefijo /api del Gateway (que ya forma parte de API_URL).
    const ruta = url.pathname.replace(/^\/api/, "");
    const consulta = Object.fromEntries(url.searchParams);
    const metodo = request.method();
    const body = request.postData() ? JSON.parse(request.postData()) : null;
    llamadas.push({ metodo, ruta, consulta, body });
    const coincidente = rutas.find(([m, p]) => m === metodo && coincide(p, ruta));
    const patron = coincidente?.[1] ?? ruta;
    const demora = demoras.get(`${metodo} ${patron}`);
    const espera = typeof demora === "function" ? demora(consulta) : demora;
    if (espera) await new Promise((resolver) => setTimeout(resolver, espera));
    const forzada = fallas.get(`${metodo} ${patron}`);
    if (forzada) {
      if (forzada.abortar) return route.abort();
      return route.fulfill({ status: forzada.status, headers: CORS, json: forzada.body });
    }
    if (!coincidente) return route.fulfill({ status: 404, headers: CORS, json: { status: "error", mensaje: "Ruta no encontrada" } });
    const [status, cuerpo] = coincidente[2](coincide(coincidente[1], ruta), body, consulta);
    return route.fulfill({ status, headers: CORS, json: cuerpo });
  });

  const normalizar = (ruta) => ruta.replace(/\/\d+/g, "/:id");
  return {
    llamadas,
    estado,
    rol,
    enviados: (metodo, ruta) => llamadas.filter((l) => l.metodo === metodo && normalizar(l.ruta) === ruta).map((l) => l.body),
    consultas: (metodo, ruta) => llamadas.filter((l) => l.metodo === metodo && normalizar(l.ruta) === ruta).map((l) => l.consulta),
    fallar: (clave, respuesta) => fallas.set(clave, respuesta),
    demorar: (clave, milisegundos) => demoras.set(clave, milisegundos),
  };
}

module.exports = { simularCatalogo };
