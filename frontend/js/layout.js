// --- ESTRUCTURA COMÚN: BARRA LATERAL + ENCABEZADO ---
// Requiere config.js, api.js y roles.js cargados antes. Se incluye al final del <body>.
// Para agregar un módulo: ponerlo en MENU y, cuando su pantalla exista, marcar disponible: true.

// Íconos de trazo (24x24). Son texto fijo del código, nunca datos de usuario.
const ICONOS = {
  panel:
    '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
  ventas:
    '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>',
  cuentas_corrientes:
    '<rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/>',
  clientes:
    '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  productos:
    '<line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>',
  proveedores:
    '<rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>',
  insumos:
    '<path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/>',
  bienes_uso:
    '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  gastos:
    '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  reportes:
    '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
  campana:
    '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
  panel_lateral:
    '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/>',
};

const MENU = [
  {
    grupo: "Ventas",
    items: [
      { modulo: "ventas", etiqueta: "Ventas", href: "ventas.html", disponible: true },
      { modulo: "cuentas_corrientes", etiqueta: "Cuenta Corriente", href: "cuenta-corriente.html", disponible: true },
      { modulo: "clientes", etiqueta: "Clientes", href: "clientes.html", disponible: true },
    ],
  },
  {
    grupo: "Productos",
    items: [
      { modulo: "productos", etiqueta: "Productos", href: "productos.html", disponible: true },
      { modulo: "proveedores", etiqueta: "Proveedores", href: "proveedores.html", disponible: true },
    ],
  },
  {
    grupo: "Finanzas",
    items: [
      { modulo: "insumos", etiqueta: "Insumos", href: "insumos.html", disponible: true },
      { modulo: "bienes_uso", etiqueta: "Bienes de Uso", href: "bienes-uso.html", disponible: true },
      { modulo: "gastos", etiqueta: "Gastos", href: "gastos.html", disponible: true },
      { modulo: "reportes", etiqueta: "Reportes", href: "reportes.html", disponible: true },
    ],
  },
];

const CLAVE_MENU_CONTRAIDO = "trazzo_menu_contraido";

const crear = (etiqueta, clase, texto) => {
  const el = document.createElement(etiqueta);
  if (clase) el.className = clase;
  if (texto) el.textContent = texto;
  return el;
};

const crearIcono = (nombre) => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    ICONOS[nombre] +
    "</svg>";
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  return document.importNode(doc.documentElement, true);
};

// Enlace del menú: ícono + texto. Con el menú contraído solo se ve el ícono.
const crearEnlace = (icono, etiqueta) => {
  const enlace = crear("a", "sidebar-link");
  enlace.append(crearIcono(icono), crear("span", "sidebar-texto", etiqueta));
  enlace.setAttribute("aria-label", etiqueta);
  enlace.title = etiqueta;
  return enlace;
};

const menuContraido = () => {
  try {
    return localStorage.getItem(CLAVE_MENU_CONTRAIDO) === "1";
  } catch (error) {
    return false;
  }
};

const guardarMenuContraido = (contraido) => {
  try {
    localStorage.setItem(CLAVE_MENU_CONTRAIDO, contraido ? "1" : "0");
  } catch (error) {
    // Sin almacenamiento: el menú funciona igual, solo no recuerda el estado.
  }
};

// Solo se dibujan los módulos que el rol puede ver. Es solo UX: el Backend es quien protege.
const crearBarraLateral = (estructura) => {
  const barra = crear("aside", "sidebar");
  barra.dataset.testid = "sidebar";

  // Arriba: nombre y botón con ícono para contraer o expandir el menú.
  const marca = crear("div", "sidebar-marca");
  const contraer = crear("button", "sidebar-toggle");
  contraer.type = "button";
  contraer.dataset.testid = "btn-contraer-menu";
  contraer.appendChild(crearIcono("panel_lateral"));
  const actualizarToggle = () => {
    const contraido = estructura.classList.contains("sidebar-contraida");
    contraer.setAttribute("aria-expanded", String(!contraido));
    contraer.setAttribute("aria-label", contraido ? "Expandir menú" : "Contraer menú");
    contraer.title = contraido ? "Expandir menú" : "Contraer menú";
  };
  contraer.addEventListener("click", () => {
    const contraido = estructura.classList.toggle("sidebar-contraida");
    guardarMenuContraido(contraido);
    actualizarToggle();
  });
  actualizarToggle();
  marca.append(crear("span", "marca-completa", "Trazzo"), contraer);
  barra.appendChild(marca);

  const nav = crear("nav", "sidebar-nav");
  const pagina = window.location.pathname.split("/").pop() || "dashboard.html";

  const panel = crearEnlace("panel", "Panel");
  panel.href = "dashboard.html";
  panel.dataset.testid = "menu-panel";
  if (pagina === "dashboard.html") panel.setAttribute("aria-current", "page");
  nav.appendChild(panel);

  MENU.forEach(({ grupo, items }) => {
    const permitidos = items.filter((item) => puedeHacer(item.modulo, "ver"));
    if (permitidos.length === 0) return;

    nav.appendChild(crear("div", "sidebar-grupo-titulo", grupo));
    permitidos.forEach((item) => {
      const enlace = crearEnlace(item.modulo, item.etiqueta);
      enlace.dataset.modulo = item.modulo;
      enlace.dataset.testid = `menu-${item.modulo}`;
      if (item.disponible) {
        enlace.href = item.href;
        if (pagina === item.href) enlace.setAttribute("aria-current", "page");
      } else {
        enlace.classList.add("deshabilitado");
        enlace.title = `${item.etiqueta} (próximamente)`;
        enlace.setAttribute("aria-disabled", "true");
      }
      nav.appendChild(enlace);
    });
  });
  barra.appendChild(nav);

  return barra;
};

