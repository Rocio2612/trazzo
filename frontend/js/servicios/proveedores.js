// --- HELPER DE PROVEEDORES PARA OTRAS PANTALLAS (módulo ES) ---
// Lo usan los selects de "Reposición de stock" (Productos e Insumos) para elegir el proveedor.
// Devuelve solo los proveedores visibles, es decir con `activo` (los ocultos no se ofrecen para registros nuevos).
// Funciona también con el rol Empleado: el Backend deja leer la lista (GET /proveedores) en modo lectura.
//
// Uso:
//   import { cargarProveedores, llenarSelectProveedores } from "./servicios/proveedores.js";
//   const proveedores = await cargarProveedores();
//   llenarSelectProveedores(select, proveedores);               // arma las opciones
//   if (proveedores.length === 0) contenedor.append(crearSinOpciones("proveedores"));
//
// Requiere api.js cargado antes (fetchAPI).

// [{ id, nombre, categoria_impositiva }]. Si el servicio no responde devuelve una lista vacía.
export const cargarProveedores = async () => {
  try {
    const data = await fetchAPI("/proveedores");
    const lista = Array.isArray(data) ? data : data?.items || [];
    return lista
      .filter((p) => p.activo !== false)
      .map((p) => ({ id: p.id, nombre: p.nombre, categoria_impositiva: p.categoria_impositiva }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  } catch {
    return [];
  }
};

// Reemplaza las opciones de un <select>: una primera opción vacía y un proveedor por opción.
// `valor` deja elegido un proveedor (por ejemplo, al editar).
export const llenarSelectProveedores = (select, proveedores, { valor = "", textoVacio = "Elegir proveedor…" } = {}) => {
  select.replaceChildren(new Option(proveedores.length === 0 ? "Sin proveedores" : textoVacio, ""));
  proveedores.forEach((p) => select.append(new Option(p.nombre, String(p.id))));
  select.value = String(valor ?? "");
  select.disabled = proveedores.length === 0;
};
