// --- DATOS SIMULADOS DE VENTAS (hasta que Back publique /ventas) ---
// Sirven para ver las pantallas de Nueva venta y de Historial de ventas con datos de ejemplo, sin Backend.
// Los datos viven en la pestaña (sessionStorage): sobreviven al pasar de Nueva venta al Historial y se pierden
// al cerrarla. Hacen lo mismo que va a hacer el Backend: ponen el número y la fecha, descuentan el stock al
// confirmar, bloquean si no alcanza, y al anular devuelven el stock y el saldo a favor.
//
// Cada función imita una ruta (el contrato está en servicios/ventas.js):
//   GET/POST /ventas · POST /ventas/{id}/anular · PATCH /ventas/{id}/ocultar · GET /ventas/{id}/ticket
//   GET /clientes · GET /productos?tipo_producto=BIEN_DE_CAMBIO · GET /medios-pago · GET /auth/negocio
// Los nombres de campo son provisorios hasta cerrar el contrato con Back.
// Privacidad: al Cajero (sin permiso para ver clientes) los clientes le llegan sin categoría impositiva.
// Los ejemplos se arman con la fecha de hoy, así el filtro de período siempre tiene algo para mostrar.

import { calcularIva } from "../ventas.js";

const CLAVE = "trazzo_ventas_mock";
const CATEGORIA_NEGOCIO = "RESPONSABLE_INSCRIPTO";

const redondear = (n) => Math.round(n * 100) / 100;
const haceDias = (dias) => new Date(Date.now() - dias * 86400000).toISOString();

const errorHttp = (status, mensaje, errores) => Object.assign(new Error(mensaje), { status, ...(errores ? { errores } : {}) });
const errorDeValidacion = (errores) => errorHttp(400, "Error de validación en los datos enviados", errores);

export const MEDIOS_PAGO_EJEMPLO = [
  { id: 1, nombre: "Efectivo", es_predeterminado: true },
  { id: 2, nombre: "Transferencia", es_predeterminado: false },
  { id: 3, nombre: "Tarjeta de débito", es_predeterminado: false },
];

export const PRODUCTOS_EJEMPLO = [
  { id: 1, nombre: "Sifón de soda 1.5 l", categoria_nombre: "Bebidas", cantidad: 2, precio_venta: 1200 },
  { id: 2, nombre: "Bidón de agua 20 l", categoria_nombre: "Bebidas", cantidad: 0, precio_venta: 2200 },
  { id: 3, nombre: "Detergente 750 ml", categoria_nombre: "Limpieza", cantidad: 24, precio_venta: 980 },
  { id: 4, nombre: "Lavandina 1 l", categoria_nombre: "Limpieza", cantidad: 40, precio_venta: 590 },
  { id: 5, nombre: "Yerba mate 1 kg", categoria_nombre: "Almacén", cantidad: 15, precio_venta: 3100 },
  { id: 6, nombre: "Agua mineral 2 l", categoria_nombre: "Bebidas", cantidad: 48, precio_venta: 750 },
  { id: 7, nombre: "Gaseosa cola 2.25 l", categoria_nombre: "Bebidas", cantidad: 30, precio_venta: 1850 },
  { id: 8, nombre: "Jugo de naranja 1 l", categoria_nombre: "Bebidas", cantidad: 1, precio_venta: 1100 },
  { id: 9, nombre: "Jabón en polvo 800 g", categoria_nombre: "Limpieza", cantidad: 18, precio_venta: 2400 },
  { id: 10, nombre: "Esponja doble faz", categoria_nombre: "Limpieza", cantidad: 60, precio_venta: 320 },
  { id: 11, nombre: "Fideos tirabuzón 500 g", categoria_nombre: "Almacén", cantidad: 80, precio_venta: 890 },
  { id: 12, nombre: "Aceite de girasol 900 ml", categoria_nombre: "Almacén", cantidad: 22, precio_venta: 1950 },
  { id: 13, nombre: "Azúcar 1 kg", categoria_nombre: "Almacén", cantidad: 35, precio_venta: 1050 },
  { id: 14, nombre: "Papel higiénico x4", categoria_nombre: "Perfumería", cantidad: 0, precio_venta: 1700 },
  { id: 15, nombre: "Shampoo 400 ml", categoria_nombre: "Perfumería", cantidad: 12, precio_venta: 2850 },
];

