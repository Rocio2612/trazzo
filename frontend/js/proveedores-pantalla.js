// --- PANTALLA DE PROVEEDORES (módulo ES) ---
// Directorio de proveedores: tabla con buscador, alta y edición en un modal, ocultar y restaurar, y eliminar
// definitivo solo si el proveedor está oculto y no tiene productos ni reposiciones. La lógica (validación,
// payload, reglas) está en proveedores.js y los datos vienen de mocks/proveedores.js hasta que Back
// publique /api/proveedores. Solo el Admin entra (el Backend también lo valida).

import {
  abrirFormularioModal,
  avisar,
  bannerAmbar,
  boton,
  botonIcono,
  confirmar,
  crearSvg,
  h,
  ICONOS,
} from "./componentes/ui-panel.js";
import {
  armarPayloadProveedor,
  CATEGORIAS_PROVEEDOR,
  CORREO_MAXIMO,
  estaOculto,
  ETIQUETA_CATEGORIA_CORTA,
  formatearDocumento,
  NOMBRE_PROVEEDOR_MAXIMO,
  puedeEliminarProveedor,
  TELEFONO_PROVEEDOR_MAXIMO,
  TIPOS_DOCUMENTO,
  validarProveedor,
} from "./proveedores.js";
import { servicioProveedores } from "./mocks/proveedores.js";

const MODULO = "proveedores";

const ICONO_OCULTAR =
  '<path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" y1="2" x2="22" y2="22"/>';
const ICONO_RESTAURAR = '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>';

const COLUMNAS = [
  { titulo: "Nombre o razón social" },
  { titulo: "Documento" },
  { titulo: "Categoría impositiva" },
  { titulo: "Teléfono" },
  { titulo: "Descripción de compra" },
  { titulo: "Acciones", clase: "acciones-columna" },
];

const CAMPOS = [
  { nombre: "nombre", etiqueta: "Nombre o razón social", obligatorio: true, maxlength: NOMBRE_PROVEEDOR_MAXIMO },
  { nombre: "tipo_documento", etiqueta: "Tipo de documento", obligatorio: true, grupo: "documento", opciones: TIPOS_DOCUMENTO },
  { nombre: "numero_documento", etiqueta: "Número", obligatorio: true, grupo: "documento", maxlength: 13, placeholder: "Ej.: 30-71234567-1" },
  {
    nombre: "categoria_impositiva",
    etiqueta: "Categoría impositiva",
    obligatorio: true,
    opciones: [{ valor: "", texto: "Elegir…" }, ...CATEGORIAS_PROVEEDOR],
    ayuda: "Define cómo se registra el IVA de las compras a este proveedor.",
  },
  { nombre: "telefono", etiqueta: "Teléfono (opcional)", grupo: "contacto", maxlength: TELEFONO_PROVEEDOR_MAXIMO, tipo: "tel" },
  { nombre: "correo", etiqueta: "Correo (opcional)", grupo: "contacto", tipo: "email", maxlength: CORREO_MAXIMO },
  {
    nombre: "descripcion_compra",
    etiqueta: "Descripción de compra",
    tipo: "textarea",
    placeholder: "Ej.: Distribuidor de envases y cajas de cartón",
    ayuda: "Qué mercadería, insumos o servicios le compras a este proveedor.",
  },
];

