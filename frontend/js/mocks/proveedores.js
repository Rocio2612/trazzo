// --- DATOS SIMULADOS DE PROVEEDORES (hasta que Back publique /api/proveedores) ---
// Mientras tanto los datos viven en memoria y se pierden al recargar. Cuando exista el Backend solo hay
// que reemplazar el contenido de estas funciones por llamadas a fetchAPI (cada una ya es asíncrona):
//   GET/POST /proveedores · PUT /proveedores/{id} · PATCH /proveedores/{id}/ocultar | /mostrar · DELETE /proveedores/{id}
// `tiene_movimientos` lo calcula el Backend: es verdadero si el proveedor tiene productos o reposiciones asociados.
// Los nombres de campo son provisorios hasta cerrar el contrato con Back.
// La tabla productos.proveedores no guarda quién creó al proveedor, así que la pantalla no muestra "Creado por".

import { buscarProveedores, filtrarProveedores, formatearDocumento, MOTIVO_CON_MOVIMIENTOS, soloDigitos } from "../proveedores.js";

const errorDeCampo = (campo, mensaje) => Object.assign(new Error(mensaje), { errores: { [campo]: mensaje } });

export const PROVEEDORES_EJEMPLO = [
  { id: 1, nombre: "Envases del Sur S.A.", tipo_documento: "CUIT", numero_documento: "30712345671", telefono: "11 4444-5555", correo: "ventas@envasesdelsur.com", categoria_impositiva: "RESPONSABLE_INSCRIPTO", descripcion_compra: "Distribuidor de envases y cajas de cartón", activo: true, tiene_movimientos: true },
  { id: 2, nombre: "Bebidas Don Raúl", tipo_documento: "CUIT", numero_documento: "30500001735", telefono: "11 5555-6666", correo: null, categoria_impositiva: "RESPONSABLE_INSCRIPTO", descripcion_compra: "Proveedor de bebidas línea blanca", activo: true, tiene_movimientos: true },
  { id: 3, nombre: "Marta Giménez", tipo_documento: "CUIL", numero_documento: "20123456786", telefono: null, correo: "marta@correo.com", categoria_impositiva: "MONOTRIBUTISTA", descripcion_compra: "Verduras y frutas de estación", activo: true, tiene_movimientos: false },
  { id: 4, nombre: "Cooperativa La Esperanza", tipo_documento: "CUIT", numero_documento: "33712345670", telefono: "11 6666-7777", correo: null, categoria_impositiva: "EXENTO", descripcion_compra: null, activo: false, tiene_movimientos: false },
  { id: 5, nombre: "Librería Central", tipo_documento: "CUIT", numero_documento: "30700000016", telefono: null, correo: null, categoria_impositiva: "RESPONSABLE_INSCRIPTO", descripcion_compra: "Papelería y útiles", activo: false, tiene_movimientos: true },
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
    const proveedor = { id: siguienteId++, ...datos, activo: true, tiene_movimientos: false };
    proveedores.push(proveedor);
    return { ...proveedor };
  },
  actualizar: async (id, datos) => {
    verificarDocumentoUnico(datos, id);
    return { ...Object.assign(buscar(id), datos) };
  },
  cambiarOculto: async (id, oculto) => ({ ...Object.assign(buscar(id), { activo: !oculto }) }),
  eliminar: async (id) => {
    const proveedor = buscar(id);
    if (proveedor.tiene_movimientos) throw new Error(MOTIVO_CON_MOVIMIENTOS);
    proveedores.splice(proveedores.indexOf(proveedor), 1);
  },
};
