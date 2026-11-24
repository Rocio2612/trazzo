import { formatearDinero, fechaDeMarcaParaMostrar, fechaParaEnviar } from "./formatos.js";
import { servicioInsumos } from "./servicios/insumos.js";

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

let insumos = [];
let resumenData = { valor_inventario_total: 0 };
let verOcultos = false;
let refrescarUI = null; 

const obtenerProveedores = async () => {
    try {
        const res = await fetchAPI("/proveedores"); // Corregido Punto 1
        return res.items || []; 
    } catch (error) {
        console.error("Error al cargar proveedores:", error);
        return [];
    }
};

const abrirModal = ({ titulo, cuerpo, onGuardar }) => {
    const fondo = h("div", { class: "gastos-modal-fondo" });
    const btnGuardar = h("button", { class: "btn btn-primario", text: "Guardar" });
    
    const modal = h("div", { class: "gastos-modal" },
        h("div", { class: "gastos-modal-cabecera" }, h("h2", { text: titulo }), h("button", { class: "gastos-modal-cerrar", text: "×", onclick: () => fondo.remove() })),
        h("div", { class: "gastos-modal-cuerpo" }, cuerpo),
        h("div", { class: "gastos-modal-pie" }, h("button", { class: "btn btn-outline", text: "Cancelar", onclick: () => fondo.remove() }), btnGuardar)
    );

    btnGuardar.addEventListener("click", async () => {
        btnGuardar.disabled = true; btnGuardar.textContent = "Guardando...";
        try {
            await onGuardar();
            fondo.remove();
        } catch (error) {
            alert(error.message || "Error al guardar");
            btnGuardar.disabled = false; btnGuardar.textContent = "Guardar";
        }
    });
    fondo.append(modal); document.body.append(fondo);
};

