import { formatearDinero, fechaHoraParaMostrar } from "./formatos.js";

const h = (etiqueta, props = {}, ...hijos) => {
    const el = document.createElement(etiqueta);
    Object.entries(props).forEach(([k, v]) => {
        if (v === null || v === undefined || v === false) return;
        if (k === "class") el.className = v;
        else if (k === "text") el.textContent = v;
        else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.substring(2).toLowerCase(), v);
        else el.setAttribute(k, v === true ? "" : v);
    });
    hijos.flat().forEach(h => h && el.append(h));
    return el;
};

const svgString = (path) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16">${path}</svg>`;
const crearSvg = (path) => new DOMParser().parseFromString(svgString(path), "image/svg+xml").documentElement;

const ICONO_MAS = '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>';
const ICONO_LAPIZ = '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/>';
const ICONO_BAN = '<circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>';
const ICONO_OJO = '<path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" y1="2" x2="22" y2="22"/>';
const ICONO_RESTAURAR = '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>';
const ICONO_DOC = '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>';

let ventas = [];
let pagos = [];
let tabActiva = 'ventas';
let verOcultos = false;
let esCajero = false;

// Rutas de API (Ajustar cuando el back esté listo)
const API_VENTAS = "/api/cuenta-corriente/ventas"; 
const API_PAGOS = "/api/cuenta-corriente/pagos";

const iniciarPantalla = () => {
    const pagina = document.getElementById("cc-pagina");
    
    // Acá deberías usar tu función real de roles para saber si es Cajero
    const rolUsuario = localStorage.getItem("trazzo_rol") || "Administrador"; 
    esCajero = (rolUsuario === "Cajero");

    pagina.replaceChildren(
        h("div", { class: "cc-header" }, h("h1", { text: "Cuenta corriente" })),
        h("div", { id: "cc-contenido" })
    );
    
    dibujarInterfaz();
};

const dibujarInterfaz = () => {
    const contenido = document.getElementById("cc-contenido");
    contenido.replaceChildren();

    const tabsContainer = h("div", { class: "cc-tabs-container" },
        h("div", { class: "cc-tabs", role: "tablist" },
            h("button", { class: `cc-tab ${tabActiva === 'ventas' ? 'activa' : ''}`, onclick: () => cambiarTab('ventas'), text: "Ventas" }),
            h("button", { class: `cc-tab ${tabActiva === 'pagos' ? 'activa' : ''}`, onclick: () => cambiarTab('pagos'), text: "Pagos" })
        ),
        h("button", { class: "cc-btn-primario", onclick: () => abrirModalPago() }, crearSvg(ICONO_MAS), "Registrar pago")
    );

    const barra = h("div", { class: "cc-barra" });
    const inputBuscador = h("input", { class: "cc-buscador", placeholder: tabActiva === 'ventas' ? "Buscar por cliente o N° de venta..." : "Buscar por cliente, N° de venta o N° de pago...", oninput: renderizarTabla });
    
    if (tabActiva === 'ventas') {
        const filtro = h("select", { class: "cc-filtro", onchange: renderizarTabla },
            h("option", { value: "todas", text: "Todas" }),
            h("option", { value: "pendiente", text: "Pendientes" }),
            h("option", { value: "saldada", text: "Saldadas" }),
            h("option", { value: "anulada", text: "Anuladas" })
        );
        barra.append(inputBuscador, filtro);
    } else {
        barra.append(inputBuscador);
        if (!esCajero) {
            const chip = h("button", { class: `cc-chip ${verOcultos ? 'activo' : ''}`, text: "Ver ocultos", onclick: (e) => {
                verOcultos = !verOcultos; e.target.classList.toggle("activo"); renderizarTabla();
            }});
            barra.append(chip);
        }
    }

    const tablaContainer = h("div", { id: "cc-tabla-container" });

    contenido.append(tabsContainer, barra, tablaContainer);
    renderizarTabla();
};

const cambiarTab = (nuevaTab) => {
    tabActiva = nuevaTab;
    verOcultos = false;
    dibujarInterfaz();
};

const calcularEstado = (venta) => {
    if (venta.anulada) return "Anulada";
    if (venta.pagado >= venta.total) return "Saldada";
    return "Pendiente";
};

