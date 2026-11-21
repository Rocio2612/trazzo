// --- PANTALLA "NUEVA VENTA" (módulo ES) ---
// Da funcionamiento a ventas.html: la lista de productos, el carrito con sus subtotales y total en tiempo real, el modal
// "Cobrar" (tipo de venta, cliente, saldo a favor, medio de pago e IVA) y la pantalla de venta confirmada con el ticket.
// La lógica (cálculos y validaciones) está en ventas.js y los datos vienen del Backend (servicios/ventas.js).
// Todo se arma con textContent: nunca se pone texto del usuario o del Backend con innerHTML.

import { abrirModal, avisar, boton, crearSvg, h } from "./componentes/ui-panel.js";
import { aNumero, fechaHoraParaMostrar, formatearDinero } from "./formatos.js";
import { mensajeDeError } from "./servicios/errores.js";
import { cargarMediosPago, servicioClientesDeVentas, servicioNegocio, servicioProductosDeVentas, servicioVentas } from "./ventas-datos.js";
import {
  armarPayloadVenta,
  calcularIva,
  cantidadValida,
  creditoMaximo,
  limitarAlStock,
  MEDIO_SALDO_A_FAVOR,
  MENSAJE_CANTIDAD,
  MENSAJE_CANTIDADES,
  MENSAJE_SIN_PRODUCTOS,
  redondear,
  resumenDeErrores,
  subtotalDeItem,
  textoStockLimitado,
  textoTipo,
  totalDelCarrito,
  validarCobro,
  validarCreditoAUsar,
} from "./ventas.js";

// Íconos de trazo (24x24). Son textos fijos del código, nunca datos del usuario.
const ICONO_ELIMINAR = '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>';
const ICONO_HISTORIAL = '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>';

const MENSAJE_SIN_MEDIOS = "Sin medios de pago. Creá uno en Configuración > Medios de pago";
const el = (id) => document.getElementById(id);

// --- Bloque del IVA (también lo usa la venta confirmada) ------------------------------------------
// Si se discrimina: recuadro con neto, IVA y total (y la leyenda si corresponde). Si no, un texto simple sin recuadro.
const bloqueIva = (iva, total) => {
  if (!iva) return null;
  if (iva.modo !== "DISCRIMINA") return h("p", { class: "gastos-ayuda ventas-texto-iva", "data-testid": "venta-iva", text: iva.texto || "" });
  return h(
    "div",
    { class: "ventas-panel", "data-testid": "venta-iva" },
    h(
      "ul",
      { class: "ventas-lista-items" },
      h("li", {}, h("span", { text: "Importe neto gravado" }), h("span", { text: formatearDinero(iva.neto) })),
      h("li", {}, h("span", { text: "IVA 21 %" }), h("span", { text: formatearDinero(iva.iva) })),
      h("li", {}, h("strong", { text: "Total" }), h("strong", { text: formatearDinero(total) })),
    ),
    iva.leyenda && h("p", { class: "gastos-ayuda", "data-testid": "venta-leyenda-iva", text: iva.leyenda }),
  );
};

