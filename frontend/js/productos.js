// Trazzo - Sprint 2 - Módulo 5: Productos (Bienes de Cambio)
import { fetchAPI } from "./api.js";
import {
  calcularPrecioVenta,
  precioMenorAlCosto,
  calcularMontoReposicion,
  formatearMoneda,
} from "./productosUtils.js";

// La base guarda el rol en mayúsculas: PROPIETARIO, ADMIN o CAJERO.
const ROL_USUARIO = localStorage.getItem("trazzo_rol") || "CAJERO";
const esAdmin = ["ADMIN", "PROPIETARIO"].includes(ROL_USUARIO);

let filtroStockBajo = false;
let verOcultos = false;
let precioEditadoManual = false;
let montoRepoEditadoManual = false;

// Fecha local (YYYY-MM-DD). toISOString() devuelve fecha UTC y de noche
// en Argentina adelanta el día, chocando con chk_repo_fecha_no_futura.
const obtenerFechaLocal = () => {
  const hoy = new Date();
  const offset = hoy.getTimezoneOffset() * 60000;
  return new Date(hoy.getTime() - offset).toISOString().split("T")[0];
};

document.addEventListener("DOMContentLoaded", () => {
  cargarProductos();
  cargarSelectores();
  configurarEventos();
});

const mostrarToast = (msg) => {
  const toast = document.getElementById("toast");
  toast.textContent = msg;
  toast.classList.add("mostrar");
  setTimeout(() => toast.classList.remove("mostrar"), 2600);
};

const cargarSelectores = async () => {
  try {
    const [cats, provs] = await Promise.all([
      fetchAPI("/categorias"),
      fetchAPI("/proveedores"),
    ]);

    const selectCat = document.getElementById("categoria_id");
    const selectProv = document.getElementById("proveedor_id");
    const repoProv = document.getElementById("proveedor_id_repo");

    // Categorías (opcional: categoria_id admite NULL)
    if (cats.length === 0) {
      selectCat.innerHTML = '<option value="">Sin categorías creadas</option>';
    } else {
      selectCat.innerHTML = '<option value="">Seleccione categoría</option>';
      cats.forEach(
        (c) =>
          (selectCat.innerHTML += `<option value="${c.id}">${c.nombre}</option>`),
      );
    }

    // Proveedores (obligatorio: proveedor_id es NOT NULL en la base)
    const provOpts =
      provs.length === 0
        ? '<option value="">Debe cargar proveedores primero</option>'
        : '<option value="">Seleccione proveedor...</option>' +
          provs
            .map((p) => `<option value="${p.id}">${p.nombre}</option>`)
            .join("");

    selectProv.innerHTML = provOpts;
    selectProv.required = true;
    repoProv.innerHTML = provOpts;
    repoProv.required = true;
  } catch (e) {
    console.error("Error cargando selectores", e);
  }
};

const cargarProductos = async () => {
  const tbody = document.getElementById("productos-tbody");
  tbody.innerHTML =
    '<tr><td colspan="8" style="text-align:center;">Cargando...</td></tr>';

  let url = `/productos?q=${document.getElementById("buscador").value}&tipo_producto=BIEN_DE_CAMBIO`;
  if (filtroStockBajo) url += "&stock_bajo=true";
  if (verOcultos && esAdmin) url += "&ocultos=true";

  try {
    const data = await fetchAPI(url);
    tbody.innerHTML = "";

    if (data.items.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="8" style="text-align:center; color:gray;">Sin productos</td></tr>';
      return;
    }

    data.items.forEach((prod) => {
      const tr = document.createElement("tr");

      // Insignias de stock. NUMERIC puede llegar como texto ("10.00"),
      // así que se convierte antes de comparar.
      const cantidad = Number(prod.cantidad);
      const stockMinimo = Number(prod.stock_minimo);
      let stockHTML = `<span>${cantidad}</span>`;
      if (cantidad === 0)
        stockHTML = `<span class="badge badge-rojo">Sin stock</span>`;
      else if (cantidad <= stockMinimo)
        stockHTML = `<span class="badge badge-ambar">Stock bajo</span>`;

      // ÍCONOS SVG EN BLANCO Y NEGRO
      let accionesHTML = `
                <button class="btn-icono" title="Reponer Stock">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                </button>
                <button class="btn-icono" title="Editar">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                </button>
                <button class="btn-icono" title="Dar de baja">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"></polyline><polyline points="17 18 23 18 23 12"></polyline></svg>
                </button>
            `;

      if (esAdmin) {
        accionesHTML += `
                    <button class="btn-icono" title="Ocultar">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>
                    </button>
                    <button class="btn-icono" title="Eliminar">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    </button>
                `;
      }

      tr.innerHTML = `
                <td>${prod.nombre}</td>
                <td>${prod.categoria_nombre || "—"}</td>
                <td>${formatearMoneda(prod.precio_compra)}</td>
                <td>${formatearMoneda(prod.precio_venta)}</td>
                <td>${stockHTML}</td>
                <td>${stockMinimo}</td>
                <td>${prod.proveedor_nombre || "—"}</td>
                <td><div class="acciones-flex">${accionesHTML}</div></td>
            `;

      tr.querySelector('[title="Reponer Stock"]').onclick = () =>
        abrirReposicion(prod);
      tr.querySelector('[title="Editar"]').onclick = () => abrirEditar(prod);
      tr.querySelector('[title="Dar de baja"]').onclick = () => abrirBaja(prod);

      if (esAdmin) {
        tr.querySelector('[title="Ocultar"]').onclick = () =>
          ocultarProducto(prod.id);
        tr.querySelector('[title="Eliminar"]').onclick = () =>
          eliminarProducto(prod.id);
      }

      tbody.appendChild(tr);
    });
  } catch (error) {
    tbody.innerHTML =
      '<tr><td colspan="8" style="text-align:center; color:red;">Error al cargar</td></tr>';
  }
};

