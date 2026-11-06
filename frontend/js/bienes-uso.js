import { formatearDinero } from "./formatos.js";

// 1. Función constructora de HTML
const h = (etiqueta, props = {}, ...hijos) => {
    const el = document.createElement(etiqueta);
    Object.entries(props).forEach(([k, v]) => {
        if (v === null || v === undefined || v === false) return;
        if (k === "class") el.className = v;
        else if (k === "text") el.textContent = v;
        else if (k.startsWith("on") && typeof v === "function") {
            el.addEventListener(k.substring(2).toLowerCase(), v);
        } else {
            el.setAttribute(k, v === true ? "" : v);
        }
    });
    hijos.flat().forEach(h => h && el.append(h));
    return el;
};

// 2. Íconos SVG
const svgString = (path) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
const crearSvg = (path) => new DOMParser().parseFromString(svgString(path), "image/svg+xml").documentElement;

const ICONO_EDITAR = '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/>';
const ICONO_OCULTAR = '<path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" y1="2" x2="22" y2="22"/>';
const ICONO_RESTAURAR = '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>';
const ICONO_ELIMINAR = '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>';
const ICONO_MAS = '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>';

// 3. Datos de prueba
let bienes = [
    { id: 1, nombre: "Heladera exhibidora", valor_adquisicion: 850000, en_uso: 1, en_reparacion: 0, baja: 0, fecha: "12-02-2026", creado_por: "admin1", oculto: false, historial_cambios: [] },
    { id: 2, nombre: "Balanza electrónica", valor_adquisicion: 95000, en_uso: 2, en_reparacion: 0, baja: 0, fecha: "03-03-2026", creado_por: "admin1", oculto: false, historial_cambios: [] }
];
let verOcultos = false;

// 4. Modal genérico
const abrirModal = ({ titulo, cuerpo, onGuardar }) => {
    const fondo = h("div", { class: "gastos-modal-fondo" });
    const btnGuardar = h("button", { class: "btn btn-primario", text: "Guardar" });
    
    const modal = h("div", { class: "gastos-modal" },
        h("div", { class: "gastos-modal-cabecera" }, h("h2", { text: titulo }), h("button", { class: "gastos-modal-cerrar", text: "×", onclick: () => fondo.remove() })),
        h("div", { class: "gastos-modal-cuerpo" }, cuerpo),
        h("div", { class: "gastos-modal-pie" },
            h("button", { class: "btn btn-outline", text: "Cancelar", onclick: () => fondo.remove() }),
            btnGuardar
        )
    );

    btnGuardar.addEventListener("click", () => {
        btnGuardar.disabled = true;
        btnGuardar.textContent = "Guardando...";
        onGuardar();
        fondo.remove();
    });

    fondo.append(modal);
    document.body.append(fondo);
};

const renderEtiquetasEstado = (bien) => {
    const etiquetas = [];
    const estilo = "background-color: #f8f9fa; border: 1px solid #dee2e6; border-radius: 12px; padding: 4px 8px; font-size: 0.75rem; color: #495057; display: inline-block; margin-right: 4px;";
    
    if (bien.en_uso > 0) etiquetas.push(h("span", { style: estilo, text: `${bien.en_uso} En uso` }));
    if (bien.en_reparacion > 0) etiquetas.push(h("span", { style: estilo, text: `${bien.en_reparacion} En rep.` }));
    if (bien.baja > 0) etiquetas.push(h("span", { style: estilo, text: `${bien.baja} De baja` }));

    return h("div", {}, ...etiquetas);
};

