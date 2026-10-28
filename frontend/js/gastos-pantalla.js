// --- PANTALLA DE GASTOS OPERATIVOS (módulo ES) ---
// Dibuja la lista, el selector de período, el buscador, los modales de alta/edición y las
// confirmaciones de ocultar y eliminar. La lógica (validación, payload) está en gastos.js.
// Mientras Back no publique /api/gastos, los datos viven en memoria (mocks/gastos.js) y se
// pierden al recargar: solo hay que reemplazar el objeto `servicio` por llamadas a fetchAPI.
// Todo se arma con textContent (nada de innerHTML con datos del usuario).

import { fechaIsoDeHoy, fechaParaMostrar, formatearDinero } from "./formatos.js";
import { armarPayloadGasto, validarGasto } from "./gastos.js";
import { GASTOS_EJEMPLO, listarGastosSimulado } from "./mocks/gastos.js";

const MODULO = "gastos";

// Íconos de trazo (24x24). Son textos fijos del código, nunca datos del usuario.
const ICONO_EDITAR = '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/>';
const ICONO_OCULTAR = '<path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" y1="2" x2="22" y2="22"/>';
const ICONO_ELIMINAR = '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>';
const ICONO_RESTAURAR = '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>';
const ICONO_CALENDARIO = '<path d="M8 2v4"/><path d="M16 2v4"/><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 10h18"/><path d="M8 14h.01"/><path d="M12 14h.01"/><path d="M16 14h.01"/><path d="M8 18h.01"/><path d="M12 18h.01"/><path d="M16 18h.01"/>';
const ICONO_MAS = '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>';

const OPCIONES_PERIODO = [
  { valor: "todas", texto: "Todos los gastos" },
  { valor: "hoy", texto: "Hoy" },
  { valor: "mes", texto: "Este mes" },
  { valor: "anio", texto: "Este año" },
];

// --- Datos (simulados) ---------------------------------------------------------
const gastos = GASTOS_EJEMPLO.map((g) => ({ ...g }));
let siguienteId = Math.max(0, ...gastos.map((g) => g.id)) + 1;

const usuarioActual = () => {
  try {
    return decodificarToken(localStorage.getItem("trazzo_access_token"))?.usuario || "admin1";
  } catch {
    return "admin1";
  }
};

const servicio = {
  listar: (filtros) => listarGastosSimulado(gastos, { ...filtros, porPagina: Number.MAX_SAFE_INTEGER }).items,
  crear: (datos) => {
    const gasto = {
      id: siguienteId++,
      fecha: datos.fecha,
      concepto: datos.concepto,
      monto: datos.monto.toFixed(2),
      medio_pago_id: null,
      medio_pago_nombre: null,
      oculto: false,
      creado_por_nombre: usuarioActual(),
    };
    gastos.push(gasto);
    return gasto;
  },
  actualizar: (gasto, datos) => Object.assign(gasto, { fecha: datos.fecha, concepto: datos.concepto, monto: datos.monto.toFixed(2) }),
  cambiarOculto: (gasto, oculto) => Object.assign(gasto, { oculto }),
  eliminar: (gasto) => gastos.splice(gastos.indexOf(gasto), 1),
};

// Rango aaaa-mm-dd (inclusivo) de cada período, con la fecha de hoy del usuario.
const rangoDePeriodo = (periodo) => {
  const hoy = fechaIsoDeHoy();
  if (periodo === "hoy") return { desde: hoy, hasta: hoy };
  if (periodo === "mes") return { desde: `${hoy.slice(0, 7)}-01`, hasta: `${hoy.slice(0, 7)}-31` };
  if (periodo === "anio") return { desde: `${hoy.slice(0, 4)}-01-01`, hasta: `${hoy.slice(0, 4)}-12-31` };
  return {};
};

