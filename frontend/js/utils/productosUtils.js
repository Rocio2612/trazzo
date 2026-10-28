// js/utils/productosUtils.js

/**
 * Calcula el monto total de reposición.
 */
export const calcularMontoReposicion = (cantidad, ultimoCosto) => {
  if (!cantidad || !ultimoCosto || cantidad <= 0 || ultimoCosto <= 0) return 0;
  return cantidad * ultimoCosto;
};

/**
 * Evalúa si el precio es menor al costo para mostrar el banner.
 */
export const precioMenorAlCosto = (precio, costo) => {
  if (!precio || !costo) return false;
  return parseFloat(precio) < parseFloat(costo);
};

/**
 * Genera el texto de la alerta de stock.
 */
export const generarTextoAlerta = (nombreProducto, stockActual) => {
  if (stockActual === 0) return `Sin stock: ${nombreProducto}`;
  return `Quedan ${stockActual} unidades de ${nombreProducto}`;
};

/**
 * Formatea un número como moneda argentina.
 */
export const formatearMoneda = (valor) => {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
  }).format(valor);
};
