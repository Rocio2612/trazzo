// Trazzo - Sprint 2 - Módulo 5: Productos
// fetchAPI (api.js) y API_URL (config.js) son globales: los usa js/servicios/productos.js.
import {
  calcularPrecioVenta,
  precioMenorAlCosto,
  calcularMontoReposicion,
  formatearMoneda,
  estadoStock,
  escaparHTML as esc,
  rolDesdeToken,
  esRolAdmin,
  mensajeDeError,
} from "./utils/productosUtils.js";
import { servicioProductos } from "./servicios/productos.js";
import {
  cargarProveedores,
  llenarSelectProveedores,
} from "./servicios/proveedores.js";

// La base guarda el rol en mayúsculas: PROPIETARIO, ADMIN o CAJERO.
const esAdmin = esRolAdmin(
  rolDesdeToken(localStorage.getItem("trazzo_access_token")) || "CAJERO",
);

const $ = (id) => document.getElementById(id);

const estado = {
  stockBajo: false,
  ocultos: false,
  precioManual: false,
  montoRepoManual: false,
  proveedores: [],
  productos: new Map(),
  productoEnEdicion: null,
  cargaActual: 0,
  timerBusqueda: null,
};

// ---------- utilidades de pantalla ----------
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

const abrirModal = (id) => $(id).classList.remove("hidden");
const cerrarModal = (id) => $(id).classList.add("hidden");

const ICONOS = {
  reponer:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>',
  baja: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"></polyline><polyline points="17 18 23 18 23 12"></polyline></svg>',
  editar:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>',
  ocultar:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>',
  eliminar:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>',
};

const boton = (accion, titulo, id) =>
  `<button type="button" class="btn-icono" data-accion="${accion}" data-id="${esc(id)}" title="${titulo}" aria-label="${titulo}">${ICONOS[accion]}</button>`;

// ---------- tabla ----------
const mensajeEnTabla = (texto, esError = false) => {
  $("productos-tbody").innerHTML =
    `<tr class="fila-mensaje${esError ? " error" : ""}"><td colspan="8">${esc(texto)}</td></tr>`;
};

const renderizarTabla = (productos) => {
  const tbody = $("productos-tbody");
  estado.productos = new Map(productos.map((p) => [String(p.id), p]));

  if (productos.length === 0) {
    mensajeEnTabla("Sin productos");
    return;
  }

  tbody.innerHTML = productos
    .map((prod) => {
      const cantidad = Number(prod.cantidad);
      const minimo = Number(prod.stock_minimo);
      const nivel = estadoStock(cantidad, minimo);
      const insignia =
        nivel === "SIN_STOCK"
          ? '<span class="badge badge-rojo">Sin stock</span>'
          : nivel === "BAJO"
            ? '<span class="badge badge-ambar">Stock bajo</span>'
            : "";
      const oculto = prod.activo === false;

      let acciones = boton("reponer", "Reponer stock", prod.id);
      acciones += boton("baja", "Dar de baja", prod.id);

      // TODO: Cuando el back implemente PUT, PATCH y DELETE, descomentar esto.
      /*
      if (esAdmin) {
        acciones += boton("editar", "Editar", prod.id);
        acciones += boton("ocultar", "Ocultar", prod.id);
        acciones += boton("eliminar", "Eliminar", prod.id);
      }
      */

      // Como el back actual no hace JOIN, mostramos guiones en cat y prov.
      return `
        <tr class="${oculto ? "fila-oculta" : ""}" data-id="${esc(prod.id)}">
          <td>${esc(prod.nombre)}${oculto ? '<span class="badge badge-gris">Oculto</span>' : ""}</td>
          <td>—</td> <!-- categoria_nombre -->
          <td>${formatearMoneda(prod.precio_compra)}</td>
          <td>${formatearMoneda(prod.precio_venta)}</td>
          <td>${cantidad}${insignia}</td>
          <td>${minimo}</td>
          <td>—</td> <!-- proveedor_nombre -->
          <td><div class="acciones-flex">${acciones}</div></td>
        </tr>`;
    })
    .join("");
};

