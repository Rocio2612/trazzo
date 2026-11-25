import { formatearDinero, fechaDeMarcaParaMostrar, fechaParaEnviar } from "./formatos.js";
import { servicioEquipamiento } from "./servicios/equipamiento.js";

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

let bienes = [];
let resumenData = { patrimonio_total: 0 }; 
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
    // Corregido Punto 3: Redirección del Cajero
    if (typeof puedeHacer === "function" && !puedeHacer("bienes_uso", "ver")) {
        window.location.href = "dashboard.html";
        return;
    }

    const pagina = document.getElementById("bienes-pagina");
    const zonaTabla = h("div");
    const zonaTotal = h("div", { style: "display: flex; justify-content: space-between; align-items: center; background-color: #f8f9fa; border: 1px solid #dee2e6; border-radius: 8px; padding: 1.25rem 1.5rem; margin-bottom: 1rem;" });

    const refrescar = () => {
        const filtradosActivos = bienes.filter(b => !b.oculto);
        const totalMostrar = resumenData.patrimonio_total || 0;

        zonaTotal.replaceChildren(
            h("div", { style: "display: flex; gap: 2rem;" },
                h("div", { style: "font-size: 1.25rem; font-weight: 600; color: #111;" }, "Valor Total del Inventario: ", h("span", { text: formatearDinero(totalMostrar), style: "color: #0056b3;" }))
            ),
            h("div", { style: "background: #e9ecef; color: #495057; padding: 0.4rem 1rem; border-radius: 999px; font-size: 0.9rem; font-weight: 500;" }, `${filtradosActivos.length} ${filtradosActivos.length === 1 ? 'equipo' : 'equipos'}`)
        );

        const texto = document.querySelector(".gastos-buscador").value.toLowerCase();
        const filtrados = bienes.filter(b => b.nombre.toLowerCase().includes(texto) && (verOcultos ? b.oculto : !b.oculto));

        const filas = filtrados.map(bien => {
            const valorTotal = bien.cantidad * bien.precio_compra;
            
            const acciones = bien.oculto 
                ? h("div", { class: "gastos-acciones-fila" }, 
                    h("button", { class: "btn btn-outline gastos-btn-chico gastos-btn-icono gastos-btn-icono-texto", onclick: async () => {
                        try { await servicioEquipamiento.restaurar(bien.id); await cargarDatos(); } 
                        catch (e) { alert(e.message || "El backend aún no tiene el endpoint de restaurar"); }
                    }}, crearSvg(ICONO_RESTAURAR), h("span", { text: "Restaurar" })),
                    h("button", { class: "btn btn-outline gastos-btn-chico gastos-btn-icono gastos-btn-eliminar", title: "Eliminar", onclick: async () => { 
                        if (confirm("ADVERTENCIA: Eliminar este bien altera las sumatorias históricas. ¿Seguro que querés borrarlo definitivamente?")) { 
                            try { await servicioEquipamiento.eliminar(bien.id); await cargarDatos(); }
                            catch (e) { alert(e.message || "Error al eliminar"); }
                        } 
                    }}, crearSvg(ICONO_ELIMINAR))
                  )
                : h("div", { class: "gastos-acciones-fila" },
                    h("button", { class: "btn btn-outline gastos-btn-icono", title: "Editar", onclick: () => editar(bien) }, crearSvg(ICONO_EDITAR)),
                    h("button", { class: "btn btn-outline gastos-btn-icono", title: "Ocultar", onclick: async () => { 
                        try { await servicioEquipamiento.ocultar(bien.id); await cargarDatos(); }
                        catch (e) { alert(e.message || "Error al ocultar"); }
                    }}, crearSvg(ICONO_OCULTAR))
                  );

            return h("tr", {},
                h("td", { text: bien.nombre }),
                h("td", { text: formatearDinero(bien.precio_compra) }),
                h("td", { text: bien.cantidad }),
                h("td", { text: formatearDinero(valorTotal) }),
                h("td", { text: fechaDeMarcaParaMostrar(bien.fecha) }), 
                h("td", { text: bien.creado_por }),
                h("td", { class: "acciones-columna" }, acciones)
            );
        });

        zonaTabla.replaceChildren(
            h("div", { class: "gastos-tarjeta" },
                filtrados.length === 0 ? h("div", { class: "gastos-vacio", text: verOcultos ? "Sin elementos ocultos" : "Sin equipamiento" })
                : h("div", { class: "gastos-tabla-contenedor" },
                    h("table", { class: "gastos-tabla" },
                        h("thead", {}, h("tr", {}, ["NOMBRE", "VALOR ADQ.", "CANTIDAD", "VALOR TOTAL", "FECHA", "CREADO POR", "ACCIONES"].map(t => h("th", { text: t })))),
                        h("tbody", {}, filas)
                    )
                )
            )
        );
    };

    const buscador = h("input", { type: "search", class: "gastos-entrada gastos-buscador", placeholder: "Buscar por nombre...", oninput: refrescar });
    const chipOcultos = h("button", { class: "gastos-chip", text: "Ver ocultos", onclick: (e) => { verOcultos = !verOcultos; e.target.classList.toggle("activo"); refrescar(); } });
    const botonNuevo = h("button", { class: "btn btn-primario gastos-btn-con-icono", onclick: () => crear() }, crearSvg(ICONO_MAS), h("span", { text: "Nuevo equipamiento" }));

    pagina.replaceChildren(
        h("div", { class: "gastos-encabezado" }, h("h1", { text: "Equipamiento" })), 
        h("div", { class: "gastos-acciones" }, h("div"), botonNuevo),
        zonaTotal,
        h("div", { class: "gastos-barra" }, buscador, chipOcultos),
        zonaTabla
    );
    
    refrescarUI = refrescar;
    refrescar(); 

    // CORRECCIÓN QA: Se llama acá adentro, después de verificar permisos
    cargarDatos();
};

