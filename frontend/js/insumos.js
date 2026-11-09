import { formatearDinero } from "./formatos.js";

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

const svgString = (path) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
const crearSvg = (path) => new DOMParser().parseFromString(svgString(path), "image/svg+xml").documentElement;

const ICONO_EDITAR = '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/>';
const ICONO_OCULTAR = '<path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" y1="2" x2="22" y2="22"/>';
const ICONO_RESTAURAR = '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>';
const ICONO_ELIMINAR = '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>';
const ICONO_MAS = '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>';

let insumos = [
    { id: 1, nombre: "Café molido", precio_compra: 8500, cantidad: 5, unidad_medida: "unidades", costo_total: 42500, fecha: "04-03-2026", proveedor: "Distribuidora Norte", creado_por: "admin1", oculto: false }
];
let verOcultos = false;

const abrirModal = ({ titulo, cuerpo, onGuardar }) => {
    const fondo = h("div", { class: "gastos-modal-fondo" });
    const btnGuardar = h("button", { class: "btn btn-primario", text: "Guardar" });
    
    const modal = h("div", { class: "gastos-modal" },
        h("div", { class: "gastos-modal-cabecera" }, h("h2", { text: titulo }), h("button", { class: "gastos-modal-cerrar", text: "×", onclick: () => fondo.remove() })),
        h("div", { class: "gastos-modal-cuerpo" }, cuerpo),
        h("div", { class: "gastos-modal-pie" }, h("button", { class: "btn btn-outline", text: "Cancelar", onclick: () => fondo.remove() }), btnGuardar)
    );

    btnGuardar.addEventListener("click", () => {
        btnGuardar.disabled = true; btnGuardar.textContent = "Guardando..."; onGuardar(); fondo.remove();
    });
    fondo.append(modal); document.body.append(fondo);
};

const iniciarPantalla = () => {
    const pagina = document.getElementById("insumos-pagina");
    const zonaTabla = h("div");
    const zonaTotal = h("div", { style: "display: flex; justify-content: space-between; align-items: center; background-color: #f8f9fa; border: 1px solid #dee2e6; border-radius: 8px; padding: 1.25rem 1.5rem; margin-bottom: 1rem;" });

    const refrescar = () => {
        const filtradosActivos = insumos.filter(i => !i.oculto);
        const total = filtradosActivos.reduce((acc, i) => acc + i.costo_total, 0);
        const cantidad = filtradosActivos.length;

        zonaTotal.replaceChildren(
            h("div", { style: "font-size: 1.5rem; font-weight: 600; color: #111;" }, "Total del período: ", h("span", { text: formatearDinero(total), style: "color: #0056b3;" })),
            h("div", { style: "background: #e9ecef; color: #495057; padding: 0.4rem 1rem; border-radius: 999px; font-size: 0.9rem; font-weight: 500;" }, `${cantidad} ${cantidad === 1 ? 'insumo' : 'insumos'}`)
        );

        const texto = document.querySelector(".gastos-buscador").value.toLowerCase();
        const filtrados = insumos.filter(i => i.nombre.toLowerCase().includes(texto) && (verOcultos ? i.oculto : !i.oculto));

        const filas = filtrados.map(insumo => {
            const acciones = insumo.oculto 
                ? h("div", { class: "gastos-acciones-fila" }, 
                    h("button", { class: "btn btn-outline gastos-btn-chico gastos-btn-icono gastos-btn-icono-texto", onclick: () => { insumo.oculto = false; refrescar(); } }, crearSvg(ICONO_RESTAURAR), h("span", { text: "Restaurar" })),
                    h("button", { class: "btn btn-outline gastos-btn-chico gastos-btn-icono gastos-btn-eliminar", title: "Eliminar", onclick: () => { if (confirm("¿Eliminar definitivamente este insumo?")) { insumos = insumos.filter(i => i.id !== insumo.id); refrescar(); } }}, crearSvg(ICONO_ELIMINAR))
                  )
                : h("div", { class: "gastos-acciones-fila" },
                    h("button", { class: "btn btn-outline gastos-btn-icono", title: "Editar", onclick: () => editar(insumo) }, crearSvg(ICONO_EDITAR)),
                    h("button", { class: "btn btn-outline gastos-btn-chico", text: "Reponer", onclick: () => reponer(insumo) }),
                    h("button", { class: "btn btn-outline gastos-btn-chico", text: "Consumir", onclick: () => consumir(insumo) }),
                    h("button", { class: "btn btn-outline gastos-btn-icono", title: "Ocultar", onclick: () => { insumo.oculto = true; refrescar(); } }, crearSvg(ICONO_OCULTAR))
                  );

            return h("tr", {},
                h("td", { text: insumo.nombre }),
                h("td", { text: formatearDinero(insumo.precio_compra) }),
                h("td", { text: insumo.cantidad }),
                h("td", { text: insumo.unidad_medida }),
                h("td", { text: formatearDinero(insumo.costo_total) }),
                h("td", { text: insumo.fecha }),
                h("td", { text: insumo.proveedor }),
                h("td", { text: insumo.creado_por }),
                h("td", { class: "acciones-columna" }, acciones)
            );
        });

        zonaTabla.replaceChildren(
            h("div", { class: "gastos-tarjeta" },
                filtrados.length === 0 ? h("div", { class: "gastos-vacio", text: verOcultos ? "Sin elementos ocultos" : "Sin insumos" })
                : h("div", { class: "gastos-tabla-contenedor" },
                    h("table", { class: "gastos-tabla" },
                        h("thead", {}, h("tr", {}, ["NOMBRE", "COSTO UNITARIO", "CANTIDAD", "UNIDAD", "COSTO TOTAL", "FECHA", "PROVEEDOR", "CREADO POR", "ACCIONES"].map(t => h("th", { text: t })))),
                        h("tbody", {}, filas)
                    )
                )
            )
        );
    };

    const buscador = h("input", { type: "search", class: "gastos-entrada gastos-buscador", placeholder: "Buscar por nombre...", oninput: refrescar });
    const chipOcultos = h("button", { class: "gastos-chip", text: "Ver ocultos", onclick: (e) => { verOcultos = !verOcultos; e.target.classList.toggle("activo"); refrescar(); } });
    const botonNuevo = h("button", { class: "btn btn-primario gastos-btn-con-icono", onclick: () => crear() }, crearSvg(ICONO_MAS), h("span", { text: "Nuevo insumo" }));

    pagina.replaceChildren(
        h("div", { class: "gastos-encabezado" }, h("h1", { text: "Insumos" })),
        h("div", { class: "gastos-acciones" }, h("div"), botonNuevo),
        zonaTotal,
        h("div", { class: "gastos-barra" }, buscador, chipOcultos),
        zonaTabla
    );
    refrescar();
};