const cargarProductos = async () => {
  const miCarga = ++estado.cargaActual;
  mensajeEnTabla("Cargando...");
  try {
    const productos = await servicioProductos.listar({
      q: $("buscador").value.trim(),
      stockBajo: estado.stockBajo,
      ocultos: estado.ocultos && esAdmin,
    });
    if (miCarga !== estado.cargaActual) return;
    renderizarTabla(productos);
  } catch (error) {
    if (miCarga !== estado.cargaActual) return;
    console.error(error);
    mensajeEnTabla(
      mensajeDeError(error, "Error al cargar los productos"),
      true,
    );
  }
};

const cargarListaProveedores = async () => {
  estado.proveedores = await cargarProveedores();
  llenarSelectProveedores($("proveedor_id"), estado.proveedores, {
    valor: $("proveedor_id").value,
  });
  llenarSelectProveedores($("proveedor_id_repo"), estado.proveedores, {
    valor: $("proveedor_id_repo").value,
  });
};

// ---------- modal nuevo / editar ----------
const validarAvisoPrecio = () => {
  const menor = precioMenorAlCosto(
    $("precio_venta").value,
    $("precio_compra").value,
  );
  $("banner-precio-menor").classList.toggle("hidden", !menor);
};

const sugerirPrecio = () => {
  if (estado.precioManual) {
    validarAvisoPrecio();
    return;
  }
  const sugerido = calcularPrecioVenta(
    $("precio_compra").value,
    $("rentabilidad").value,
    $("iva_alicuota").value,
  );
  if (sugerido > 0) $("precio_venta").value = sugerido;
  validarAvisoPrecio();
};

const abrirModalProducto = (prod = null) => {
  estado.productoEnEdicion = prod;
  $("form-producto").reset();
  llenarSelectProveedores($("proveedor_id"), estado.proveedores, {
    valor: prod?.proveedor_id ?? "",
  });

  const editando = prod !== null;
  $("modal-producto-titulo").textContent = editando
    ? "Editar producto"
    : "Nuevo producto";
  $("precio_compra").disabled = editando;
  $("cantidad").disabled = editando;
  $("ayuda-costo").classList.toggle("hidden", !editando);
  $("ayuda-stock").classList.toggle("hidden", !editando);
  estado.precioManual = editando;

  if (editando) {
    $("nombre").value = prod.nombre ?? "";
    $("precio_compra").value = Number(prod.precio_compra);
    $("rentabilidad").value = Number(prod.rentabilidad) || 0;
    $("iva_alicuota").value = String(Number(prod.iva_alicuota));
    $("precio_venta").value = Number(prod.precio_venta);
    $("cantidad").value = Number(prod.cantidad);
    $("stock_minimo").value = Number(prod.stock_minimo);
  }
  validarAvisoPrecio();
  abrirModal("modal-producto");
  $("nombre").focus();
};

const guardarProducto = async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  const editando = estado.productoEnEdicion !== null;

  const datos = {
    nombre: $("nombre").value.trim(),
    iva_alicuota: parseFloat($("iva_alicuota").value),
    rentabilidad: parseFloat($("rentabilidad").value) || 0,
    precio_venta: parseFloat($("precio_venta").value),
    stock_minimo: parseFloat($("stock_minimo").value),
  };
  const proveedorId = parseInt($("proveedor_id").value, 10);
  if (Number.isInteger(proveedorId)) datos.proveedor_id = proveedorId;

  if (!editando) {
    datos.precio_compra = parseFloat($("precio_compra").value);
    datos.cantidad = parseFloat($("cantidad").value);
  }

  if (!datos.nombre)
    return mostrarToast("Ingresá el nombre del producto.", true);
  if (!editando && !(datos.precio_compra > 0))
    return mostrarToast("Ingresá un precio de compra mayor a 0.", true);
  if (!(datos.precio_venta > 0))
    return mostrarToast("Ingresá un precio de venta mayor a 0.", true);
  if (!editando && (!Number.isInteger(datos.cantidad) || datos.cantidad < 0))
    return mostrarToast("Ingresá el stock actual.", true);
  if (!Number.isInteger(datos.stock_minimo) || datos.stock_minimo < 0)
    return mostrarToast("Ingresá el stock mínimo.", true);
  if (!datos.proveedor_id)
    return mostrarToast(
      "Elegí un proveedor. Si no hay, cargalos primero en Proveedores.",
      true,
    );

  btn.disabled = true;
  try {
    if (editando) {
      await servicioProductos.actualizar(estado.productoEnEdicion.id, datos);
    } else {
      await servicioProductos.crear(datos);
    }
    cerrarModal("modal-producto");
    mostrarToast(editando ? "Producto actualizado" : "Producto creado");
    cargarProductos();
  } catch (error) {
    mostrarToast(
      mensajeDeError(error, "No se pudo guardar el producto."),
      true,
    );
  } finally {
    btn.disabled = false;
  }
};