const configurarEventos = () => {
  document
    .getElementById("buscador")
    .addEventListener("input", () => cargarProductos());
  document.getElementById("btn-stock-bajo").addEventListener("click", (e) => {
    filtroStockBajo = !filtroStockBajo;
    e.target.classList.toggle("activo", filtroStockBajo);
    cargarProductos();
  });
  document.getElementById("btn-ver-ocultos").addEventListener("click", (e) => {
    verOcultos = !verOcultos;
    e.target.classList.toggle("activo", verOcultos);
    cargarProductos();
  });

  // Fórmula de precio
  const actualizarPrecioSugerido = () => {
    if (precioEditadoManual) return;
    const costo =
      parseFloat(document.getElementById("precio_compra").value) || 0;
    const rent = parseFloat(document.getElementById("rentabilidad").value) || 0;
    const iva = parseFloat(document.getElementById("iva_alicuota").value) || 0;

    const sugerido = calcularPrecioVenta(costo, rent, iva);
    if (sugerido > 0) document.getElementById("precio_venta").value = sugerido;

    validarAvisoPrecio();
  };

  ["precio_compra", "rentabilidad", "iva_alicuota"].forEach((id) => {
    document
      .getElementById(id)
      .addEventListener("input", actualizarPrecioSugerido);
  });

  document.getElementById("precio_venta").addEventListener("input", () => {
    precioEditadoManual = true;
    validarAvisoPrecio();
  });

  const validarAvisoPrecio = () => {
    const pv = document.getElementById("precio_venta").value;
    const pc = document.getElementById("precio_compra").value;
    const banner = document.getElementById("banner-precio-menor");
    if (precioMenorAlCosto(pv, pc)) banner.classList.remove("hidden");
    else banner.classList.add("hidden");
  };

  // Guardar Producto
  document
    .getElementById("form-producto")
    .addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button[type="submit"]');
      btn.disabled = true;

      const id = document.getElementById("prod-id").value;

      const payload = {
        nombre: document.getElementById("nombre").value,
        precio_compra: parseFloat(
          document.getElementById("precio_compra").value,
        ),
        rentabilidad:
          parseFloat(document.getElementById("rentabilidad").value) || 0,
        iva_alicuota: parseFloat(document.getElementById("iva_alicuota").value),
        precio_venta: parseFloat(document.getElementById("precio_venta").value),
        cantidad: parseInt(document.getElementById("cantidad").value),
        stock_minimo: parseInt(document.getElementById("stock_minimo").value),
        categoria_id: document.getElementById("categoria_id").value || null,
        // Obligatorio: productos.proveedor_id es NOT NULL
        proveedor_id: parseInt(document.getElementById("proveedor_id").value),
        tipo_producto: "BIEN_DE_CAMBIO",
      };

      try {
        await fetchAPI(
          id ? `/productos/${id}` : "/productos",
          id ? "PUT" : "POST",
          payload,
        );
        document.getElementById("modal-producto").classList.add("hidden");
        mostrarToast(id ? "Producto actualizado" : "Producto creado");
        cargarProductos();
      } catch (error) {
        alert(error.message || "Error al guardar");
      } finally {
        btn.disabled = false;
      }
    });

  // Reposición
  document.getElementById("repo-cantidad").addEventListener("input", (e) => {
    if (montoRepoEditadoManual) return;
    const cant = parseInt(e.target.value) || 0;
    const costo =
      parseFloat(document.getElementById("repo-ultimo-costo").value) || 0;
    document.getElementById("monto_total").value = calcularMontoReposicion(
      cant,
      costo,
    );
  });

  document.getElementById("monto_total").addEventListener("input", () => {
    montoRepoEditadoManual = true;
  });

  document
    .getElementById("form-reposicion")
    .addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button[type="submit"]');
      btn.disabled = true;

      const payload = {
        cantidad: parseInt(document.getElementById("repo-cantidad").value),
        monto_total: parseFloat(document.getElementById("monto_total").value),
        fecha_adquisicion: document.getElementById("fecha_adquisicion").value,
        proveedor_id: parseInt(
          document.getElementById("proveedor_id_repo").value,
        ),
      };

      try {
        await fetchAPI(
          `/productos/${document.getElementById("repo-prod-id").value}/reposiciones`,
          "POST",
          payload,
        );
        document.getElementById("modal-reposicion").classList.add("hidden");
        mostrarToast("Reposición registrada");
        cargarProductos();
      } catch (error) {
        alert(error.message);
      } finally {
        btn.disabled = false;
      }
    });

  // Baja
  // "cantidad" se manda positiva; el backend arma el movimiento en
  // movimientos_stock (tipo 'BAJA', cantidad_movimiento negativa, stock_resultante).
  document.getElementById("form-baja").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;

    const payload = {
      cantidad: parseInt(document.getElementById("baja-cantidad").value),
      motivo: document.getElementById("baja-motivo").value,
      fecha: document.getElementById("baja-fecha").value,
    };

    try {
      await fetchAPI(
        `/productos/${document.getElementById("baja-prod-id").value}/bajas`,
        "POST",
        payload,
      );
      document.getElementById("modal-baja").classList.add("hidden");
      mostrarToast("Baja registrada");
      cargarProductos();
    } catch (error) {
      alert(error.message);
    } finally {
      btn.disabled = false;
    }
  });

  document
    .getElementById("btn-nuevo-producto")
    .addEventListener("click", () => {
      document.getElementById("form-producto").reset();
      document.getElementById("prod-id").value = "";
      precioEditadoManual = false;
      document.getElementById("banner-precio-menor").classList.add("hidden");
      document.getElementById("modal-producto").classList.remove("hidden");
    });
};

