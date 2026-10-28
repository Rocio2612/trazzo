// js/productos.js
import {
  calcularMontoReposicion,
  precioMenorAlCosto,
  formatearMoneda,
} from "./utils/productosUtils.js";

const ROL_USUARIO = localStorage.getItem("trazzo_rol") || "Admin";
const esAdmin = ROL_USUARIO === "Admin";

document.addEventListener("DOMContentLoaded", () => {
  cargarProductos();
  configurarModales();
});

const cargarProductos = async (
  query = "",
  stockBajo = false,
  verOcultos = false,
) => {
  const tbody = document.getElementById("productos-tbody");
  tbody.innerHTML = '<tr><td colspan="8">Cargando...</td></tr>';

  let url = `/productos?q=${query}`;
  if (stockBajo) url += "&stock_bajo=true";
  if (verOcultos && esAdmin) url += "&ocultos=true";

  try {
    const data = await fetchAPI(url);
    tbody.innerHTML = ""; // Limpiar seguro

    if (data.items.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="8" class="texto-vacio">Sin productos</td></tr>';
      return;
    }

    data.items.forEach((prod) => {
      const tr = document.createElement("tr");

      // Insignias de stock
      let stockHTML = `<span>${prod.stock_actual}</span>`;
      if (prod.stock_actual === 0) {
        stockHTML = `<span class="badge badge-rojo">Sin stock</span>`;
      } else if (prod.stock_actual <= prod.stock_minimo) {
        stockHTML = `<span class="badge badge-ambar">Stock bajo</span>`;
      }

      // Acciones (solo admin puede ocultar/eliminar)
      let accionesHTML = `
                <button class="btn-icon" onclick="abrirReposicion(${prod.id}, ${prod.ultimo_costo})" title="Reponer Stock" data-testid="productos-reponer-${prod.id}">+</button>
                <button class="btn-icon" onclick="abrirEditar(${prod.id})" title="Editar" data-testid="productos-editar-${prod.id}">✏️</button>
            `;

      if (esAdmin) {
        accionesHTML += `
                    <button class="btn-icon" onclick="ocultarProducto(${prod.id})" data-modulo="productos" data-accion="ocultar" title="Ocultar">👁️‍🗨️</button>
                    <button class="btn-icon text-rojo" onclick="eliminarProducto(${prod.id})" data-modulo="productos" data-accion="eliminar" title="Eliminar">🗑️</button>
                `;
      }

      tr.innerHTML = `
                <td>${prod.nombre}</td>
                <td>${prod.categoria_nombre || "—"}</td>
                <td>${formatearMoneda(prod.costo_unitario)}</td>
                <td>${formatearMoneda(prod.precio_venta)}</td>
                <td>${stockHTML}</td>
                <td>${prod.stock_minimo}</td>
                <td>${prod.proveedor_nombre || "—"}</td>
                <td>${prod.creado_por}</td>
                <td class="acciones">${accionesHTML}</td>
            `;
      tbody.appendChild(tr);
    });
  } catch (error) {
    tbody.innerHTML =
      '<tr><td colspan="8" class="texto-error">Error al cargar productos</td></tr>';
  }
};

