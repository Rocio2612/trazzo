// --- SERVICIOS DE VENTAS (módulo ES) ---
// Hablan con el Backend (a través del Gateway). Requieren api.js cargado antes (fetchAPI, que manda el token y
// renueva la sesión). Las respuestas vienen envueltas: acá se desenvuelven.
//
// Este archivo traduce entre lo que responde el Backend y lo que esperan las pantallas: ellas no cambian.
//
// RUTAS DEL BACKEND QUE SE USAN:
//   GET   /ventas                  -> { items: [ { id, numero_venta, tipo_venta, total, estado, fecha_hora, cliente } ] }
//   POST  /ventas                  -> { venta_id, numero, total } (201). Errores: 400 { mensaje }, 409 { mensaje } (stock)
//                                     recibe { tipo_venta, cliente_id, medio_pago_id, items: [ { producto_id, cantidad } ] }
//   PATCH /ventas/{id}/anular      -> { mensaje }
//   GET   /pagos/cuentas-corrientes -> { items: [ { venta_id, saldo_pendiente, productos: [ { nombre, precio, cantidad } ] } ] }
//   GET   /pagos?todos=true        -> { items: [ { venta_id, medio_pago } ] }
//   GET   /clientes                -> { items: [ { id, nombre, categoria_impositiva? } ] }
//   GET   /productos?tipo_producto=BIEN_DE_CAMBIO -> { items: [ producto ] } (la ruta que ya usa Productos)
//
// Formato que reciben las pantallas:
//   venta = { id, numero ("00001-00000458"), tipo ("CONTADO" | "CUENTA_CORRIENTE"), cliente_nombre (null = Consumidor final),
//             fecha_hora, total, saldo, medio_pago (nombre), credito_aplicado, anulada, oculto,
//             items: [ { producto, precio, cantidad } ] (precio = el del momento de la venta), iva }
//
// LO QUE EL BACKEND TODAVÍA NO TIENE:
//   - PATCH /ventas/{id}/ocultar y GET /ventas/{id}/ticket (las rutas responden 404).
//   - Los productos de las ventas de contado (items queda vacío) y el desglose del IVA (iva queda en null).
//   - Descontar el saldo a favor: por eso los clientes se entregan con saldo 0 y la pantalla no ofrece usarlo.

// El Backend manda el número sin punto de venta y guarda todas las ventas en la sucursal 1.
const numeroCompleto = (numero) => `00001-${String(numero).padStart(8, "0")}`;

const itemsDe = (respuesta) => respuesta?.items ?? [];

// Datos que completan una venta (productos, saldo y medio de pago). Si fallan, la venta se muestra igual sin ellos.
const pedirComplemento = async (ruta) => {
  try {
    return itemsDe(await fetchAPI(ruta));
  } catch {
    return [];
  }
};

const traducirVenta = (venta, cuenta, pago) => ({
  id: venta.id,
  numero: numeroCompleto(venta.numero_venta),
  tipo: venta.tipo_venta,
  cliente_nombre: venta.cliente ?? null,
  fecha_hora: venta.fecha_hora,
  total: Number(venta.total),
  saldo: cuenta?.saldo_pendiente,
  medio_pago: venta.tipo_venta === "CONTADO" ? (pago?.medio_pago ?? null) : null,
  credito_aplicado: 0,
  anulada: venta.estado === "ANULADA",
  oculto: false,
  items: (cuenta?.productos ?? []).map((p) => ({ producto: p.nombre, precio: p.precio, cantidad: p.cantidad })),
  iva: null,
});

// El Backend nombra al producto sin stock por su número: se reemplaza por el nombre.
const ponerNombreDelProducto = async (error) => {
  const id = Number(/producto (\d+)$/.exec(error.message)?.[1]);
  if (!id) return;
  const productos = await servicioProductosDeVentas.listar().catch(() => []);
  const producto = productos.find((p) => p.id === id);
  if (producto) error.message = `Stock insuficiente para el producto "${producto.nombre}"`;
};

