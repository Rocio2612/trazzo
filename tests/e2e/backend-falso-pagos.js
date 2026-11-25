// --- BACKEND FALSO DE CUENTA CORRIENTE Y PAGOS PARA LOS TESTS E2E ---
// Simula, dentro del navegador de Playwright, los endpoints que usa la pantalla Cuenta corriente, con el formato y las reglas
// del Backend real (services/transacciones-service/routes/pagos.py):
//   GET   /pagos/cuentas-corrientes           -> { status, items: [venta a cuenta corriente con total, pagado, saldo y productos] }
//   GET   /pagos?incluir_ocultos=true         -> { status, items: [pago] }  (el Cajero nunca recibe los ocultos ni los datos de auditoría)
//   POST  /pagos                              -> 201 { status, pago, monto_aplicado, excedente_a_favor, saldo_venta, ... }
//   PUT   /pagos/<id>   PATCH /pagos/<id>/anular   PATCH /pagos/<id>/visibilidad (solo Administrador)
//   GET   /medios-pago                        -> { status, medios_pago: [...] }  (formato real: la lista NO viene en "items")
//
//   const backend = await simularPagos(page, { rol: "ADMIN" });
//   backend.llamadas                          -> todo lo que pidió la pantalla ({ metodo, ruta, consulta, body })
//   backend.enviados("POST", "/pagos")        -> los cuerpos enviados a esa ruta (los números de id se cuentan como /:id)
//   backend.estado                            -> datos en memoria (ventas, pagos, medios)
//   backend.fallar("GET /pagos", { status: 500, body: { mensaje: "..." } })   (también { abortar: true })
//   backend.demorar("POST /pagos", 600)
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

const redondear = (n) => Math.round(n * 100) / 100;
const error = (status, mensaje) => [status, { status: "error", mensaje }];
const dosDigitos = (n) => String(n).padStart(2, "0");
const nroVenta = (v) => `00001-${String(v.numero_venta).padStart(8, "0")}`;
const nroPago = (p) => String(p.id).padStart(8, "0");
const MENSAJE_FECHA_FUTURA = "La fecha de pago no puede ser posterior a la fecha actual";

// Ventas a cuenta corriente (todas sucursal 1) y sus pagos. Las fechas van a media tarde (UTC) para que el día no cambie
// con la zona horaria de quien corre los tests.
//   467 Sandra Quiroga            $ 4.260   sin pagos                         -> Pendiente, deuda $ 4.260
//   460 Panadería La Espiga S.A.  $ 6.500   pago 2: Efectivo $ 6.500          -> Saldada
//   462 Almacén Don Pedro S.R.L.  $ 4.260   pago 1: Transferencia $ 1.000     -> Pendiente, deuda $ 3.260
//   470 Luis Gómez                $ 3.000   ANULADA
// El pago 3 (Mercado Pago $ 500 sobre la venta 467) está oculto: solo lo ve el Administrador.
const semillaInicial = () => ({
  medios: [
    { id: 1, nombre: "Efectivo", es_predeterminado: true, activo: true },
    { id: 2, nombre: "Transferencia", es_predeterminado: false, activo: true },
    { id: 3, nombre: "Tarjeta Débito", es_predeterminado: false, activo: true },
    { id: 4, nombre: "Mercado Pago", es_predeterminado: false, activo: true },
  ],
  ventas: [
    {
      id: 467, numero_venta: "467", fecha_hora: "2026-11-03T15:00:00+00:00", cliente_id: 11, cliente_nombre: "Sandra Quiroga", total: 4260, estado_venta: "CONFIRMADA", saldo_a_favor_cliente: 0,
      productos: [
        { nombre: "Sifón de soda", precio: 1200, cantidad: 2, subtotal: 2400 },
        { nombre: "Detergente 750 ml", precio: 930, cantidad: 2, subtotal: 1860 },
      ],
    },
    {
      id: 460, numero_venta: "460", fecha_hora: "2026-10-15T15:00:00+00:00", cliente_id: 12, cliente_nombre: "Panadería La Espiga S.A.", total: 6500, estado_venta: "CONFIRMADA", saldo_a_favor_cliente: 0,
      productos: [{ nombre: "Yerba mate 1 kg", precio: 3250, cantidad: 2, subtotal: 6500 }],
    },
    {
      id: 462, numero_venta: "462", fecha_hora: "2026-10-20T15:00:00+00:00", cliente_id: 13, cliente_nombre: "Almacén Don Pedro S.R.L.", total: 4260, estado_venta: "CONFIRMADA", saldo_a_favor_cliente: 150,
      productos: [
        { nombre: "Sifón de soda", precio: 1200, cantidad: 1, subtotal: 1200 },
        { nombre: "Lavandina 1 l", precio: 1530, cantidad: 2, subtotal: 3060 },
      ],
    },
    { id: 470, numero_venta: "470", fecha_hora: "2026-10-25T15:00:00+00:00", cliente_id: 14, cliente_nombre: "Luis Gómez", total: 3000, estado_venta: "ANULADA", saldo_a_favor_cliente: 0, productos: [] },
  ],
  pagos: [
    { id: 1, venta_id: 462, medio_pago_id: 2, monto: 1000, fecha_pago: "2026-10-21T15:00:00+00:00", estado: "ACTIVO", oculto: false, creado_por: "admin1" },
    { id: 2, venta_id: 460, medio_pago_id: 1, monto: 6500, fecha_pago: "2026-10-16T15:00:00+00:00", estado: "ACTIVO", oculto: false, creado_por: "admin1" },
    { id: 3, venta_id: 467, medio_pago_id: 4, monto: 500, fecha_pago: "2026-11-04T15:00:00+00:00", estado: "ANULADO", oculto: true, creado_por: "cajero1" },
  ],
});