export const CLIENTES_EJEMPLO = [
  { id: 1, nombre: "Almacén Don Pedro S.R.L.", saldo_a_favor: 0, categoria_impositiva: "RESPONSABLE_INSCRIPTO" },
  { id: 2, nombre: "María Fernanda López", saldo_a_favor: 660, categoria_impositiva: "CONSUMIDOR_FINAL" },
  { id: 3, nombre: "Kiosco El Sol (Carlos Gómez)", saldo_a_favor: 0, categoria_impositiva: "MONOTRIBUTISTA" },
  { id: 4, nombre: "Fundación Manos Unidas", saldo_a_favor: 0, categoria_impositiva: "EXENTO" },
];

const NEGOCIO_EJEMPLO = { identificador: "kiosco", nombre_comercial: "Kiosco", rubro: "Kiosco", categoria_impositiva: CATEGORIA_NEGOCIO };

const ventaDeEjemplo = (datos, productos) => {
  const items = datos.items.map(([producto_id, cantidad]) => {
    const p = productos.find((x) => x.id === producto_id);
    return { producto_id, producto: p.nombre, precio: p.precio_venta, cantidad };
  });
  const total = redondear(items.reduce((suma, i) => suma + i.precio * i.cantidad, 0));
  const cliente = CLIENTES_EJEMPLO.find((c) => c.id === datos.cliente_id) ?? null;
  return {
    id: datos.id,
    numero: datos.numero,
    tipo: datos.tipo,
    cliente_id: cliente?.id ?? null,
    cliente_nombre: cliente?.nombre ?? null,
    fecha_hora: haceDias(datos.dias),
    total,
    saldo: datos.tipo === "CONTADO" ? 0 : total,
    medio_pago: datos.tipo === "CONTADO" ? datos.medio : null,
    credito_aplicado: 0,
    anulada: Boolean(datos.anulada),
    oculto: Boolean(datos.oculto),
    items,
    iva: calcularIva(total, CATEGORIA_NEGOCIO, cliente ? cliente.categoria_impositiva : "CONSUMIDOR_FINAL"),
  };
};

const semilla = () => ({
  productos: PRODUCTOS_EJEMPLO.map((p) => ({ ...p })),
  clientes: CLIENTES_EJEMPLO.map((c) => ({ ...c })),
  ventas: [
    { id: 1, numero: "00001-00000451", tipo: "CUENTA_CORRIENTE", cliente_id: 1, dias: 40, items: [[5, 2]] },
    { id: 2, numero: "00001-00000452", tipo: "CONTADO", cliente_id: null, dias: 0, medio: "Efectivo", items: [[3, 3], [4, 1]] },
    { id: 3, numero: "00001-00000453", tipo: "CUENTA_CORRIENTE", cliente_id: 3, dias: 20, anulada: true, items: [[1, 2]] },
    { id: 4, numero: "00001-00000454", tipo: "CONTADO", cliente_id: null, dias: 5, medio: "Transferencia", oculto: true, items: [[4, 1]] },
  ].map((v) => ventaDeEjemplo(v, PRODUCTOS_EJEMPLO)),
});

// Estado en memoria; se guarda en sessionStorage después de cada cambio (si el navegador no lo permite, queda solo en memoria).
let estado = null;
const cargarEstado = () => {
  if (estado) return estado;
  try {
    const guardado = sessionStorage.getItem(CLAVE);
    if (guardado) return (estado = JSON.parse(guardado));
  } catch {
    // sin sessionStorage: se trabaja en memoria
  }
  return (estado = semilla());
};
const guardarEstado = () => {
  try {
    sessionStorage.setItem(CLAVE, JSON.stringify(estado));
  } catch {
    // sin sessionStorage: se trabaja en memoria
  }
};

