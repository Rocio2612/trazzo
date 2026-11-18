// Trazzo - Módulo 7: Clientes
import { formatearMoneda } from "./utils/productosUtils.js"; // Reutilizamos formateador del Sprint 2
import { rolDesdeToken, esRolAdmin } from "./utils/productosUtils.js"; // O roles.js si lo tienen ahí

const ROL_USUARIO = localStorage.getItem("trazzo_rol") || "ADMIN"; // Fallback para pruebas
const esAdmin = ["ADMIN", "PROPIETARIO"].includes(ROL_USUARIO.toUpperCase());

const $ = (id) => document.getElementById(id);
let clientesData = [];
let modoOcultos = false;
let editandoId = null;

// --- VALIDACIÓN DE CUIT (Algoritmo Módulo 11) ---
const validarCUIT = (cuit) => {
  if (!cuit) return false;
  const limpio = cuit.replace(/[^0-9]/g, "");
  if (limpio.length !== 11) return false;

  const multiplicadores = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  let suma = 0;
  for (let i = 0; i < 10; i++) suma += parseInt(limpio[i]) * multiplicadores[i];

  const resto = suma % 11;
  const digitoVerificador = resto === 0 ? 0 : resto === 1 ? 9 : 11 - resto;
  return digitoVerificador === parseInt(limpio[10]);
};

// --- UTILIDADES DE UI ---
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

// --- CARGA Y RENDERIZADO DE TABLA ---
const cargarClientes = async () => {
  const tbody = $("clientes-tbody");
  tbody.innerHTML =
    '<tr><td colspan="4" class="texto-vacio">Cargando...</td></tr>';

  try {
    // Enviamos el flag de ocultos si es admin
    const url = `/clientes${esAdmin && modoOcultos ? "?ocultos=true" : ""}`;
    const data = await fetchAPI(url);
    clientesData = data.items || data;

    renderizarTabla(clientesData);
  } catch (error) {
    tbody.innerHTML = `<tr><td colspan="4" class="texto-vacio" style="color:#dc3545;">Error al cargar clientes</td></tr>`;
  }
};