const iniciarPantalla = () => {
    // Corregido Punto 3
    if (typeof puedeHacer === "function" && !puedeHacer("insumos", "ver")) {
        window.location.href = "dashboard.html";
        return;
    }

    const pagina = document.getElementById("insumos-pagina");
    const zonaTabla = h("div");
    const zonaTotal = h("div", { style: "display: flex; justify-content: space-between; align-items: center; background-color: #f8f9fa; border: 1px solid #dee2e6; border-radius: 8px; padding: 1.25rem 1.5rem; margin-bottom: 1rem;" });

    const refrescar = () => {
        const filtradosActivos = insumos.filter(i => !i.oculto);
        const cantidad = filtradosActivos.length;
        const totalMostrar = resumenData.valor_inventario_total || 0;

        zonaTotal.replaceChildren(
            h("div", { style: "font-size: 1.5rem; font-weight: 600; color: #111;" }, "Valor Total del Inventario: ", h("span", { text: formatearDinero(totalMostrar), style: "color: #0056b3;" })),
            h("div", { style: "background: #e9ecef; color: #495057; padding: 0.4rem 1rem; border-radius: 999px; font-size: 0.9rem; font-weight: 500;" }, `${cantidad} ${cantidad === 1 ? 'insumo' : 'insumos'}`)
        );

        const texto = document.querySelector(".gastos-buscador").value.toLowerCase();
        const filtrados = insumos.filter(i => i.nombre.toLowerCase().includes(texto) && (verOcultos ? i.oculto : !i.oculto));

        const filas = filtrados.map(insumo => {
            const acciones = insumo.oculto 
                ? h("div", { class: "gastos-acciones-fila" }, 
                    h("button", { class: "btn btn-outline gastos-btn-chico gastos-btn-icono gastos-btn-icono-texto", onclick: async () => {
                        try { await servicioInsumos.restaurar(insumo.id); await cargarDatos(); } 
                        catch (e) { alert(e.message || "El backend aún no tiene el endpoint de restaurar"); }
                    }}, crearSvg(ICONO_RESTAURAR), h("span", { text: "Restaurar" })),
                    h("button", { class: "btn btn-outline gastos-btn-chico gastos-btn-icono gastos-btn-eliminar", title: "Eliminar", onclick: async () => { 
                        if (confirm("¿Eliminar definitivamente este insumo?")) { 
                            try { await servicioInsumos.eliminar(insumo.id); await cargarDatos(); }
                            catch (e) { alert(e.message || "Error al eliminar: puede que tenga reposiciones o consumos asociados."); }
                        } 
                    }}, crearSvg(ICONO_ELIMINAR))
                  )
                : h("div", { class: "gastos-acciones-fila" },
                    h("button", { class: "btn btn-outline gastos-btn-icono", title: "Editar", onclick: () => editar(insumo) }, crearSvg(ICONO_EDITAR)),
                    h("button", { class: "btn btn-outline gastos-btn-chico", text: "Reponer", onclick: () => reponer(insumo) }),
                    h("button", { class: "btn btn-outline gastos-btn-chico", text: "Consumir", onclick: () => consumir(insumo) }),
                    h("button", { class: "btn btn-outline gastos-btn-icono", title: "Ocultar", onclick: async () => { 
                        try { await servicioInsumos.ocultar(insumo.id); await cargarDatos(); }
                        catch (e) { alert(e.message || "Error al ocultar"); }
                    }}, crearSvg(ICONO_OCULTAR))
                  );

            return h("tr", {},
                h("td", { text: insumo.nombre }),
                h("td", { text: formatearDinero(insumo.precio_compra) }),
                h("td", { text: insumo.cantidad }),
                h("td", { text: insumo.unidad_medida }),
                h("td", { text: formatearDinero(insumo.costo_total) }),
                h("td", { text: fechaDeMarcaParaMostrar(insumo.fecha) }), 
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
    
    refrescarUI = refrescar; 
    refrescar(); 
};

const cargarDatos = async () => {
    try {
        const datos = await servicioInsumos.listar();
        resumenData = datos.resumen; 
        insumos = datos.insumos.map(item => ({
            id: item.id,
            nombre: item.nombre,
            precio_compra: item.costo_unitario, 
            cantidad: item.cantidad,
            unidad_medida: item.unidad_medida || "unidades",
            costo_total: item.valor_stock, 
            fecha: item.fecha || item.creado_en || "—",
            proveedor: item.proveedor_nombre || "—",
            proveedor_id: item.proveedor_id, // Corregido Punto 5 (guardar id)
            creado_por: item.creado_por || "admin",
            oculto: item.activo === false || item.oculto === true || false
        }));
        if (refrescarUI) refrescarUI(); 
    } catch (error) {
        console.error("Error al cargar insumos:", error);
        alert(error.message || "No se pudieron cargar los insumos.");
    }
};

const crear = async () => {
    const proveedores = await obtenerProveedores(); 

    const form = h("div", {},
        h("div", { class: "gastos-campo" }, h("label", { text: "Nombre *" }), h("input", { id: "m-nombre", class: "gastos-entrada" })),
        h("div", { class: "gastos-campo" }, h("label", { text: "Costo unitario *" }), h("input", { id: "m-costo", type: "number", class: "gastos-entrada" })),
        h("div", { class: "gastos-campo" }, h("label", { text: "Cantidad *" }), h("input", { id: "m-cant", type: "number", step: "1", class: "gastos-entrada" })),
        h("div", { class: "gastos-campo" }, h("label", { text: "Fecha *" }), h("input", { id: "m-fecha", type: "text", class: "gastos-entrada", placeholder: "dd-mm-aaaa" })),
        h("div", { class: "gastos-campo" }, h("label", { text: "Proveedor *" }), 
            h("select", { id: "m-prov", class: "gastos-entrada" }, 
                h("option", { value: "", text: "Seleccione un proveedor" }),
                ...proveedores.map(p => h("option", { value: p.id, text: p.nombre }))
            )
        ),
        h("div", { class: "gastos-campo" }, h("label", { text: "Costo total" }), h("input", { id: "m-total", class: "gastos-entrada", readonly: true, style: "background:#f8f9fa;", placeholder: "Se calcula automáticamente" }), h("p", { class: "gastos-ayuda", text: "Costo unitario × cantidad. Lo calcula el sistema." }))
    );
    
    abrirModal({
        titulo: "Nuevo insumo", cuerpo: form,
        onGuardar: async () => {
            const nombre = document.getElementById("m-nombre").value.trim();
            const costo = parseFloat(document.getElementById("m-costo").value);
            const cant = parseInt(document.getElementById("m-cant").value);
            const fecha = document.getElementById("m-fecha").value;
            const provId = document.getElementById("m-prov").value;

            if (!nombre) throw new Error("El nombre es obligatorio.");
            if (isNaN(costo) || costo <= 0) throw new Error("El costo unitario debe ser mayor a 0."); // Corregido Punto 2
            if (isNaN(cant) || cant <= 0) throw new Error("La cantidad debe ser mayor a 0.");
            if (!provId) throw new Error("Debe seleccionar un proveedor.");
            
            const fechaFormateada = fechaParaEnviar(fecha);
            if (!fecha || !fechaFormateada) throw new Error("La fecha es obligatoria y debe tener el formato dd-mm-aaaa.");

            await servicioInsumos.crear({
                nombre: nombre, precio_compra: costo, cantidad: cant, stock_minimo: 0, 
                proveedor_id: parseInt(provId),
                iva_alicuota: 21.00, fecha: fechaFormateada 
            });
            await cargarDatos();
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

// Corregido Punto 4: Edit modal implementado
const editar = async (insumo) => {
    const proveedores = await obtenerProveedores();

    const form = h("div", {},
        h("div", { class: "gastos-campo" }, h("label", { text: "Nombre *" }), h("input", { id: "e-nombre", class: "gastos-entrada", value: insumo.nombre })),
        h("div", { class: "gastos-campo" }, h("label", { text: "Costo unitario *" }), h("input", { id: "e-costo", type: "number", class: "gastos-entrada", value: insumo.precio_compra })),
        h("div", { class: "gastos-campo" }, h("label", { text: "Fecha *" }), h("input", { id: "e-fecha", type: "text", class: "gastos-entrada", placeholder: "dd-mm-aaaa", value: fechaDeMarcaParaMostrar(insumo.fecha) })),
        h("div", { class: "gastos-campo" }, h("label", { text: "Proveedor *" }), 
            h("select", { id: "e-prov", class: "gastos-entrada" }, 
                h("option", { value: "", text: "Seleccione un proveedor" }),
                ...proveedores.map(p => h("option", { value: p.id, text: p.nombre, selected: p.id === insumo.proveedor_id }))
            )
        )
    );
    
    abrirModal({
        titulo: "Editar insumo", cuerpo: form,
        onGuardar: async () => {
            const nombre = document.getElementById("e-nombre").value.trim();
            const costo = parseFloat(document.getElementById("e-costo").value);
            const fecha = document.getElementById("e-fecha").value;
            const provId = document.getElementById("e-prov").value;

            if (!nombre) throw new Error("El nombre es obligatorio.");
            if (isNaN(costo) || costo <= 0) throw new Error("El costo unitario debe ser mayor a 0.");
            if (!provId) throw new Error("Debe seleccionar un proveedor.");
            
            const fechaFormateada = fechaParaEnviar(fecha);
            if (!fecha || !fechaFormateada) throw new Error("La fecha es obligatoria y debe tener el formato dd-mm-aaaa.");

            await servicioInsumos.editar(insumo.id, {
                nombre: nombre, precio_compra: costo, proveedor_id: parseInt(provId), fecha: fechaFormateada
            });
            await cargarDatos();
        }
    });
};

const reponer = async (insumo) => {
    const proveedores = await obtenerProveedores();
    
    const form = h("div", {},
        h("p", { text: `Reponiendo stock de: ${insumo.nombre}`, style: "margin-bottom:1rem; font-weight:bold;" }),
        h("div", { class: "gastos-campo" }, h("label", { text: "Cantidad a reponer *" }), h("input", { id: "m-cant", type: "number", step: "1", class: "gastos-entrada" })),
        h("div", { class: "gastos-campo" }, h("label", { text: "Monto total invertido *" }), h("input", { id: "m-monto", type: "number", class: "gastos-entrada", placeholder: "Se calcula automáticamente" })),
        h("div", { class: "gastos-campo" }, h("label", { text: "Fecha *" }), h("input", { id: "m-fecha", type: "text", class: "gastos-entrada", placeholder: "dd-mm-aaaa" })),
        h("div", { class: "gastos-campo" }, h("label", { text: "Proveedor *" }), 
            h("select", { id: "m-prov", class: "gastos-entrada" }, 
                h("option", { value: "", text: "Seleccione un proveedor" }),
                ...proveedores.map(p => h("option", { value: p.id, text: p.nombre }))
            )
        )
    );
    abrirModal({
        titulo: "Reponer stock", cuerpo: form,
        onGuardar: async () => {
            const cant = parseInt(document.getElementById("m-cant").value);
            const monto = parseFloat(document.getElementById("m-monto").value);
            const fecha = document.getElementById("m-fecha").value;
            const provId = document.getElementById("m-prov").value;

            if (isNaN(cant) || cant <= 0) throw new Error("La cantidad debe ser mayor a 0.");
            if (isNaN(monto) || monto <= 0) throw new Error("El monto debe ser mayor a 0.");
            if (!provId) throw new Error("Debe seleccionar un proveedor.");
            
            const fechaFormateada = fechaParaEnviar(fecha);
            if (!fecha || !fechaFormateada) throw new Error("La fecha es obligatoria y debe tener el formato dd-mm-aaaa.");

            await servicioInsumos.reponer(insumo.id, { 
                proveedor_id: parseInt(provId), cantidad: cant, monto_total: monto, fecha: fechaFormateada 
            });
            await cargarDatos();
        }
    });

    setTimeout(() => {
        const iCant = document.getElementById("m-cant");
        const iMonto = document.getElementById("m-monto");
        const calcularMonto = () => {
            const cant = parseInt(iCant.value) || 0;
            iMonto.value = cant > 0 ? (cant * insumo.precio_compra).toFixed(2) : '';
        };
        iCant.addEventListener("input", calcularMonto);
    }, 50);
};

const consumir = (insumo) => {
    const form = h("div", {},
        h("p", { text: `Consumiendo: ${insumo.nombre}`, style: "margin-bottom:1rem; font-weight:bold;" }),
        h("div", { class: "gastos-campo" }, h("label", { text: "Cantidad consumida *" }), h("input", { id: "m-cant", type: "number", step: "1", class: "gastos-entrada" })),
        h("div", { class: "gastos-campo" }, h("label", { text: "Fecha *" }), h("input", { id: "m-fecha", type: "text", class: "gastos-entrada", placeholder: "dd-mm-aaaa" }))
    );
    abrirModal({
        titulo: "Registrar consumo", cuerpo: form,
        onGuardar: async () => {
            const cant = parseInt(document.getElementById("m-cant").value);
            const fecha = document.getElementById("m-fecha").value;

            if (isNaN(cant) || cant <= 0) throw new Error("La cantidad debe ser mayor a 0.");
            
            const fechaFormateada = fechaParaEnviar(fecha);
            if (!fecha || !fechaFormateada) throw new Error("La fecha es obligatoria y debe tener el formato dd-mm-aaaa.");

            await servicioInsumos.consumir(insumo.id, { 
                cantidad: cant, motivo: "Consumo operativo", fecha: fechaFormateada 
            });
            await cargarDatos();
        }
    });
};

iniciarPantalla();
cargarDatos();