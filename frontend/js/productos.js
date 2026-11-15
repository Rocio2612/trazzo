// Trazzo - Sprint 2 - Módulo 5: Productos
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
let timerBusqueda = null;
let ultimaCarga = 0; // evita que una respuesta vieja pise a una más nueva

document.addEventListener("DOMContentLoaded", () => {
  cargarProductos();
  cargarSelectores();
  configurarEventos();
});

// Escapa texto antes de meterlo en innerHTML (nombres cargados por usuarios).
const esc = (valor) =>
  String(valor ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

const mostrarToast = (msg) => {
  const toast = document.getElementById("toast");
  toast.textContent = msg;
  toast.classList.add("mostrar");
  setTimeout(() => toast.classList.remove("mostrar"), 2600);
};

const cargarSelectores = async () => {
  try {
    const respuesta = await fetchAPI("/proveedores");
    // Acepta tanto un array directo como { items: [...] }
    const provs = Array.isArray(respuesta) ? respuesta : respuesta?.items || [];

    const selectProv = document.getElementById("proveedor_id");
    const repoProv = document.getElementById("proveedor_id_repo");

    // Proveedor obligatorio: proveedor_id es NOT NULL en la base
    const provOpts =
      provs.length === 0
        ? '<option value="">Debe cargar proveedores primero</option>'
        : '<option value="">Seleccione proveedor...</option>' +
          provs
            .map((p) => `<option value="${p.id}">${esc(p.nombre)}</option>`)
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
  const miCarga = ++ultimaCarga;
  tbody.innerHTML =
    '<tr><td colspan="8" style="text-align:center;">Cargando...</td></tr>';

  const params = new URLSearchParams({
    q: document.getElementById("buscador").value.trim(),
    tipo_producto: "BIEN_DE_CAMBIO",
  });
  if (filtroStockBajo) params.set("stock_bajo", "true");
  if (verOcultos && esAdmin) params.set("ocultos", "true");

  try {
    const data = await fetchAPI(`/productos?${params.toString()}`);
    if (miCarga !== ultimaCarga) return; // llegó otra búsqueda más nueva
    if (!data) return; // sesión vencida: fetchAPI ya redirige al login

    const items = data.items || [];
    tbody.innerHTML = "";

    if (items.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="8" style="text-align:center; color:gray;">Sin productos</td></tr>';
      return;
    }

    items.forEach((prod) => {
      const tr = document.createElement("tr");

      // NUMERIC puede llegar como texto ("10.00"): se convierte antes de comparar.
      const cantidad = Number(prod.cantidad);
      const stockMinimo = Number(prod.stock_minimo);
      let stockHTML = `<span>${cantidad}</span>`;
      if (cantidad === 0)
        stockHTML = `<span class="badge badge-rojo">Sin stock</span>`;
      else if (cantidad <= stockMinimo)
        stockHTML = `<span class="badge badge-ambar">Stock bajo</span>`;

      let accionesHTML = `
        <button class="btn-icono" title="Reponer Stock">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
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
        <td>${esc(prod.nombre)}</td>
        <td>${esc(prod.categoria_nombre) || "—"}</td>
        <td>${formatearMoneda(prod.precio_compra)}</td>
        <td>${formatearMoneda(prod.precio_venta)}</td>
        <td>${stockHTML}</td>
        <td>${stockMinimo}</td>
        <td>${esc(prod.proveedor_nombre) || "—"}</td>
        <td><div class="acciones-flex">${accionesHTML}</div></td>
      `;

      tr.querySelector('[title="Reponer Stock"]').onclick = () =>
        abrirReposicion(prod);
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
    if (miCarga !== ultimaCarga) return;
    tbody.innerHTML =
      '<tr><td colspan="8" style="text-align:center; color:red;">Error al cargar</td></tr>';
  }
};

const configurarEventos = () => {
  // Buscador con debounce: espera 300 ms sin tipear antes de pedir al servidor
  document.getElementById("buscador").addEventListener("input", () => {
    clearTimeout(timerBusqueda);
    timerBusqueda = setTimeout(cargarProductos, 300);
  });

  document.getElementById("btn-stock-bajo").addEventListener("click", (e) => {
    filtroStockBajo = !filtroStockBajo;
    e.currentTarget.classList.toggle("activo", filtroStockBajo);
    cargarProductos();
  });

  const btnOcultos = document.getElementById("btn-ver-ocultos");
  // "Ver ocultos" es solo para Admin/Propietario
  if (!esAdmin) {
    btnOcultos.classList.add("hidden");
  } else {
    btnOcultos.addEventListener("click", (e) => {
      verOcultos = !verOcultos;
      e.currentTarget.classList.toggle("activo", verOcultos);
      cargarProductos();
    });
  }

  const validarAvisoPrecio = () => {
    const pv = document.getElementById("precio_venta").value;
    const pc = document.getElementById("precio_compra").value;
    const banner = document.getElementById("banner-precio-menor");
    if (precioMenorAlCosto(pv, pc)) banner.classList.remove("hidden");
    else banner.classList.add("hidden");
  };

  // Fórmula de precio sugerido
  const actualizarPrecioSugerido = () => {
    if (precioEditadoManual) {
      validarAvisoPrecio();
      return;
    }
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

  // Guardar producto
  document
    .getElementById("form-producto")
    .addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button[type="submit"]');
      btn.disabled = true;

      const payload = {
        nombre: document.getElementById("nombre").value.trim(),
        precio_compra: parseFloat(
          document.getElementById("precio_compra").value,
        ),
        rentabilidad:
          parseFloat(document.getElementById("rentabilidad").value) || 0,
        iva_alicuota: parseFloat(document.getElementById("iva_alicuota").value),
        precio_venta: parseFloat(document.getElementById("precio_venta").value),
        cantidad: parseInt(document.getElementById("cantidad").value, 10),
        stock_minimo: parseInt(
          document.getElementById("stock_minimo").value,
          10,
        ),
        // Obligatorio: productos.proveedor_id es NOT NULL
        proveedor_id: parseInt(
          document.getElementById("proveedor_id").value,
          10,
        ),
      };

      try {
        await fetchAPI("/productos", "POST", payload);
        document.getElementById("modal-producto").classList.add("hidden");
        mostrarToast("Producto creado");
        cargarProductos();
      } catch (error) {
        alert(error.message || "Error al guardar");
      } finally {
        btn.disabled = false;
      }
    });

  // Reposición: monto sugerido = cantidad × último costo (editable)
  document.getElementById("repo-cantidad").addEventListener("input", (e) => {
    if (montoRepoEditadoManual) return;
    const cant = parseInt(e.target.value, 10) || 0;
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
        cantidad: parseInt(document.getElementById("repo-cantidad").value, 10),
        monto_total: parseFloat(document.getElementById("monto_total").value),
        proveedor_id: parseInt(
          document.getElementById("proveedor_id_repo").value,
          10,
        ),
      };

      try {
        await fetchAPI(
          `/productos/${document.getElementById("repo-prod-id").value}/reposicion`,
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

  // Baja: "cantidad" se manda positiva; el backend arma el movimiento negativo.
  document.getElementById("form-baja").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;

    const payload = {
      cantidad: parseInt(document.getElementById("baja-cantidad").value, 10),
      motivo: document.getElementById("baja-motivo").value,
    };

    try {
      await fetchAPI(
        `/productos/${document.getElementById("baja-prod-id").value}/baja`,
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
      precioEditadoManual = false;
      document.getElementById("banner-precio-menor").classList.add("hidden");
      document.getElementById("modal-producto").classList.remove("hidden");
    });
};

const abrirReposicion = (prod) => {
  // reset() primero: si no, borraría los hidden que se cargan después
  document.getElementById("form-reposicion").reset();
  document.getElementById("repo-prod-id").value = prod.id;
  document.getElementById("repo-ultimo-costo").value = prod.precio_compra;
  montoRepoEditadoManual = false;
  document.getElementById("modal-reposicion").classList.remove("hidden");
};

const abrirBaja = (prod) => {
  document.getElementById("form-baja").reset();
  document.getElementById("baja-prod-id").value = prod.id;
  document.getElementById("baja-cantidad").max = Number(prod.cantidad);
  document.getElementById("modal-baja").classList.remove("hidden");
};

// El backend debe hacer: UPDATE productos.productos SET activo = false WHERE id = ...
const ocultarProducto = async (id) => {
  if (!confirm("¿Ocultar este producto? No se borrarán sus datos.")) return;
  try {
    await fetchAPI(`/productos/${id}/ocultar`, "PATCH");
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