// --- Ayudantes de DOM ----------------------------------------------------------
// h("div", { class: "x", text: "hola" }, hijo1, hijo2)
const h = (etiqueta, propiedades = {}, ...hijos) => {
  const el = document.createElement(etiqueta);
  Object.entries(propiedades).forEach(([clave, valor]) => {
    if (valor === null || valor === undefined || valor === false) return;
    if (clave === "class") el.className = valor;
    else if (clave === "text") el.textContent = valor;
    else el.setAttribute(clave, valor === true ? "" : valor);
  });
  hijos.flat(Infinity).forEach((hijo) => {
    if (hijo !== null && hijo !== undefined && hijo !== false) el.append(hijo);
  });
  return el;
};

const boton = (texto, clase = "btn-outline", extra = {}) =>
  h("button", { type: "button", class: `btn ${clase}`, text: texto, ...extra });

const crearSvg = (iconoSvg) => {
  const svg = new DOMParser().parseFromString(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + iconoSvg + "</svg>",
    "image/svg+xml",
  ).documentElement;
  return document.importNode(svg, true);
};

// Botón con ícono (y, si se indica, un texto corto). La etiqueta es el nombre para lectores de pantalla.
const botonIcono = (iconoSvg, etiqueta, extra = {}, texto = "", clase = "") => {
  const el = h("button", {
    type: "button",
    class: `btn btn-outline gastos-btn-chico gastos-btn-icono${texto ? " gastos-btn-icono-texto" : ""} ${clase}`.trim(),
    "aria-label": etiqueta,
    title: etiqueta,
    ...extra,
  });
  el.append(crearSvg(iconoSvg));
  if (texto) el.append(h("span", { text: texto }));
  return el;
};

const avisar = (texto) => {
  document.querySelectorAll(".gastos-toast").forEach((t) => t.remove());
  const aviso = h("div", { class: "gastos-toast", role: "status", text: texto });
  document.body.append(aviso);
  setTimeout(() => aviso.remove(), 2600);
};

const bannerAmbar = (texto) => h("div", { class: "gastos-banner gastos-banner-ambar", role: "status", text: texto });

const abrirModal = ({ titulo, chico = false, cuerpo, pie, alIntentarCerrar }) => {
  const cerrarBtn = h("button", { class: "gastos-modal-cerrar", type: "button", "aria-label": "Cerrar", text: "×" });
  const fondo = h(
    "div",
    { class: "gastos-modal-fondo", "data-testid": "modal" },
    h(
      "div",
      { class: "gastos-modal" + (chico ? " gastos-modal-chico" : ""), role: "dialog", "aria-modal": "true", "aria-label": titulo },
      h("div", { class: "gastos-modal-cabecera" }, h("h2", { text: titulo }), cerrarBtn),
      h("div", { class: "gastos-modal-cuerpo" }, cuerpo),
      h("div", { class: "gastos-modal-pie" }, pie),
    ),
  );
  const cerrar = () => {
    fondo.remove();
    document.removeEventListener("keydown", alTecla);
  };
  const intentarCerrar = () => (alIntentarCerrar ? alIntentarCerrar(cerrar) : cerrar());
  const alTecla = (e) => {
    const abiertos = document.querySelectorAll(".gastos-modal-fondo");
    if (e.key === "Escape" && abiertos[abiertos.length - 1] === fondo) intentarCerrar();
  };
  cerrarBtn.addEventListener("click", intentarCerrar);
  fondo.addEventListener("mousedown", (e) => {
    if (e.target === fondo) intentarCerrar();
  });
  document.addEventListener("keydown", alTecla);
  document.body.append(fondo);
  return { fondo, cerrar, intentarCerrar };
};

// Modal chico de confirmación.
const confirmar = ({ titulo, cuerpo, textoOk, claseOk = "btn-primario", textoCancelar = "Cancelar", alAceptar }) => {
  const cancelar = boton(textoCancelar, "btn-outline", { "data-testid": "modal-cancelar" });
  const aceptar = boton(textoOk, claseOk, { "data-testid": "modal-confirmar" });
  const modal = abrirModal({ titulo, chico: true, cuerpo, pie: [cancelar, aceptar] });
  cancelar.addEventListener("click", modal.cerrar);
  aceptar.addEventListener("click", () => {
    modal.cerrar();
    alAceptar();
  });
  aceptar.focus();
};