// --- Lógica del Modal de Producto ---
const configurarModales = () => {
  const formProducto = document.getElementById("form-producto");
  const inputCosto = document.getElementById("costo_unitario");
  const inputPrecio = document.getElementById("precio_venta");
  const bannerPrecio = document.getElementById("banner-precio-menor");

  // Validar visualmente si el precio es menor al costo
  const validarPrecios = () => {
    if (precioMenorAlCosto(inputPrecio.value, inputCosto.value)) {
      bannerPrecio.classList.remove("hidden");
    } else {
      bannerPrecio.classList.add("hidden");
    }
  };

  inputCosto.addEventListener("input", validarPrecios);
  inputPrecio.addEventListener("input", validarPrecios);

  // Submit del formulario de crear/editar
  formProducto.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btnGuardar = formProducto.querySelector('button[type="submit"]');
    btnGuardar.disabled = true; // Evitar doble clic

    const id = document.getElementById("prod-id").value;
    const payload = {
      nombre: document.getElementById("nombre").value,
      costo_unitario: parseFloat(inputCosto.value),
      precio_venta: parseFloat(inputPrecio.value),
      stock_actual: parseInt(document.getElementById("stock_actual").value),
      stock_minimo: parseInt(document.getElementById("stock_minimo").value),
      categoria_id: document.getElementById("categoria").value || null,
      proveedor_nombre: document.getElementById("proveedor").value,
    };

    try {
      const method = id ? "PUT" : "POST";
      const url = id ? `/productos/${id}` : "/productos";
      await fetchAPI(url, method, payload);

      cerrarModales();
      cargarProductos(); // Recargar tabla
    } catch (error) {
      // Asumiendo que error trae { campo: mensaje }
      if (error.errores) {
        Object.keys(error.errores).forEach((campo) => {
          const errorEl = document.getElementById(`error-${campo}`);
          if (errorEl) {
            errorEl.textContent = error.errores[campo];
            errorEl.classList.remove("hidden");
          }
        });
      } else {
        alert(error.message);
      }
    } finally {
      btnGuardar.disabled = false;
    }
  });
};

// --- Lógica del Modal de Reposición ---
let montoEditadoManualmente = false;

window.abrirReposicion = (id, ultimoCosto) => {
  document.getElementById("repo-prod-id").value = id;
  document.getElementById("repo-cantidad").value = "";
  document.getElementById("repo-monto").value = "";
  document.getElementById("repo-ultimo-costo").value = ultimoCosto;
  montoEditadoManualmente = false;

  document.getElementById("modal-reposicion").classList.remove("hidden");
};

const inputRepoCantidad = document.getElementById("repo-cantidad");
const inputRepoMonto = document.getElementById("repo-monto");

if (inputRepoCantidad && inputRepoMonto) {
  inputRepoCantidad.addEventListener("input", (e) => {
    if (montoEditadoManualmente) return;
    const cant = parseInt(e.target.value) || 0;
    const ultimoCosto =
      parseFloat(document.getElementById("repo-ultimo-costo").value) || 0;
    inputRepoMonto.value = calcularMontoReposicion(cant, ultimoCosto);
  });

  inputRepoMonto.addEventListener("input", () => {
    montoEditadoManualmente = true; // El usuario lo tocó, dejamos de autocalcular
  });

  document
    .getElementById("form-reposicion")
    .addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button[type="submit"]');
      btn.disabled = true;

      const id = document.getElementById("repo-prod-id").value;
      const payload = {
        cantidad: parseInt(inputRepoCantidad.value),
        monto_total: parseFloat(inputRepoMonto.value),
        fecha_adquisicion: document.getElementById("repo-fecha").value, // aaaa-mm-dd
        proveedor_nombre: document.getElementById("repo-proveedor").value,
      };

      try {
        await fetchAPI(`/productos/${id}/reposiciones`, "POST", payload);
        cerrarModales();
        cargarProductos();
      } catch (error) {
        alert(error.message || "Error al reponer");
      } finally {
        btn.disabled = false;
      }
    });
}

// --- Acciones de Admin: Ocultar / Eliminar ---
window.ocultarProducto = async (id) => {
  if (
    !confirm(
      "¿Ocultar este producto? No se borrarán sus datos ni afectará los reportes.",
    )
  )
    return;
  try {
    await fetchAPI(`/productos/${id}/visibilidad`, "PATCH");
    cargarProductos();
  } catch (e) {
    alert(e.message);
  }
};

window.eliminarProducto = async (id) => {
  if (
    !confirm(
      "¿Eliminar definitivamente este producto? Esta acción no se puede deshacer.",
    )
  )
    return;
  try {
    await fetchAPI(`/productos/${id}`, "DELETE");
    cargarProductos();
  } catch (error) {
    if (error.status === 409) {
      // Si el back devuelve 409, ofrecer ocultar
      if (
        confirm(
          "El producto tiene movimientos y no se puede eliminar. ¿Querés ocultarlo en su lugar?",
        )
      ) {
        window.ocultarProducto(id);
      }
    } else {
      alert(error.message);
    }
  }
};

const cerrarModales = () => {
  document
    .querySelectorAll(".modal-backdrop")
    .forEach((m) => m.classList.add("hidden"));
};