const abrirEditar = (prod) => {
  document.getElementById("prod-id").value = prod.id;
  document.getElementById("nombre").value = prod.nombre;
  document.getElementById("precio_compra").value = prod.precio_compra;
  document.getElementById("rentabilidad").value = prod.rentabilidad || 0;
  document.getElementById("iva_alicuota").value = prod.iva_alicuota || 21;
  document.getElementById("precio_venta").value = prod.precio_venta;
  document.getElementById("cantidad").value = Number(prod.cantidad);
  document.getElementById("stock_minimo").value = Number(prod.stock_minimo);
  document.getElementById("categoria_id").value = prod.categoria_id || "";
  document.getElementById("proveedor_id").value = prod.proveedor_id || "";

  precioEditadoManual = true;
  document.getElementById("modal-producto").classList.remove("hidden");
};

const abrirReposicion = (prod) => {
  document.getElementById("repo-prod-id").value = prod.id;
  document.getElementById("repo-ultimo-costo").value = prod.precio_compra;
  document.getElementById("form-reposicion").reset();
  montoRepoEditadoManual = false;
  document.getElementById("fecha_adquisicion").value = obtenerFechaLocal();
  document.getElementById("modal-reposicion").classList.remove("hidden");
};

const abrirBaja = (prod) => {
  document.getElementById("baja-prod-id").value = prod.id;
  document.getElementById("form-baja").reset();
  document.getElementById("baja-cantidad").max = Number(prod.cantidad);
  document.getElementById("baja-fecha").value = obtenerFechaLocal();
  document.getElementById("modal-baja").classList.remove("hidden");
};

// El backend debe hacer: UPDATE productos.productos SET activo = false WHERE id = ...
const ocultarProducto = async (id) => {
  if (!confirm("¿Ocultar este producto? No se borrarán sus datos.")) return;
  try {
    await fetchAPI(`/productos/${id}/visibilidad`, "PATCH");
    mostrarToast("Producto oculto");
    cargarProductos();
  } catch (e) {
    alert(e.message);
  }
};

const eliminarProducto = async (id) => {
  if (!confirm("¿Eliminar definitivamente? Esta acción no se puede deshacer."))
    return;
  try {
    await fetchAPI(`/productos/${id}`, "DELETE");
    mostrarToast("Producto eliminado");
    cargarProductos();
  } catch (error) {
    if (error.status === 409) {
      if (
        confirm(
          "El producto tiene movimientos y no se puede eliminar. ¿Querés ocultarlo?",
        )
      ) {
        ocultarProducto(id);
      }
    } else {
      alert(error.message);
    }
  }
};