const renderizarTabla = () => {
    const container = document.getElementById("cc-tabla-container");
    container.replaceChildren();

    const texto = document.querySelector(".cc-buscador").value.toLowerCase();
    const filtroEstado = document.querySelector(".cc-filtro")?.value || "todas";

    if (tabActiva === 'ventas') {
        const filtrados = ventas.filter(v => {
            const matchBusqueda = v.cliente.toLowerCase().includes(texto) || v.nro_venta.includes(texto);
            const estado = calcularEstado(v).toLowerCase();
            const matchEstado = filtroEstado === "todas" || estado === filtroEstado;
            return matchBusqueda && matchEstado;
        });

        if (filtrados.length === 0) {
            container.append(h("div", { class: "cc-tabla-tarjeta" }, h("div", { style: "text-align: center; padding: 4rem 1rem; color: #8c8c8c;", text: "Sin ventas" })));
            return;
        }

        const filas = filtrados.map(v => {
            const saldo = v.total - v.pagado;
            let claseSaldo = "saldo-neutro";
            let labelSaldo = "Saldada";
            let montoSaldo = formatearDinero(0);

            if (v.anulada) {
                claseSaldo = "saldo-neutro";
                labelSaldo = "Venta anulada";
                montoSaldo = "—";
            } else if (saldo > 0) {
                claseSaldo = "saldo-deuda";
                labelSaldo = "Deuda";
                montoSaldo = formatearDinero(saldo);
            } else if (saldo < 0) {
                claseSaldo = "saldo-favor";
                labelSaldo = "Saldo a favor";
                montoSaldo = formatearDinero(Math.abs(saldo));
            }

            const esPagable = !v.anulada && saldo > 0;

            return h("tr", {},
                h("td", { style: "font-weight: 600;", text: v.nro_venta }),
                h("td", { text: v.cliente }),
                h("td", { text: fechaHoraParaMostrar(v.fecha) }),
                h("td", { class: `text-right ${v.anulada ? 'texto-tachado' : ''}`, text: formatearDinero(v.total) }),
                h("td", { class: `text-right ${v.anulada ? 'texto-tachado' : ''}`, text: v.anulada ? "—" : formatearDinero(v.pagado) }),
                h("td", { class: "text-right" }, 
                    h("div", { class: `saldo-celda ${claseSaldo}` },
                        h("span", { class: "saldo-monto", text: montoSaldo }),
                        h("span", { class: "saldo-label", text: labelSaldo })
                    )
                ),
                h("td", {}, h("span", { class: `cc-badge bg-${calcularEstado(v).toLowerCase()}`, text: calcularEstado(v) })),
                h("td", { class: "col-acciones" },
                    h("button", { class: "cc-btn-accion solo-icono", title: "Ver detalle", onclick: () => abrirModalDetalle(v) }, crearSvg(ICONO_DOC)),
                    h("button", { class: "cc-btn-accion", style: "font-weight: bold;", text: "+ Pagar", disabled: !esPagable, title: !esPagable ? (v.anulada ? "Venta anulada: no se puede pagar" : "Venta saldada: no admite más pagos") : "", onclick: () => abrirModalPago(v) })
                )
            );
        });

        container.append(
            h("div", { class: "cc-tabla-tarjeta" },
                h("div", { class: "cc-tabla-contenedor" },
                    h("table", { class: "cc-tabla" },
                        h("thead", {}, h("tr", {}, ["N° de venta", "Cliente", "Fecha y hora", "Total", "Pagado", "Saldo", "Estado", "Acciones"].map(t => h("th", { text: t, class: t === "Total" || t === "Pagado" || t === "Saldo" || t === "Acciones" ? "text-right" : "" })))),
                        h("tbody", {}, filas)
                    )
                )
            )
        );

    } else {
        const filtrados = pagos.filter(p => {
            const matchBusqueda = p.cliente.toLowerCase().includes(texto) || p.nro_venta.includes(texto) || p.nro_pago.includes(texto);
            const matchOculto = verOcultos ? p.oculto : !p.oculto;
            return matchBusqueda && matchOculto;
        });

        if (filtrados.length === 0) {
            container.append(h("div", { class: "cc-tabla-tarjeta" }, h("div", { style: "text-align: center; padding: 4rem 1rem; color: #8c8c8c;", text: verOcultos ? "Sin pagos ocultos" : "Sin pagos" })));
            return;
        }

        const filas = filtrados.map(p => {
            const acciones = [];
            if (p.oculto) {
                acciones.push(h("button", { class: "cc-btn-accion", onclick: () => restaurarPago(p) }, crearSvg(ICONO_RESTAURAR), "Restaurar"));
            } else {
                if (!p.anulado) {
                    acciones.push(h("button", { class: "cc-btn-accion solo-icono", title: "Editar", onclick: () => abrirModalPago(null, p) }, crearSvg(ICONO_LAPIZ)));
                    acciones.push(h("button", { class: "cc-btn-accion solo-icono peligro", title: "Anular", onclick: () => abrirModalAnular(p) }, crearSvg(ICONO_BAN)));
                }
                if (!esCajero) {
                    acciones.push(h("button", { class: "cc-btn-accion solo-icono", title: "Ocultar", onclick: () => abrirModalOcultar(p) }, crearSvg(ICONO_OJO)));
                }
            }

            return h("tr", {},
                h("td", { style: "font-weight: 600;", text: p.nro_pago }),
                h("td", { text: p.nro_venta }),
                h("td", { text: p.cliente }),
                h("td", { text: fechaHoraParaMostrar(p.fecha) }),
                h("td", { text: p.medio_pago }),
                h("td", { class: `text-right ${p.anulado ? 'texto-tachado' : ''}`, text: formatearDinero(p.monto) }),
                h("td", {}, h("span", { class: `cc-badge ${p.anulado ? 'bg-anulada' : 'bg-saldada'}`, text: p.anulado ? "Anulado" : "Vigente" })),
                h("td", { class: "col-acciones" }, ...acciones)
            );
        });

        container.append(
            h("div", { class: "cc-tabla-tarjeta" },
                h("div", { class: "cc-tabla-contenedor" },
                    h("table", { class: "cc-tabla" },
                        h("thead", {}, h("tr", {}, ["N° de pago", "N° de venta", "Cliente", "Fecha y hora", "Medio de pago", "Monto", "Estado", "Acciones"].map(t => h("th", { text: t, class: t === "Monto" || t === "Acciones" ? "text-right" : "" })))),
                        h("tbody", {}, filas)
                    )
                )
            )
        );
    }
};

