// js/historial-reposiciones.js
import { fetchAPI } from "./api.js";
import { formatearMoneda } from "./utils/productosUtils.js";

document.addEventListener("DOMContentLoaded", () => {
  cargarHistorial();
});

const cargarHistorial = async () => {
  const tbody = document.getElementById("historial-tbody");
  tbody.innerHTML =
    '<tr><td colspan="7" class="texto-vacio">Cargando historial...</td></tr>';

  try {
    // Asumimos que este endpoint devuelve todas las reposiciones (o adaptarlo según el contrato del backend)
    const data = await fetchAPI("/reposiciones");

    tbody.innerHTML = ""; // Limpiar la tabla

    if (data.length === 0) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 7;
      td.className = "texto-vacio";
      td.textContent = "No hay reposiciones registradas";
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    // Llenar proveedores en el select sin duplicados
    const proveedoresUnicos = [
      ...new Set(data.map((item) => item.proveedor).filter(Boolean)),
    ];
    const selectProveedor = document.getElementById("filtro-proveedor");
    proveedoresUnicos.forEach((prov) => {
      const option = document.createElement("option");
      option.value = prov;
      option.textContent = prov;
      selectProveedor.appendChild(option);
    });

    // Renderizar filas
    data.forEach((repo) => {
      const tr = document.createElement("tr");

      // Formatear fecha de aaaa-mm-dd a dd-mm-aaaa para mostrar
      const fechaObj = new Date(repo.fecha_adquisicion + "T00:00:00");
      const fechaMostrar = fechaObj.toLocaleDateString("es-AR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });

      // Crear celdas de forma segura
      const tdProducto = document.createElement("td");
      tdProducto.textContent = repo.producto_nombre;

      const tdCantidad = document.createElement("td");
      tdCantidad.textContent = repo.cantidad;

      const tdMonto = document.createElement("td");
      tdMonto.textContent = formatearMoneda(repo.monto_total);

      const tdCostoUnitario = document.createElement("td");
      tdCostoUnitario.textContent = formatearMoneda(repo.costo_unitario);

      const tdFecha = document.createElement("td");
      tdFecha.textContent = fechaMostrar;

      const tdProveedor = document.createElement("td");
      tdProveedor.textContent = repo.proveedor || "—";

      const tdRegistrado = document.createElement("td");
      tdRegistrado.textContent = repo.creado_por;

      // Armar la fila
      tr.appendChild(tdProducto);
      tr.appendChild(tdCantidad);
      tr.appendChild(tdMonto);
      tr.appendChild(tdCostoUnitario);
      tr.appendChild(tdFecha);
      tr.appendChild(tdProveedor);
      tr.appendChild(tdRegistrado);

      tbody.appendChild(tr);
    });
  } catch (error) {
    console.error(error);
    tbody.innerHTML =
      '<tr><td colspan="7" class="texto-error" style="text-align:center; color:red; padding:2rem;">Error al cargar el historial</td></tr>';
  }
};