const crearEncabezado = () => {
  const encabezado = crear("header", "topbar");

  const izquierda = crear("div", "topbar-izquierda");
  const botonMenu = crear("button", "btn-menu", "☰");
  botonMenu.type = "button";
  botonMenu.setAttribute("aria-label", "Abrir menú");
  botonMenu.dataset.testid = "btn-menu";
  botonMenu.addEventListener("click", () => document.body.classList.toggle("sidebar-abierta"));
  izquierda.appendChild(botonMenu);

  const derecha = crear("div", "topbar-derecha");

  // Campana: la lógica del contador y de la lista de alertas se agrega con el módulo de Notificaciones.
  const campana = crear("button", "topbar-campana");
  campana.type = "button";
  campana.id = "campana";
  campana.dataset.modulo = "notificaciones";
  campana.dataset.testid = "campana";
  campana.setAttribute("aria-label", "Notificaciones");
  campana.appendChild(crearIcono("campana"));
  const contador = crear("span", "campana-contador", "0");
  contador.id = "campana-contador";
  contador.dataset.testid = "campana-contador";
  contador.hidden = true;
  campana.appendChild(contador);
  derecha.appendChild(campana);

  const cerrar = crear("button", "btn btn-outline", "Cerrar Sesión");
  cerrar.type = "button";
  cerrar.id = "btn-logout";
  cerrar.dataset.testid = "btn-cerrar-sesion";
  derecha.appendChild(cerrar);

  encabezado.append(izquierda, derecha);
  return encabezado;
};

// --- CIERRE DE SESIÓN ---
const limpiarSesion = () => {
  limpiarSesionLocal();
  window.location.href = "login.html";
};

const cerrarSesion = async () => {
  const confirmar = confirm("¿Estás seguro/a que querés cerrar sesión?");
  if (!confirmar) return;
  // El refresh token viaja en el body para que el Backend también lo revoque.
  const refreshToken = localStorage.getItem("trazzo_refresh_token");
  try {
    await fetchAPI("/auth/logout", "POST", refreshToken ? { refresh_token: refreshToken } : null);
  } catch (error) {
    console.log("Error al notificar al back.");
  } finally {
    limpiarSesion();
  }
};

// --- INICIO ---
const iniciarLayout = () => {
  const contenido = document.querySelector("main");
  const principal = crear("div", "app-main");
  principal.appendChild(crearEncabezado());

  const fondo = crear("div", "sidebar-fondo");
  fondo.addEventListener("click", () => document.body.classList.remove("sidebar-abierta"));

  const estructura = crear("div", "app-layout");
  if (menuContraido()) estructura.classList.add("sidebar-contraida");
  estructura.append(crearBarraLateral(estructura), fondo, principal);

  contenido.replaceWith(estructura);
  principal.appendChild(contenido);

  document.getElementById("btn-logout").addEventListener("click", cerrarSesion);
  aplicarPermisos();
};

// Pregunta al Backend si la sesión sigue vigente (token vencido, revocado o usuario deshabilitado).
// fetchAPI intenta renovar el token y, si no puede, limpia todo y manda al login.
// Un error de conexión u otro no cierra la sesión.
const verificarSesion = async () => {
  try {
    await fetchAPI("/auth/yo");
  } catch (error) {
    // Sin conexión o error del servidor: se sigue con la sesión actual.
  }
};

// Protección de ruta: sin token no se muestra nada.
if (!localStorage.getItem("trazzo_access_token")) {
  window.location.href = "login.html";
} else {
  iniciarLayout();
  verificarSesion();

  // Botón "Atrás": el navegador puede mostrar la página guardada sin volver a ejecutarla.
  window.addEventListener("pageshow", (evento) => {
    if (!evento.persisted) return;
    if (!localStorage.getItem("trazzo_access_token")) {
      window.location.href = "login.html";
    } else {
      verificarSesion();
    }
  });
}
