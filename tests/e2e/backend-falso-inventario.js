// --- BACKEND FALSO DE INSUMOS, EQUIPAMIENTO Y REPOSICIONES PARA LOS TESTS E2E ---
// Simula, dentro del navegador de Playwright, los endpoints que usan las pantallas Insumos (/bienes-gasto), Equipamiento
// (/bienes-uso) e Historial de reposiciones (/reposiciones), más /proveedores. Responde con el formato del Backend real:
//   GET /bienes-gasto -> { bienes_gasto: [...], resumen: { valor_inventario_total, total_articulos } }
//   GET /bienes-uso   -> { bienes_uso: [...],   resumen: { patrimonio_total, unidades_totales, cantidad_bienes } }
//   GET /proveedores  -> { items: [...] }      GET /reposiciones -> [...]
//
//   const backend = await simularInventario(page, { rol: "ADMIN" });
//   backend.llamadas                      -> todo lo que pidió la pantalla ({ metodo, ruta, body })
//   backend.enviados("POST", "/bienes-gasto")
//   backend.estado                        -> datos en memoria (insumos, bienes, proveedores, reposiciones)
//   backend.fallar("GET /bienes-gasto", { status: 500, body: { mensaje: "..." } })
//   backend.demorar("GET /bienes-gasto", 600)
//
// Una ruta que no existe responde 404, igual que el Backend real: así un pedido a una dirección equivocada (por ejemplo
// /api/proveedores en lugar de /proveedores) falla en los tests como fallaría en la realidad.

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
const error = (status, mensaje, errores) => [status, { status: "error", mensaje, ...(errores ? { errores } : {}) }];

const semillaInicial = () => ({
  proveedores: [
    { id: 1, nombre: "Distribuidora Norte", activo: true },
    { id: 2, nombre: "Librería Central", activo: true },
  ],
  // Insumos (bienes de gasto): valor_stock = costo_unitario × cantidad
  insumos: [
    { id: 1, nombre: "Papel de ticket", costo_unitario: 500, cantidad: 10, unidad_medida: "rollos", valor_stock: 5000, fecha: "2026-11-05T15:00:00Z", proveedor_nombre: "Librería Central", creado_por: "admin1", activo: true },
    { id: 2, nombre: "Bolsas de papel", costo_unitario: 20, cantidad: 100, unidad_medida: "unidades", valor_stock: 2000, fecha: "2026-11-10T15:00:00Z", proveedor_nombre: "Distribuidora Norte", creado_por: "admin1", activo: true },
    { id: 3, nombre: "Cinta de embalar", costo_unitario: 800, cantidad: 3, unidad_medida: "unidades", valor_stock: 2400, fecha: "2026-10-01T15:00:00Z", proveedor_nombre: "Librería Central", creado_por: "admin1", activo: false },
  ],
  // Equipamiento (bienes de uso): valor total = costo_adquisicion × cantidad
  bienes: [
    { id: 1, nombre: "Heladera exhibidora", costo_adquisicion: 850000, cantidad: 1, valor_total: 850000, fecha_adquisicion: "2026-02-12T15:00:00Z", proveedor_id: 1, proveedor_nombre: "Distribuidora Norte", creado_por: "admin1", activo: true },
    { id: 2, nombre: "Estantes metálicos", costo_adquisicion: 95000, cantidad: 2, valor_total: 190000, fecha_adquisicion: "2026-03-03T15:00:00Z", creado_por: "admin1", activo: true },
    { id: 3, nombre: "Balanza vieja", costo_adquisicion: 30000, cantidad: 1, valor_total: 30000, fecha_adquisicion: "2025-11-05T15:00:00Z", creado_por: "admin1", activo: false },
  ],
  reposiciones: [
    { id: 1, producto_nombre: "Sifón de soda", cantidad: 12, monto_total: 10200, costo_unitario_real: 850, fecha_adquisicion: "2026-11-05", proveedor_nombre: "Distribuidora Norte", creado_por: "admin1", estado: "ACTIVA" },
    { id: 2, producto_nombre: "Detergente 750 ml", cantidad: 36, monto_total: 22320, costo_unitario_real: 620, fecha_adquisicion: "2026-10-20", proveedor_nombre: "Librería Central", creado_por: "admin1", estado: "ACTIVA" },
    { id: 3, producto_nombre: "Lavandina 1 l", cantidad: 24, monto_total: 9120, costo_unitario_real: 380, fecha_adquisicion: "2026-09-02", proveedor_nombre: "Distribuidora Norte", creado_por: "admin1", estado: "ANULADA" },
    { id: 4, producto_nombre: "Yerba mate 1 kg", cantidad: 6, monto_total: 12600, costo_unitario_real: 2100, fecha_adquisicion: "2026-11-15", proveedor_nombre: "Distribuidora Norte", creado_por: "cajero1", estado: "ACTIVA" },
  ],
});

