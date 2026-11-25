// --- PANTALLA DE REPORTES (módulo ES) ---
// Panel de solo lectura (solo Administrador): tarjetas de indicadores y desglose de la inversión en inventario, con un
// filtro de período. Los números vienen del Backend (servicios/reportes.js). Lo que se muestra de cada tarjeta
// (títulos, de qué servicio depende, textos) está en reportes.js.
// Si el usuario no tiene permiso (por ejemplo un Cajero que escribe la dirección), se avisa con el 403 y se vuelve al
// Panel antes de pedir ningún dato.

import { crearSvg, h } from "./componentes/ui-panel.js";
import { formatearDinero } from "./formatos.js";
import { servicioReportes } from "./servicios/reportes.js";
import { mensajeDeError } from "./servicios/errores.js";
import {
  estaCaido,
  esNegativo,
  INDICADORES_ESTADO,
  INDICADORES_PRINCIPALES,
  MENSAJE_DESGLOSE_CAIDO,
  MENSAJE_SIN_DESGLOSE,
  NOTA_DESGLOSE,
  PERIODO_INICIAL,
  afectadosPorFalla,
  serviciosCaidos,
  textoAvisoParcial,
  textoDePeriodo,
  textoVentasPorSaldar,
  TITULO_DESGLOSE,
  totalDelDesglose,
} from "./reportes.js";

// Íconos de trazo (24x24). Son textos fijos del código, nunca datos del usuario.
const ICONOS = {
  ingresos: '<rect width="20" height="12" x="2" y="6" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/>',
  vendido: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
  cmv: '<path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z"/><path d="M7 7h.01"/>',
  ganancia: '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
  gastos: '<polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/><polyline points="16 17 22 17 22 11"/>',
  bienes: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  neta: '<line x1="12" y1="2" x2="12" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  inventario: '<path d="M16 16h6"/><path d="M19 13v6"/><path d="M21 10V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l2-1.14"/><path d="m7.5 4.27 9 5.15"/><polyline points="3.29 7 12 12 20.71 7"/><line x1="12" y1="22" x2="12" y2="12"/>',
  cobrar: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
};

const MENSAJE_SIN_PERMISO = "Acceso denegado (403): no tenés permiso para ver Reportes.";

// Sin permiso: se avisa y se vuelve al Panel de inmediato, sin dibujar ni pedir nada.
const sinPermiso = typeof puedeHacer === "function" && !puedeHacer("reportes", "ver");
if (sinPermiso) {
  if (typeof avisarAccesoDenegado === "function") avisarAccesoDenegado({ mensaje: MENSAJE_SIN_PERMISO });
  else window.location.replace("dashboard.html");
} else {
  iniciar();
}