// ---------- modal reposición ----------
const abrirReposicion = (prod) => {
  $("form-reposicion").reset();
  $("repo-prod-nombre").textContent = prod.nombre;
  $("repo-prod-nombre").dataset.id = prod.id;
  $("repo-prod-nombre").dataset.costo = Number(prod.precio_compra) || 0;
  llenarSelectProveedores($("proveedor_id_repo"), estado.proveedores, {
    valor: prod.proveedor_id ?? "",
  });
  estado.montoRepoManual = false;
  abrirModal("modal-reposicion");
  $("repo-cantidad").focus();
};

const guardarReposicion = async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  const datos = {
    cantidad: parseFloat($("repo-cantidad").value),
    monto_total: parseFloat($("monto_total").value),
    proveedor_id: parseInt($("proveedor_id_repo").value, 10),
  };
  if (!Number.isInteger(datos.cantidad) || datos.cantidad < 1)
    return mostrarToast("Ingresá una cantidad válida.", true);
  if (!(datos.monto_total > 0))
    return mostrarToast("Ingresá el monto total.", true);
  if (!Number.isInteger(datos.proveedor_id))
    return mostrarToast(
      "Elegí un proveedor. Si no hay, cargalos primero en Proveedores.",
      true,
    );

  btn.disabled = true;
  try {
    await servicioProductos.reponer($("repo-prod-nombre").dataset.id, datos);
    cerrarModal("modal-reposicion");
    mostrarToast("Reposición registrada");
    cargarProductos();
  } catch (error) {
    mostrarToast(
      mensajeDeError(error, "No se pudo registrar la reposición."),
      true,
    );
  } finally {
    btn.disabled = false;
  }
};

// ---------- modal baja ----------
const abrirBaja = (prod) => {
  $("form-baja").reset();
  $("baja-prod-nombre").textContent = prod.nombre;
  $("baja-prod-nombre").dataset.id = prod.id;
  $("baja-prod-nombre").dataset.stock = Number(prod.cantidad);
  $("baja-cantidad").max = Number(prod.cantidad);
  $("baja-stock-actual").textContent = `Stock actual: ${Number(prod.cantidad)}`;
  abrirModal("modal-baja");
  $("baja-cantidad").focus();
};

const guardarBaja = async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  const stock = Number($("baja-prod-nombre").dataset.stock);
  const datos = {
    cantidad: parseFloat($("baja-cantidad").value),
    motivo: $("baja-motivo").value,
  };
  if (!Number.isInteger(datos.cantidad) || datos.cantidad < 1)
    return mostrarToast("Ingresá una cantidad válida.", true);
  if (datos.cantidad > stock)
    return mostrarToast(
      `No podés dar de baja más del stock actual (${stock}).`,
      true,
    );

  btn.disabled = true;
  try {
    await servicioProductos.registrarBaja(
      $("baja-prod-nombre").dataset.id,
      datos,
    );
    cerrarModal("modal-baja");
    mostrarToast("Baja registrada");
    cargarProductos();
  } catch (error) {
    mostrarToast(mensajeDeError(error, "No se pudo registrar la baja."), true);
  } finally {
    btn.disabled = false;
  }
};

