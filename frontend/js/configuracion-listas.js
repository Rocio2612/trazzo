// --- PESTAÑAS "CATEGORÍAS" Y "MEDIOS DE PAGO" DE CONFIGURACIÓN (módulo ES) ---
// Las dos son una lista simple de nombres: un campo para agregar arriba y, debajo, cada elemento con sus
// botones de editar y eliminar (con confirmación). Se arman con la misma función y cambian solo los textos.
// "Efectivo" (es_predeterminado) se puede ver y editar pero no eliminar.

import { abrirFormularioModal, avisar, bannerAmbar, boton, botonIcono, confirmar, crearSvg, h, ICONOS } from "./componentes/ui-panel.js";
import { crearSinOpciones } from "./componentes/sin-opciones.js";
import { validarNombreLista } from "./personalizacion.js";
import { servicioCategorias } from "./mocks/categorias.js";
import { mensajeDeError } from "./servicios/errores.js";
import { servicioMediosPago } from "./servicios/medios-pago.js";

// tipo: "categorias" | "medios_pago". Es también el nombre del módulo en roles.js.
export const TEXTOS_LISTA = {
  categorias: {
    singular: "categoría",
    articulo: "una categoría",
    maximo: 100, // productos.categorias.nombre es VARCHAR(100)
    creado: "Categoría creada",
    etiquetaEntrada: "Nombre de la categoría",
    placeholder: "Ej.: remeras, pantalones",
    aviso: "Estas categorías aparecen como opción (opcional) al crear un producto.",
    eliminar: "Si la categoría tiene productos asociados, sigue apareciendo en lo histórico pero ya no se ofrece para productos nuevos.",
  },
  medios_pago: {
    singular: "medio de pago",
    articulo: "un medio de pago",
    maximo: 50, // finanzas.medios_pago.nombre es VARCHAR(50)
    creado: "Medio de pago creado",
    etiquetaEntrada: "Nombre del medio de pago",
    placeholder: "Ej.: transferencia, tarjeta de débito",
    aviso: "Estos medios de pago se pueden elegir (opcional) al registrar ventas, pagos y gastos operativos.",
    eliminar: "Si el medio de pago ya se usó en ventas, pagos o gastos, sigue apareciendo en lo histórico pero ya no se ofrece para registros nuevos.",
  },
};

