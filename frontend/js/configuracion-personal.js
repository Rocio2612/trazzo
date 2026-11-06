// --- PESTAÑA "PERSONAL" DE CONFIGURACIÓN (módulo ES) ---
// Tabla del personal con buscador, alta y edición en un modal, y botones habilitar, deshabilitar y eliminar
// con confirmación. Qué botones aparecen lo decide personalizacion.js según quién mira (Propietario,
// Administrador) y a quién (a uno mismo, al Propietario, a otro administrador o a un empleado).
// El Backend valida lo mismo: ocultar botones no protege nada.

import { abrirFormularioModal, avisar, bannerAmbar, boton, botonIcono, confirmar, crearSvg, h, ICONOS } from "./componentes/ui-panel.js";
import {
  armarPayloadPersona,
  buscarPersonal,
  ETIQUETA_ROL,
  MOTIVO_ULTIMO_ADMIN,
  puedeDeshabilitarPersona,
  puedeEditarPersona,
  puedeEliminarPersona,
  puedeHabilitarPersona,
  ROLES,
  validarPersona,
} from "./personalizacion.js";
import { servicioPersonal } from "./mocks/personalizacion.js";
import { obtenerSesion } from "./sesion.js";

const MODULO = "personal";

const COLUMNAS = [
  { titulo: "Nombre" },
  { titulo: "Usuario" },
  { titulo: "Correo" },
  { titulo: "Rol" },
  { titulo: "Estado" },
  { titulo: "Acciones", clase: "acciones-columna" },
];

const CAMPOS = (esNuevo) => [
  { nombre: "nombre", etiqueta: "Nombre", obligatorio: true, maxlength: 50 },
  { nombre: "apellido", etiqueta: "Apellido", obligatorio: true, maxlength: 50 },
  { nombre: "correo", etiqueta: "Correo", tipo: "email", obligatorio: true, autocomplete: "off", ayuda: "Se usa para recuperar la contraseña." },
  { nombre: "dni", etiqueta: "DNI (opcional)", maxlength: 8, placeholder: "Sin puntos" },
  { nombre: "usuario", etiqueta: "Usuario", obligatorio: true, maxlength: 20, ayuda: "4 a 20 caracteres: minúsculas y números." },
  {
    nombre: "password",
    etiqueta: "Contraseña",
    tipo: "password",
    obligatorio: esNuevo,
    maxlength: 64,
    autocomplete: "new-password",
    ayuda: esNuevo
      ? "8 a 64 caracteres, con mayúscula, minúscula, número y símbolo."
      : "Dejala vacía para no cambiarla.",
  },
  {
    nombre: "rol",
    etiqueta: "Rol",
    obligatorio: true,
    opciones: [
      { valor: ROLES.CAJERO, texto: ETIQUETA_ROL.CAJERO },
      { valor: ROLES.ADMIN, texto: ETIQUETA_ROL.ADMIN },
    ],
  },
];