// Acepta los mismos formatos que el Backend ('aaaa-mm-dd', 'dd-mm-aaaa', 'dd-mm-aaaa hh:mm' y la fecha con hora que manda la
// pantalla, 'aaaa-mm-dd hh:mm:ss'). Devuelve { fecha } o { error }. La hora que se escribe es la de Argentina (UTC-3).
const interpretarFecha = (texto, fechaVenta) => {
  const ahora = new Date();
  let fecha;
  const t = String(texto ?? "").trim();
  if (!t) fecha = ahora;
  else {
    let m;
    if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t))) fecha = new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00-03:00`);
    else if ((m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(t))) fecha = new Date(`${m[3]}-${m[2]}-${m[1]}T12:00:00-03:00`);
    else if ((m = /^(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2})$/.exec(t))) fecha = new Date(`${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:00-03:00`);
    else if ((m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(t))) fecha = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] || "00"}-03:00`);
    else fecha = new Date(t);
    if (Number.isNaN(fecha.getTime())) return { error: "Formato de fecha inválido. Use dd-mm-aaaa hh:mm o ISO 8601" };
    const diaArg = (d) => new Date(d.getTime() - 3 * 3600 * 1000).toISOString().slice(0, 10);
    if (diaArg(fecha) > diaArg(ahora)) return { error: MENSAJE_FECHA_FUTURA };
  }
  if (fechaVenta && fecha.getTime() < new Date(fechaVenta).getTime() - 59 * 1000) {
    const v = new Date(new Date(fechaVenta).getTime() - 3 * 3600 * 1000);
    const txt = `${dosDigitos(v.getUTCDate())}-${dosDigitos(v.getUTCMonth() + 1)}-${v.getUTCFullYear()} ${dosDigitos(v.getUTCHours())}:${dosDigitos(v.getUTCMinutes())}`;
    return { error: `La fecha y hora del pago no pueden ser anteriores a las de la venta (${txt})` };
  }
  return { fecha: fecha.toISOString() };
};