// 5. Pantalla Principal
const iniciarPantalla = () => {
    const pagina = document.getElementById("bienes-pagina");
    const zonaTabla = h("div");
    
    // Caja del Total (Igual a la de Jime)
    const zonaTotal = h("div", { style: "display: flex; justify-content: space-between; align-items: center; background-color: #f8f9fa; border: 1px solid #dee2e6; border-radius: 8px; padding: 1.25rem 1.5rem; margin-bottom: 1rem;" });

    const refrescar = () => {
        // Calcular Sumatorias y Cantidad
        let sumaTotal = 0;
        let sumaActual = 0;
        const filtradosActivos = bienes.filter(b => !b.oculto);
        
        filtradosActivos.forEach(b => {
            const totalCant = b.en_uso + b.en_reparacion + b.baja;
            sumaTotal += (totalCant * b.valor_adquisicion);
            sumaActual += ((b.en_uso + b.en_reparacion) * b.valor_adquisicion);
        });

        // Dibujar Caja del Total
        zonaTotal.replaceChildren(
            h("div", { style: "display: flex; gap: 2rem;" },
                h("div", { style: "font-size: 1.25rem; font-weight: 600; color: #111;" },
                    "Valor Total: ",
                    h("span", { text: formatearDinero(sumaTotal), style: "color: #0056b3;" })
                ),
                h("div", { style: "font-size: 1.25rem; font-weight: 600; color: #111;" },
                    "Valor Actual: ",
                    h("span", { text: formatearDinero(sumaActual), style: "color: #0056b3;" })
                )
            ),
            h("div", { style: "background: #e9ecef; color: #495057; padding: 0.4rem 1rem; border-radius: 999px; font-size: 0.9rem; font-weight: 500;" },
                `${filtradosActivos.length} ${filtradosActivos.length === 1 ? 'equipo' : 'equipos'}`
            )
        );

        // Filtrar
        const texto = document.querySelector(".gastos-buscador").value.toLowerCase();
        const filtrados = bienes.filter(b => b.nombre.toLowerCase().includes(texto) && (verOcultos ? b.oculto : !b.oculto));

        // Dibujar Tabla
        const filas = filtrados.map(bien => {
            const totalCant = bien.en_uso + bien.en_reparacion + bien.baja;
            const valorTotal = totalCant * bien.valor_adquisicion;
            
            const acciones = bien.oculto 
                ? h("div", { class: "gastos-acciones-fila" }, 
                    h("button", { class: "btn btn-outline gastos-btn-chico gastos-btn-icono gastos-btn-icono-texto", onclick: () => { bien.oculto = false; refrescar(); } }, crearSvg(ICONO_RESTAURAR), h("span", { text: "Restaurar" })),
                    h("button", { class: "btn btn-outline gastos-btn-chico gastos-btn-icono gastos-btn-eliminar", title: "Eliminar", onclick: () => {
                        if (confirm("ADVERTENCIA: Eliminar este bien altera las sumatorias históricas. ¿Seguro que querés borrarlo definitivamente?")) {
                            bienes = bienes.filter(b => b.id !== bien.id);
                            refrescar();
                        }
                    }}, crearSvg(ICONO_ELIMINAR))
                  )
                : h("div", { class: "gastos-acciones-fila" },
                    h("button", { class: "btn btn-outline gastos-btn-icono", title: "Editar", onclick: () => editar(bien) }, crearSvg(ICONO_EDITAR)),
                    h("button", { class: "btn btn-outline gastos-btn-chico", text: "Cambiar Estado", onclick: () => cambiarEstado(bien) }),
                    h("button", { class: "btn btn-outline gastos-btn-icono", title: "Ocultar", onclick: () => { 
                        if (bien.historial_cambios.length > 0) {
                            if(!confirm("Este bien tiene historial de cambios. Si lo ocultás, sigue sumando en los reportes. ¿Continuar?")) return;
                        }
                        bien.oculto = true; 
                        refrescar(); 
                    } }, crearSvg(ICONO_OCULTAR))
                  );

            return h("tr", {},
                h("td", { text: bien.nombre }),
                h("td", { text: formatearDinero(bien.valor_adquisicion) }),
                h("td", { text: totalCant }),
                h("td", { text: formatearDinero(valorTotal) }),
                h("td", { text: bien.fecha }),
                h("td", {}, renderEtiquetasEstado(bien)), 
                h("td", { text: bien.creado_por }),
                h("td", { class: "acciones-columna" }, acciones)
            );
        });

        zonaTabla.replaceChildren(
            h("div", { class: "gastos-tarjeta" },
                filtrados.length === 0 
                ? h("div", { class: "gastos-vacio", text: verOcultos ? "Sin elementos ocultos" : "Sin equipamiento" })
                : h("div", { class: "gastos-tabla-contenedor" },
                    h("table", { class: "gastos-tabla" },
                        h("thead", {}, h("tr", {}, 
                            ["NOMBRE", "VALOR ADQUISICIÓN", "CANTIDAD", "VALOR TOTAL", "FECHA", "ESTADO", "CREADO POR", "ACCIONES"].map(t => h("th", { text: t }))
                        )),
                        h("tbody", {}, filas)
                    )
                )
            )
        );
    };

    const buscador = h("input", { type: "search", class: "gastos-entrada gastos-buscador", placeholder: "Buscar por nombre...", oninput: refrescar });
    const chipOcultos = h("button", { class: "gastos-chip", text: "Ver ocultos", onclick: (e) => { verOcultos = !verOcultos; e.target.classList.toggle("activo"); refrescar(); } });
    const botonNuevo = h("button", { class: "btn btn-primario gastos-btn-con-icono", onclick: () => crear() }, crearSvg(ICONO_MAS), h("span", { text: "Nuevo equipamiento" }));

    // Estructura visual exacta
    pagina.replaceChildren(
        h("div", { class: "gastos-encabezado" }, h("h1", { text: "Equipamiento" })), 
        h("div", { class: "gastos-acciones" }, h("div"), botonNuevo),
        zonaTotal,
        h("div", { class: "gastos-barra" }, buscador, chipOcultos),
        zonaTabla
    );
    refrescar();
};