export const crearPanelLista = (tipo) => {
  const textos = TEXTOS_LISTA[tipo];
  // Los medios de pago vienen del Backend (finanzas-service). Las categorías siguen simuladas hasta que haya API.
  const servicio = tipo === "medios_pago" ? servicioMediosPago : servicioCategorias;
  const ctx = { elementos: [] };
  const zonaLista = h("div");

  // Si el Backend no responde se avisa en la lista en vez de mostrarla vacía.
  const cargar = async () => {
    try {
      ctx.elementos = await servicio.listar();
      ctx.error = "";
    } catch (error) {
      ctx.error = mensajeDeError(error, `No se pudo cargar la lista de ${textos.singular}s.`);
    }
    refrescar();
  };

  const nombresExcepto = (id) => ctx.elementos.filter((e) => e.id !== id).map((e) => e.nombre);

  // --- Agregar (campo en línea) ---
  const entrada = h("input", { type: "text", class: "gastos-entrada cfg-entrada-agregar", placeholder: textos.placeholder, maxlength: textos.maximo, "aria-label": textos.etiquetaEntrada, "data-testid": `${tipo}-nombre` });
  const errorAgregar = h("p", { class: "gastos-error", hidden: true, "data-testid": `${tipo}-error` });
  const botonAgregar = boton("", "btn-primario gastos-btn-con-icono", { "data-testid": `${tipo}-agregar`, "data-modulo": tipo, "data-accion": "crear" });
  botonAgregar.append(crearSvg(ICONOS.mas), h("span", { text: "Agregar" }));

  const mostrarErrorAgregar = (mensaje) => {
    errorAgregar.textContent = mensaje || "";
    errorAgregar.hidden = !mensaje;
    entrada.classList.toggle("con-error", Boolean(mensaje));
  };

  let agregando = false;
  const agregar = async () => {
    if (agregando) return;
    const error = validarNombreLista(entrada.value, nombresExcepto(null), textos.articulo, textos.maximo);
    mostrarErrorAgregar(error);
    if (error) return entrada.focus();
    agregando = true;
    botonAgregar.disabled = true;
    try {
      await servicio.crear(entrada.value.trim());
      entrada.value = "";
      await cargar();
      avisar(textos.creado);
    } catch (e) {
      mostrarErrorAgregar(e.errores?.nombre || mensajeDeError(e, `No se pudo crear ${textos.articulo}.`));
    } finally {
      agregando = false;
      botonAgregar.disabled = false;
    }
  };
  botonAgregar.addEventListener("click", agregar);
  entrada.addEventListener("keydown", (e) => e.key === "Enter" && agregar());
  entrada.addEventListener("input", () => mostrarErrorAgregar(""));

  // --- Editar y eliminar ---
  const editar = (elemento) =>
    abrirFormularioModal({
      titulo: `Editar ${textos.singular}`,
      campos: [{ nombre: "nombre", etiqueta: "Nombre", obligatorio: true, maxlength: textos.maximo }],
      valores: { nombre: elemento.nombre },
      validar: (datos) => {
        const error = validarNombreLista(datos.nombre, nombresExcepto(elemento.id), textos.articulo, textos.maximo);
        return error ? { nombre: error } : {};
      },
      alGuardar: async (datos) => {
        await servicio.actualizar(elemento.id, datos.nombre.trim());
        await cargar();
        avisar("Cambios guardados");
      },
    });

  const pedirEliminar = (elemento) =>
    confirmar({
      titulo: `Eliminar ${textos.singular}`,
      cuerpo: [
        h("p", { text: `¿Eliminar "${elemento.nombre}"?` }),
        bannerAmbar(textos.eliminar),
        h("p", { class: "gastos-ayuda", text: "Esta acción no se puede deshacer." }),
      ],
      textoOk: "Eliminar",
      claseOk: "btn-peligro",
      alAceptar: async () => {
        try {
          await servicio.eliminar(elemento.id);
          await cargar();
          avisar(`"${elemento.nombre}" se eliminó`);
        } catch (e) {
          avisar(mensajeDeError(e, "No se pudo eliminar."));
        }
      },
    });

  // --- Lista ---
  const filaDeElemento = (elemento) =>
    h(
      "li",
      { class: "cfg-fila-lista", "data-testid": `${tipo}-fila-${elemento.id}` },
      h("span", { class: "cfg-fila-nombre", text: elemento.nombre }),
      elemento.es_predeterminado && h("span", { class: "cfg-insignia", text: "Por defecto" }),
      h(
        "div",
        { class: "gastos-acciones-fila cfg-fila-acciones" },
        botonIcono(ICONOS.editar, "Editar", { "data-testid": `${tipo}-editar-${elemento.id}`, "data-modulo": tipo, "data-accion": "editar", "data-id": elemento.id }),
        !elemento.es_predeterminado &&
          botonIcono(ICONOS.eliminar, "Eliminar", { "data-testid": `${tipo}-eliminar-${elemento.id}`, "data-modulo": tipo, "data-accion": "eliminar", "data-id": elemento.id }, "gastos-btn-eliminar"),
      ),
    );

  const refrescar = () =>
    zonaLista.replaceChildren(
      h(
        "div",
        { class: "gastos-tarjeta" },
        ctx.elementos.length === 0
          ? ctx.error
            ? h("div", { class: "gastos-vacio", "data-testid": `${tipo}-error-carga`, text: ctx.error })
            : h("div", { class: "gastos-vacio" }, crearSinOpciones(tipo, { conEnlace: false }))
          : h(
              "div",
              { class: "cfg-lista-scroll" },
              h("div", { class: "cfg-lista-cabecera" }, h("span", { text: "Nombre" }), h("span", { text: "Acciones" })),
              h("ul", { class: "cfg-lista", "data-testid": `${tipo}-lista` }, ctx.elementos.map(filaDeElemento)),
            ),
      ),
    );

  zonaLista.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-accion]");
    const elemento = b && ctx.elementos.find((x) => x.id === Number(b.dataset.id));
    if (!elemento) return;
    ({ editar: () => editar(elemento), eliminar: () => pedirEliminar(elemento) })[b.dataset.accion]?.();
  });

  const panel = h(
    "section",
    { id: `panel-${tipo}`, class: "cfg-columna", "data-modulo": tipo },
    h("p", { class: "gastos-ayuda cfg-descripcion", text: textos.aviso }),
    h("div", { class: "cfg-agregar" }, h("div", { class: "cfg-agregar-campo" }, entrada, errorAgregar), botonAgregar),
    zonaLista,
  );
  return { panel, cargar };
};