const productoPorId = (id) => cargarEstado().productos.find((p) => p.id === Number(id));
const clientePorId = (id) => cargarEstado().clientes.find((c) => c.id === Number(id));
const ventaPorId = (id) => cargarEstado().ventas.find((v) => v.id === Number(id));
const copia = (objeto) => JSON.parse(JSON.stringify(objeto));

export const servicioVentas = {
  // Simula GET /ventas (confirmadas y anuladas; las ocultas llevan oculto: true)
  listar: async () => copia(cargarEstado().ventas),

  // Simula POST /ventas: valida, descuenta el stock y pone número y fecha.
  crear: async (datos) => {
    const { productos, clientes, ventas } = cargarEstado();
    const items = Array.isArray(datos.items) ? datos.items : [];
    const errores = {};
    if (items.length === 0) errores.items = "Seleccioná al menos un producto.";
    else if (items.some((i) => !Number.isInteger(i.cantidad) || i.cantidad < 1)) errores.items = "Cada producto necesita una cantidad entera mayor a 0.";
    if (!["CONTADO", "CUENTA_CORRIENTE"].includes(datos.tipo)) errores.tipo = "Elegí el tipo de venta.";
    const comprador = datos.cliente_id ? clientes.find((c) => c.id === Number(datos.cliente_id)) : null;
    if (datos.cliente_id && !comprador) errores.cliente_id = "El cliente no está registrado.";
    if (datos.tipo === "CUENTA_CORRIENTE" && !datos.cliente_id) errores.cliente_id = "Seleccioná un cliente registrado para una venta a cuenta corriente.";
    const lineas = items.map((i) => ({ ...i, producto: productos.find((p) => p.id === Number(i.producto_id)) }));
    if (lineas.some((l) => !l.producto)) errores.items = "Hay un producto que no existe.";
    if (Object.keys(errores).length) throw errorDeValidacion(errores);

    const total = redondear(lineas.reduce((suma, l) => suma + l.producto.precio_venta * l.cantidad, 0));
    const credito = Number(datos.saldo_a_favor_usado) || 0;
    if (credito > 0) {
      if (!comprador || credito > comprador.saldo_a_favor) throw errorDeValidacion({ saldo_a_favor_usado: "El saldo a favor a usar supera el que tiene el cliente." });
      if (credito > total) throw errorDeValidacion({ saldo_a_favor_usado: "El saldo a favor a usar supera el total de la venta." });
    }
    const aCobrar = redondear(total - credito);
    const medio = MEDIOS_PAGO_EJEMPLO.find((m) => m.id === Number(datos.medio_pago_id));
    if (datos.tipo === "CONTADO" && aCobrar > 0 && !medio) throw errorDeValidacion({ medio_pago_id: "Seleccioná el medio de pago de la venta." });
    // Bloqueo por stock: no se crea la venta y no cambia nada.
    const sinStock = lineas.find((l) => l.producto.cantidad < l.cantidad);
    if (sinStock) throw errorHttp(409, `No se puede confirmar la venta: "${sinStock.producto.nombre}" no tiene stock suficiente (stock actual: ${sinStock.producto.cantidad}).`);

    lineas.forEach((l) => (l.producto.cantidad -= l.cantidad));
    if (comprador) comprador.saldo_a_favor = redondear(comprador.saldo_a_favor - credito);
    const siguiente = Math.max(450, ...ventas.map((v) => Number(v.numero.split("-")[1]))) + 1;
    const nueva = {
      id: Math.max(0, ...ventas.map((v) => v.id)) + 1,
      numero: `00001-${String(siguiente).padStart(8, "0")}`,
      tipo: datos.tipo,
      cliente_id: comprador?.id ?? null,
      cliente_nombre: comprador?.nombre ?? null,
      fecha_hora: new Date().toISOString(),
      total,
      saldo: datos.tipo === "CONTADO" ? 0 : aCobrar,
      medio_pago: datos.tipo === "CONTADO" && aCobrar > 0 ? medio.nombre : null,
      credito_aplicado: credito,
      anulada: false,
      oculto: false,
      items: lineas.map((l) => ({ producto_id: l.producto.id, producto: l.producto.nombre, precio: l.producto.precio_venta, cantidad: l.cantidad })),
      iva: calcularIva(total, CATEGORIA_NEGOCIO, comprador ? comprador.categoria_impositiva : "CONSUMIDOR_FINAL"),
    };
    ventas.push(nueva);
    guardarEstado();
    return copia(nueva);
  },

  // Simula POST /ventas/{id}/anular: el stock vuelve y la venta conserva su número.
  anular: async (id) => {
    const venta = ventaPorId(id);
    if (!venta) throw errorHttp(404, "Venta no encontrada");
    if (venta.anulada) throw errorHttp(409, "La venta ya está anulada");
    venta.anulada = true;
    venta.saldo = 0;
    venta.items.forEach((i) => {
      const producto = productoPorId(i.producto_id);
      if (producto) producto.cantidad += i.cantidad;
    });
    if (venta.credito_aplicado > 0) {
      const cliente = clientePorId(venta.cliente_id);
      if (cliente) cliente.saldo_a_favor = redondear(cliente.saldo_a_favor + venta.credito_aplicado);
    }
    guardarEstado();
    return copia(venta);
  },

  // Simula PATCH /ventas/{id}/ocultar. Ocultar no cambia los reportes.
  ocultar: async (id, oculto) => {
    const venta = ventaPorId(id);
    if (!venta) throw errorHttp(404, "Venta no encontrada");
    venta.oculto = Boolean(oculto);
    guardarEstado();
    return copia(venta);
  },

  // Simula GET /ventas/{id}/ticket: el Backend va a devolver el PDF; acá se baja un texto de ejemplo.
  descargarTicket: async (id, numero = String(id)) => {
    const venta = ventaPorId(id);
    if (!venta) throw errorHttp(404, "Venta no encontrada");
    const lineas = venta.items.map((i) => `${i.cantidad} x ${i.producto}  $ ${i.precio}`);
    const texto = ["TICKET DE EJEMPLO (sin valor)", `Venta ${venta.numero}`, ...lineas, `Total: $ ${venta.total}`].join("\n");
    const archivo = URL.createObjectURL(new Blob([texto], { type: "text/plain" }));
    const enlace = document.createElement("a");
    enlace.href = archivo;
    enlace.download = `ticket-${numero}.txt`;
    document.body.append(enlace);
    enlace.click();
    enlace.remove();
    setTimeout(() => URL.revokeObjectURL(archivo), 1000);
  },
};

// Simula GET /clientes. El Cajero no ve la categoría impositiva ni otros datos del cliente: solo nombre y saldo a favor.
export const servicioClientesDeVentas = {
  listar: async () => {
    const puedeVerClientes = typeof puedeHacer === "function" && puedeHacer("clientes", "ver");
    return cargarEstado().clientes.map((c) => (puedeVerClientes ? { ...c } : { id: c.id, nombre: c.nombre, saldo_a_favor: c.saldo_a_favor }));
  },
};

// Simula GET /productos?tipo_producto=BIEN_DE_CAMBIO
export const servicioProductosDeVentas = {
  listar: async () => copia(cargarEstado().productos),
};

// Simula GET /medios-pago (mismo formato que servicios/medios-pago.js: el id viaja como texto).
export const cargarMediosPago = async () => MEDIOS_PAGO_EJEMPLO.map((m) => ({ id: String(m.id), nombre: m.nombre }));

// Simula GET /auth/negocio
export const servicioNegocio = {
  obtener: async () => ({ ...NEGOCIO_EJEMPLO }),
};
