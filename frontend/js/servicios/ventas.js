// --- SERVICIOS DE VENTAS (módulo ES) ---
// Hablan con el Backend (a través del Gateway). Requieren api.js cargado antes (fetchAPI, que manda el token y
// renueva la sesión). Las respuestas vienen envueltas: acá se desenvuelven.
//
// RUTAS QUE ESPERA EL FRONTEND (el Backend todavía tiene que publicarlas; ver "Contrato de ventas" abajo):
//   GET   /ventas                  -> { ventas: [ venta ] }
//   POST  /ventas                  -> { venta }          (201). Errores: 400 { errores }, 409 { mensaje } (stock)
//   POST  /ventas/{id}/anular      -> { venta }
//   PATCH /ventas/{id}/ocultar     -> { venta }          cuerpo { oculto: true|false }
//   GET   /ventas/{id}/ticket      -> archivo del ticket (PDF)
//   GET   /clientes                -> { clientes: [ { id, nombre, saldo_a_favor, categoria_impositiva? } ] }
//   GET   /productos?tipo_producto=BIEN_DE_CAMBIO -> { items: [ producto ] } (la ruta que ya usa Productos)
//
// Contrato de ventas:
//   venta = { id, numero ("00001-00000458"), tipo ("CONTADO" | "CUENTA_CORRIENTE"), cliente_id, cliente_nombre (null = Consumidor final),
//             fecha_hora (ISO, la pone el Backend), total, saldo, medio_pago (nombre), credito_aplicado, anulada, oculto,
//             items: [ { producto_id, producto, precio, cantidad } ] (precio = el del momento de la venta),
//             iva: { modo: "DISCRIMINA" | "INCLUIDO" | "NINGUNO", neto, iva, leyenda, texto } }
//   POST /ventas recibe { tipo, cliente_id, medio_pago_id, saldo_a_favor_usado, items: [ { producto_id, cantidad } ] }.
//   Privacidad: al Cajero, GET /clientes le devuelve solo { id, nombre, saldo_a_favor } (nunca categoría, documento ni contacto).

export const servicioVentas = {
  // Todas las ventas (confirmadas y anuladas; las ocultas llevan oculto: true), de cualquier tipo.
  listar: async () => (await fetchAPI("/ventas")).ventas ?? [],

  // La fecha, la hora y el número los pone el Backend. Devuelve la venta confirmada.
  crear: async (datos) => (await fetchAPI("/ventas", "POST", datos)).venta,

  // Devuelve el stock, anula los pagos y excluye la venta de los reportes. Conserva el número.
  anular: async (id) => (await fetchAPI(`/ventas/${id}/anular`, "POST")).venta,

  // Ocultar no cambia los reportes: la venta sigue contando.
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
  listar: async () => ((await fetchAPI("/clientes")).clientes ?? []).map((c) => ({ ...c, saldo_a_favor: Number(c.saldo_a_favor) || 0 })),
};

// Productos para vender (bienes de cambio). Usa la misma ruta que la pantalla de Productos.
export const servicioProductosDeVentas = {
  listar: async () => {
    const params = new URLSearchParams({ tipo_producto: "BIEN_DE_CAMBIO" });
    const data = await fetchAPI(`/productos?${params.toString()}`);
    return (data?.items ?? []).map((p) => ({ ...p, cantidad: Number(p.cantidad), precio_venta: Number(p.precio_venta) }));
  },
};