const preguntarDescarte = (alDescartar) =>
  confirmar({
    titulo: "Hay datos sin guardar",
    cuerpo: [h("p", { text: "Si cerrás ahora, se pierde lo que cargaste. ¿Querés descartarlo?" })],
    textoOk: "Descartar",
    textoCancelar: "Seguir editando",
    alAceptar: alDescartar,
  });

// Formulario de gasto en un modal. Los errores salen junto a cada campo, con los nombres de campo del contrato.
const CAMPOS_GASTO = [
  { nombre: "fecha", etiqueta: "Fecha", obligatorio: true, placeholder: "dd-mm-aaaa" },
  { nombre: "concepto", etiqueta: "Concepto", obligatorio: true, placeholder: "Ej.: alquiler, luz, internet, flete" },
  { nombre: "monto", etiqueta: "Monto", tipo: "number", obligatorio: true },
  { nombre: "medio_pago_id", etiqueta: "Medio de pago (opcional)", opciones: [{ valor: "", texto: "Sin medios de pago" }], ayuda: "Se activa cuando existan medios de pago." },
];

const abrirFormulario = ({ titulo, valores = {}, avisos, alGuardar }) => {
  const controles = {};
  const zonaAvisos = h("div");
  const filas = CAMPOS_GASTO.map((spec) => {
    const control = spec.opciones
      ? h("select", { id: spec.nombre, name: spec.nombre, class: "gastos-entrada", disabled: true }, spec.opciones.map((o) => h("option", { value: o.valor, text: o.texto })))
      : h("input", { id: spec.nombre, name: spec.nombre, type: spec.tipo || "text", step: spec.tipo === "number" ? "any" : null, placeholder: spec.placeholder, class: "gastos-entrada", autocomplete: "off" });
    if (!spec.opciones) control.value = valores[spec.nombre] ?? "";
    const error = h("p", { class: "gastos-error", id: `error-${spec.nombre}`, hidden: true });
    controles[spec.nombre] = { control, error };
    return h(
      "div",
      { class: "gastos-campo" },
      h("label", { for: spec.nombre, text: spec.etiqueta + (spec.obligatorio ? " *" : "") }),
      control,
      spec.ayuda && h("p", { class: "gastos-ayuda", text: spec.ayuda }),
      error,
    );
  });

  const leer = () => Object.fromEntries(CAMPOS_GASTO.map((c) => [c.nombre, controles[c.nombre].control.value]));
  const actualizarAvisos = () => zonaAvisos.replaceChildren(...(avisos ? avisos() : []));

  const cancelar = boton("Cancelar", "btn-outline", { "data-testid": "modal-cancelar" });
  const guardar = boton("Guardar", "btn-primario", { "data-testid": "modal-guardar" });
  let sinGuardar = false;
  let enviando = false;

  const modal = abrirModal({
    titulo,
    cuerpo: [zonaAvisos, filas],
    pie: [cancelar, guardar],
    alIntentarCerrar: (cerrar) => (sinGuardar ? preguntarDescarte(cerrar) : cerrar()),
  });
  cancelar.addEventListener("click", modal.intentarCerrar);

  const mostrarErrores = (errores) => {
    CAMPOS_GASTO.forEach(({ nombre }) => {
      const { control, error } = controles[nombre];
      const mensaje = errores[nombre];
      error.textContent = mensaje || "";
      error.hidden = !mensaje;
      control.classList.toggle("con-error", Boolean(mensaje));
    });
  };

  CAMPOS_GASTO.forEach(({ nombre }) => {
    const { control, error } = controles[nombre];
    control.addEventListener(control.tagName === "SELECT" ? "change" : "input", () => {
      sinGuardar = true;
      error.hidden = true;
      control.classList.remove("con-error");
      actualizarAvisos();
    });
  });

  guardar.addEventListener("click", async () => {
    if (enviando) return;
    const datos = leer();
    const errores = validarGasto(datos);
    mostrarErrores(errores);
    const primero = CAMPOS_GASTO.find((c) => errores[c.nombre]);
    if (primero) {
      controles[primero.nombre].control.focus();
      return;
    }
    // Se deshabilita el botón mientras "procesa", para que un doble clic no duplique el registro.
    enviando = true;
    guardar.disabled = true;
    guardar.textContent = "Guardando…";
    await new Promise((resolver) => setTimeout(resolver, 450));
    alGuardar(armarPayloadGasto(datos));
    sinGuardar = false;
    modal.cerrar();
  });

  actualizarAvisos();
  controles[CAMPOS_GASTO[0].nombre].control.focus();
};