// ---------- ocultar / eliminar (solo Admin) ----------
const ocultarProducto = async (id) => {
  if (!confirm("¿Ocultar este producto? No se borrarán sus datos.")) return;
  try {
    await servicioProductos.ocultar(id);
    mostrarToast("Producto oculto");
    cargarProductos();
  } catch (error) {
    mostrarToast(
      mensajeDeError(error, "No se pudo ocultar el producto."),
      true,
    );
  }
};

const eliminarProducto = async (id) => {
  if (!confirm("¿Eliminar definitivamente? Esta acción no se puede deshacer."))
    return;
  try {
    await servicioProductos.eliminar(id);
    mostrarToast("Producto eliminado");
    cargarProductos();
  } catch (error) {
    if (error.status === 409) {
      if (
        confirm(
          "El producto tiene movimientos y no se puede eliminar. ¿Querés ocultarlo?",
        )
      )
        ocultarProducto(id);
    } else {
      mostrarToast(
        mensajeDeError(error, "No se pudo eliminar el producto."),
        true,
      );
    }
  }
};

// ---------- eventos ----------
const configurarEventos = () => {
  document
    .querySelectorAll("[data-cerrar]")
    .forEach((el) =>
      el.addEventListener("click", () => cerrarModal(el.dataset.cerrar)),
    );
  document.querySelectorAll(".modal-backdrop").forEach((fondo) =>
    fondo.addEventListener("mousedown", (e) => {
      if (e.target === fondo) fondo.classList.add("hidden");
    }),
  );
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape")
      document
        .querySelectorAll(".modal-backdrop")
        .forEach((m) => m.classList.add("hidden"));
  });

  $("buscador").addEventListener("input", () => {
    clearTimeout(estado.timerBusqueda);
    estado.timerBusqueda = setTimeout(cargarProductos, 300);
  });
  $("btn-stock-bajo").addEventListener("click", (e) => {
    estado.stockBajo = !estado.stockBajo;
    e.currentTarget.classList.toggle("activo", estado.stockBajo);
    cargarProductos();
  });
  const btnOcultos = $("btn-ver-ocultos");
  if (esAdmin) {
    btnOcultos.classList.remove("hidden");
    btnOcultos.addEventListener("click", (e) => {
      estado.ocultos = !estado.ocultos;
      e.currentTarget.classList.toggle("activo", estado.ocultos);
      cargarProductos();
    });
  }

  $("productos-tbody").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-accion]");
    if (!btn) return;
    const prod = estado.productos.get(btn.dataset.id);
    if (!prod) return;
    const acciones = {
      reponer: () => abrirReposicion(prod),
      baja: () => abrirBaja(prod),
      editar: () => esAdmin && abrirModalProducto(prod),
      ocultar: () => esAdmin && ocultarProducto(prod.id),
      eliminar: () => esAdmin && eliminarProducto(prod.id),
    };
    acciones[btn.dataset.accion]?.();
  });

  $("btn-nuevo-producto").addEventListener("click", () => abrirModalProducto());
  ["precio_compra", "rentabilidad", "iva_alicuota"].forEach((id) =>
    $(id).addEventListener("input", sugerirPrecio),
  );
  $("iva_alicuota").addEventListener("change", sugerirPrecio);
  $("precio_venta").addEventListener("input", () => {
    estado.precioManual = true;
    validarAvisoPrecio();
  });
  $("form-producto").addEventListener("submit", guardarProducto);

  $("repo-cantidad").addEventListener("input", (e) => {
    if (estado.montoRepoManual) return;
    const costo = Number($("repo-prod-nombre").dataset.costo) || 0;
    const monto = calcularMontoReposicion(e.target.value, costo);
    $("monto_total").value = monto > 0 ? monto : "";
  });
  $("monto_total").addEventListener("input", () => {
    estado.montoRepoManual = true;
  });
  $("form-reposicion").addEventListener("submit", guardarReposicion);

  $("form-baja").addEventListener("submit", guardarBaja);
};

document.addEventListener("DOMContentLoaded", async () => {
  configurarEventos();
  cargarListaProveedores();
  cargarProductos();
});
