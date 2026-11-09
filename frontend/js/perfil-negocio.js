// --- PANTALLA "MI NEGOCIO" (módulo ES) ---
// Muestra y permite editar el nombre o razón social, el rubro y la categoría impositiva del negocio.
// El identificador se ve pero no se puede editar. La lógica (validación, payload) está en personalizacion.js
// y los datos vienen de mocks/personalizacion.js hasta que Back publique PUT /negocio.

import { avisar, bannerAmbar, boton, confirmar, crearCampo, h, ICONOS, crearSvg } from "./componentes/ui-panel.js";
import { armarPayloadNegocio, CATEGORIAS_IMPOSITIVAS, RUBROS, validarNegocio } from "./personalizacion.js";
import { servicioNegocio } from "./mocks/personalizacion.js";

const MODULO = "negocio";
const OTRO = "__otro";

const textoDeCategoria = (valor) => CATEGORIAS_IMPOSITIVAS.find((c) => c.valor === valor)?.texto ?? valor;

const iniciarPantalla = async () => {
  // Solo el Admin entra (el Backend también lo valida).
  if (!puedeHacer(MODULO, "ver")) {
    window.location.href = "dashboard.html";
    return;
  }

  const pagina = document.getElementById("perfil-pagina");
  let guardado = await servicioNegocio.obtener();

  const rubroEsLista = (rubro) => !rubro || RUBROS.includes(rubro);

  // --- Campos ---
  const identificador = crearCampo(
    { nombre: "identificador", etiqueta: "Identificador del negocio", solo_lectura: true, ayuda: "Es único y no se puede cambiar." },
    guardado.identificador,
  );
  identificador.control.classList.add("cfg-solo-lectura");

  const nombre = crearCampo(
    { nombre: "nombre", etiqueta: "Nombre o razón social", obligatorio: true, maxlength: 100 },
    guardado.nombre,
  );

  const rubro = crearCampo(
    {
      nombre: "rubro",
      etiqueta: "Rubro",
      opciones: [
        { valor: "", texto: "Sin especificar" },
        ...RUBROS.map((r) => ({ valor: r, texto: r })),
        { valor: OTRO, texto: "Otro (escribirlo)" },
      ],
    },
    rubroEsLista(guardado.rubro) ? guardado.rubro || "" : OTRO,
  );
  const rubroOtro = crearCampo(
    { id: "rubro_otro", nombre: "rubro_otro", etiqueta: "Escribí tu rubro", maxlength: 50 },
    rubroEsLista(guardado.rubro) ? "" : guardado.rubro,
  );

  const categoria = crearCampo(
    {
      nombre: "categoria_impositiva",
      etiqueta: "Categoría impositiva",
      obligatorio: true,
      opciones: [{ valor: "", texto: "Elegir…" }, ...CATEGORIAS_IMPOSITIVAS],
    },
    guardado.categoria_impositiva,
  );

  const avisoCategoria = h("div", { "data-testid": "negocio-aviso-categoria" });
  const guardarBtn = boton("Guardar cambios", "btn-primario", { "data-testid": "negocio-guardar" });

  const leer = () => ({
    nombre: nombre.control.value,
    rubro: rubro.control.value === OTRO ? rubroOtro.control.value : rubro.control.value,
    categoria_impositiva: categoria.control.value,
  });

  const cambioCategoria = () => categoria.control.value !== guardado.categoria_impositiva;

  const actualizarVista = () => {
    rubroOtro.fila.hidden = rubro.control.value !== OTRO;
    avisoCategoria.replaceChildren(
      bannerAmbar(
        cambioCategoria()
          ? "Vas a cambiar la categoría impositiva. El cambio solo afecta las operaciones futuras, no las ya confirmadas."
          : "Si cambiás la categoría impositiva, el cambio solo afecta las operaciones futuras, no las ya confirmadas.",
      ),
    );
  };

  [nombre, rubro, rubroOtro, categoria].forEach(({ control, mostrarError }) =>
    control.addEventListener(control.tagName === "SELECT" ? "change" : "input", () => {
      mostrarError("");
      // Al cambiar de rubro, un error viejo del campo "Escribí tu rubro" no debe quedar esperando.
      if (control === rubro.control) rubroOtro.mostrarError("");
      actualizarVista();
    }),
  );

  // Enter en un campo de texto guarda, igual que el botón (los desplegables lo usan para abrirse).
  [nombre, rubroOtro].forEach(({ control }) =>
    control.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || e.isComposing) return;
      e.preventDefault();
      guardarBtn.click();
    }),
  );

  // --- Guardar ---
  let enviando = false;

  // Muestra los errores junto a cada campo y lleva el foco al primero. Devuelve true si no hay ninguno.
  const validarFormulario = () => {
    const errores = validarNegocio(leer());
    const esOtro = rubro.control.value === OTRO;
    // "Otro (escribirlo)" sin escribir nada no es un rubro: se pide completarlo o elegir uno de la lista.
    const errorRubro = errores.rubro || (esOtro && rubroOtro.control.value.trim() === "" ? "Escribí el rubro o elegí uno de la lista." : "");
    nombre.mostrarError(errores.nombre);
    rubro.mostrarError(esOtro ? "" : errorRubro);
    rubroOtro.mostrarError(esOtro ? errorRubro : "");
    categoria.mostrarError(errores.categoria_impositiva);
    const primero = [
      [errores.nombre, nombre],
      [errorRubro, esOtro ? rubroOtro : rubro],
      [errores.categoria_impositiva, categoria],
    ].find(([mensaje]) => mensaje);
    primero?.[1].control.focus();
    return !primero;
  };

  // Errores que devuelve el Backend: cada uno junto a su campo; los de campos que no están en pantalla, como aviso.
  const mostrarErroresDelServidor = (errores) => {
    nombre.mostrarError(errores.nombre);
    (rubro.control.value === OTRO ? rubroOtro : rubro).mostrarError(errores.rubro);
    categoria.mostrarError(errores.categoria_impositiva);
    const camposEnPantalla = ["nombre", "rubro", "categoria_impositiva"];
    const otros = Object.entries(errores).filter(([campo, mensaje]) => mensaje && !camposEnPantalla.includes(campo));
    if (otros.length > 0) avisar(otros[0][1]);
  };

  const guardar = async () => {
    if (enviando) return;
    const datos = leer();

    enviando = true;
    guardarBtn.disabled = true;
    guardarBtn.textContent = "Guardando…";
    try {
      guardado = await servicioNegocio.guardar(armarPayloadNegocio(datos));
      // Los campos muestran lo que realmente quedó guardado (sin los espacios de los costados).
      nombre.control.value = guardado.nombre;
      if (rubro.control.value === OTRO) rubroOtro.control.value = guardado.rubro ?? "";
      avisar("Datos del negocio actualizados");
    } catch (error) {
      if (error.errores) mostrarErroresDelServidor(error.errores);
      else avisar(error.message || "No se pudo guardar. Intentá de nuevo.");
    } finally {
      enviando = false;
      guardarBtn.disabled = false;
      guardarBtn.textContent = "Guardar cambios";
      actualizarVista();
    }
  };

  guardarBtn.addEventListener("click", () => {
    if (enviando) return;
    // Primero se valida: no tiene sentido pedir confirmación de un cambio que no se puede guardar.
    if (!validarFormulario()) return;
    if (!cambioCategoria()) return guardar();
    // Cambiar la categoría impositiva es una decisión importante: se pide confirmación.
    confirmar({
      titulo: "Cambiar la categoría impositiva",
      cuerpo: [
        h("p", { text: `Pasás de ${textoDeCategoria(guardado.categoria_impositiva)} a ${textoDeCategoria(categoria.control.value)}.` }),
        bannerAmbar("El cambio solo afecta las operaciones futuras, no las ya confirmadas."),
      ],
      textoOk: "Confirmar cambio",
      alAceptar: guardar,
    });
  });

  const candado = h("span", { class: "cfg-candado" });
  candado.append(crearSvg(ICONOS.candado));
  identificador.fila.querySelector("label").append(" ", candado);

  // El título queda a la izquierda; la tarjeta va centrada en el espacio disponible, así que se recentra cuando el menú se abre o se cierra.
  pagina.replaceChildren(
    h("div", { class: "gastos-encabezado" }, h("h1", { text: "Mi negocio" })),
    h(
      "div",
      { class: "gastos-tarjeta cfg-tarjeta cfg-centrado" },
      identificador.fila,
      nombre.fila,
      rubro.fila,
      rubroOtro.fila,
      categoria.fila,
      avisoCategoria,
      h("div", { class: "cfg-acciones-form" }, guardarBtn),
    ),
  );
  actualizarVista();
};

iniciarPantalla();