const renderizarTabla = (lista) => {
  const tbody = $("clientes-tbody");

  if (lista.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="texto-vacio">${modoOcultos ? "Sin elementos ocultos" : "Sin clientes"}</td></tr>`;
    return;
  }

  tbody.innerHTML = lista
    .map((c) => {
      // Si es Cajero, el back solo devuelve { id, nombre }. Respetamos lo que llegue.
      const doc =
        c.tipo_documento && c.numero_documento
          ? `${c.tipo_documento} ${c.numero_documento}`
          : "—";
      const cat = c.categoria_impositiva || "—";

      let acciones = `
            <button type="button" class="btn-icono" title="Ver ficha" onclick="abrirFicha(${c.id})">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
            </button>
        `;

      if (esAdmin && modoOcultos) {
        acciones += `
                <button type="button" class="btn-pz btn-pz-sec btn-chico" onclick="restaurarCliente(${c.id})" style="font-weight:600;">Restaurar</button>
                <button type="button" class="btn-icono rojo" title="Eliminar" onclick="eliminarCliente(${c.id})">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                </button>
            `;
      } else if (esAdmin) {
        acciones += `
                <button type="button" class="btn-icono" title="Editar" onclick="abrirModalEditar(${c.id})">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                </button>
                <button type="button" class="btn-icono" title="Ocultar" onclick="ocultarCliente(${c.id})">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>
                </button>
            `;
      }

      return `
            <tr>
                <td style="font-weight:600;">${c.nombre}</td>
                <td>${doc}</td>
                <td>${cat !== "—" ? `<span class="badge-gris">${cat.replace(/_/g, " ")}</span>` : "—"}</td>
                <td><div class="acciones-flex">${acciones}</div></td>
            </tr>
        `;
    })
    .join("");
};

// --- MODALES (Nuevo / Editar) ---
window.abrirModalNuevo = () => {
  editandoId = null;
  $("form-cliente").reset();
  $("modal-cliente-titulo").textContent = "Nuevo cliente";
  $("aviso-edicion").classList.add("hidden");
  limpiarErrores();
  abrirModal("modal-cliente");
  setTimeout(() => $("nombre").focus(), 100);
};

window.abrirModalEditar = (id) => {
  const c = clientesData.find((x) => x.id === id);
  if (!c) return;
  editandoId = id;
  $("form-cliente").reset();
  $("modal-cliente-titulo").textContent = "Editar cliente";
  $("aviso-edicion").classList.remove("hidden");
  limpiarErrores();

  $("nombre").value = c.nombre || "";
  $("telefono").value = c.telefono || "";
  $("correo").value = c.correo || "";
  $("tipo_documento").value = c.tipo_documento || "";
  $("numero_documento").value = c.numero_documento || "";
  $("domicilio").value = c.domicilio || "";
  $("categoria_impositiva").value = c.categoria_impositiva || "";

  validarDocumentoUI();
  abrirModal("modal-cliente");
};

window.abrirFicha = async (id) => {
  try {
    const c = await fetchAPI(`/clientes/${id}`);
    if (!esAdmin) {
      // CAJERO: Ficha reducida, sin datos sensibles.
      $("ficha-contenido").innerHTML = `
                <div style="margin-bottom:1rem;">
                    <div style="font-size:0.72rem; color:#8c8c8c; text-transform:uppercase; font-weight:600;">Nombre completo o razón social</div>
                    <div style="font-size:1.2rem; font-weight:600;">${c.nombre}</div>
                </div>
                <p style="font-size:0.8rem; color:#6c757d; border-top:1px solid #dee2e6; padding-top:1rem;">
                    Por la Ley 25.326 de Protección de Datos Personales, solo se muestran los datos necesarios para completar la operación.
                </p>
            `;
    } else {
      // ADMIN: Ficha completa
      const saldo = c.saldo_cuenta_corriente || 0;
      const colorSaldo =
        saldo > 0 ? "#b02a37" : saldo < 0 ? "#146c43" : "#212529";

      $("ficha-contenido").innerHTML = `
                <div style="margin-bottom:1rem;">
                    <div style="font-size:0.72rem; color:#8c8c8c; text-transform:uppercase; font-weight:600;">Nombre completo o razón social</div>
                    <div style="font-size:1.2rem; font-weight:600;">${c.nombre}</div>
                </div>
                <div style="border-top:1px solid #dee2e6; padding:1rem 0;">
                    <h4 style="font-size:0.9rem; font-weight:600; margin-bottom:0.8rem; margin-top:0;">Identificación</h4>
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.8rem 1.25rem;">
                        <div><div style="font-size:0.72rem; color:#8c8c8c; text-transform:uppercase; font-weight:600;">Tipo de Documento</div><div style="font-size:0.92rem;">${c.tipo_documento || "—"}</div></div>
                        <div><div style="font-size:0.72rem; color:#8c8c8c; text-transform:uppercase; font-weight:600;">Número de Documento</div><div style="font-size:0.92rem;">${c.numero_documento || "—"}</div></div>
                        <div style="grid-column:1/-1;"><div style="font-size:0.72rem; color:#8c8c8c; text-transform:uppercase; font-weight:600;">Categoría Impositiva</div><div style="font-size:0.92rem;">${(c.categoria_impositiva || "—").replace(/_/g, " ")}</div></div>
                    </div>
                </div>
                <div style="border-top:1px solid #dee2e6; padding:1rem 0;">
                    <h4 style="font-size:0.9rem; font-weight:600; margin-bottom:0.8rem; margin-top:0;">Contacto</h4>
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.8rem 1.25rem;">
                        <div><div style="font-size:0.72rem; color:#8c8c8c; text-transform:uppercase; font-weight:600;">Teléfono</div><div style="font-size:0.92rem;">${c.telefono || "—"}</div></div>
                        <div><div style="font-size:0.72rem; color:#8c8c8c; text-transform:uppercase; font-weight:600;">Correo Electrónico</div><div style="font-size:0.92rem;">${c.correo || "—"}</div></div>
                        <div style="grid-column:1/-1;"><div style="font-size:0.72rem; color:#8c8c8c; text-transform:uppercase; font-weight:600;">Domicilio</div><div style="font-size:0.92rem;">${c.domicilio || "—"}</div></div>
                    </div>
                </div>
                <div style="border-top:1px solid #dee2e6; padding:1rem 0;">
                    <h4 style="font-size:0.9rem; font-weight:600; margin-bottom:0.8rem; margin-top:0;">Movimientos</h4>
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.8rem 1.25rem;">
                        <div><div style="font-size:0.72rem; color:#8c8c8c; text-transform:uppercase; font-weight:600;">Ventas Registradas</div><div style="font-size:0.92rem;">${c.cantidad_ventas || 0}</div></div>
                        <div><div style="font-size:0.72rem; color:#8c8c8c; text-transform:uppercase; font-weight:600;">Saldo Cta. Cte.</div><div style="font-size:0.92rem; color:${colorSaldo}; font-weight:600;">${formatearMoneda(saldo)}</div></div>
                    </div>
                </div>
            `;
    }
    $("btn-ficha-editar").classList.toggle("hidden", !esAdmin);
    $("btn-ficha-editar").onclick = () => {
      cerrarModal("modal-ficha");
      abrirModalEditar(id);
    };
    abrirModal("modal-ficha");
  } catch (e) {
    mostrarToast("Error al cargar la ficha", true);
  }
};

// --- VALIDACIONES UI ---
const limpiarErrores = () => {
  document
    .querySelectorAll(".error-message")
    .forEach((el) => (el.style.display = "none"));
  document
    .querySelectorAll(".form-control")
    .forEach((el) => el.classList.remove("error"));
};

const validarDocumentoUI = () => {
  const tipo = $("tipo_documento").value;
  const num = $("numero_documento").value;
  const ayuda = $("ayuda-documento");

  if (!tipo) {
    ayuda.textContent = "Elegí primero el tipo de documento.";
    ayuda.className = "ayuda";
    return false;
  }
  if (tipo === "CUIT" || tipo === "CUIL") {
    if (num.length === 0) {
      ayuda.textContent = "Formato XX-XXXXXXXXX-X (11 dígitos).";
      ayuda.className = "ayuda";
      return false;
    }
    if (validarCUIT(num)) {
      ayuda.textContent = "✓ Formato válido.";
      ayuda.className = "ayuda valido";
      return true;
    } else {
      ayuda.textContent = "× El formato no es válido.";
      ayuda.className = "ayuda";
      return false;
    }
  }
  if (tipo === "DNI") {
    ayuda.textContent = "7 u 8 dígitos, sin puntos.";
    ayuda.className = "ayuda";
    return /^\d{7,8}$/.test(num.replace(/[^0-9]/g, ""));
  }
  return false;
};

// --- SUBMIT (Guardar) ---
$("form-cliente").addEventListener("submit", async (e) => {
  e.preventDefault();
  limpiarErrores();
  let valido = true;

  if (!$("nombre").value.trim()) {
    $("nombre").classList.add("error");
    $("error-nombre").style.display = "block";
    valido = false;
  }
  if (!$("telefono").value.trim()) {
    $("telefono").classList.add("error");
    $("error-telefono").style.display = "block";
    valido = false;
  }
  if (!$("correo").value.trim()) {
    $("correo").classList.add("error");
    $("error-correo").style.display = "block";
    valido = false;
  }
  if (!$("tipo_documento").value) {
    $("tipo_documento").classList.add("error");
    $("error-tipo_documento").style.display = "block";
    valido = false;
  }
  if (!$("numero_documento").value) {
    $("numero_documento").classList.add("error");
    $("error-numero_documento").style.display = "block";
    valido = false;
  }
  if (!$("domicilio").value.trim()) {
    $("domicilio").classList.add("error");
    $("error-domicilio").style.display = "block";
    valido = false;
  }
  if (!$("categoria_impositiva").value) {
    $("categoria_impositiva").classList.add("error");
    $("error-categoria_impositiva").style.display = "block";
    valido = false;
  }

  if (!valido) return;

  const btn = $("btn-guardar-cliente");
  btn.disabled = true;
  btn.textContent = "Guardando...";

  const payload = {
    nombre: $("nombre").value.trim(),
    telefono: $("telefono").value.trim(),
    correo: $("correo").value.trim(),
    tipo_documento: $("tipo_documento").value,
    numero_documento: $("numero_documento").value.trim(),
    domicilio: $("domicilio").value.trim(),
    categoria_impositiva: $("categoria_impositiva").value,
  };

  try {
    if (editandoId) {
      await fetchAPI(`/clientes/${editandoId}`, "PUT", payload);
    } else {
      await fetchAPI("/clientes", "POST", payload);
    }
    cerrarModal("modal-cliente");
    mostrarToast(editandoId ? "Cliente actualizado" : "Cliente creado");
    cargarClientes();
  } catch (error) {
    if (error.message.toLowerCase().includes("documento")) {
      $("numero_documento").classList.add("error");
      $("error-numero_documento").textContent = error.message;
      $("error-numero_documento").style.display = "block";
    } else {
      mostrarToast(error.message, true);
    }
  } finally {
    btn.disabled = false;
    btn.textContent = "Guardar";
  }
});

// --- ACCIONES (Ocultar, Restaurar, Eliminar) ---
window.ocultarCliente = async (id) => {
  if (
    !confirm(
      "¿Ocultar este cliente? Dejará de verse en ventas nuevas, pero se conserva su historial.",
    )
  )
    return;
  try {
    await fetchAPI(`/clientes/${id}/visibilidad`, "PATCH");
    mostrarToast("Cliente oculto");
    cargarClientes();
  } catch (e) {
    mostrarToast(e.message, true);
  }
};

window.restaurarCliente = async (id) => {
  try {
    await fetchAPI(`/clientes/${id}/visibilidad`, "PATCH");
    mostrarToast("Cliente restaurado");
    cargarClientes();
  } catch (e) {
    mostrarToast(e.message, true);
  }
};

window.eliminarCliente = async (id) => {
  if (
    !confirm(
      "¿Eliminar este cliente definitivamente? Esta acción no se puede deshacer.",
    )
  )
    return;
  try {
    await fetchAPI(`/clientes/${id}`, "DELETE");
    mostrarToast("Cliente eliminado");
    cargarClientes();
  } catch (error) {
    if (error.status === 409) {
      $("texto-error-eliminar").textContent =
        error.message ||
        "No se puede eliminar el cliente porque tiene ventas registradas o saldo en cuenta corriente.";
      abrirModal("modal-error-eliminar");
    } else {
      mostrarToast(error.message, true);
    }
  }
};

// --- INIT ---
document.addEventListener("DOMContentLoaded", () => {
  if (!esAdmin) {
    // Modo Cajero: ocultamos el botón de nuevo cliente
    document
      .querySelectorAll(".solo-admin")
      .forEach((el) => el.classList.add("hidden"));
  }

  cargarClientes();

  $("btn-nuevo-cliente").addEventListener("click", () =>
    window.abrirModalNuevo(),
  );

  $("buscador").addEventListener("input", (e) => {
    const texto = e.target.value.toLowerCase();
    const filtrados = clientesData.filter(
      (c) =>
        c.nombre.toLowerCase().includes(texto) ||
        (c.numero_documento && c.numero_documento.includes(texto)) ||
        (c.correo && c.correo.toLowerCase().includes(texto)),
    );
    renderizarTabla(filtrados);
  });

  $("btn-ver-ocultos").addEventListener("click", (e) => {
    modoOcultos = !modoOcultos;
    e.target.classList.toggle("activo", modoOcultos);
    cargarClientes();
  });

  $("numero_documento").addEventListener("input", validarDocumentoUI);
  $("tipo_documento").addEventListener("change", validarDocumentoUI);

  // Cerrar modales con el botón ✕ o Cancelar
  document.querySelectorAll("[data-cerrar]").forEach((el) => {
    el.addEventListener("click", () => cerrarModal(el.dataset.cerrar));
  });

  // Cerrar modales haciendo clic afuera
  document.querySelectorAll(".modal-backdrop").forEach((fondo) => {
    fondo.addEventListener("mousedown", (e) => {
      if (e.target === fondo) fondo.classList.add("hidden");
    });
  });
});