const crear = () => {
    const form = h("div", {},
        h("div", { class: "gastos-campo" }, h("label", { text: "Nombre *" }), h("input", { id: "m-nombre", class: "gastos-entrada" })),
        h("div", { class: "gastos-campo" }, h("label", { text: "Costo unitario *" }), h("input", { id: "m-costo", type: "number", class: "gastos-entrada" })),
        h("div", { class: "gastos-campo" }, h("label", { text: "Cantidad *" }), h("input", { id: "m-cant", type: "number", step: "1", class: "gastos-entrada" })),
        h("div", { class: "gastos-campo" }, h("label", { text: "Fecha *" }), h("input", { id: "m-fecha", class: "gastos-entrada", placeholder: "dd-mm-aaaa" })),
        h("div", { class: "gastos-campo" }, h("label", { text: "Proveedor registrado (opcional)" }), h("select", { id: "m-prov-select", class: "gastos-entrada" }, h("option", { value: "", text: "Sin proveedor" }), h("option", { value: "Distribuidora Norte", text: "Distribuidora Norte" }))),
        h("div", { class: "gastos-campo" }, h("label", { text: "O escribir un proveedor" }), h("input", { id: "m-prov-input", class: "gastos-entrada", placeholder: "Nombre o razón social" })),
        h("div", { class: "gastos-campo" }, h("label", { text: "Costo total" }), h("input", { id: "m-total", class: "gastos-entrada", readonly: true, style: "background:#f8f9fa;", placeholder: "Se calcula automáticamente" }), h("p", { class: "gastos-ayuda", text: "Costo unitario × cantidad. Lo calcula el sistema." }))
    );
    
    abrirModal({
        titulo: "Nuevo insumo", cuerpo: form,
        onGuardar: () => {
            const costo = parseFloat(document.getElementById("m-costo").value) || 0;
            const cant = parseInt(document.getElementById("m-cant").value) || 0;
            const provSelect = document.getElementById("m-prov-select").value;
            const provInput = document.getElementById("m-prov-input").value;
            
            insumos.push({
                id: Date.now(), 
                nombre: document.getElementById("m-nombre").value,
                precio_compra: costo, cantidad: cant, 
                unidad_medida: "unidades", costo_total: costo * cant,
                fecha: document.getElementById("m-fecha").value, 
                proveedor: provInput || provSelect || "—", 
                creado_por: "admin1", oculto: false
            });
            iniciarPantalla();
        }
    });

    setTimeout(() => {
        const iCosto = document.getElementById("m-costo");
        const iCant = document.getElementById("m-cant");
        const iTotal = document.getElementById("m-total");
        const calcular = () => { iTotal.value = ((parseFloat(iCosto.value) || 0) * (parseInt(iCant.value) || 0)) > 0 ? formatearDinero((parseFloat(iCosto.value) || 0) * (parseInt(iCant.value) || 0)) : ''; };
        iCosto.addEventListener("input", calcular); iCant.addEventListener("input", calcular);
    }, 50);
};