const cargarDatos = async () => {
    try {
        const datos = await servicioEquipamiento.listar();
        resumenData = datos.resumen; 
        bienes = datos.bienes.map(item => ({
            id: item.id,
            nombre: item.nombre,
            precio_compra: item.costo_adquisicion, 
            cantidad: item.cantidad,
            valor_total: item.valor_total, 
            fecha: item.fecha_adquisicion || item.creado_en || "—", 
            proveedor_id: item.proveedor_id,
            creado_por: item.creado_por || "admin",
            oculto: item.activo === false || item.oculto === true || false
        }));
        if (refrescarUI) refrescarUI();
    } catch (error) {
        console.error("Error al cargar equipamiento:", error);
        alert(error.message || "No se pudo cargar el equipamiento."); 
    }
};

const crear = async () => {
    const proveedores = await obtenerProveedores(); 

    const form = h("div", {},
        h("div", { class: "gastos-campo" }, h("label", { text: "Nombre *" }), h("input", { id: "m-nombre", class: "gastos-entrada" })),
        h("div", { class: "gastos-campo" }, h("label", { text: "Valor de Adquisición (Unitario) *" }), h("input", { id: "m-valor", type: "number", class: "gastos-entrada" })),
        h("div", { class: "gastos-campo" }, h("label", { text: "Fecha de Adquisición *" }), h("input", { id: "m-fecha", type: "text", class: "gastos-entrada", placeholder: "dd-mm-aaaa" })),
        h("div", { class: "gastos-campo" }, h("label", { text: "Cantidad Total *" }), h("input", { id: "m-cant", type: "number", step: "1", class: "gastos-entrada", value: "1" })),
        h("div", { class: "gastos-campo" }, h("label", { text: "Proveedor *" }), 
            h("select", { id: "m-prov", class: "gastos-entrada" }, 
                h("option", { value: "", text: "Seleccione un proveedor" }),
                ...proveedores.map(p => h("option", { value: p.id, text: p.nombre }))
            )
        )
    );
    
    abrirModal({
        titulo: "Nuevo equipamiento", cuerpo: form,
        onGuardar: async () => {
            const nombre = document.getElementById("m-nombre").value.trim();
            const valor = parseFloat(document.getElementById("m-valor").value);
            const cant = parseInt(document.getElementById("m-cant").value);
            const fecha = document.getElementById("m-fecha").value;
            const provId = document.getElementById("m-prov").value;

            if (!nombre) throw new Error("El nombre es obligatorio.");
            if (isNaN(valor) || valor <= 0) throw new Error("El valor de adquisición debe ser mayor a 0."); 
            if (isNaN(cant) || cant <= 0) throw new Error("La cantidad debe ser mayor a 0.");
            if (!provId) throw new Error("Debe seleccionar un proveedor.");
            
            const fechaFormateada = fechaParaEnviar(fecha);
            if (!fecha || !fechaFormateada) throw new Error("La fecha es obligatoria y debe tener el formato dd-mm-aaaa.");

            await servicioEquipamiento.crear({
                nombre: nombre, precio_compra: valor, cantidad: cant, stock_minimo: 0, 
                proveedor_id: parseInt(provId),
                fecha_adquisicion: fechaFormateada, iva_alicuota: 21.00
            });
            await cargarDatos();
        }
    });
};

