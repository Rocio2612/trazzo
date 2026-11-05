// --- LÓGICA DEL MÓDULO DE PROVEEDORES (módulo ES, sin pantalla) ---
// Reglas del Módulo 10: ficha del proveedor (documento con validación de CUIT, categoría impositiva,
// descripción de compra), búsqueda y cuándo se puede eliminar. El Backend repite todas las reglas:
// esto es solo UX. Los nombres de campo son provisorios hasta cerrar el contrato con Back.

import { CATEGORIAS_IMPOSITIVAS } from "./personalizacion.js";

export const TIPOS_DOCUMENTO = [
  { valor: "CUIT", texto: "CUIT" },
  { valor: "CUIL", texto: "CUIL" },
  { valor: "DNI", texto: "DNI" },
];

// Un proveedor no puede ser Consumidor Final: son las mismas tres categorías del negocio.
export const CATEGORIAS_PROVEEDOR = CATEGORIAS_IMPOSITIVAS;

export const ETIQUETA_CATEGORIA_CORTA = {
  RESPONSABLE_INSCRIPTO: "Resp. Inscripto",
  MONOTRIBUTISTA: "Monotributista",
  EXENTO: "Exento",
};

const vacio = (valor) => valor === null || valor === undefined || String(valor).trim() === "";

// Deja solo los números ("30-71234567-8" -> "30712345678").
export const soloDigitos = (valor) => String(valor ?? "").replace(/\D/g, "");

// --- Documento ---------------------------------------------------------------------

const PESOS_CUIT = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
const PREFIJOS_CUIT = ["20", "23", "24", "27", "30", "33", "34"];

// Dígito verificador que le corresponde a los primeros 10 números de un CUIT o CUIL.
// Devuelve null si ese CUIT no puede existir (el resto da 10).
export const digitoVerificadorCuit = (primeros10) => {
  const suma = [...String(primeros10)].reduce((total, d, i) => total + Number(d) * PESOS_CUIT[i], 0);
  const resto = suma % 11;
  if (resto === 0) return 0;
  return resto === 1 ? null : 11 - resto;
};

// null si el CUIT o CUIL es válido; si no, el motivo.
export const validarCuit = (valor) => {
  const digitos = soloDigitos(valor);
  if (digitos.length !== 11) return "El CUIT debe tener 11 números.";
  if (!PREFIJOS_CUIT.includes(digitos.slice(0, 2))) return "El CUIT no es válido: el prefijo no existe.";
  return digitoVerificadorCuit(digitos.slice(0, 10)) === Number(digitos[10])
    ? null
    : "El CUIT no es válido: el dígito verificador no coincide.";
};

// Valida el número según el tipo: DNI de 7 u 8 números; CUIT y CUIL con dígito verificador.
export const validarDocumento = (tipo, numero) => {
  if (!TIPOS_DOCUMENTO.some((t) => t.valor === tipo)) return { tipo_documento: "Elija el tipo de documento." };
  if (vacio(numero)) return { numero_documento: `Rellene el número de ${tipo}.` };
  const digitos = soloDigitos(numero);
  if (/[^\d\s.-]/.test(String(numero))) return { numero_documento: "Solo se admiten números." };
  if (tipo === "DNI") {
    return /^\d{7,8}$/.test(digitos) ? {} : { numero_documento: "El DNI debe tener 7 u 8 números." };
  }
  const motivo = validarCuit(digitos);
  return motivo ? { numero_documento: motivo.replace("El CUIT", `El ${tipo}`) } : {};
};

// "30712345678" -> "30-71234567-8" (CUIT y CUIL). El DNI se muestra con puntos: "30.123.456".
export const formatearDocumento = (tipo, numero) => {
  const d = soloDigitos(numero);
  if ((tipo === "CUIT" || tipo === "CUIL") && d.length === 11) return `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}`;
  if (tipo === "DNI") return d.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return d;
};

// --- Ficha -------------------------------------------------------------------------

export const validarProveedor = (datos = {}) => {
  const errores = {};

  if (vacio(datos.nombre)) errores.nombre = "Rellene el nombre o razón social.";
  else if (String(datos.nombre).trim().length > 100) errores.nombre = "El nombre no puede superar los 100 caracteres.";

  Object.assign(errores, validarDocumento(datos.tipo_documento, datos.numero_documento));

  if (!vacio(datos.telefono)) {
    const t = String(datos.telefono);
    if (/[^\d\s()+-]/.test(t) || soloDigitos(t).length < 6 || soloDigitos(t).length > 15) {
      errores.telefono = "El teléfono debe tener entre 6 y 15 números (puede llevar +, espacios, guiones y paréntesis).";
    }
  }

  if (!vacio(datos.correo) && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(datos.correo).trim())) {
    errores.correo = "El correo no es válido.";
  }

  if (!CATEGORIAS_PROVEEDOR.some((c) => c.valor === datos.categoria_impositiva)) {
    errores.categoria_impositiva = "Elija la categoría impositiva.";
  }

  if (String(datos.descripcion_compra ?? "").trim().length > 500) {
    errores.descripcion_compra = "La descripción no puede superar los 500 caracteres.";
  }
  return errores;
};

// Datos que se envían al Backend: el documento viaja solo con números y lo opcional vacío como null.
export const armarPayloadProveedor = (datos) => ({
  nombre: String(datos.nombre ?? "").trim(),
  tipo_documento: datos.tipo_documento,
  numero_documento: soloDigitos(datos.numero_documento),
  telefono: vacio(datos.telefono) ? null : String(datos.telefono).trim(),
  correo: vacio(datos.correo) ? null : String(datos.correo).trim(),
  categoria_impositiva: datos.categoria_impositiva,
  descripcion_compra: vacio(datos.descripcion_compra) ? null : String(datos.descripcion_compra).trim(),
});

// --- Lista -------------------------------------------------------------------------

const sinTildes = (texto) => String(texto ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Búsqueda por nombre, documento (con o sin guiones), teléfono, correo o descripción, sin distinguir
// mayúsculas ni tildes.
export const buscarProveedores = (proveedores, texto) => {
  const buscado = sinTildes(texto).trim();
  if (!buscado) return proveedores;
  const buscadoDigitos = soloDigitos(buscado);
  return proveedores.filter(
    (p) =>
      [p.nombre, p.telefono, p.correo, p.descripcion_compra].some((campo) => sinTildes(campo).includes(buscado)) ||
      (buscadoDigitos.length > 0 && soloDigitos(p.numero_documento).includes(buscadoDigitos)),
  );
};

// Por defecto la lista muestra los visibles; con ocultos: true muestra solo los ocultos.
export const filtrarProveedores = (proveedores, { ocultos = false } = {}) =>
  proveedores.filter((p) => Boolean(p.oculto) === ocultos);

export const MOTIVO_CON_MOVIMIENTOS = "Tiene reposiciones o insumos asociados: solo se puede ocultar.";

// Se elimina únicamente si ya está oculto y no tiene reposiciones ni insumos asociados.
export const puedeEliminarProveedor = (proveedor) => {
  if (!proveedor.oculto) return { permitido: false, motivo: "Primero hay que ocultarlo." };
  if (proveedor.tiene_movimientos) return { permitido: false, motivo: MOTIVO_CON_MOVIMIENTOS };
  return { permitido: true, motivo: "" };
};