// --- MODALES ---

const crearModalBase = (titulo, cuerpo, botones, ancho = "") => {
    const fondo = h("div", { class: "cc-modal-fondo" });
    const modal = h("div", { class: `cc-modal ${ancho}`, role: "dialog", "aria-modal": "true" },
        h("div", { class: "cc-modal-header" }, h("h2", { text: titulo }), h("button", { class: "cc-modal-close", text: "×", onclick: () => fondo.remove() })),
        h("div", { class: "cc-modal-body" }, cuerpo),
        h("div", { class: "cc-modal-footer" }, ...botones)
    );
    fondo.append(modal); document.body.append(fondo);
    return { fondo, modal };
};

const abrirModalDetalle = (venta) => {
    const saldo = venta.total - venta.pagado;
    const estado = calcularEstado(venta);
    const productos = venta.productos || [{ nombre: "Producto de Ejemplo", precio: venta.total, cantidad: 1, subtotal: venta.total }];
    const pagosVenta = pagos.filter(p => p.nro_venta === venta.nro_venta && !p.oculto);

    const cuerpo = h("div", {},
        h("div", { class: "detalle-cabecera" },
            h("div", { class: "detalle-cliente" }, h("label", { text: "CLIENTE" }), h("h3", { text: venta.cliente })),
            h("span", { class: `cc-badge bg-${estado.toLowerCase()}`, text: estado })
        ),
        h("div", { class: "detalle-seccion" },
            h("h4", { text: "Datos de la venta" }),
            h("div", { class: "detalle-grid" },
                h("div", {}, h("label", { text: "Fecha y hora", style: "font-size:0.7rem; color:#8c8c8c;" }), h("div", { text: fechaHoraParaMostrar(venta.fecha) })),
                h("div", {}, h("label", { text: "Tipo de venta", style: "font-size:0.7rem; color:#8c8c8c;" }), h("div", { text: "Cuenta Corriente" }))
            )
        ),
        h("div", { class: "detalle-seccion" },
            h("h4", { text: "Productos vendidos" }),
            h("table", { class: "cc-tabla", style: "border: 1px solid #dee2e6; border-radius: 8px;" },
                h("thead", {}, h("tr", {}, ["Producto", "Precio", "Cantidad", "Subtotal"].map(t => h("th", { text: t, class: t !== "Producto" ? "text-right" : "" })))),
                h("tbody", {}, productos.map(p => h("tr", {},
                    h("td", { text: p.nombre }),
                    h("td", { class: "text-right", text: formatearDinero(p.precio) }),
                    h("td", { class: "text-right", text: p.cantidad }),
                    h("td", { class: "text-right", text: formatearDinero(p.subtotal) })
                )))
            )
        ),
        h("div", { class: "detalle-seccion" },
            h("h4", { text: "Saldo" }),
            h("div", { class: "detalle-grid" },
                h("div", { class: "detalle-cuadro" }, h("label", { text: "Total de la venta" }), h("span", { text: formatearDinero(venta.total) })),
                h("div", { class: "detalle-cuadro" }, h("label", { text: "Pagado" }), h("span", { text: formatearDinero(venta.pagado) })),
                h("div", { class: "detalle-cuadro" }, 
                    h("label", { text: "Saldo" }), 
                    h("span", { style: `font-size: 1.15rem; color: ${saldo > 0 ? '#b02a37' : saldo < 0 ? '#146c43' : '#212529'};`, text: saldo === 0 ? "Saldada" : formatearDinero(Math.abs(saldo)) }),
                    h("div", { style: "font-size: 0.7rem; color: #8c8c8c;", text: saldo > 0 ? "Deuda" : saldo < 0 ? "Saldo a favor" : "" })
                )
            ),
            h("div", { class: "cc-ayuda", text: "El saldo y el estado los calcula el sistema: no se pueden editar." })
        ),
        h("div", { class: "detalle-seccion" },
            h("h4", { text: "Pagos de esta venta" }),
            pagosVenta.length === 0 ? h("div", { style: "color: #8c8c8c; font-size: 0.85rem;", text: "Todavía no tiene pagos" }) :
            h("table", { class: "cc-tabla", style: "border: 1px solid #dee2e6; border-radius: 8px;" },
                h("thead", {}, h("tr", {}, ["N° de pago", "Fecha y hora", "Medio de pago", "Monto", "Estado"].map(t => h("th", { text: t })))),
                h("tbody", {}, pagosVenta.map(p => h("tr", {},
                    h("td", { text: p.nro_pago }),
                    h("td", { text: fechaHoraParaMostrar(p.fecha) }),
                    h("td", { text: p.medio_pago }),
                    h("td", { text: formatearDinero(p.monto) }),
                    h("td", {}, h("span", { class: `cc-badge ${p.anulado ? 'bg-anulada' : 'bg-saldada'}`, text: p.anulado ? "Anulado" : "Vigente" }))
                )))
            )
        )
    );

    const esPagable = !venta.anulada && saldo > 0;
    const { fondo: modalFondo } = crearModalBase(`Venta ${venta.nro_venta}`, cuerpo, [
        h("button", { class: "cc-btn-accion", text: "Cerrar", onclick: () => modalFondo.remove() }),
        h("button", { class: "cc-btn-primario", text: "Registrar pago", disabled: !esPagable, onclick: () => { modalFondo.remove(); abrirModalPago(venta); } })
    ], "ancho");
};