async function simularPagos(page, { rol = "ADMIN", semilla } = {}) {
  const estado = semillaInicial();
  semilla?.(estado);
  const llamadas = [];
  const fallas = new Map();
  const demoras = new Map();
  let proximoPago = Math.max(0, ...estado.pagos.map((p) => p.id)) + 1;

  const venta = (id) => estado.ventas.find((v) => v.id === Number(id));
  const pago = (id) => estado.pagos.find((p) => p.id === Number(id));
  const medio = (id) => estado.medios.find((m) => m.id === Number(id));
  const pagado = (v) => redondear(estado.pagos.filter((p) => p.venta_id === v.id && p.estado === "ACTIVO").reduce((s, p) => s + p.monto, 0));
  const esAdmin = rol !== "CAJERO";

  const serializarVenta = (v) => {
    const total = v.total;
    const pag = pagado(v);
    const saldo = redondear(total - pag);
    const anulada = v.estado_venta === "ANULADA";
    const item = {
      id: v.id, venta_id: v.id, numero_venta: v.numero_venta, nro_venta: nroVenta(v), fecha_hora: v.fecha_hora, fecha: v.fecha_hora,
      cliente_id: v.cliente_id, cliente_nombre: v.cliente_nombre, cliente: v.cliente_nombre,
      total, total_pagado: pag, pagado: pag, saldo, saldo_pendiente: Math.max(saldo, 0), anulada,
      estado_cuenta: anulada ? "ANULADA" : saldo <= 0 ? "SALDADA" : "PENDIENTE", productos: v.productos,
    };
    if (esAdmin) item.saldo_a_favor_cliente = v.saldo_a_favor_cliente;
    return item;
  };

  const serializarPago = (p) => {
    const v = venta(p.venta_id);
    const m = medio(p.medio_pago_id);
    const base = {
      id: p.id, nro_pago: nroPago(p), venta_id: p.venta_id, numero_venta: v.numero_venta, nro_venta: nroVenta(v), tipo_venta: "CUENTA_CORRIENTE",
      cliente_id: v.cliente_id, cliente_nombre: v.cliente_nombre, cliente: v.cliente_nombre,
      medio_pago_id: p.medio_pago_id, medio_pago_nombre: m.nombre, medio_pago: m.nombre,
      monto: p.monto, fecha_pago: p.fecha_pago, fecha: p.fecha_pago, estado: p.estado, anulado: p.estado === "ANULADO",
    };
    if (!esAdmin) return base;
    return { ...base, oculto: p.oculto, creado_por: p.creado_por, modificado_por: p.modificado_por ?? null, anulado_por: p.anulado_por ?? null };
  };

  const listarVentas = () => [200, { status: "ok", items: estado.ventas.map(serializarVenta) }];

  const listarPagos = (params, body, consulta) => {
    let lista = estado.pagos;
    if (!esAdmin || consulta.incluir_ocultos !== "true") lista = lista.filter((p) => !p.oculto);
    return [200, { status: "ok", items: [...lista].sort((a, b) => b.fecha_pago.localeCompare(a.fecha_pago) || b.id - a.id).map(serializarPago) }];
  };

  const registrar = (params, body) => {
    if (!body?.venta_id || !body?.medio_pago_id || body.monto === undefined || body.monto === null) {
      return error(400, "Los campos venta_id, medio_pago_id y monto son obligatorios");
    }
    const monto = redondear(Number(body.monto));
    if (Number.isNaN(monto)) return error(400, "El monto debe ser un valor numérico válido");
    if (monto <= 0) return error(400, "El monto del pago debe ser mayor a cero");
    const m = medio(body.medio_pago_id);
    if (!m) return error(404, "El medio de pago seleccionado no existe");
    if (!m.activo) return error(400, "El medio de pago seleccionado está inactivo");
    const v = venta(body.venta_id);
    if (!v) return error(404, "La venta indicada no existe");
    if (v.estado_venta !== "CONFIRMADA") return error(409, "No se pueden registrar pagos sobre una venta anulada");
    const saldo = redondear(v.total - pagado(v));
    if (saldo <= 0) return error(409, "Esta venta ya se encuentra completamente saldada");
    const fecha = interpretarFecha(body.fecha_pago, v.fecha_hora);
    if (fecha.error) return error(400, fecha.error);
    const excedente = monto > saldo ? redondear(monto - saldo) : 0;
    const nuevo = { id: proximoPago++, venta_id: v.id, medio_pago_id: m.id, monto, fecha_pago: fecha.fecha, estado: "ACTIVO", oculto: false, creado_por: "usuario1" };
    estado.pagos.push(nuevo);
    if (excedente > 0) v.saldo_a_favor_cliente = redondear(v.saldo_a_favor_cliente + excedente);
    const saldoFinal = redondear(saldo - monto);
    const respuesta = {
      status: "ok",
      mensaje: excedente === 0 ? "Pago registrado correctamente" : "Pago registrado y excedente acreditado como saldo a favor",
      pago: serializarPago(nuevo),
      monto_aplicado: Math.min(monto, saldo),
      excedente_a_favor: excedente,
      saldo_venta: saldoFinal,
      saldo_pendiente_venta: Math.max(saldoFinal, 0),
      estado_venta_cuenta: saldoFinal <= 0 ? "SALDADA" : "PENDIENTE",
    };
    return [201, respuesta];
  };

  const editar = ({ id }, body) => {
    const p = pago(id);
    if (!p) return error(404, "Pago no encontrado");
    if (p.estado === "ANULADO") return error(409, "No se puede editar un pago anulado");
    const v = venta(body?.venta_id ?? p.venta_id);
    if (!v) return error(404, "La venta seleccionada no existe");
    if (v.estado_venta !== "CONFIRMADA") return error(400, "Solo se pueden asociar pagos a ventas confirmadas de Cuenta Corriente");
    const monto = redondear(Number(body?.monto));
    if (Number.isNaN(monto)) return error(400, "El monto debe ser un valor numérico válido");
    if (monto <= 0) return error(400, "El monto del pago debe ser mayor a cero");
    const fecha = interpretarFecha(body?.fecha_pago, v.fecha_hora);
    if (fecha.error) return error(400, fecha.error);
    const m = medio(body?.medio_pago_id);
    if (!m || !m.activo) return error(400, "El medio de pago seleccionado no es válido o está inactivo");
    Object.assign(p, { venta_id: v.id, medio_pago_id: m.id, monto, fecha_pago: fecha.fecha, modificado_por: "usuario1" });
    return [200, { status: "ok", mensaje: "Pago actualizado correctamente", pago: serializarPago(p) }];
  };

  const anular = ({ id }) => {
    const p = pago(id);
    if (!p) return error(404, "Pago no encontrado");
    if (p.estado === "ANULADO") return error(409, "Este pago ya se encuentra anulado");
    Object.assign(p, { estado: "ANULADO", anulado_por: "usuario1" });
    return [200, { status: "ok", mensaje: "Pago anulado correctamente; el saldo de la venta fue recalculado", pago: serializarPago(p) }];
  };

  const visibilidad = ({ id }, body) => {
    if (!esAdmin) return error(403, "No tenés permiso para realizar esta acción.");
    const p = pago(id);
    if (!p) return error(404, "Pago no encontrado");
    p.oculto = typeof body?.oculto === "boolean" ? body.oculto : !p.oculto;
    return [200, { status: "ok", mensaje: `Pago ${p.oculto ? "ocultado" : "restaurado"} visualmente (el saldo de la venta no se altera)`, pago: { id: p.id, oculto: p.oculto } }];
  };

  // [método, ruta, función(parámetros de la ruta, cuerpo, parámetros de la dirección) -> [status, cuerpo]]
  const rutas = [
    ["GET", "/pagos/cuentas-corrientes", listarVentas],
    ["GET", "/pagos", listarPagos],
    ["POST", "/pagos", registrar],
    ["PUT", "/pagos/:id", editar],
    ["PATCH", "/pagos/:id/anular", anular],
    ["PATCH", "/pagos/:id/visibilidad", visibilidad],
    ["GET", "/medios-pago", () => [200, { status: "ok", medios_pago: estado.medios.filter((m) => m.activo).map(({ id, nombre, es_predeterminado }) => ({ id, nombre, es_predeterminado })) }]],
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
    const url = new URL(request.url());
    const ruta = url.pathname.replace(/^\/api/, "");
    const consulta = Object.fromEntries(url.searchParams);
    const metodo = request.method();
    const body = request.postData() ? JSON.parse(request.postData()) : null;
    llamadas.push({ metodo, ruta, consulta, body });
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

module.exports = { simularPagos };