// 6. Modales
const crear = () => {
    const form = h("div", {},
        h("div", { class: "gastos-campo" }, h("label", { text: "Nombre *" }), h("input", { id: "m-nombre", class: "gastos-entrada" })),
        h("div", { class: "gastos-campo" }, h("label", { text: "Valor de Adquisición (Unitario) *" }), h("input", { id: "m-valor", type: "number", class: "gastos-entrada" })),
        h("div", { class: "gastos-campo" }, h("label", { text: "Fecha de Adquisición *" }), h("input", { id: "m-fecha", class: "gastos-entrada", placeholder: "dd-mm-aaaa" })),
        h("div", { class: "gastos-campo" }, h("label", { text: "Cantidad En Uso *" }), h("input", { id: "m-uso", type: "number", class: "gastos-entrada", value: "0" })),
        h("div", { class: "gastos-campo" }, h("label", { text: "Cantidad En Reparación *" }), h("input", { id: "m-rep", type: "number", class: "gastos-entrada", value: "0" })),
        h("div", { class: "gastos-campo" }, h("label", { text: "Cantidad Dado de Baja *" }), h("input", { id: "m-baja", type: "number", class: "gastos-entrada", value: "0" }))
    );
    
    abrirModal({
        titulo: "Nuevo equipamiento", cuerpo: form,
        onGuardar: () => {
            bienes.push({
                id: Date.now(), 
                nombre: document.getElementById("m-nombre").value,
                valor_adquisicion: parseFloat(document.getElementById("m-valor").value) || 0, 
                en_uso: parseInt(document.getElementById("m-uso").value) || 0,
                en_reparacion: parseInt(document.getElementById("m-rep").value) || 0,
                baja: parseInt(document.getElementById("m-baja").value) || 0,
                fecha: document.getElementById("m-fecha").value, creado_por: "admin1", oculto: false, historial_cambios: []
            });
            iniciarPantalla();
        }
    });
};

const editar = (bien) => {
    const form = h("div", {},
        h("div", { class: "gastos-campo" }, h("label", { text: "Nombre *" }), h("input", { id: "m-nombre", class: "gastos-entrada", value: bien.nombre })),
        h("div", { class: "gastos-campo" }, h("label", { text: "Valor de Adquisición *" }), h("input", { id: "m-valor", type: "number", class: "gastos-entrada", value: bien.valor_adquisicion })),
        h("div", { class: "gastos-campo" }, h("label", { text: "Fecha de Adquisición *" }), h("input", { id: "m-fecha", class: "gastos-entrada", value: bien.fecha })),
        h("div", { class: "gastos-campo" }, h("label", { text: "Cantidad En Uso *" }), h("input", { id: "m-uso", type: "number", class: "gastos-entrada", value: bien.en_uso })),
        h("div", { class: "gastos-campo" }, h("label", { text: "Cantidad En Reparación *" }), h("input", { id: "m-rep", type: "number", class: "gastos-entrada", value: bien.en_reparacion })),
        h("div", { class: "gastos-campo" }, h("label", { text: "Cantidad Dado de Baja *" }), h("input", { id: "m-baja", type: "number", class: "gastos-entrada", value: bien.baja }))
    );
    
    abrirModal({
        titulo: "Editar equipamiento", cuerpo: form,
        onGuardar: () => {
            bien.nombre = document.getElementById("m-nombre").value;
            bien.valor_adquisicion = parseFloat(document.getElementById("m-valor").value);
            bien.fecha = document.getElementById("m-fecha").value;
            bien.en_uso = parseInt(document.getElementById("m-uso").value) || 0;
            bien.en_reparacion = parseInt(document.getElementById("m-rep").value) || 0;
            bien.baja = parseInt(document.getElementById("m-baja").value) || 0;
            iniciarPantalla();
        }
    });
};

const cambiarEstado = (bien) => {
    const form = h("div", {},
        h("div", { class: "gastos-campo" }, h("label", { text: "Cantidad a mover *" }), h("input", { id: "m-cant", type: "number", class: "gastos-entrada", value: "1" })),
        h("div", { class: "gastos-campo" }, 
            h("label", { text: "Desde *" }), 
            h("select", { id: "m-origen", class: "gastos-entrada" },
                h("option", { value: "en_uso", text: "En Uso" }),
                h("option", { value: "en_reparacion", text: "En Reparación" })
            )
        ),
        h("div", { class: "gastos-campo" }, 
            h("label", { text: "Hacia *" }), 
            h("select", { id: "m-destino", class: "gastos-entrada" },
                h("option", { value: "en_uso", text: "En Uso" }),
                h("option", { value: "en_reparacion", text: "En Reparación" }),
                h("option", { value: "baja", text: "Dado de Baja" })
            )
        )
    );
    abrirModal({
        titulo: "Cambiar Estado", cuerpo: form,
        onGuardar: () => {
            const cant = parseInt(document.getElementById("m-cant").value) || 0;
            const origen = document.getElementById("m-origen").value;
            const destino = document.getElementById("m-destino").value;

            if (origen === destino) { alert("El origen y destino no pueden ser iguales."); return; }
            if (bien[origen] < cant) { alert("No hay suficientes unidades en ese estado."); return; }

            bien[origen] -= cant;
            bien[destino] += cant;
            bien.historial_cambios.push({ fecha: new Date().toISOString(), origen, destino, cant });
            iniciarPantalla();
        }
    });
};

iniciarPantalla();