export const servicioVentas = {
  // Todas las ventas (confirmadas y anuladas), de cualquier tipo.
  listar: async () => {
    const ventas = itemsDe(await fetchAPI("/ventas"));
    if (ventas.length === 0) return [];
    const [cuentas, pagos] = await Promise.all([
      pedirComplemento("/pagos/cuentas-corrientes"),
      pedirComplemento("/pagos?todos=true&incluir_ocultos=true"),
    ]);
    return ventas.map((v) => traducirVenta(v, cuentas.find((c) => c.venta_id === v.id), pagos.find((p) => p.venta_id === v.id)));
  },

  // La fecha, la hora y el número los pone el Backend. Devuelve la venta confirmada.
  crear: async ({ tipo, ...datos }) => {
    let respuesta;
    try {
      respuesta = await fetchAPI("/ventas", "POST", { ...datos, tipo_venta: tipo });
    } catch (error) {
      if (error.status === 409) await ponerNombreDelProducto(error);
      throw error;
    }
    const basica = { id: respuesta.venta_id, numero_venta: respuesta.numero, tipo_venta: tipo, total: respuesta.total, estado: "CONFIRMADA" };
    // La venta ya quedó guardada: desde acá no puede haber errores, para que no se confirme dos veces.
    // Se busca en el listado para traer la fecha, el cliente y el medio de pago.
    const ventas = await servicioVentas.listar().catch(() => []);
    const guardada = ventas.find((v) => v.id === basica.id);
    return guardada ?? traducirVenta({ ...basica, cliente: datos.cliente_id ? "Cliente registrado" : null });
  },

  // Devuelve el stock, anula los pagos y excluye la venta de los reportes. Conserva el número.
  anular: (id) => fetchAPI(`/ventas/${id}/anular`, "PATCH"),

  // Ocultar no cambia los reportes: la venta sigue contando. El Backend todavía no tiene esta ruta.
  ocultar: async (id, oculto) => (await fetchAPI(`/ventas/${id}/ocultar`, "PATCH", { oculto })).venta,

  // Baja el ticket de una venta confirmada (/api/ventas/{id}/ticket).
  descargarTicket: async (id, numero = String(id)) => {
    const respuesta = await fetch(`${API_URL}/ventas/${id}/ticket`, { headers: { Authorization: `Bearer ${localStorage.getItem("trazzo_access_token")}` } });
    if (!respuesta.ok) {
      const data = await respuesta.json().catch(() => ({}));
      const error = new Error(data.mensaje || "No se pudo descargar el ticket.");
      error.status = respuesta.status;
      throw error;
    }
    const archivo = URL.createObjectURL(await respuesta.blob());
    const enlace = document.createElement("a");
    enlace.href = archivo;
    enlace.download = `ticket-${numero}.pdf`;
    document.body.append(enlace);
    enlace.click();
    enlace.remove();
    setTimeout(() => URL.revokeObjectURL(archivo), 1000);
  },
};

// Clientes ya registrados en el módulo de Clientes (no se crean desde Ventas). Los ocultos no se ofrecen.
export const servicioClientesDeVentas = {
  // Saldo a favor en 0: el Backend todavía no lo descuenta al vender, así que no se ofrece.
  listar: async () => itemsDe(await fetchAPI("/clientes")).map((c) => ({ ...c, saldo_a_favor: 0 })),
};

// Productos para vender (bienes de cambio). Usa la misma ruta que la pantalla de Productos.
export const servicioProductosDeVentas = {
  listar: async () => {
    const params = new URLSearchParams({ tipo_producto: "BIEN_DE_CAMBIO" });
    const data = await fetchAPI(`/productos?${params.toString()}`);
    return (data?.items ?? []).map((p) => ({ ...p, cantidad: Number(p.cantidad), precio_venta: Number(p.precio_venta) }));
  },
};