export const crearPanelPersonal = () => {
  const actor = obtenerSesion();
  const ctx = { q: "", personal: [] };
  const zonaTabla = h("div");

  const cargar = async () => {
    ctx.personal = await servicioPersonal.listar();
    refrescar();
  };

  // --- Alta y edición ---
  const formulario = (persona) => {
    const esNuevo = !persona;
    abrirFormularioModal({
      titulo: esNuevo ? "Nuevo usuario" : "Editar usuario",
      campos: CAMPOS(esNuevo),
      valores: persona ? { ...persona, dni: persona.dni ?? "", password: "" } : { rol: ROLES.CAJERO },
      validar: (datos) => validarPersona(datos, { esNuevo }),
      alGuardar: async (datos) => {
        const payload = armarPayloadPersona(datos, { esNuevo });
        if (esNuevo) await servicioPersonal.crear(payload);
        else await servicioPersonal.actualizar(persona.id, payload);
        await cargar();
        avisar(esNuevo ? "Usuario creado" : "Usuario actualizado");
      },
    });
  };

  // --- Habilitar, deshabilitar y eliminar ---
  const nombreCompleto = (p) => `${p.nombre} ${p.apellido}`;

  const pedirHabilitar = (p) =>
    confirmar({
      titulo: "Habilitar usuario",
      cuerpo: [h("p", { text: `¿Habilitar a ${nombreCompleto(p)}? Podrá iniciar sesión con sus credenciales.` })],
      textoOk: "Habilitar",
      alAceptar: async () => {
        await servicioPersonal.habilitar(p.id);
        await cargar();
        avisar(`${nombreCompleto(p)} fue habilitado`);
      },
    });

  const pedirDeshabilitar = (p) =>
    confirmar({
      titulo: "Deshabilitar usuario",
      cuerpo: [
        h("p", { text: `¿Deshabilitar a ${nombreCompleto(p)}?` }),
        bannerAmbar("Se sigue viendo en la lista, pero no podrá iniciar sesión y se cierran sus sesiones activas."),
      ],
      textoOk: "Deshabilitar",
      alAceptar: async () => {
        await servicioPersonal.deshabilitar(p.id);
        await cargar();
        avisar(`${nombreCompleto(p)} fue deshabilitado`);
      },
    });

  const pedirEliminar = (p) =>
    confirmar({
      titulo: "Eliminar usuario",
      cuerpo: [
        h("p", { text: `¿Eliminar a ${nombreCompleto(p)} definitivamente?` }),
        bannerAmbar("Se borran su usuario y su contraseña: no podrá volver a iniciar sesión y se cierran sus sesiones activas. Su nombre se conserva en el historial."),
        h("p", { class: "gastos-ayuda", text: "Esta acción no se puede deshacer." }),
      ],
      textoOk: "Eliminar",
      claseOk: "btn-peligro",
      alAceptar: async () => {
        await servicioPersonal.eliminar(p.id);
        await cargar();
        avisar(`${nombreCompleto(p)} fue eliminado`);
      },
    });

  // --- Tabla ---
  const insignia = (texto, clase) => h("span", { class: `cfg-insignia ${clase}`, text: texto });

  // Un botón que no corresponde se oculta. Si solo falta que quede otro administrador activo, se muestra
  // deshabilitado con la razón, para que se entienda por qué no se puede.
  const botonSegunRegla = (regla, icono, etiqueta, accion, p, clase = "") => {
    if (regla.permitido) {
      return botonIcono(icono, etiqueta, { "data-testid": `personal-${accion}-${p.id}`, "data-modulo": MODULO, "data-accion": accion, "data-id": p.id }, clase);
    }
    if (regla.motivo !== MOTIVO_ULTIMO_ADMIN) return null;
    const bloqueado = botonIcono(icono, `${etiqueta}: ${regla.motivo}`, { disabled: true, "data-testid": `personal-${accion}-${p.id}` }, clase);
    return bloqueado;
  };

  const botonesFila = (p) => {
    const editar = puedeEditarPersona(actor, p);
    return h(
      "div",
      { class: "gastos-acciones-fila" },
      editar.permitido && botonIcono(ICONOS.editar, "Editar", { "data-testid": `personal-editar-${p.id}`, "data-modulo": MODULO, "data-accion": "editar", "data-id": p.id }),
      botonSegunRegla(puedeHabilitarPersona(actor, p), ICONOS.habilitar, "Habilitar", "habilitar", p),
      botonSegunRegla(puedeDeshabilitarPersona(actor, p, ctx.personal), ICONOS.deshabilitar, "Deshabilitar", "deshabilitar", p),
      botonSegunRegla(puedeEliminarPersona(actor, p, ctx.personal), ICONOS.eliminar, "Eliminar", "eliminar", p, "gastos-btn-eliminar"),
    );
  };

  const filaDePersona = (p) => {
    const esUno = p.id === actor.id;
    const celdas = [
      h("span", {}, nombreCompleto(p), esUno && h("span", { class: "cfg-vos", text: " (vos)" })),
      p.usuario,
      p.correo,
      insignia(ETIQUETA_ROL[p.rol] || p.rol, p.rol === ROLES.PROPIETARIO ? "cfg-insignia-propietario" : ""),
      p.activo ? insignia("Habilitado", "cfg-insignia-ok") : insignia("Deshabilitado", "cfg-insignia-off"),
      botonesFila(p),
    ];
    return h("tr", { "data-testid": `personal-fila-${p.id}` }, celdas.map((celda, i) => h("td", { class: COLUMNAS[i].clase }, celda)));
  };

  const refrescar = () => {
    const items = buscarPersonal(ctx.personal, ctx.q);
    zonaTabla.replaceChildren(
      h(
        "div",
        { class: "gastos-tarjeta" },
        items.length === 0
          ? h("div", { class: "gastos-vacio", "data-testid": "personal-vacio", text: ctx.q.trim() ? "Sin resultados" : "Todavía no hay usuarios" })
          : h(
              "div",
              { class: "gastos-tabla-contenedor cfg-tabla-contenedor" },
              h(
                "table",
                { class: "gastos-tabla", "data-testid": "personal-tabla" },
                h("thead", {}, h("tr", {}, COLUMNAS.map((c) => h("th", { class: c.clase, text: c.titulo })))),
                h("tbody", {}, items.map(filaDePersona)),
              ),
            ),
      ),
    );
  };

  zonaTabla.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-accion]");
    const persona = b && ctx.personal.find((p) => p.id === Number(b.dataset.id));
    if (!persona) return;
    const acciones = {
      editar: () => formulario(persona),
      habilitar: () => pedirHabilitar(persona),
      deshabilitar: () => pedirDeshabilitar(persona),
      eliminar: () => pedirEliminar(persona),
    };
    acciones[b.dataset.accion]?.();
  });

  // --- Barra superior: buscador y "Nuevo usuario" ---
  const buscador = h("input", { type: "search", class: "gastos-entrada gastos-buscador-entrada", placeholder: "Buscar por nombre, usuario o correo…", "data-testid": "personal-buscador", "aria-label": "Buscar" });
  buscador.addEventListener("input", () => {
    ctx.q = buscador.value;
    refrescar();
  });

  const botonNuevo = boton("", "btn-primario gastos-btn-con-icono", { "data-testid": "personal-nuevo", "data-modulo": MODULO, "data-accion": "crear" });
  botonNuevo.append(crearSvg(ICONOS.mas), h("span", { text: "Nuevo usuario" }));
  botonNuevo.addEventListener("click", () => formulario(null));

  const panel = h("section", { id: "panel-personal", "data-modulo": MODULO }, h("div", { class: "gastos-barra" }, h("div", { class: "gastos-buscador" }, crearSvg(ICONOS.lupa), buscador), botonNuevo), zonaTabla);
  return { panel, cargar };
};
