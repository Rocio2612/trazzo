// Trazzo - Sprint 2 - Historial de Reposiciones
import { fetchAPI } from "./api.js";
import { formatearMoneda } from "./productosUtils.js";

// La base guarda el rol en mayúsculas: PROPIETARIO, ADMIN o CAJERO.
const ROL_USUARIO = localStorage.getItem("trazzo_rol") || "CAJERO";
const esAdmin = ["ADMIN", "PROPIETARIO"].includes(ROL_USUARIO);

let todasLasReposiciones = [];

document.addEventListener("DOMContentLoaded", () => {
  if (esAdmin)
    document.querySelector(".acciones-admin").classList.remove("hidden");
  cargarHistorial();
  configurarFiltros();
});

const cargarHistorial = async () => {
  const tbody = document.getElementById("historial-tbody");
  tbody.innerHTML =
    '<tr><td colspan="9" style="text-align:center; color:gray; padding: 2rem;">Cargando...</td></tr>';

  try {
    const data = await fetchAPI("/reposiciones");
    todasLasReposiciones = data;
    llenarFiltroProveedores(data);
    renderizarTabla(data);
  } catch (error) {
    console.error(error);
    tbody.innerHTML =
      '<tr><td colspan="9" style="text-align:center; color:#dc3545; padding: 2rem;">Error al cargar el historial</td></tr>';
  }
};

const llenarFiltroProveedores = (reposiciones) => {
  const select = document.getElementById("filtro-proveedor");
  // Se recarga el historial tras anular: evitar duplicar las opciones.
  select.length = 1;
  const proveedoresUnicos = [
    ...new Set(reposiciones.map((r) => r.proveedor_nombre).filter(Boolean)),
  ];
  proveedoresUnicos.forEach((prov) => {
    const option = document.createElement("option");
    option.value = prov;
    option.textContent = prov;
    select.appendChild(option);
  });
};

const renderizarTabla = (reposiciones) => {
  const tbody = document.getElementById("historial-tbody");
  tbody.innerHTML = "";

  if (reposiciones.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="9" style="text-align:center; color:gray; padding: 2rem;">No hay reposiciones registradas</td></tr>';
    return;
  }

  reposiciones.forEach((repo) => {
    const tr = document.createElement("tr");

    const fechaObj = new Date(repo.fecha_adquisicion + "T00:00:00");
    const fechaMostrar = fechaObj.toLocaleDateString("es-AR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });

    let estadoHTML =
      repo.estado === "ACTIVA"
        ? '<span style="color: #198754; font-weight: 500;">Activa</span>'
        : '<span style="color: #dc3545; font-weight: 500;">Anulada</span>';

    let accionHTML = "";
    if (esAdmin) {
      if (repo.estado === "ACTIVA") {
        accionHTML = `
                    <button class="btn-icono btn-anular" data-id="${repo.id}" title="Anular">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                `;
      } else {
        accionHTML = `<span style="color:gray; font-size:0.8rem;">—</span>`;
      }
    }

    tr.innerHTML = `
            <td>${repo.producto_nombre}</td>
            <td>${Number(repo.cantidad)}</td>
            <td>${formatearMoneda(repo.monto_total)}</td>
            <td>${formatearMoneda(repo.costo_unitario_real)}</td>
            <td>${fechaMostrar}</td>
            <td>${repo.proveedor_nombre || "—"}</td>
            <td>${repo.creado_por}</td>
            <td>${estadoHTML}</td>
            ${esAdmin ? `<td><div class="acciones-flex">${accionHTML}</div></td>` : ""}
        `;

    tbody.appendChild(tr);
  });

  if (esAdmin) {
    tbody.querySelectorAll(".btn-anular").forEach((btn) => {
      btn.addEventListener("click", () => anularReposicion(btn.dataset.id));
    });
  }
};

const configurarFiltros = () => {
  const buscar = document.getElementById("buscador");
  const filtroProv = document.getElementById("filtro-proveedor");
  const filtroFecha = document.getElementById("filtro-fecha");

  const aplicarFiltros = () => {
    const texto = buscar.value.toLowerCase();
    const prov = filtroProv.value;
    const fechaOp = filtroFecha.value;

    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    const filtrados = todasLasReposiciones.filter((r) => {
      const coincideTexto =
        r.producto_nombre.toLowerCase().includes(texto) ||
        (r.proveedor_nombre &&
          r.proveedor_nombre.toLowerCase().includes(texto));
      const coincideProv = prov === "" || r.proveedor_nombre === prov;

      let coincideFecha = true;
      if (fechaOp !== "todas") {
        const fRepo = new Date(r.fecha_adquisicion + "T00:00:00");
        if (fechaOp === "hoy")
          coincideFecha = fRepo.getTime() === hoy.getTime();
        else if (fechaOp === "mes")
          coincideFecha =
            fRepo.getMonth() === hoy.getMonth() &&
            fRepo.getFullYear() === hoy.getFullYear();
        else if (fechaOp === "año")
          coincideFecha = fRepo.getFullYear() === hoy.getFullYear();
      }

      return coincideTexto && coincideProv && coincideFecha;
    });

    renderizarTabla(filtrados);
  };

  buscar.addEventListener("input", aplicarFiltros);
  filtroProv.addEventListener("change", aplicarFiltros);
  filtroFecha.addEventListener("change", aplicarFiltros);
};

const anularReposicion = async (id) => {
  if (
    !confirm(
      "¿Estás seguro de anular esta reposición? Se restará el stock correspondiente al producto.",
    )
  )
    return;
  try {
    await fetchAPI(`/reposiciones/${id}/anular`, "PATCH");
    alert("Reposición anulada correctamente.");
    cargarHistorial();
  } catch (error) {
    if (error.status === 409) {
      alert(
        "No se puede anular: el stock actual del producto es menor a la cantidad que se intenta restar.",
      );
    } else {
      alert(error.message || "Error al anular la reposición");
    }
  }
};
