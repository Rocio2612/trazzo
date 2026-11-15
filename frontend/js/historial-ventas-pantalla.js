// --- PANTALLA "HISTORIAL DE VENTAS" (módulo ES) ---
// Da funcionamiento a historial-ventas.html: la tabla con todas las ventas (de contado y a cuenta corriente), el buscador,
// los filtros (período, estado y tipo), "Ver ocultos", el detalle de cada venta, y anular, ocultar y restaurar.
// La lógica (filtros y textos) está en ventas.js y los datos vienen del Backend (servicios/ventas.js).
// No hay editar ni eliminar: las ventas confirmadas no se editan y no se eliminan, se anulan.
// Todo se arma con textContent: nunca se pone texto del usuario o del Backend con innerHTML.

import { abrirModal, avisar, bannerAmbar, boton, confirmar, crearSvg, h } from "./componentes/ui-panel.js";
import { fechaHoraParaMostrar, formatearDinero } from "./formatos.js";
import { mensajeDeError } from "./servicios/errores.js";
import { servicioVentas } from "./ventas-datos.js";
import { filtrarVentas, nombreCliente, textoEstado, textoTipo } from "./ventas.js";

// Íconos de trazo (24x24). Son textos fijos del código, nunca datos del usuario.
const ICONO_DETALLE = '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/>';
const ICONO_ANULAR = '<circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>';
const ICONO_OCULTAR = '<path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" y1="2" x2="22" y2="22"/>';
const ICONO_RESTAURAR = '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>';
const ICONO_DESCARGAR = '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>';

const MODULO = "ventas";
const el = (id) => document.getElementById(id);
const sinDato = () => h("span", { class: "gastos-sin-dato", text: "—" });

// Botón con ícono (y, si se indica, un texto corto). La etiqueta es el nombre para lectores de pantalla.
const botonIcono = (iconoSvg, etiqueta, extra = {}, texto = "", clase = "") => {
  const boton = h("button", {
    type: "button",
    class: `btn btn-outline gastos-btn-chico gastos-btn-icono${texto ? " gastos-btn-icono-texto" : ""} ${clase}`.trim(),
    "aria-label": etiqueta,
    title: etiqueta,
    ...extra,
  });
  boton.append(crearSvg(iconoSvg));
  if (texto) boton.append(h("span", { text: texto }));
  return boton;
};

// Bloque del IVA de una venta ya confirmada: recuadro si se discriminó, texto simple si no.
const bloqueIva = (iva, total) => {
  if (!iva) return null;
  if (iva.modo !== "DISCRIMINA") return h("p", { class: "gastos-ayuda ventas-texto-iva", text: iva.texto || "" });
  return h(
    "div",
    { class: "ventas-panel" },
    h(
      "ul",
      { class: "ventas-lista-items" },
      h("li", {}, h("span", { text: "Importe neto gravado" }), h("span", { text: formatearDinero(iva.neto) })),
      h("li", {}, h("span", { text: "IVA 21 %" }), h("span", { text: formatearDinero(iva.iva) })),
      h("li", {}, h("strong", { text: "Total" }), h("strong", { text: formatearDinero(total) })),
    ),
    iva.leyenda && h("p", { class: "gastos-ayuda", text: iva.leyenda }),
  );
};

const insigniaDeTipo = (venta) => h("span", { class: `ventas-insignia ventas-insignia-plana ${venta.tipo === "CONTADO" ? "ventas-tipo-contado" : "ventas-tipo-cc"}`, "data-testid": `tipo-venta-${venta.id}`, text: textoTipo(venta.tipo) });
const insigniaDeEstado = (venta) => h("span", { class: `ventas-insignia ventas-insignia-plana ${venta.anulada ? "ventas-insignia-rojo" : "ventas-insignia-verde"}`, "data-testid": `estado-venta-${venta.id}`, text: textoEstado(venta) });