const editar = (insumo) => {
    const form = h("div", {},
        h("div", { class: "gastos-campo" }, h("label", { text: "Nombre *" }), h("input", { id: "m-nombre", class: "gastos-entrada", value: insumo.nombre })),
        h("div", { class: "gastos-campo" }, h("label", { text: "Costo unitario *" }), h("input", { id: "m-costo", type: "number", class: "gastos-entrada", value: insumo.precio_compra })),
        h("div", { class: "gastos-campo" }, h("label", { text: "Cantidad *" }), h("input", { id: "m-cant", type: "number", step: "1", class: "gastos-entrada", value: insumo.cantidad })),
        h("div", { class: "gastos-campo" }, h("label", { text: "Fecha *" }), h("input", { id: "m-fecha", class: "gastos-entrada", value: insumo.fecha })),
        h("div", { class: "gastos-campo" }, h("label", { text: "Proveedor" }), h("input", { id: "m-proveedor", class: "gastos-entrada", value: insumo.proveedor === "—" ? "" : insumo.proveedor })),
        h("div", { class: "gastos-campo" }, h("label", { text: "Costo total" }), h("input", { id: "m-total", class: "gastos-entrada", readonly: true, style: "background:#f8f9fa;", value: formatearDinero(insumo.costo_total) }))
    );
    abrirModal({
        titulo: "Editar insumo", cuerpo: form,
        onGuardar: () => {
            insumo.nombre = document.getElementById("m-nombre").value;
            insumo.precio_compra = parseFloat(document.getElementById("m-costo").value);
            insumo.cantidad = parseInt(document.getElementById("m-cant").value);
            insumo.fecha = document.getElementById("m-fecha").value;
            insumo.proveedor = document.getElementById("m-proveedor").value || "—";
            insumo.costo_total = insumo.precio_compra * insumo.cantidad;
            iniciarPantalla();
        }
    });
};

const reponer = (insumo) => {
    const form = h("div", {},
        h("p", { text: `Reponiendo stock de: ${insumo.nombre}`, style: "margin-bottom:1rem; font-weight:bold;" }),
        h("div", { class: "gastos-campo" }, h("label", { text: "Cantidad a reponer *" }), h("input", { id: "m-cant", type: "number", step: "1", class: "gastos-entrada" })),
        h("div", { class: "gastos-campo" }, h("label", { text: "Monto total invertido *" }), h("input", { id: "m-monto", type: "number", class: "gastos-entrada" })),
        h("div", { class: "gastos-campo" }, h("label", { text: "Fecha *" }), h("input", { id: "m-fecha", class: "gastos-entrada", placeholder: "dd-mm-aaaa" }))
    );
    abrirModal({
        titulo: "Reponer stock", cuerpo: form,
        onGuardar: () => {
            const cant = parseInt(document.getElementById("m-cant").value) || 0;
            const monto = parseFloat(document.getElementById("m-monto").value) || 0;
            if(cant <= 0 || monto <= 0) { alert("Complete los campos correctamente"); return; }
            insumo.cantidad += cant;
            insumo.precio_compra = monto / cant; 
            insumo.costo_total = insumo.cantidad * insumo.precio_compra;
            insumo.fecha = document.getElementById("m-fecha").value;
            iniciarPantalla();
        }
    });
};

const consumir = (insumo) => {
    const form = h("div", {},
        h("p", { text: `Consumiendo: ${insumo.nombre}`, style: "margin-bottom:1rem; font-weight:bold;" }),
        h("div", { class: "gastos-campo" }, h("label", { text: "Cantidad consumida *" }), h("input", { id: "m-cant", type: "number", step: "1", class: "gastos-entrada" })),
        h("div", { class: "gastos-campo" }, h("label", { text: "Fecha *" }), h("input", { id: "m-fecha", class: "gastos-entrada", placeholder: "dd-mm-aaaa" }))
    );
    abrirModal({
        titulo: "Registrar consumo", cuerpo: form,
        onGuardar: () => {
            const cant = parseInt(document.getElementById("m-cant").value) || 0;
            if (cant <= 0) return;
            if (cant > insumo.cantidad) { alert("No hay stock suficiente"); return; }
            insumo.cantidad -= cant;
            insumo.costo_total = insumo.cantidad * insumo.precio_compra;
            iniciarPantalla();
        }
    });
};

iniciarPantalla();