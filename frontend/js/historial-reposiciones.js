// Trazzo - Sprint 2 - Historial de reposiciones
// fetchAPI (api.js) y API_URL (config.js) son globales: los usa js/servicios/productos.js.
import {
  formatearMoneda,
  formatearFecha,
  parsearFecha,
  escaparHTML as esc,
  rolDesdeToken,
  esRolAdmin,
} from "./utils/productosUtils.js";
import { mensajeDeError } from "./servicios/errores.js";
import { servicioReposiciones } from "./servicios/producto.js";

const esAdmin = esRolAdmin(
  rolDesdeToken(localStorage.getItem("trazzo_access_token")) || "CAJERO",
);
const COLUMNAS = esAdmin ? 9 : 8;

const $ = (id) => document.getElementById(id);
let todas = [];

const mostrarToast = (mensaje, esError = false) => {
  const toast = $("toast");
  toast.textContent = mensaje;
  toast.classList.toggle("error", esError);
  toast.classList.add("mostrar");
  clearTimeout(mostrarToast.timer);
  mostrarToast.timer = setTimeout(
    () => toast.classList.remove("mostrar"),
    2800,
  );
};

const mensajeEnTabla = (texto, esError = false) => {
  $("historial-tbody").innerHTML =
    `<tr class="fila-mensaje${esError ? " error" : ""}"><td colspan="${COLUMNAS}">${esc(texto)}</td></tr>`;
};

const llenarFiltroProveedores = (reposiciones) => {
  const select = $("filtro-proveedor");
  const elegido = select.value;
  select.length = 1; // se recarga tras anular: evita duplicar opciones
  const nombres = [
    ...new Set(reposiciones.map((r) => r.proveedor_nombre).filter(Boolean)),
  ].sort((a, b) => a.localeCompare(b, "es"));
  nombres.forEach((nombre) => select.append(new Option(nombre, nombre)));
  if (nombres.includes(elegido)) select.value = elegido;
};

const renderizarTabla = (reposiciones) => {
  if (reposiciones.length === 0) {
    mensajeEnTabla("No hay reposiciones registradas");
    return;
  }
  $("historial-tbody").innerHTML = reposiciones
    .map((r) => {
      const activa = r.estado === "ACTIVA";
      const estadoHTML = activa
        ? '<span class="estado-activa">Activa</span>'
        : '<span class="estado-anulada">Anulada</span>';
      let celdaAccion = "";
      if (esAdmin) {
        celdaAccion = activa
          ? `<td><div class="acciones-flex"><button type="button" class="btn-icono" data-anular="${esc(r.id)}" title="Anular" aria-label="Anular reposición"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button></div></td>`
          : '<td><span style="color:gray; font-size:0.8rem;">—</span></td>';
      }
      return `
        <tr>
          <td>${esc(r.producto_nombre)}</td>
          <td>${Number(r.cantidad)}</td>
          <td>${formatearMoneda(r.monto_total)}</td>
          <td>${formatearMoneda(r.costo_unitario_real)}</td>
          <td>${formatearFecha(r.fecha_adquisicion)}</td>
          <td>${esc(r.proveedor_nombre) || "—"}</td>
          <td>${esc(r.creado_por) || "—"}</td>
          <td>${estadoHTML}</td>
          ${celdaAccion}
        </tr>`;
    })
    .join("");
};

// Búsqueda + proveedor + fecha sobre lo ya cargado.
const aplicarFiltros = () => {
  const texto = $("buscador").value.trim().toLowerCase();
  const proveedor = $("filtro-proveedor").value;
  const rango = $("filtro-fecha").value;
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);

  renderizarTabla(
    todas.filter((r) => {
      const coincideTexto =
        String(r.producto_nombre || "")
          .toLowerCase()
          .includes(texto) ||
        String(r.proveedor_nombre || "")
          .toLowerCase()
          .includes(texto);
      const coincideProveedor =
        proveedor === "" || r.proveedor_nombre === proveedor;

      let coincideFecha = true;
      if (rango !== "todas") {
        const f = parsearFecha(r.fecha_adquisicion);
        if (!f) coincideFecha = false;
        else if (rango === "hoy") coincideFecha = f.getTime() === hoy.getTime();
        else if (rango === "mes")
          coincideFecha =
            f.getMonth() === hoy.getMonth() &&
            f.getFullYear() === hoy.getFullYear();
        else if (rango === "año")
          coincideFecha = f.getFullYear() === hoy.getFullYear();
      }
      return coincideTexto && coincideProveedor && coincideFecha;
    }),
  );
};

const cargarHistorial = async () => {
  mensajeEnTabla("Cargando...");
  try {
    todas = await servicioReposiciones.listar();
    llenarFiltroProveedores(todas);
    aplicarFiltros();
  } catch (error) {
    console.error(error);
    mensajeEnTabla(mensajeDeError(error, "Error al cargar el historial"), true);
  }
};

const anularReposicion = async (id) => {
  if (
    !confirm(
      "¿Estás seguro de anular esta reposición? Se restará el stock correspondiente al producto.",
    )
  )
    return;
  try {
    await servicioReposiciones.anular(id);
    mostrarToast("Reposición anulada");
    cargarHistorial();
  } catch (error) {
    if (error.status === 409) {
      mostrarToast(
        "No se puede anular: el stock actual del producto es menor a la cantidad que se intenta restar.",
        true,
      );
    } else {
      mostrarToast(
        mensajeDeError(error, "No se pudo anular la reposición."),
        true,
      );
    }
  }
};

document.addEventListener("DOMContentLoaded", () => {
  if (esAdmin)
    document.querySelector(".acciones-admin")?.classList.remove("hidden");
  $("buscador").addEventListener("input", aplicarFiltros);
  $("filtro-proveedor").addEventListener("change", aplicarFiltros);
  $("filtro-fecha").addEventListener("change", aplicarFiltros);
  $("historial-tbody").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-anular]");
    if (btn && esAdmin) anularReposicion(btn.dataset.anular);
  });
  cargarHistorial();
});