function iniciar() {
  const zonaContenido = document.getElementById("reportes-contenido");
  const selector = document.getElementById("reportes-filtro-periodo");
  let periodo = PERIODO_INICIAL;
  let pedido = 0; // para descartar respuestas viejas si se cambia el período mientras se consulta

  // Una tarjeta de indicador. Si el servicio del que depende falló, muestra "No se pudo calcular" y las demás siguen visibles.
  const tarjeta = (indicador, datos, caidos) => {
    const valor = datos[indicador.campo];
    const caido = estaCaido(indicador, caidos) || valor === null || valor === undefined;
    return h(
      "div",
      { class: `reportes-indicador${indicador.destacado ? " reportes-indicador-destacado" : ""}`, "data-testid": `rep-${indicador.id}` },
      h(
        "div",
        { class: "reportes-cabecera" },
        h(
          "div",
          { class: "reportes-cabecera-izquierda" },
          h("span", { class: `reportes-icono reportes-tono-${indicador.tono}` }, crearSvg(ICONOS[indicador.icono])),
          h("div", { class: "reportes-titulo-indicador", text: indicador.titulo }),
        ),
        indicador.alDiaDeHoy && h("span", { class: "reportes-insignia reportes-insignia-azul", "data-testid": `rep-${indicador.id}-al-dia`, text: "Al día de hoy" }),
      ),
      caido
        ? h("div", { class: "reportes-valor reportes-sin-calculo", "data-testid": `rep-${indicador.id}-error`, text: "No se pudo calcular" })
        : [
            h("div", { class: `reportes-valor${esNegativo(indicador, valor) ? " reportes-valor-negativo" : ""}`, "data-testid": `rep-${indicador.id}-valor`, text: formatearDinero(valor) }),
            h("p", { class: "gastos-ayuda", text: indicador.detalle }),
            indicador.conPorSaldar && h("span", { class: "reportes-insignia reportes-insignia-ambar reportes-chip", "data-testid": "rep-faltan-saldar", text: textoVentasPorSaldar(datos.ventas_por_saldar) }),
          ],
    );
  };

  const tablaDeDesglose = (desglose) =>
    h(
      "div",
      { class: "gastos-tabla-contenedor" },
      h(
        "table",
        { class: "gastos-tabla", "data-testid": "rep-desglose" },
        h("thead", {}, h("tr", {}, h("th", { text: "Producto" }), h("th", { class: "num", text: "Unidades en stock" }), h("th", { class: "num", text: "Costo unitario" }), h("th", { class: "num", text: "Inversión" }))),
        h(
          "tbody",
          {},
          ...desglose.map((fila) => h("tr", {}, h("td", { text: fila.producto }), h("td", { class: "num", text: String(fila.unidades) }), h("td", { class: "num", text: formatearDinero(fila.costo_unitario) }), h("td", { class: "num", text: formatearDinero(fila.inversion) }))),
          h("tr", {}, h("td", {}, h("strong", { text: "Total invertido en el período" })), h("td"), h("td"), h("td", { class: "num" }, h("strong", { "data-testid": "rep-desglose-total", text: formatearDinero(totalDelDesglose(desglose)) }))),
        ),
      ),
    );

  const cuerpoDelDesglose = (datos, caidos) => {
    if (caidos.includes("productos") || !Array.isArray(datos.desglose_inversion)) return h("div", { class: "reportes-vacio", "data-testid": "rep-desglose-error", text: MENSAJE_DESGLOSE_CAIDO });
    return [
      datos.desglose_inversion.length === 0 ? h("div", { class: "reportes-vacio", "data-testid": "rep-desglose-vacio", text: MENSAJE_SIN_DESGLOSE }) : tablaDeDesglose(datos.desglose_inversion),
      h("p", { class: "gastos-ayuda reportes-desglose-nota", text: NOTA_DESGLOSE }),
    ];
  };

  const pintar = (datos) => {
    const caidos = serviciosCaidos(datos);
    zonaContenido.replaceChildren(
      ...[
        afectadosPorFalla(caidos).length > 0 && h("div", { class: "reportes-aviso", role: "status", "data-testid": "reportes-aviso-parcial", text: textoAvisoParcial(caidos) }),
        h("h2", { class: "reportes-seccion", text: "Indicadores principales" }),
        h("div", { class: "reportes-indicadores" }, INDICADORES_PRINCIPALES.map((i) => tarjeta(i, datos, caidos))),
        h(
          "div",
          { class: "reportes-desglose" },
          h("div", { class: "reportes-desglose-titulo" }, h("h3", { text: TITULO_DESGLOSE }), h("span", { class: "reportes-insignia reportes-insignia-azul", text: textoDePeriodo(periodo) })),
          cuerpoDelDesglose(datos, caidos),
        ),
        h("h2", { class: "reportes-seccion", text: "Estado actual" }),
        h("div", { class: "reportes-indicadores reportes-indicadores-dos" }, INDICADORES_ESTADO.map((i) => tarjeta(i, datos, caidos))),
      ].filter(Boolean),
    );
  };

  // Cada vez que cambia el período se vuelve a consultar: mientras tanto se muestra un aviso breve.
  const consultar = async () => {
    const mio = ++pedido;
    zonaContenido.replaceChildren(h("div", { class: "reportes-tarjeta-aviso" }, h("div", { class: "reportes-vacio", "data-testid": "reportes-actualizando", text: "Actualizando indicadores…" })));
    try {
      const datos = await servicioReportes.obtener({ periodo });
      if (mio === pedido) pintar(datos);
    } catch (error) {
      if (mio !== pedido) return;
      zonaContenido.replaceChildren(
        h("div", { class: "reportes-tarjeta-aviso" }, h("div", { class: "reportes-vacio", "data-testid": "reportes-error", role: "alert", text: mensajeDeError(error, "No se pudieron cargar los reportes. Intentá de nuevo.") })),
      );
    }
  };

  selector.value = periodo;
  selector.addEventListener("change", () => {
    periodo = selector.value;
    consultar();
  });
  consultar();
}