async function simularInventario(page, { rol = "ADMIN", semilla = null } = {}) {
  const estado = semillaInicial();
  if (semilla) semilla(estado);
  const llamadas = [];
  const fallas = new Map();
  const demoras = new Map();
  let proximoId = 100;

  const buscar = (lista, id) => lista.find((x) => x.id === Number(id));
  const proveedor = (id) => buscar(estado.proveedores, id);

  // --- Insumos ---
  const resumenInsumos = () => {
    const activos = estado.insumos.filter((i) => i.activo);
    return { valor_inventario_total: redondear(activos.reduce((s, i) => s + i.valor_stock, 0)), total_articulos: activos.length };
  };
  const listarInsumos = () => [200, { status: "ok", bienes_gasto: estado.insumos, resumen: resumenInsumos() }];
  const crearInsumo = (_p, body) => {
    const errores = {};
    if (!String(body.nombre ?? "").trim()) errores.nombre = "El nombre es obligatorio";
    if (!(Number(body.cantidad) > 0) || !(Number(body.precio_compra) > 0)) return error(400, "El costo y la cantidad deben ser mayores a cero");
    if (!proveedor(body.proveedor_id)) errores.proveedor_id = "El proveedor no existe";
    if (Object.keys(errores).length) return error(400, "Error de validación en los datos enviados", errores);
    const nuevo = {
      id: proximoId++, nombre: body.nombre.trim(), costo_unitario: Number(body.precio_compra), cantidad: Number(body.cantidad), unidad_medida: "unidades",
      valor_stock: redondear(Number(body.precio_compra) * Number(body.cantidad)), fecha: `${body.fecha}T15:00:00Z`, proveedor_nombre: proveedor(body.proveedor_id).nombre, creado_por: "admin1", activo: true,
    };
    estado.insumos.push(nuevo);
    return [201, { status: "ok", mensaje: "Insumo registrado", bien_gasto: nuevo }];
  };
  const reponerInsumo = ({ id }, body) => {
    const insumo = buscar(estado.insumos, id);
    if (!insumo) return error(404, "Insumo no encontrado");
    if (!proveedor(body.proveedor_id)) return error(400, "Error de validación en los datos enviados", { proveedor_id: "El proveedor no existe" });
    insumo.cantidad += Number(body.cantidad);
    insumo.valor_stock = redondear(insumo.valor_stock + Number(body.monto_total));
    insumo.costo_unitario = redondear(insumo.valor_stock / insumo.cantidad);
    return [201, { status: "ok", mensaje: "Reposición registrada" }];
  };
  const consumirInsumo = ({ id }, body) => {
    const insumo = buscar(estado.insumos, id);
    if (!insumo) return error(404, "Insumo no encontrado");
    if (Number(body.cantidad) > insumo.cantidad) return error(409, `No hay stock suficiente de "${insumo.nombre}" (stock actual: ${insumo.cantidad})`);
    insumo.cantidad -= Number(body.cantidad);
    insumo.valor_stock = redondear(insumo.costo_unitario * insumo.cantidad);
    return [201, { status: "ok", mensaje: "Consumo registrado" }];
  };
  const cambiarActivo = (lista, valor) => ({ id }) => {
    const elemento = buscar(lista(), id);
    if (!elemento) return error(404, "No encontrado");
    elemento.activo = valor;
    return [200, { status: "ok" }];
  };
  const eliminarDe = (lista) => ({ id }) => {
    const elemento = buscar(estado[lista], id);
    if (!elemento) return error(404, "No encontrado");
    if (elemento.activo) return error(409, "Solo se puede eliminar un elemento oculto");
    estado[lista].splice(estado[lista].indexOf(elemento), 1);
    return [200, { status: "ok", mensaje: "Eliminado" }];
  };

  // --- Equipamiento ---
  const resumenBienes = () => {
    // Regla del Backend (CU-18): los bienes ocultos siguen sumando al patrimonio; solo dejan de sumar si se eliminan.
    const activos = estado.bienes.filter((b) => b.activo);
    return {
      patrimonio_total: redondear(estado.bienes.reduce((s, b) => s + b.valor_total, 0)),
      unidades_totales: activos.reduce((s, b) => s + b.cantidad, 0),
      cantidad_bienes: activos.length,
    };
  };
  const listarBienes = () => [200, { status: "ok", bienes_uso: estado.bienes, resumen: resumenBienes() }];
  const crearBien = (_p, body) => {
    const errores = {};
    if (!String(body.nombre ?? "").trim()) errores.nombre = "El nombre es obligatorio";
    if (!(Number(body.cantidad) > 0) || !(Number(body.precio_compra) > 0)) return error(400, "El costo y la cantidad deben ser mayores a cero");
    if (!proveedor(body.proveedor_id)) errores.proveedor_id = "El proveedor no existe";
    if (Object.keys(errores).length) return error(400, "Error de validación en los datos enviados", errores);
    const nuevo = {
      id: proximoId++, nombre: body.nombre.trim(), costo_adquisicion: Number(body.precio_compra), cantidad: Number(body.cantidad),
      valor_total: redondear(Number(body.precio_compra) * Number(body.cantidad)), fecha_adquisicion: `${body.fecha_adquisicion}T15:00:00Z`, creado_por: "admin1", activo: true,
    };
    estado.bienes.push(nuevo);
    return [201, { status: "ok", mensaje: "Equipamiento registrado", bien_uso: nuevo }];
  };
  const editarBien = ({ id }, body) => {
    const bien = buscar(estado.bienes, id);
    if (!bien) return error(404, "Equipamiento no encontrado");
    Object.assign(bien, { nombre: body.nombre.trim(), costo_adquisicion: Number(body.precio_compra), cantidad: Number(body.cantidad), fecha_adquisicion: `${body.fecha_adquisicion}T15:00:00Z` });
    bien.valor_total = redondear(bien.costo_adquisicion * bien.cantidad);
    return [200, { status: "ok", bien_uso: bien }];
  };

  // --- Reposiciones ---
  const anularReposicion = ({ id }) => {
    const reposicion = buscar(estado.reposiciones, id);
    if (!reposicion) return error(404, "Reposición no encontrada");
    reposicion.estado = "ANULADA";
    return [200, { status: "ok", mensaje: "Reposición anulada" }];
  };

  const rutas = [
    ["GET", "/bienes-gasto", listarInsumos],
    ["POST", "/bienes-gasto", crearInsumo],
    ["POST", "/bienes-gasto/:id/reposicion", reponerInsumo],
    ["POST", "/bienes-gasto/:id/consumo", consumirInsumo],
    ["PATCH", "/bienes-gasto/:id/ocultar", cambiarActivo(() => estado.insumos, false)],
    ["PATCH", "/bienes-gasto/:id/restaurar", cambiarActivo(() => estado.insumos, true)],
    ["DELETE", "/bienes-gasto/:id", eliminarDe("insumos")],
    ["GET", "/bienes-uso", listarBienes],
    ["POST", "/bienes-uso", crearBien],
    ["PUT", "/bienes-uso/:id", editarBien],
    ["PATCH", "/bienes-uso/:id/ocultar", cambiarActivo(() => estado.bienes, false)],
    ["PATCH", "/bienes-uso/:id/restaurar", cambiarActivo(() => estado.bienes, true)],
    ["DELETE", "/bienes-uso/:id", eliminarDe("bienes")],
    ["GET", "/proveedores", () => [200, { status: "ok", items: estado.proveedores }]],
    // Alias de compatibilidad: hoy insumos.js y bienes-uso.js piden "/api/proveedores" (con un /api de más, que queda doblado
    // porque API_URL ya lo trae). El Backend real NO tiene esta ruta. Se responde igual para que el resto de los tests de esas
    // pantallas se pueda ejecutar; el test "pide los proveedores a /proveedores" es el que deja a la vista el error.
    ["GET", "/api/proveedores", () => [200, { status: "ok", items: estado.proveedores }]],
    ["GET", "/reposiciones", () => [200, estado.reposiciones]],
    ["PATCH", "/reposiciones/:id/anular", anularReposicion],
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

  await page.route(`${API}/**`, async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    // La dirección sin el prefijo /api del Gateway (que ya forma parte de API_URL).
    const ruta = new URL(request.url()).pathname.replace(/^\/api/, "");
    const metodo = request.method();
    const body = request.postData() ? JSON.parse(request.postData()) : null;
    llamadas.push({ metodo, ruta, body });
    const coincidente = rutas.find(([m, p]) => m === metodo && coincide(p, ruta));
    const patron = coincidente?.[1] ?? ruta;
    const espera = demoras.get(`${metodo} ${patron}`);
    if (espera) await new Promise((resolver) => setTimeout(resolver, espera));
    const forzada = fallas.get(`${metodo} ${patron}`);
    if (forzada) {
      if (forzada.abortar) return route.abort();
      return route.fulfill({ status: forzada.status, headers: CORS, json: forzada.body });
    }
    if (!coincidente) return route.fulfill({ status: 404, headers: CORS, json: { status: "error", mensaje: "Ruta no encontrada" } });
    const [status, cuerpo] = coincidente[2](coincide(coincidente[1], ruta), body);
    return route.fulfill({ status, headers: CORS, json: cuerpo });
  });

  return {
    llamadas,
    estado,
    rol,
    enviados: (metodo, ruta) => llamadas.filter((l) => l.metodo === metodo && l.ruta.replace(/\/\d+/g, "/:id") === ruta).map((l) => l.body),
    fallar: (clave, respuesta) => fallas.set(clave, respuesta),
    demorar: (clave, milisegundos) => demoras.set(clave, milisegundos),
  };
}

module.exports = { simularInventario };