// --- Pantalla ------------------------------------------------------------------
const iniciarPantalla = () => {
  const pagina = document.getElementById("gastos-pagina");
  const ctx = { q: "", ocultos: false, periodo: "todas" };
  const zonaTabla = h("div");

  const formularioGasto = (gasto) => {
    const esNuevo = !gasto;
    abrirFormulario({
      titulo: esNuevo ? "Nuevo gasto" : "Editar gasto",
      valores: gasto ? { fecha: fechaParaMostrar(gasto.fecha), concepto: gasto.concepto, monto: gasto.monto } : { fecha: fechaParaMostrar(fechaIsoDeHoy()) },
      avisos: () => (esNuevo ? [] : [bannerAmbar("Si cambiás la fecha o el monto, se recalcula el total del período.")]),
      alGuardar: (datos) => {
        if (esNuevo) servicio.crear(datos);
        else servicio.actualizar(gasto, datos);
        refrescar();
        avisar(esNuevo ? "Gasto registrado" : "Gasto actualizado");
      },
    });
  };

  const alternarOculto = (gasto) => {
    const aplicar = (oculto) => {
      servicio.cambiarOculto(gasto, oculto);
      refrescar();
      avisar(oculto ? `"${gasto.concepto}" ahora está oculto` : `"${gasto.concepto}" se restauró`);
    };
    if (gasto.oculto) return aplicar(false);
    confirmar({
      titulo: "Ocultar",
      cuerpo: [
        h("p", { text: `¿Ocultar "${gasto.concepto}"?` }),
        h("p", { class: "gastos-ayuda", text: "Deja de verse en el listado. Sus datos y su historial se conservan, y no se modifican los reportes." }),
      ],
      textoOk: "Ocultar",
      alAceptar: () => aplicar(true),
    });
  };

  const pedirEliminar = (gasto) =>
    confirmar({
      titulo: "Eliminar",
      cuerpo: [
        h("p", { text: `¿Eliminar "${gasto.concepto}" definitivamente?` }),
        bannerAmbar("Al eliminarlo, el total del período y la Ganancia Neta Operativa se recalculan."),
        h("p", { class: "gastos-ayuda", text: "Esta acción no se puede deshacer." }),
      ],
      textoOk: "Eliminar",
      claseOk: "btn-peligro",
      alAceptar: () => {
        servicio.eliminar(gasto);
        refrescar();
        avisar(`"${gasto.concepto}" se eliminó`);
      },
    });

  // Botones de cada fila. Llevan data-modulo y data-accion para que roles.js los oculte según el rol.
  const botonesFila = (gasto) => {
    const datos = (accion) => ({ "data-testid": `gastos-${accion}-${gasto.id}`, "data-modulo": MODULO, "data-accion": accion, "data-id": gasto.id });
    // Lista normal: Editar y Ocultar. Eliminar definitivamente solo se puede desde "Ver ocultos",
    // donde quedan Restaurar (con texto) y Eliminar.
    if (gasto.oculto) {
      return h(
        "div",
        { class: "gastos-acciones-fila" },
        botonIcono(ICONO_RESTAURAR, "Restaurar", datos("ocultar"), "Restaurar"),
        botonIcono(ICONO_ELIMINAR, "Eliminar", datos("eliminar"), "", "gastos-btn-eliminar"),
      );
    }
    return h("div", { class: "gastos-acciones-fila" }, botonIcono(ICONO_EDITAR, "Editar", datos("editar")), botonIcono(ICONO_OCULTAR, "Ocultar", datos("ocultar")));
  };

  const sinDato = () => h("span", { class: "gastos-sin-dato", text: "—" });
  const COLUMNAS = [{ titulo: "Fecha" }, { titulo: "Concepto" }, { titulo: "Monto", clase: "num" }, { titulo: "Medio de pago" }, { titulo: "Creado por" }, { titulo: "Acciones", clase: "acciones-columna" }];

  const filaDeGasto = (gasto) => {
    const celdas = [fechaParaMostrar(gasto.fecha), gasto.concepto, formatearDinero(gasto.monto), gasto.medio_pago_nombre || sinDato(), gasto.creado_por_nombre, botonesFila(gasto)];
    return h("tr", {}, celdas.map((celda, i) => h("td", { class: COLUMNAS[i].clase }, celda)));
  };

  const refrescar = () => {
    const items = servicio.listar({ q: ctx.q, ocultos: ctx.ocultos, ...rangoDePeriodo(ctx.periodo) });
    const hayFiltros = ctx.q.trim() || ctx.periodo !== "todas";
    const textoVacio = ctx.ocultos ? "Sin elementos ocultos" : hayFiltros ? "Sin resultados" : "Sin gastos";
    zonaTabla.replaceChildren(
      h(
        "div",
        { class: "gastos-tarjeta" },
        items.length === 0
          ? h("div", { class: "gastos-vacio", "data-testid": "gastos-tabla-vacio", text: textoVacio })
          : h(
              "div",
              { class: "gastos-tabla-contenedor" },
              h(
                "table",
                { class: "gastos-tabla", "data-testid": "gastos-tabla" },
                h("thead", {}, h("tr", {}, COLUMNAS.map((c) => h("th", { class: c.clase, text: c.titulo })))),
                h("tbody", {}, items.map(filaDeGasto)),
              ),
            ),
      ),
    );
  };

  zonaTabla.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-accion]");
    const gasto = b && gastos.find((g) => g.id === Number(b.dataset.id));
    if (!gasto) return;
    const acciones = {
      editar: () => formularioGasto(gasto),
      ocultar: () => alternarOculto(gasto),
      eliminar: () => pedirEliminar(gasto),
    };
    acciones[b.dataset.accion]?.();
  });

  // Selector de período a la izquierda y "+ Nuevo gasto" a la derecha.
  const selectorPeriodo = h(
    "select",
    { class: "gastos-entrada gastos-select-fecha", "data-testid": "gastos-filtro-fecha", "aria-label": "Período" },
    OPCIONES_PERIODO.map((o) => h("option", { value: o.valor, text: o.texto })),
  );
  selectorPeriodo.addEventListener("change", () => {
    ctx.periodo = selectorPeriodo.value;
    refrescar();
  });

  const botonNuevo = boton("", "btn-primario gastos-btn-con-icono", { "data-testid": "gastos-nuevo", "data-modulo": MODULO, "data-accion": "crear" });
  botonNuevo.append(crearSvg(ICONO_MAS), h("span", { text: "Nuevo gasto" }));
  botonNuevo.addEventListener("click", () => formularioGasto(null));

  const buscador = h("input", { type: "search", class: "gastos-entrada gastos-buscador", placeholder: "Buscar por concepto…", "data-testid": "gastos-buscador", "aria-label": "Buscar" });
  buscador.addEventListener("input", () => {
    ctx.q = buscador.value;
    refrescar();
  });

  const chipOcultos = h("button", { type: "button", class: "gastos-chip", text: "Ver ocultos", "data-testid": "gastos-ver-ocultos", "data-modulo": MODULO, "data-accion": "ocultar" });
  chipOcultos.addEventListener("click", () => {
    ctx.ocultos = !ctx.ocultos;
    chipOcultos.classList.toggle("activo", ctx.ocultos);
    refrescar();
  });

  pagina.replaceChildren(
    h("div", { class: "gastos-encabezado" }, h("h1", { text: "Gastos operativos" })),
    h("div", { class: "gastos-acciones" }, h("div", { class: "gastos-selector" }, crearSvg(ICONO_CALENDARIO), selectorPeriodo), botonNuevo),
    h("div", { class: "gastos-barra" }, buscador, chipOcultos),
    zonaTabla,
  );
  refrescar();
};

iniciarPantalla();