const iniciarPantalla = () => {
  const ctx = {
    productos: [],
    cargando: true,
    error: "",
    q: "",
    carrito: [], // [{ producto_id, cantidad (texto) }]
    categoriaNegocio: undefined,
  };

  const zonaAlertas = el("ventas-alertas");
  const zonaProductos = el("venta-productos");
  const filasCarrito = el("venta-carrito-filas");
  const productoPorId = (id) => ctx.productos.find((p) => p.id === id);
  const total = () => totalDelCarrito(ctx.carrito, ctx.productos);

  const avisarArriba = (mensaje, testid) =>
    zonaAlertas.replaceChildren(h("div", { "data-testid": testid }, h("div", { class: "gastos-banner ventas-banner-rojo", role: "alert", text: mensaje })));

  // --- Lista de productos -----------------------------------------------------------------------
  // Un producto sin stock se ve en la lista pero no se puede seleccionar (el botón queda deshabilitado).
  const tarjetaDeProducto = (p) => {
    const sinStock = p.cantidad <= 0;
    const tarjeta = h(
      "button",
      {
        type: "button",
        class: "ventas-producto",
        disabled: sinStock,
        "data-testid": `venta-producto-${p.id}`,
        "aria-label": sinStock ? `${p.nombre}: sin stock, no se puede agregar` : `Agregar ${p.nombre} a la venta`,
      },
      h(
        "span",
        {},
        h("strong", {}, p.nombre, sinStock && h("span", { class: "ventas-insignia ventas-insignia-rojo", text: "Sin stock" })),
        h("small", { text: `${p.categoria_nombre || "Sin categoría"} · Stock: ${p.cantidad}` }),
      ),
      h("span", { class: "ventas-producto-precio", text: formatearDinero(p.precio_venta) }),
    );
    tarjeta.addEventListener("click", () => agregar(p));
    return tarjeta;
  };

  const pintarLista = () => {
    if (ctx.cargando) {
      zonaProductos.replaceChildren(h("div", { class: "gastos-vacio ventas-vacio-chico", "data-testid": "venta-cargando", text: "Cargando productos…" }));
      return;
    }
    if (ctx.error) {
      zonaProductos.replaceChildren(h("div", { class: "gastos-vacio ventas-vacio-chico", "data-testid": "venta-error-carga", text: ctx.error }));
      return;
    }
    const q = ctx.q.trim().toLowerCase();
    const visibles = ctx.productos.filter((p) => !q || p.nombre.toLowerCase().includes(q));
    el("venta-disponibles").textContent = `${visibles.length} ${visibles.length === 1 ? "disponible" : "disponibles"}`;
    zonaProductos.replaceChildren(...(visibles.length === 0 ? [h("div", { class: "gastos-vacio ventas-vacio-chico", text: "Sin resultados" })] : visibles.map(tarjetaDeProducto)));
  };

  // --- Carrito ----------------------------------------------------------------------------------
  const pintarTotal = () => {
    el("venta-total").textContent = formatearDinero(total());
  };

  const filaDeCarrito = (item) => {
    const producto = productoPorId(item.producto_id);
    const subtotal = h("span", { "data-testid": `venta-subtotal-${item.producto_id}` });
    const error = h("small", { class: "gastos-error", hidden: true, text: MENSAJE_CANTIDAD });
    const entrada = h("input", {
      class: "gastos-entrada",
      type: "text",
      inputmode: "numeric",
      value: item.cantidad,
      autocomplete: "off",
      "aria-label": `Cantidad de ${producto.nombre}`,
      "data-testid": `venta-cantidad-${item.producto_id}`,
    });
    // "Sin stock" va al lado del nombre; "Solo quedan N en stock" va debajo del campo de cantidad.
    const alertaSinStock = h("span", { class: "ventas-insignia ventas-insignia-rojo", "data-testid": `venta-sin-stock-${item.producto_id}`, text: "Sin stock", hidden: true });
    const avisoCantidad = h("small", { class: "gastos-error ventas-aviso-stock", "data-testid": `venta-stock-insuficiente-${item.producto_id}`, hidden: true });
    const menos = boton("−", "btn-outline gastos-btn-chico", { "aria-label": `Restar una unidad de ${producto.nombre}`, "data-testid": `venta-menos-${item.producto_id}` });
    const mas = boton("+", "btn-outline gastos-btn-chico", { "aria-label": `Sumar una unidad de ${producto.nombre}`, "data-testid": `venta-mas-${item.producto_id}` });

    // Nunca se puede pedir más de lo que hay: si se intenta, la cantidad queda en el stock y se avisa debajo del campo.
    const limitar = () => {
      const { cantidad, excedido } = limitarAlStock(item.cantidad, producto.cantidad);
      item.cantidad = cantidad;
      item.tope = excedido;
      entrada.value = cantidad;
    };

    const pintarFila = () => {
      const valida = cantidadValida(item.cantidad);
      alertaSinStock.hidden = producto.cantidad !== 0;
      avisoCantidad.hidden = !item.tope;
      avisoCantidad.textContent = item.tope ? textoStockLimitado(producto.cantidad) : "";
      mas.disabled = valida && Number(item.cantidad) >= Number(producto.cantidad);
      subtotal.textContent = valida ? formatearDinero(subtotalDeItem(producto.precio_venta, item.cantidad)) : "—";
      entrada.classList.toggle("con-error", !valida || item.tope === true);
      error.hidden = valida;
      pintarTotal();
    };
    const cambiar = (delta) => {
      const actual = cantidadValida(item.cantidad) ? Number(item.cantidad) : 0;
      item.cantidad = String(Math.max(1, actual + delta));
      limitar();
      pintarFila();
    };
    entrada.addEventListener("input", () => {
      item.cantidad = entrada.value;
      limitar();
      pintarFila();
    });
    menos.addEventListener("click", () => cambiar(-1));
    mas.addEventListener("click", () => cambiar(1));

    const quitar = h("button", {
      type: "button",
      class: "btn btn-outline gastos-btn-chico gastos-btn-icono gastos-btn-eliminar",
      "aria-label": "Quitar del carrito",
      title: "Quitar del carrito",
      "data-testid": `venta-quitar-${item.producto_id}`,
    });
    quitar.append(crearSvg(ICONO_ELIMINAR));
    quitar.addEventListener("click", () => {
      ctx.carrito.splice(ctx.carrito.indexOf(item), 1);
      pintarCarrito();
    });

    pintarFila();
    return h(
      "tr",
      {},
      h("td", {}, h("div", { class: "ventas-celda-doble" }, h("span", {}, h("span", { class: "ventas-nombre", text: producto.nombre }), alertaSinStock), h("small", { text: `Stock: ${producto.cantidad}` }))),
      h("td", { class: "num", text: formatearDinero(producto.precio_venta) }),
      h("td", {}, h("div", { class: "ventas-celda-cantidad" }, h("div", { class: "ventas-cantidad-control" }, menos, entrada, mas), error, avisoCantidad)),
      h("td", { class: "num" }, subtotal),
      h("td", {}, quitar),
    );
  };

  const pintarCarrito = () => {
    el("venta-items-contador").textContent = `${ctx.carrito.length} ${ctx.carrito.length === 1 ? "ítem" : "ítems"}`;
    el("venta-carrito-vacio").hidden = ctx.carrito.length > 0;
    filasCarrito.replaceChildren(...ctx.carrito.map(filaDeCarrito));
    pintarTotal();
  };

  const agregar = (producto) => {
    const existente = ctx.carrito.find((i) => i.producto_id === producto.id);
    if (existente) {
      // Si ya está todo el stock en el carrito, no suma más y avisa.
      const { cantidad, excedido } = limitarAlStock((cantidadValida(existente.cantidad) ? Number(existente.cantidad) : 0) + 1, producto.cantidad);
      existente.cantidad = cantidad;
      existente.tope = excedido;
    } else ctx.carrito.push({ producto_id: producto.id, cantidad: "1" });
    zonaAlertas.replaceChildren();
    pintarCarrito();
  };

  // --- Modal "Cobrar" -----------------------------------------------------------------------------
  // items: [{ producto_id, cantidad }] ya validados. El Backend vuelve a validar todo y descuenta el stock.
  const cobrar = async () => {
    zonaAlertas.replaceChildren();
    if (ctx.carrito.length === 0) return avisarArriba(MENSAJE_SIN_PRODUCTOS, "venta-aviso");
    if (ctx.carrito.some((i) => !cantidadValida(i.cantidad))) return avisarArriba(MENSAJE_CANTIDADES, "venta-aviso");

    let clientes;
    let medios;
    try {
      [clientes, medios] = await Promise.all([servicioClientesDeVentas.listar(), cargarMediosPago()]);
    } catch (error) {
      avisar(mensajeDeError(error, "No se pudieron cargar los clientes y los medios de pago. Intentá de nuevo."));
      return;
    }
    abrirModalDeCobro({
      items: ctx.carrito.map((i) => ({ producto_id: i.producto_id, cantidad: i.cantidad })),
      total: total(),
      clientes: [...clientes].sort((a, b) => a.nombre.localeCompare(b.nombre, "es")),
      medios,
    });
  };

  const abrirModalDeCobro = ({ items, total: totalVenta, clientes, medios }) => {
    const sel = { clienteId: null };
    let enviando = false;
    let aplicar = false; // casilla "Descontar el saldo a favor del total de la venta"

    const zonaErrores = h("div", { "data-testid": "formulario-errores" });
    const tipo = h(
      "select",
      { id: "tipo_venta", name: "tipo_venta", class: "gastos-entrada", "data-testid": "venta-tipo" },
      [["CONTADO", "Contado (se cobra en el momento)"], ["CUENTA_CORRIENTE", "Cuenta corriente (queda deuda)"]].map(([valor, texto]) => h("option", { value: valor, text: texto })),
    );
    // El cliente se elige en una lista desplegable: solo hay clientes ya registrados en el módulo de Clientes.
    const opcionVacia = h("option", { value: "", text: "Consumidor final" });
    const cliente = h(
      "select",
      { id: "cliente", name: "cliente", class: "gastos-entrada", "data-testid": "venta-cliente", "aria-label": "Cliente de la venta" },
      [opcionVacia, ...clientes.map((c) => h("option", { value: String(c.id), text: c.nombre }))],
    );
    const medio = h(
      "select",
      { id: "medio_pago", name: "medio_pago", class: "gastos-entrada", "data-testid": "venta-medio-pago" },
      medios.length ? [h("option", { value: "", text: "Seleccioná un medio de pago" }), ...medios.map((m) => h("option", { value: String(m.id), text: m.nombre }))] : [h("option", { value: "", text: MENSAJE_SIN_MEDIOS })],
    );
    const etiquetaCliente = h("label", { for: "cliente" });
    const ayudaCliente = h("p", { class: "gastos-ayuda" });
    const errorCliente = h("p", { class: "gastos-error", id: "error-cliente", hidden: true });
    const errorMedio = h("p", { class: "gastos-error", id: "error-medio_pago", hidden: true });
    const campoMedio = h("div", { class: "gastos-campo" }, h("label", { for: "medio_pago", text: "Medio de pago *" }), medio, errorMedio);
    const zonaIva = h("div");
    const zonaDesglose = h("div");
    const montoACobrar = h("strong", { "data-testid": "venta-cobrar-total", text: formatearDinero(totalVenta) });

    // Aviso de saldo a favor: la casilla para usarlo y cuánto usar (se arma una sola vez para no perder el foco al escribir).
    const casilla = h("input", { type: "checkbox", id: "aplicar_credito", "data-testid": "venta-aplicar-credito" });
    const textoCredito = h("p", { class: "ventas-credito-texto", "data-testid": "venta-credito-texto" });
    const montoCredito = h("input", { id: "monto_credito", class: "gastos-entrada", type: "number", step: "any", min: "0", "data-testid": "venta-monto-credito", autocomplete: "off" });
    const ayudaMontoCredito = h("p", { class: "gastos-ayuda", "data-testid": "venta-credito-queda" });
    const errorMontoCredito = h("p", { class: "gastos-error", id: "error-monto_credito", "data-testid": "venta-credito-error", hidden: true });
    const zonaMontoCredito = h("div", { class: "ventas-credito-monto", hidden: true }, h("label", { for: "monto_credito", text: "¿Cuánto saldo a favor querés usar?" }), montoCredito, ayudaMontoCredito, errorMontoCredito);
    const avisoCredito = h(
      "div",
      { class: "gastos-banner ventas-banner-verde ventas-credito", "data-testid": "venta-credito-aviso", hidden: true },
      textoCredito,
      h("label", { class: "ventas-credito-casilla", for: "aplicar_credito" }, casilla, h("span", { text: "Descontar el saldo a favor del total de la venta" })),
      zonaMontoCredito,
    );

    const clienteElegido = () => clientes.find((c) => c.id === sel.clienteId) ?? null;
    const creditoDelCliente = () => clienteElegido()?.saldo_a_favor ?? 0;
    // Mismo mensaje que el Backend si el saldo a usar no es válido (máximo: lo que tiene el cliente, sin pasar del total).
    const errorCredito = () => validarCreditoAUsar(montoCredito.value, creditoDelCliente(), totalVenta);
    const creditoUsado = () => (aplicar && !errorCredito() ? redondear(aNumero(montoCredito.value)) : 0);

    const pintar = () => {
      const esContado = tipo.value === "CONTADO";
      const credito = creditoDelCliente();
      if (credito <= 0) aplicar = false;
      casilla.checked = aplicar;
      avisoCredito.hidden = credito <= 0;
      textoCredito.textContent = `Este cliente tiene ${formatearDinero(credito)} a favor.`;
      zonaMontoCredito.hidden = !aplicar;
      const errorUso = aplicar ? errorCredito() : null;
      const aplicado = creditoUsado();
      errorMontoCredito.textContent = errorUso || "";
      errorMontoCredito.hidden = !errorUso;
      montoCredito.classList.toggle("con-error", Boolean(errorUso));
      ayudaMontoCredito.textContent = aplicado > 0 ? `Le quedan ${formatearDinero(redondear(credito - aplicado))} a favor.` : "";
      const aCobrar = redondear(totalVenta - aplicado);
      montoACobrar.textContent = formatearDinero(aCobrar);
      zonaDesglose.replaceChildren(
        ...(aplicado > 0
          ? [
              h(
                "div",
                { class: "ventas-panel ventas-panel-desglose", "data-testid": "venta-credito-desglose" },
                h(
                  "ul",
                  { class: "ventas-lista-items" },
                  h("li", {}, h("span", { text: "Total de la venta" }), h("span", { text: formatearDinero(totalVenta) })),
                  h("li", {}, h("span", { text: "Saldo a favor aplicado" }), h("span", { text: `- ${formatearDinero(aplicado)}` })),
                ),
              ),
            ]
          : []),
      );
      etiquetaCliente.textContent = esContado ? "Cliente" : "Cliente *";
      opcionVacia.textContent = esContado ? "Consumidor final" : "Elegí un cliente…";
      ayudaCliente.textContent = esContado ? "En una venta de contado se usa Consumidor final por defecto. Si querés, elegí un cliente ya registrado." : "Obligatorio: elegí un cliente ya registrado.";
      campoMedio.hidden = !(esContado && aCobrar > 0);
      // El IVA depende de la categoría del negocio y de la del cliente. Sin cliente es Consumidor final; si no se conoce
      // la categoría del cliente (por ejemplo, el Cajero no la recibe), el cálculo lo hace el Backend al confirmar.
      const categoriaCliente = sel.clienteId ? clienteElegido()?.categoria_impositiva : "CONSUMIDOR_FINAL";
      zonaIva.replaceChildren(bloqueIva(calcularIva(totalVenta, ctx.categoriaNegocio, categoriaCliente), totalVenta));
    };

    const mostrarErrores = (errores) => {
      errorCliente.textContent = errores.cliente || "";
      errorCliente.hidden = !errores.cliente;
      cliente.classList.toggle("con-error", Boolean(errores.cliente));
      errorMedio.textContent = errores.medio_pago || "";
      errorMedio.hidden = !errores.medio_pago;
      medio.classList.toggle("con-error", Boolean(errores.medio_pago));
      const resumen = resumenDeErrores(errores);
      zonaErrores.replaceChildren(...(resumen ? [h("div", { class: "gastos-banner ventas-banner-rojo", role: "alert", text: resumen })] : []));
    };

    const cancelar = boton("Cancelar", "btn-outline", { "data-testid": "modal-cancelar" });
    const confirmarBtn = boton("Confirmar venta", "btn-primario", { "data-testid": "venta-confirmar" });
    const dato = (etiqueta, valor) => h("div", {}, h("dt", { text: etiqueta }), h("dd", {}, valor || h("span", { class: "gastos-sin-dato", text: "—" })));

    const modal = abrirModal({
      titulo: "Cobrar",
      cuerpo: [
        zonaErrores,
        h(
          "div",
          { class: "ventas-campos-fila" },
          h("div", { class: "gastos-campo" }, h("label", { for: "fecha_hora", text: "Fecha y hora" }), h("input", { id: "fecha_hora", class: "gastos-entrada", readonly: true, value: "Se asigna al confirmar", "data-testid": "venta-fecha-hora" })),
          h("div", { class: "gastos-campo" }, h("label", { for: "numero_venta", text: "N° de venta" }), h("input", { id: "numero_venta", class: "gastos-entrada", readonly: true, value: "Se asigna al confirmar", "data-testid": "venta-numero-previo" })),
        ),
        h("div", { class: "gastos-campo" }, h("label", { for: "tipo_venta", text: "Tipo de venta *" }), tipo),
        h("div", { class: "gastos-campo" }, etiquetaCliente, cliente, ayudaCliente, errorCliente),
        avisoCredito,
        campoMedio,
        zonaIva,
        // Al final: el desglose (si se usa saldo a favor) y el total a cobrar, que se actualizan en tiempo real.
        zonaDesglose,
        h("div", { class: "ventas-total-cobrar" }, h("span", { text: "Total a cobrar" }), montoACobrar),
      ],
      pie: [cancelar, confirmarBtn],
      alIntentarCerrar: (cerrar) => !enviando && cerrar(),
    });
    cancelar.addEventListener("click", modal.intentarCerrar);

    tipo.addEventListener("change", () => {
      mostrarErrores({});
      pintar();
    });
    medio.addEventListener("change", () => mostrarErrores({}));
    casilla.addEventListener("change", () => {
      aplicar = casilla.checked;
      // Al marcarla, se propone usar todo lo posible; después se puede cambiar el monto.
      if (aplicar && sel.clienteId) montoCredito.value = String(creditoMaximo(creditoDelCliente(), totalVenta));
      pintar();
    });
    montoCredito.addEventListener("input", pintar);
    cliente.addEventListener("change", () => {
      aplicar = false;
      sel.clienteId = cliente.value ? Number(cliente.value) : null;
      mostrarErrores({});
      pintar();
    });

    // Venta confirmada: el mismo modal cambia de contenido y muestra el número, el ticket y cómo seguir.
    const mostrarConfirmada = (venta) => {
      const esContado = venta.tipo === "CONTADO";
      const aplicado = Number(venta.credito_aplicado) || 0;
      const medioTexto = venta.medio_pago || (aplicado > 0 ? MEDIO_SALDO_A_FAVOR : "");
      modal.fondo.querySelector("h2").textContent = "Venta confirmada";
      modal.fondo.querySelector(".gastos-modal-cuerpo").replaceChildren(
        h(
          "div",
          { class: "ventas-exito", "data-testid": "venta-confirmada" },
          h("p", { class: "ventas-etiqueta", text: "N° de venta" }),
          h("div", { class: "ventas-exito-numero", "data-testid": "venta-numero", text: venta.numero }),
          h(
            "dl",
            { class: "ventas-ficha" },
            dato("Cliente", venta.cliente_nombre || "Consumidor final"),
            dato("Tipo de venta", textoTipo(venta.tipo)),
            dato("Fecha y hora", fechaHoraParaMostrar(venta.fecha_hora)),
            esContado ? dato("Medio de pago", medioTexto) : dato("Saldo a cobrar", formatearDinero(venta.saldo ?? redondear(Number(venta.total) - aplicado))),
            aplicado > 0 && dato("Saldo a favor aplicado", formatearDinero(aplicado)),
          ),
          h("div", { class: "ventas-total-cobrar" }, h("span", { text: "Total" }), h("strong", { text: formatearDinero(venta.total) })),
          bloqueIva(venta.iva, venta.total),
          esContado ? h("div", { class: "gastos-banner ventas-banner-verde", text: "Se registró el cobro y el pago se generó automáticamente." }) : h("div", { class: "gastos-banner gastos-banner-ambar", text: "La venta quedó en cuenta corriente: el saldo se cobra desde Cuenta corriente." }),
        ),
      );
      const historial = h("a", { href: "historial-ventas.html", class: "btn btn-outline gastos-btn-con-icono", "data-testid": "venta-ver-historial", style: "text-decoration:none" });
      historial.append(crearSvg(ICONO_HISTORIAL), h("span", { text: "Ver historial" }));
      const otra = boton("Nueva venta", "btn-primario", { "data-testid": "venta-otra" });
      modal.fondo.querySelector(".gastos-modal-pie").replaceChildren(historial, otra);
      otra.addEventListener("click", modal.cerrar);
      otra.focus();
    };

    confirmarBtn.addEventListener("click", async () => {
      if (enviando) return;
      const esContado = tipo.value === "CONTADO";
      const errorUso = aplicar ? errorCredito() : null;
      const usado = creditoUsado();
      const errores = validarCobro({ tipo: tipo.value, clienteId: sel.clienteId, medioPagoId: medio.value, aCobrar: redondear(totalVenta - usado) });
      mostrarErrores(errores);
      if (errorUso) {
        pintar();
        return montoCredito.focus();
      }
      if (errores.cliente) return cliente.focus();
      if (errores.medio_pago) return medio.focus();
      // El botón se deshabilita mientras procesa: un doble clic no puede generar dos ventas.
      enviando = true;
      confirmarBtn.disabled = true;
      cancelar.disabled = true;
      confirmarBtn.textContent = "Confirmando…";
      try {
        const venta = await servicioVentas.crear(armarPayloadVenta({ items, tipo: tipo.value, clienteId: sel.clienteId, medioPagoId: esContado ? medio.value : null, creditoUsado: usado }));
        enviando = false;
        ctx.carrito.splice(0, ctx.carrito.length);
        pintarCarrito();
        mostrarConfirmada(venta);
        cargarProductos(); // el stock cambió
      } catch (error) {
        enviando = false;
        confirmarBtn.disabled = false;
        cancelar.disabled = false;
        confirmarBtn.textContent = "Confirmar venta";
        // Bloqueo por stock (u otro rechazo del Backend sobre la venta): se muestra arriba, tal cual lo devuelve el Backend.
        if (error.status === 409) {
          modal.cerrar();
          avisarArriba(error.message, "venta-alerta-stock");
          cargarProductos();
          window.scrollTo(0, 0);
          return;
        }
        if (error.errores) {
          mostrarErrores({ cliente: error.errores.cliente_id, medio_pago: error.errores.medio_pago_id });
          if (error.errores.items) {
            modal.cerrar();
            avisarArriba(error.errores.items, "venta-aviso");
          }
          return;
        }
        avisar(mensajeDeError(error, "No se pudo confirmar la venta. Intentá de nuevo."));
      }
    });

    pintar();
  };

  // --- Carga de datos -----------------------------------------------------------------------------
  const cargarProductos = async () => {
    try {
      ctx.productos = await servicioProductosDeVentas.listar();
      ctx.error = "";
    } catch (error) {
      ctx.error = mensajeDeError(error, "No se pudieron cargar los productos.");
    }
    ctx.cargando = false;
    // Un producto que ya no existe sale del carrito.
    ctx.carrito = ctx.carrito.filter((i) => productoPorId(i.producto_id));
    pintarLista();
    pintarCarrito();
  };

  // La categoría impositiva del negocio define cómo se muestra el IVA. Si no se puede leer, el IVA lo calcula el Backend.
  const cargarNegocio = async () => {
    // Solo el Administrador lee "Mi negocio" y la categoría de cada cliente; para el Cajero el IVA lo calcula el Backend.
    if (!puedeHacer("clientes", "ver")) return;
    try {
      ctx.categoriaNegocio = (await servicioNegocio.obtener())?.categoria_impositiva;
    } catch (error) {
      ctx.categoriaNegocio = undefined;
    }
  };

  // --- Eventos de la pantalla ---------------------------------------------------------------------
  el("venta-buscador").addEventListener("input", (e) => {
    ctx.q = e.target.value;
    pintarLista();
  });
  el("venta-vaciar").addEventListener("click", () => {
    // Siempre está disponible; si el carrito ya está vacío, no hace nada.
    if (ctx.carrito.length === 0) return;
    ctx.carrito.splice(0, ctx.carrito.length);
    zonaAlertas.replaceChildren();
    pintarCarrito();
  });
  el("venta-cobrar").addEventListener("click", cobrar);

  pintarLista();
  pintarCarrito();
  cargarProductos();
  cargarNegocio();
};

iniciarPantalla();