const iniciarPantalla = async () => {
  if (!puedeHacer(MODULO, "ver")) {
    window.location.href = "dashboard.html";
    return;
  }

  const pagina = document.getElementById("proveedores-pagina");
  const ctx = { q: "", ocultos: false, proveedores: [] };
  const zonaTabla = h("div");

  const cargar = async () => {
    ctx.proveedores = await servicioProveedores.listar({ q: ctx.q, ocultos: ctx.ocultos });
    refrescar();
  };

  // --- Alta y edición ---
  const formulario = (proveedor) => {
    const esNuevo = !proveedor;
    abrirFormularioModal({
      titulo: esNuevo ? "Nuevo proveedor" : "Editar proveedor",
      campos: CAMPOS,
      valores: proveedor
        ? { ...proveedor, numero_documento: formatearDocumento(proveedor.tipo_documento, proveedor.numero_documento), telefono: proveedor.telefono ?? "", correo: proveedor.correo ?? "", descripcion_compra: proveedor.descripcion_compra ?? "" }
        : { tipo_documento: "CUIT" },
      // Al cambiar la categoría impositiva se avisa qué pasa con las compras.
      avisos: (datos) =>
        !esNuevo && datos.categoria_impositiva !== proveedor.categoria_impositiva
          ? [bannerAmbar("Cambiar la categoría impositiva afecta cómo se registra el IVA de las próximas reposiciones. Las ya cargadas no cambian.")]
          : [],
      validar: validarProveedor,
      alGuardar: async (datos) => {
        const payload = armarPayloadProveedor(datos);
        if (esNuevo) await servicioProveedores.crear(payload);
        else await servicioProveedores.actualizar(proveedor.id, payload);
        await cargar();
        avisar(esNuevo ? "Proveedor registrado" : "Proveedor actualizado");
      },
    });
  };

  // --- Ocultar, restaurar y eliminar ---
  const pedirOcultar = (p) =>
    confirmar({
      titulo: "Ocultar proveedor",
      cuerpo: [
        h("p", { text: `¿Ocultar a "${p.nombre}"?` }),
        h("p", { class: "gastos-ayuda", text: "Deja de verse en el listado y no se ofrece en las reposiciones nuevas. Sus datos y su historial se conservan." }),
      ],
      textoOk: "Ocultar",
      alAceptar: async () => {
        await servicioProveedores.cambiarOculto(p.id, true);
        await cargar();
        avisar(`"${p.nombre}" ahora está oculto`);
      },
    });

  const restaurar = async (p) => {
    await servicioProveedores.cambiarOculto(p.id, false);
    await cargar();
    avisar(`"${p.nombre}" se restauró`);
  };

  const pedirEliminar = (p) =>
    confirmar({
      titulo: "Eliminar proveedor",
      cuerpo: [
        h("p", { text: `¿Eliminar a "${p.nombre}" definitivamente?` }),
        bannerAmbar("Se borra del sistema. No tiene productos ni reposiciones asociados."),
        h("p", { class: "gastos-ayuda", text: "Esta acción no se puede deshacer." }),
      ],
      textoOk: "Eliminar",
      claseOk: "btn-peligro",
      alAceptar: async () => {
        try {
          await servicioProveedores.eliminar(p.id);
          await cargar();
          avisar(`"${p.nombre}" se eliminó`);
        } catch (error) {
          avisar(error.message || "No se pudo eliminar.");
        }
      },
    });

  // --- Tabla ---
  const botonesFila = (p) => {
    const datos = (accion) => ({ "data-testid": `proveedores-${accion}-${p.id}`, "data-modulo": MODULO, "data-accion": accion, "data-id": p.id });
    if (!estaOculto(p)) {
      return h(
        "div",
        { class: "gastos-acciones-fila" },
        botonIcono(ICONOS.editar, "Editar", datos("editar")),
        botonIcono(ICONO_OCULTAR, "Ocultar", datos("ocultar")),
      );
    }
    // En "Ver ocultos": Restaurar y Eliminar. Eliminar queda deshabilitado, con el motivo, si tiene movimientos.
    const eliminar = puedeEliminarProveedor(p);
    return h(
      "div",
      { class: "gastos-acciones-fila" },
      botonIcono(ICONO_RESTAURAR, "Restaurar", { ...datos("ocultar"), "data-restaurar": "1" }),
      eliminar.permitido
        ? botonIcono(ICONOS.eliminar, "Eliminar", datos("eliminar"), "gastos-btn-eliminar")
        : botonIcono(ICONOS.eliminar, `Eliminar: ${eliminar.motivo}`, { disabled: true, "data-testid": `proveedores-eliminar-${p.id}` }, "gastos-btn-eliminar"),
    );
  };

  const sinDato = () => h("span", { class: "gastos-sin-dato", text: "—" });

  const filaDeProveedor = (p) => {
    const celdas = [
      p.nombre,
      h("span", { class: "prov-documento" }, h("span", { class: "prov-tipo", text: p.tipo_documento }), ` ${formatearDocumento(p.tipo_documento, p.numero_documento)}`),
      h("span", { class: "cfg-insignia", text: ETIQUETA_CATEGORIA_CORTA[p.categoria_impositiva] || p.categoria_impositiva }),
      p.telefono || sinDato(),
      p.descripcion_compra ? h("span", { class: "prov-descripcion", title: p.descripcion_compra, text: p.descripcion_compra }) : sinDato(),
      botonesFila(p),
    ];
    return h("tr", { "data-testid": `proveedores-fila-${p.id}` }, celdas.map((celda, i) => h("td", { class: COLUMNAS[i].clase }, celda)));
  };

  const refrescar = () => {
    const hayBusqueda = ctx.q.trim() !== "";
    const textoVacio = hayBusqueda ? "Sin resultados" : ctx.ocultos ? "No hay proveedores ocultos" : "Todavía no hay proveedores";
    zonaTabla.replaceChildren(
      h(
        "div",
        { class: "gastos-tarjeta" },
        ctx.proveedores.length === 0
          ? h("div", { class: "gastos-vacio", "data-testid": "proveedores-vacio", text: textoVacio })
          : h(
              "div",
              { class: "gastos-tabla-contenedor cfg-tabla-contenedor" },
              h(
                "table",
                { class: "gastos-tabla", "data-testid": "proveedores-tabla" },
                h("thead", {}, h("tr", {}, COLUMNAS.map((c) => h("th", { class: c.clase, text: c.titulo })))),
                h("tbody", {}, ctx.proveedores.map(filaDeProveedor)),
              ),
            ),
      ),
    );
  };

  zonaTabla.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-accion]");
    const proveedor = b && ctx.proveedores.find((p) => p.id === Number(b.dataset.id));
    if (!proveedor) return;
    const acciones = {
      editar: () => formulario(proveedor),
      ocultar: () => (estaOculto(proveedor) ? restaurar(proveedor) : pedirOcultar(proveedor)),
      eliminar: () => pedirEliminar(proveedor),
    };
    acciones[b.dataset.accion]?.();
  });

  // --- Encabezado, buscador y "Ver ocultos" ---
  const botonNuevo = boton("", "btn-primario gastos-btn-con-icono", { "data-testid": "proveedores-nuevo", "data-modulo": MODULO, "data-accion": "crear" });
  botonNuevo.append(crearSvg(ICONOS.mas), h("span", { text: "Nuevo proveedor" }));
  botonNuevo.addEventListener("click", () => formulario(null));

  const buscador = h("input", { type: "search", class: "gastos-entrada gastos-buscador-entrada", placeholder: "Buscar por nombre, documento, teléfono o descripción…", "data-testid": "proveedores-buscador", "aria-label": "Buscar" });
  buscador.addEventListener("input", () => {
    ctx.q = buscador.value;
    cargar();
  });

  const chipOcultos = h("button", { type: "button", class: "gastos-chip", text: "Ver ocultos", "data-testid": "proveedores-ver-ocultos", "data-modulo": MODULO, "data-accion": "ocultar" });
  chipOcultos.addEventListener("click", () => {
    ctx.ocultos = !ctx.ocultos;
    chipOcultos.classList.toggle("activo", ctx.ocultos);
    cargar();
  });

  pagina.replaceChildren(
    h("div", { class: "gastos-encabezado" }, h("h1", { text: "Proveedores" })),
    h("div", { class: "prov-acciones" }, botonNuevo),
    h("div", { class: "gastos-barra" }, h("div", { class: "gastos-buscador" }, crearSvg(ICONOS.lupa), buscador), chipOcultos),
    zonaTabla,
  );
  await cargar();
};

iniciarPantalla();
