// --- COMPONENTES DE PANTALLA PARA LAS SECCIONES DE ADMINISTRACIÓN (módulo ES) ---
// Ayudantes de DOM, modales, confirmaciones, avisos y formularios con error por campo.
// Usan las clases "gastos-*" de css/gastos.css (el mismo aspecto que Gastos operativos),
// así que la página que los use debe cargar css/gastos.css y css/configuracion.css.
// Todo se arma con textContent: nunca se pone texto del usuario con innerHTML.

// Íconos de trazo (24x24). Son textos fijos del código, nunca datos del usuario.
export const ICONOS = {
  editar: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/>',
  eliminar:
    '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>',
  mas: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  habilitar: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
  deshabilitar: '<circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>',
  lupa: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  candado:
    '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
};

// h("div", { class: "x", text: "hola" }, hijo1, hijo2)
export const h = (etiqueta, propiedades = {}, ...hijos) => {
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

export const boton = (texto, clase = "btn-outline", extra = {}) =>
  h("button", { type: "button", class: `btn ${clase}`, text: texto, ...extra });

export const crearSvg = (iconoSvg) => {
  const svg = new DOMParser().parseFromString(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      iconoSvg +
      "</svg>",
    "image/svg+xml",
  ).documentElement;
  return document.importNode(svg, true);
};

// Botón con ícono. La etiqueta es el nombre para lectores de pantalla y el texto al pasar el mouse.
export const botonIcono = (iconoSvg, etiqueta, extra = {}, clase = "") => {
  const el = h("button", {
    type: "button",
    class: `btn btn-outline gastos-btn-chico gastos-btn-icono ${clase}`.trim(),
    "aria-label": etiqueta,
    title: etiqueta,
    ...extra,
  });
  el.append(crearSvg(iconoSvg));
  return el;
};

export const avisar = (texto) => {
  document.querySelectorAll(".gastos-toast").forEach((t) => t.remove());
  const aviso = h("div", { class: "gastos-toast", role: "status", text: texto });
  document.body.append(aviso);
  setTimeout(() => aviso.remove(), 2800);
};

export const bannerAmbar = (texto) => h("div", { class: "gastos-banner gastos-banner-ambar", role: "status", text: texto });

// --- Modales ---------------------------------------------------------------------

export const abrirModal = ({ titulo, chico = false, cuerpo, pie, alIntentarCerrar }) => {
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

// Modal chico de confirmación. `cuerpo` es una lista de nodos.
export const confirmar = ({ titulo, cuerpo, textoOk, claseOk = "btn-primario", textoCancelar = "Cancelar", alAceptar }) => {
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

// --- Formularios -----------------------------------------------------------------

// Un campo con su etiqueta y su lugar para el error.
// spec: { nombre, etiqueta, tipo ("textarea" para texto largo), opciones: [{ valor, texto }], obligatorio, placeholder,
//         ayuda, autocomplete, solo_lectura, maxlength, grupo (los campos seguidos con el mismo grupo van en una fila) }
export const crearCampo = (spec, valor = "") => {
  const id = spec.id || spec.nombre;
  const control = spec.opciones
    ? h("select", { id, name: spec.nombre, class: "gastos-entrada" }, spec.opciones.map((o) => h("option", { value: o.valor, text: o.texto })))
    : spec.tipo === "textarea"
      ? h("textarea", { id, name: spec.nombre, rows: spec.filas || 3, placeholder: spec.placeholder, class: "gastos-entrada gastos-textarea", maxlength: spec.maxlength })
      : h("input", {
        id,
        name: spec.nombre,
        type: spec.tipo || "text",
        placeholder: spec.placeholder,
        class: "gastos-entrada",
        autocomplete: spec.autocomplete || "off",
        readonly: spec.solo_lectura,
        maxlength: spec.maxlength,
      });
  control.value = valor ?? "";
  const error = h("p", { class: "gastos-error", id: `error-${spec.nombre}`, hidden: true });
  const fila = h(
    "div",
    { class: "gastos-campo" },
    h("label", { for: id, text: spec.etiqueta + (spec.obligatorio ? " *" : "") }),
    control,
    spec.ayuda && h("p", { class: "gastos-ayuda", text: spec.ayuda }),
    error,
  );
  const mostrarError = (mensaje) => {
    error.textContent = mensaje || "";
    error.hidden = !mensaje;
    control.classList.toggle("con-error", Boolean(mensaje));
  };
  return { fila, control, mostrarError };
};

// Los campos seguidos con el mismo `grupo` se muestran juntos en una fila (por ejemplo, tipo y número de documento).
const agruparCampos = (campos, partes) => {
  const resultado = [];
  campos.forEach((c, i) => {
    const fila = partes[c.nombre].fila;
    if (c.grupo && campos[i - 1]?.grupo === c.grupo) resultado[resultado.length - 1].push(fila);
    else resultado.push(c.grupo ? [fila] : fila);
  });
  return resultado.map((item) => (Array.isArray(item) ? h("div", { class: "cfg-fila-doble" }, item) : item));
};

// Modal con un formulario. `validar(datos)` devuelve { campo: mensaje } y `alGuardar(datos)` puede ser
// asíncrona: si lanza un error con `errores` ({ campo: mensaje }) los muestra junto a cada campo; si lanza
// otro error, lo avisa. Mientras guarda, el botón queda deshabilitado (un doble clic no duplica el registro).
export const abrirFormularioModal = ({ titulo, campos, valores = {}, avisos, validar, alGuardar, textoGuardar = "Guardar" }) => {
  const zonaAvisos = h("div");
  const partes = Object.fromEntries(campos.map((spec) => [spec.nombre, crearCampo(spec, valores[spec.nombre])]));
  const leer = () => Object.fromEntries(campos.map((c) => [c.nombre, partes[c.nombre].control.value]));
  const actualizarAvisos = () => zonaAvisos.replaceChildren(...(avisos ? avisos(leer()) : []));

  const cancelar = boton("Cancelar", "btn-outline", { "data-testid": "modal-cancelar" });
  const guardar = boton(textoGuardar, "btn-primario", { "data-testid": "modal-guardar" });
  let enviando = false;

  const modal = abrirModal({
    titulo,
    cuerpo: [zonaAvisos, agruparCampos(campos, partes)],
    pie: [cancelar, guardar],
  });
  cancelar.addEventListener("click", modal.intentarCerrar);

  const mostrarErrores = (errores) => campos.forEach(({ nombre }) => partes[nombre].mostrarError(errores[nombre]));

  campos.forEach(({ nombre }) => {
    const { control, mostrarError } = partes[nombre];
    control.addEventListener(control.tagName === "SELECT" ? "change" : "input", () => {
      mostrarError("");
      actualizarAvisos();
    });
  });

  guardar.addEventListener("click", async () => {
    if (enviando) return;
    const datos = leer();
    const errores = validar ? validar(datos) : {};
    mostrarErrores(errores);
    const primero = campos.find((c) => errores[c.nombre]);
    if (primero) {
      partes[primero.nombre].control.focus();
      return;
    }
    enviando = true;
    guardar.disabled = true;
    guardar.textContent = "Guardando…";
    try {
      await alGuardar(datos);
      modal.cerrar();
    } catch (error) {
      enviando = false;
      guardar.disabled = false;
      guardar.textContent = textoGuardar;
      if (error.errores) mostrarErrores(error.errores);
      else if (error.campo && partes[error.campo]) partes[error.campo].mostrarError(error.message);
      else avisar(error.message || "No se pudo guardar. Intentá de nuevo.");
    }
  });

  actualizarAvisos();
  partes[campos[0].nombre].control.focus();
  return modal;
};