const iniciarPantalla = () => {
  const ctx = { ventas: [], cargando: true, error: "", q: "", estado: "", periodo: "todas", ocultos: false };
  const filas = el("ventas-filas");
  const COLUMNAS = 7;

  const descargarTicket = async (venta) => {
    try {
      await servicioVentas.descargarTicket(venta.id, venta.numero);
      avisar(`Ticket de la venta ${venta.numero} descargado`);
    } catch (error) {
      avisar(mensajeDeError(error, "No se pudo descargar el ticket."));
    }
  };

  // --- Detalle --------------------------------------------------------------------------------------
  const detalle = (venta) => {
    const dato = (etiqueta, valor) => h("div", {}, h("dt", { text: etiqueta }), h("dd", {}, valor || sinDato()));
    const seccion = (titulo, ...hijos) => h("section", { class: "ventas-seccion" }, h("h4", { class: "ventas-seccion-titulo", text: titulo }), hijos);
    const cerrar = boton("Cerrar", "btn-outline", { "data-testid": "modal-cancelar" });
    // En una venta anulada no se ofrece el ticket.
    const ticket = venta.anulada ? null : boton("", "btn-primario gastos-btn-con-icono", { "data-testid": "ventas-detalle-ticket", "data-modulo": MODULO, "data-accion": "ticket" });
    ticket?.append(crearSvg(ICONO_DESCARGAR), h("span", { text: "Descargar ticket" }));
    const credito = Number(venta.credito_aplicado) || 0;
    const modal = abrirModal({
      titulo: `Venta ${venta.numero}`,
      cuerpo: [
        h(
          "div",
          { "data-testid": "venta-detalle" },
          h("div", { class: "ventas-detalle-cabecera" }, h("div", {}, h("p", { class: "ventas-etiqueta", text: "Cliente" }), h("h3", { text: nombreCliente(venta) })), insigniaDeEstado(venta)),
          seccion(
            "Datos de la venta",
            h("dl", { class: "ventas-ficha" }, dato("Fecha y hora", fechaHoraParaMostrar(venta.fecha_hora)), dato("Tipo de venta", textoTipo(venta.tipo)), venta.tipo === "CONTADO" && dato("Medio de pago", venta.medio_pago || (credito > 0 ? "Saldo a favor" : ""))),
          ),
          seccion(
            "Productos vendidos",
            h(
              "div",
              { class: "ventas-tabla-modal" },
              h(
                "table",
                { class: "gastos-tabla", "data-testid": "venta-detalle-items" },
                h("thead", {}, h("tr", {}, h("th", { text: "Producto" }), h("th", { class: "num", text: "Precio" }), h("th", { class: "num", text: "Cantidad" }), h("th", { class: "num", text: "Subtotal" }))),
                h("tbody", {}, (venta.items ?? []).map((i) => h("tr", {}, h("td", { text: i.producto }), h("td", { class: "num", text: formatearDinero(i.precio) }), h("td", { class: "num", text: String(i.cantidad) }), h("td", { class: "num", text: formatearDinero(Number(i.precio) * Number(i.cantidad)) })))),
              ),
            ),
          ),
          seccion(
            "Total",
            h("p", { class: "ventas-total-detalle", "data-testid": "venta-detalle-total", text: formatearDinero(venta.total) }),
            credito > 0 && h("p", { class: "gastos-ayuda", text: `Incluye ${formatearDinero(credito)} pagados con saldo a favor del cliente.` }),
            bloqueIva(venta.iva, venta.total),
          ),
          venta.anulada && h("div", { class: "gastos-banner ventas-banner-rojo", text: "Venta anulada: se devolvió el stock, se anularon sus pagos y no cuenta en los reportes. Conserva su número." }),
        ),
      ],
      pie: [cerrar, ticket],
    });
    modal.fondo.querySelector(".gastos-modal").classList.add("ventas-modal-ancho");
    cerrar.addEventListener("click", modal.cerrar);
    ticket?.addEventListener("click", () => descargarTicket(venta));
  };

  // --- Anular y ocultar ---------------------------------------------------------------------------------
  const pedirAnular = (venta) =>
    confirmar({
      titulo: "Anular venta",
      cuerpo: [
        h("p", { text: `¿Anular la venta ${venta.numero}?` }),
        bannerAmbar("Se devuelve el stock de los productos, se anulan los pagos de la venta y se excluye de los reportes. La venta conserva su número."),
        h("p", { class: "gastos-ayuda", text: "Esta acción no se puede deshacer. Las ventas no se eliminan: se anulan." }),
      ],
      textoOk: "Anular venta",
      claseOk: "btn-peligro",
      alAceptar: async () => {
        try {
          await servicioVentas.anular(venta.id);
        } catch (error) {
          avisar(mensajeDeError(error, "No se pudo anular la venta."));
          await cargar();
          return;
        }
        await cargar();
        avisar(`Venta ${venta.numero} anulada`);
      },
    });

  const cambiarOculta = async (venta, oculto) => {
    try {
      await servicioVentas.ocultar(venta.id, oculto);
    } catch (error) {
      avisar(mensajeDeError(error, oculto ? "No se pudo ocultar la venta." : "No se pudo restaurar la venta."));
      return;
    }
    await cargar();
    avisar(oculto ? `Venta ${venta.numero} oculta` : `Venta ${venta.numero} restaurada`);
  };

  const pedirOcultar = (venta) => {
    // Restaurar es inmediato, sin confirmación.
    if (venta.oculto) return cambiarOculta(venta, false);
    confirmar({
      titulo: "Ocultar venta",
      cuerpo: [
        h("p", { text: `¿Ocultar la venta ${venta.numero}?` }),
        h("p", { class: "gastos-ayuda", text: "Deja de verse en el historial, pero se sigue contando en los reportes. Las ventas no se eliminan: se anulan." }),
      ],
      textoOk: "Ocultar",
      alAceptar: () => cambiarOculta(venta, true),
    });
  };

  // --- Tabla --------------------------------------------------------------------------------------------
  // Los botones llevan data-modulo y data-accion para que roles.js los oculte según el rol: el Cajero no ve "ocultar"
  // pero sí "anular" y "ticket". No hay editar ni eliminar.
  const botonesDeFila = (venta) => {
    const datos = (accion, rol = accion) => ({ "data-op": accion, "data-id": venta.id, "data-testid": `ventas-${accion}-${venta.id}`, "data-modulo": MODULO, "data-accion": rol });
    const acciones = venta.oculto
      ? [botonIcono(ICONO_RESTAURAR, "Restaurar", datos("ocultar"), "Restaurar")]
      : [
          botonIcono(ICONO_DETALLE, "Ver detalle", { "data-op": "detalle", "data-id": venta.id, "data-testid": `ventas-detalle-${venta.id}` }),
          !venta.anulada && botonIcono(ICONO_ANULAR, "Anular venta", datos("anular"), "", "gastos-btn-eliminar"),
          botonIcono(ICONO_OCULTAR, "Ocultar", datos("ocultar")),
        ];
    return h("div", { class: "gastos-acciones-fila" }, acciones);
  };

  const filaDeVenta = (venta) =>
    h(
      "tr",
      { "data-testid": `ventas-fila-${venta.id}` },
      h("td", {}, h("span", { class: "ventas-numero", text: venta.numero })),
      h("td", {}, insigniaDeTipo(venta)),
      h("td", { text: nombreCliente(venta) }),
      h("td", { text: fechaHoraParaMostrar(venta.fecha_hora) }),
      h("td", { class: "num" }, h("span", { class: venta.anulada ? "ventas-tachado" : "", text: formatearDinero(venta.total) })),
      h("td", {}, insigniaDeEstado(venta)),
      h("td", { class: "acciones-columna" }, botonesDeFila(venta)),
    );

  const filaDeMensaje = (texto, testid) => h("tr", {}, h("td", { colspan: COLUMNAS }, h("div", { class: "gastos-vacio", "data-testid": testid, text: texto })));

  const pintar = () => {
    if (ctx.cargando) return filas.replaceChildren(filaDeMensaje("Cargando…", "ventas-cargando"));
    if (ctx.error && ctx.ventas.length === 0) return filas.replaceChildren(filaDeMensaje(ctx.error, "ventas-error-carga"));
    const items = filtrarVentas(ctx.ventas, { texto: ctx.q, estado: ctx.estado, periodo: ctx.periodo, ocultos: ctx.ocultos });
    if (items.length === 0) {
      const hayFiltros = ctx.q.trim() || ctx.estado || ctx.periodo !== "todas";
      return filas.replaceChildren(filaDeMensaje(ctx.ocultos ? "Sin ventas ocultas" : hayFiltros ? "Sin resultados" : "Sin ventas", "ventas-tabla-vacio"));
    }
    filas.replaceChildren(...items.map(filaDeVenta));
  };

  const cargar = async () => {
    try {
      ctx.ventas = await servicioVentas.listar();
      ctx.error = "";
    } catch (error) {
      ctx.error = mensajeDeError(error, "No se pudieron cargar las ventas.");
    }
    ctx.cargando = false;
    pintar();
  };

  // --- Eventos ------------------------------------------------------------------------------------------
  filas.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-op]");
    const venta = b && ctx.ventas.find((v) => v.id === Number(b.dataset.id));
    if (!venta) return;
    const acciones = { detalle: () => detalle(venta), anular: () => pedirAnular(venta), ocultar: () => pedirOcultar(venta) };
    acciones[b.dataset.op]?.();
  });
  el("ventas-buscador").addEventListener("input", (e) => {
    ctx.q = e.target.value;
    pintar();
  });
  el("ventas-filtro-estado").addEventListener("change", (e) => {
    ctx.estado = e.target.value;
    pintar();
  });
  el("ventas-filtro-fecha").addEventListener("change", (e) => {
    ctx.periodo = e.target.value;
    pintar();
  });
  const chipOcultos = el("ventas-filtro-ocultos");
  chipOcultos.addEventListener("click", () => {
    ctx.ocultos = !ctx.ocultos;
    chipOcultos.classList.toggle("activo", ctx.ocultos);
    pintar();
  });

  pintar();
  cargar();
};

iniciarPantalla();
