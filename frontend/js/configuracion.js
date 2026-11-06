// --- PANTALLA "CONFIGURACIÓN" (módulo ES) ---
// Una sola pantalla con tres pestañas: Personal, Categorías y Medios de pago. La pestaña activa se guarda
// en la dirección (configuracion.html#categorias), así otras pantallas pueden mandar directo a una.

import { h } from "./componentes/ui-panel.js";
import { crearPanelLista } from "./configuracion-listas.js";
import { crearPanelPersonal } from "./configuracion-personal.js";

const iniciarPantalla = () => {
  // Solo el Admin entra (el Backend también lo valida).
  if (!puedeHacer("personal", "ver")) {
    window.location.href = "dashboard.html";
    return;
  }

  const pagina = document.getElementById("configuracion-pagina");

  const pestanias = [
    { id: "personal", texto: "Personal", ...crearPanelPersonal() },
    { id: "categorias", texto: "Categorías", ...crearPanelLista("categorias") },
    { id: "medios-pago", texto: "Medios de pago", ...crearPanelLista("medios_pago") },
  ];
  const cargadas = new Set();

  const lista = h("div", { class: "cfg-pestanias", role: "tablist", "aria-label": "Secciones de configuración" });
  const zonaPanel = h("div", { class: "cfg-panel" });

  const botones = pestanias.map((p) => {
    const b = h("button", { type: "button", class: "cfg-pestania", role: "tab", id: `pestania-${p.id}`, "data-testid": `pestania-${p.id}`, text: p.texto });
    b.addEventListener("click", () => mostrar(p.id));
    lista.append(b);
    return b;
  });

  const mostrar = async (id, { actualizarHash = true } = {}) => {
    const actual = pestanias.find((p) => p.id === id) || pestanias[0];
    pestanias.forEach((p, i) => {
      const activa = p === actual;
      botones[i].classList.toggle("activa", activa);
      botones[i].setAttribute("aria-selected", String(activa));
    });
    if (actualizarHash) history.replaceState(null, "", `#${actual.id}`);
    zonaPanel.replaceChildren(actual.panel);
    if (!cargadas.has(actual.id)) {
      cargadas.add(actual.id);
      await actual.cargar();
    }
  };

  pagina.replaceChildren(h("div", { class: "gastos-encabezado" }, h("h1", { text: "Configuración" })), lista, zonaPanel);

  window.addEventListener("hashchange", () => mostrar(location.hash.slice(1), { actualizarHash: false }));
  mostrar(location.hash.slice(1), { actualizarHash: false });
};

iniciarPantalla();
