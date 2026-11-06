// --- DATOS SIMULADOS DE PROVEEDORES (hasta que Back publique /api/proveedores) ---
// Mientras tanto los datos viven en memoria y se pierden al recargar. Cuando exista el Backend solo hay
// que reemplazar el contenido de estas funciones por llamadas a fetchAPI (cada una ya es asíncrona):
//   GET/POST /proveedores · PUT /proveedores/{id} · PATCH /proveedores/{id}/ocultar | /mostrar · DELETE /proveedores/{id}
// `tiene_movimientos` lo calcula el Backend: es verdadero si el proveedor tiene reposiciones o insumos.
// Los nombres de campo son provisorios hasta cerrar el contrato con Back.

import { obtenerSesion } from "../sesion.js";
import { buscarProveedores, filtrarProveedores, formatearDocumento, MOTIVO_CON_MOVIMIENTOS, soloDigitos } from "../proveedores.js";

const errorDeCampo = (campo, mensaje) => Object.assign(new Error(mensaje), { errores: { [campo]: mensaje } });

export const PROVEEDORES_EJEMPLO = [
  { id: 1, creado_por_nombre: "admin1", nombre: "Envases del Sur S.A.", tipo_documento: "CUIT", numero_documento: "30712345671", telefono: "11 4444-5555", correo: "ventas@envasesdelsur.com", categoria_impositiva: "RESPONSABLE_INSCRIPTO", descripcion_compra: "Distribuidor de envases y cajas de cartón", oculto: false, tiene_movimientos: true },
  { id: 2, creado_por_nombre: "admin1", nombre: "Bebidas Don Raúl", tipo_documento: "CUIT", numero_documento: "30500001735", telefono: "11 5555-6666", correo: null, categoria_impositiva: "RESPONSABLE_INSCRIPTO", descripcion_compra: "Proveedor de bebidas línea blanca", oculto: false, tiene_movimientos: true },
  { id: 3, creado_por_nombre: "admin2", nombre: "Marta Giménez", tipo_documento: "CUIL", numero_documento: "20123456786", telefono: null, correo: "marta@correo.com", categoria_impositiva: "MONOTRIBUTISTA", descripcion_compra: "Verduras y frutas de estación", oculto: false, tiene_movimientos: false },
  { id: 4, creado_por_nombre: "admin1", nombre: "Cooperativa La Esperanza", tipo_documento: "CUIT", numero_documento: "33712345670", telefono: "11 6666-7777", correo: null, categoria_impositiva: "EXENTO", descripcion_compra: null, oculto: true, tiene_movimientos: false },
  { id: 5, creado_por_nombre: "admin2", nombre: "Librería Central", tipo_documento: "CUIT", numero_documento: "30700000016", telefono: null, correo: null, categoria_impositiva: "RESPONSABLE_INSCRIPTO", descripcion_compra: "Papelería y útiles", oculto: true, tiene_movimientos: true },
];

const proveedores = PROVEEDORES_EJEMPLO.map((p) => ({ ...p }));
let siguienteId = Math.max(0, ...proveedores.map((p) => p.id)) + 1;

const buscar = (id) => proveedores.find((p) => p.id === id);

// Un mismo documento (tipo y número) no puede repetirse.
const verificarDocumentoUnico = (datos, idActual = null) => {
  const repetido = proveedores.some(
    (p) => p.id !== idActual && p.tipo_documento === datos.tipo_documento && soloDigitos(p.numero_documento) === soloDigitos(datos.numero_documento),
  );
  if (repetido) {
    throw errorDeCampo("numero_documento", `Ya hay un proveedor con ese ${datos.tipo_documento} (${formatearDocumento(datos.tipo_documento, datos.numero_documento)}).`);
  }
};

export const servicioProveedores = {
  // Simula GET /proveedores?q=&ocultos=
  listar: async ({ q = "", ocultos = false } = {}) =>
    buscarProveedores(filtrarProveedores(proveedores, { ocultos }), q).map((p) => ({ ...p })),
  crear: async (datos) => {
    verificarDocumentoUnico(datos);
    // El Backend toma quién lo creó del token; acá se simula con el usuario de la sesión.
    const proveedor = { id: siguienteId++, creado_por_nombre: obtenerSesion().usuario, ...datos, oculto: false, tiene_movimientos: false };
    proveedores.push(proveedor);
    return { ...proveedor };
  },
  actualizar: async (id, datos) => {
    verificarDocumentoUnico(datos, id);
    return { ...Object.assign(buscar(id), datos) };
  },
  cambiarOculto: async (id, oculto) => ({ ...Object.assign(buscar(id), { oculto }) }),
  eliminar: async (id) => {
    const proveedor = buscar(id);
    if (proveedor.tiene_movimientos) throw new Error(MOTIVO_CON_MOVIMIENTOS);
    proveedores.splice(proveedores.indexOf(proveedor), 1);
  },
};
