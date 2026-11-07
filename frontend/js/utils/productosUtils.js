// js/utils/productosUtils.js

export const calcularPrecioVenta = (
  precioCompra,
  rentabilidad = 0,
  iva = 21,
) => {
  if (!precioCompra || precioCompra <= 0) return 0;
  const neto = precioCompra * (1 + rentabilidad / 100);
  const conIva = neto * (1 + iva / 100);
  return Number(conIva.toFixed(2));
};

export const precioMenorAlCosto = (precioVenta, precioCompra) => {
  if (!precioVenta || !precioCompra) return false;
  return parseFloat(precioVenta) < parseFloat(precioCompra);
};

export const calcularMontoReposicion = (cantidad, ultimoPrecioCompra) => {
  if (
    !cantidad ||
    !ultimoPrecioCompra ||
    cantidad <= 0 ||
    ultimoPrecioCompra <= 0
  )
    return 0;
  return Number((cantidad * ultimoPrecioCompra).toFixed(2));
};

export const formatearMoneda = (valor) => {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
  }).format(valor);
};