const abrirModalPago = async (ventaFija = null, pagoAEditar = null) => {
    const medios = ["Efectivo", "Transferencia", "Tarjeta Débito", "Mercado Pago"];
    const ventasDisponibles = ventas.filter(v => !v.anulada && (v.total - v.pagado) > 0);

    const form = h("div", {});
    const avisoError = h("div", { class: "cc-aviso error" });
    
    const selectVenta = h("select", { class: "cc-select", id: "cc-pago-venta", disabled: !!ventaFija || !!pagoAEditar });
    if (!ventaFija && !pagoAEditar) selectVenta.append(h("option", { value: "", text: "Elegí una venta" }));
    ventasDisponibles.forEach(v => selectVenta.append(h("option", { value: v.nro_venta, text: `${v.nro_venta} · ${v.cliente}` })));

    const inputMonto = h("input", { type: "number", class: "cc-input", id: "cc-pago-monto", step: "0.01" });
    const labelSaldo = h("div", { class: "cc-ayuda" });
    
    const selectMedio = h("select", { class: "cc-select", id: "cc-pago-medio" });
    selectMedio.append(h("option", { value: "", text: "Elegí una opción" }));
    medios.forEach(m => selectMedio.append(h("option", { value: m, text: m })));

    const ahora = new Date();
    const inputFecha = h("input", { type: "text", class: "cc-input", id: "cc-pago-fecha", placeholder: "dd-mm-aaaa" });
    const inputHora = h("input", { type: "text", class: "cc-input", id: "cc-pago-hora", placeholder: "hh:mm" });

    form.append(
        avisoError,
        h("div", { class: "cc-grupo" }, h("label", { text: "Venta asociada *" }), selectVenta),
        h("div", { class: "cc-fila-2" },
            h("div", { class: "cc-grupo" }, h("label", { text: "Monto abonado *" }), inputMonto, labelSaldo),
            h("div", { class: "cc-grupo" }, h("label", { text: "Medio de pago *" }), selectMedio)
        ),
        h("div", { class: "cc-fila-2" },
            h("div", { class: "cc-grupo" }, h("label", { text: "Fecha del pago *" }), inputFecha),
            h("div", { class: "cc-grupo" }, h("label", { text: "Hora del pago *" }), inputHora)
        )
    );

    const actualizarSaldoLabel = () => {
        const idVenta = selectVenta.value;
        const v = ventas.find(x => x.nro_venta === idVenta);
        if (!v) { labelSaldo.textContent = ""; return; }
        
        let saldoActual = v.total - v.pagado;
        if (pagoAEditar) saldoActual += pagoAEditar.monto;
        
        const montoIngresado = parseFloat(inputMonto.value) || 0;
        const saldoNuevo = saldoActual - montoIngresado;
        
        let texto = "";
        if (saldoNuevo > 0) texto = `Saldo después del pago: ${formatearDinero(saldoNuevo)} (deuda)`;
        else if (saldoNuevo < 0) texto = `Saldo después del pago: ${formatearDinero(Math.abs(saldoNuevo))} (saldo a favor)`;
        else texto = `Saldo después del pago: $ 0,00 (saldada)`;
        
        labelSaldo.textContent = texto;
    };

    selectVenta.addEventListener("change", actualizarSaldoLabel);
    inputMonto.addEventListener("input", actualizarSaldoLabel);

    if (ventaFija) {
        selectVenta.value = ventaFija.nro_venta;
        inputMonto.value = (ventaFija.total - ventaFija.pagado).toFixed(2);
    } else if (pagoAEditar) {
        selectVenta.value = pagoAEditar.nro_venta;
        inputMonto.value = pagoAEditar.monto;
        selectMedio.value = pagoAEditar.medio_pago;
        inputFecha.value = new Date(pagoAEditar.fecha).toLocaleDateString('es-AR').replace(/\//g, '-');
        inputHora.value = new Date(pagoAEditar.fecha).toLocaleTimeString('es-AR', {hour: '2-digit', minute:'2-digit'});
    } else {
        inputFecha.value = new Date().toLocaleDateString('es-AR').replace(/\//g, '-');
        inputHora.value = new Date().toLocaleTimeString('es-AR', {hour: '2-digit', minute:'2-digit'});
    }

    actualizarSaldoLabel();

    const { fondo } = crearModalBase(pagoAEditar ? `Editar pago ${pagoAEditar.nro_pago}` : "Registrar pago", form, [
        h("button", { class: "cc-btn-accion", text: "Cancelar", onclick: () => fondo.remove() }),
        h("button", { class: "cc-btn-primario", text: "Guardar", onclick: async (e) => {
            const btn = e.target;
            const idVenta = selectVenta.value;
            const monto = parseFloat(inputMonto.value);
            const medio = selectMedio.value;
            const fecha = inputFecha.value;
            const hora = inputHora.value;

            if (!idVenta || !monto || monto <= 0 || !medio || !fecha || !hora) {
                avisoError.textContent = "Revisá estos datos: monto abonado, medio de pago, fecha y hora.";
                avisoError.style.display = "block";
                return;
            }

            btn.disabled = true; btn.textContent = "Guardando...";
            await new Promise(r => setTimeout(r, 500)); // Simula el guardado
            fondo.remove();
            alert(pagoAEditar ? "Pago actualizado" : "Pago registrado");
        }})
    ], "ancho");
};

const abrirModalAnular = (pago) => {
    const cuerpo = h("div", {},
        h("p", { text: `¿Anular el pago ${pago.nro_pago} de ${formatearDinero(pago.monto)}?`, style: "font-weight: 600; margin-bottom: 1rem;" }),
        h("div", { class: "cc-aviso alerta", style: "display: block;", text: "El saldo de la venta volverá a subir. El pago conserva su número y se excluye de los reportes." }),
        h("p", { class: "cc-ayuda", text: "Esta acción no se puede deshacer. Los pagos no se eliminan: se anulan." })
    );

    const { fondo } = crearModalBase("Anular pago", cuerpo, [
        h("button", { class: "cc-btn-accion", text: "Cancelar", onclick: () => fondo.remove() }),
        h("button", { class: "cc-btn-primario", text: "Anular pago", style: "background: #dc3545;", onclick: async () => {
            fondo.remove();
            alert("Pago anulado");
        }})
    ], "chico");
};

const abrirModalOcultar = (pago) => {
    const cuerpo = h("div", {},
        h("p", { text: `¿Ocultar el pago ${pago.nro_pago}?`, style: "font-weight: 600; margin-bottom: 1rem;" }),
        h("p", { class: "cc-ayuda", text: "Deja de verse en el listado, pero se sigue contando en el saldo de la venta y en los reportes." })
    );

    const { fondo } = crearModalBase("Ocultar pago", cuerpo, [
        h("button", { class: "cc-btn-accion", text: "Cancelar", onclick: () => fondo.remove() }),
        h("button", { class: "cc-btn-primario", text: "Ocultar", onclick: async () => {
            fondo.remove();
            alert("Pago oculto");
        }})
    ], "chico");
};

const restaurarPago = async (pago) => {
    alert("Pago restaurado");
};

// --- CARGA DE DATOS (MOCK TEMPORAL) ---
const cargarDatos = async () => {
    try {
        // MOCK: Simulamos datos para que veas la pantalla llena
        ventas = [
            { nro_venta: "00001-0000467", cliente: "Sandra Quiroga", fecha: "2026-11-03T17:20:00Z", total: 4260.00, pagado: 0, anulada: false },
            { nro_venta: "00001-0000460", cliente: "Panadería La Espiga S.A.", fecha: "2026-10-28T14:00:00Z", total: 6500.00, pagado: 6500.00, anulada: false },
            { nro_venta: "00001-0000462", cliente: "Almacén Don Pedro S.R.L.", fecha: "2026-10-20T16:45:00Z", total: 4260.00, pagado: 1000.00, anulada: false }
        ];
        pagos = [
            { nro_pago: "00000002", nro_venta: "00001-0000460", cliente: "Panadería La Espiga S.A.", fecha: "2026-10-28T14:30:00Z", medio_pago: "Efectivo", monto: 6500.00, anulado: false, oculto: false },
            { nro_pago: "00000001", nro_venta: "00001-0000462", cliente: "Almacén Don Pedro S.R.L.", fecha: "2026-10-21T10:00:00Z", medio_pago: "Transferencia", monto: 1000.00, anulado: false, oculto: false }
        ];
        
        renderizarTabla();
    } catch (error) {
        console.error("Error al cargar cuenta corriente:", error);
    }
};

iniciarPantalla();
cargarDatos();