const editar = async (bien) => {
    const proveedores = await obtenerProveedores();

    const form = h("div", {},
        h("div", { class: "gastos-campo" }, h("label", { text: "Nombre *" }), h("input", { id: "e-nombre", class: "gastos-entrada", value: bien.nombre })),
        h("div", { class: "gastos-campo" }, h("label", { text: "Valor de Adquisición (Unitario) *" }), h("input", { id: "e-valor", type: "number", class: "gastos-entrada", value: bien.precio_compra })),
        h("div", { class: "gastos-campo" }, h("label", { text: "Fecha de Adquisición *" }), h("input", { id: "e-fecha", type: "text", class: "gastos-entrada", placeholder: "dd-mm-aaaa", value: fechaDeMarcaParaMostrar(bien.fecha) })),
        h("div", { class: "gastos-campo" }, h("label", { text: "Cantidad Total *" }), h("input", { id: "e-cant", type: "number", step: "1", class: "gastos-entrada", value: bien.cantidad })),
        h("div", { class: "gastos-campo" }, h("label", { text: "Proveedor *" }), 
            h("select", { id: "e-prov", class: "gastos-entrada" }, 
                h("option", { value: "", text: "Seleccione un proveedor" }),
                ...proveedores.map(p => h("option", { value: p.id, text: p.nombre, selected: p.id === bien.proveedor_id }))
            )
        )
    );
    
    abrirModal({
        titulo: "Editar equipamiento", cuerpo: form,
        onGuardar: async () => {
            const nombre = document.getElementById("e-nombre").value.trim();
            const valor = parseFloat(document.getElementById("e-valor").value);
            const cant = parseInt(document.getElementById("e-cant").value);
            const fecha = document.getElementById("e-fecha").value;
            const provId = document.getElementById("e-prov").value;

            if (!nombre) throw new Error("El nombre es obligatorio.");
            if (isNaN(valor) || valor <= 0) throw new Error("El valor de adquisición debe ser mayor a 0."); 
            if (isNaN(cant) || cant <= 0) throw new Error("La cantidad debe ser mayor a 0.");
            if (!provId) throw new Error("Debe seleccionar un proveedor.");
            
            const fechaFormateada = fechaParaEnviar(fecha);
            if (!fecha || !fechaFormateada) throw new Error("La fecha es obligatoria y debe tener el formato dd-mm-aaaa.");

            await servicioEquipamiento.editar(bien.id, {
                nombre: nombre, 
                precio_compra: valor, 
                cantidad: cant,
                proveedor_id: parseInt(provId),
                fecha_adquisicion: fechaFormateada
            });
            await cargarDatos();
        }
    });
};

// ACÁ ESTABA EL ERROR: Sacamos cargarDatos() de acá afuera
iniciarPantalla();