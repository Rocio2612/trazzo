// --- SERVICIO DE PRODUCTOS Y REPOSICIONES (módulo ES) ---
// Habla con el Backend (productos-service, a través del Gateway): /productos y /reposiciones.
// Requiere api.js cargado antes (fetchAPI, función global). Las respuestas vienen envueltas:
// acá se desenvuelven. fetchAPI devuelve undefined si la sesión venció (ya redirige al login).

const comoLista = (data) => (Array.isArray(data) ? data : (data?.items ?? []));

export const servicioProductos = {
  // [{ id, nombre, categoria_nombre, precio_compra, iva_alicuota, rentabilidad, precio_venta,
  //    cantidad, stock_minimo, proveedor_id, proveedor_nombre, activo }]
  listar: async ({ q = "", stockBajo = false, ocultos = false } = {}) => {
    const params = new URLSearchParams({ tipo_producto: "BIEN_DE_CAMBIO" });
    if (q) params.set("q", q);
    if (stockBajo) params.set("stock_bajo", "true");
    if (ocultos) params.set("ocultos", "true");
    return comoLista(await fetchAPI(`/productos?${params.toString()}`));
  },

  // { nombre, precio_compra, iva_alicuota, rentabilidad, precio_venta, cantidad, stock_minimo, proveedor_id }
  crear: async (datos) =>
    (await fetchAPI("/productos", "POST", datos))?.producto,

  // El Backend todavía tiene que publicar PUT /productos/{id}. No modifica stock ni costo.
  actualizar: async (id, datos) =>
    (await fetchAPI(`/productos/${id}`, "PUT", datos))?.producto,

  // { cantidad, monto_total, proveedor_id }
  reponer: (id, datos) =>
    fetchAPI(`/productos/${id}/reposicion`, "POST", datos),

  // { cantidad (positiva), motivo }
  registrarBaja: (id, datos) =>
    fetchAPI(`/productos/${id}/baja`, "POST", datos),

  ocultar: (id) => fetchAPI(`/productos/${id}/ocultar`, "PATCH"),

  // El Backend responde 409 si el producto ya tiene movimientos.
  eliminar: (id) => fetchAPI(`/productos/${id}`, "DELETE"),
};

export const servicioReposiciones = {
  // [{ id, producto_nombre, cantidad, monto_total, costo_unitario_real, fecha_adquisicion,
  //    proveedor_nombre, creado_por, estado: "ACTIVA" | "ANULADA" }]
  listar: async () => comoLista(await fetchAPI("/reposiciones")),

  // El Backend responde 409 si el stock actual es menor a la cantidad a restar.
  anular: (id) => fetchAPI(`/reposiciones/${id}/anular`, "PATCH"),
};
