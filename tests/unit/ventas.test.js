import { describe, expect, it } from "vitest";
import {
  armarPayloadVenta,
  avisoDeStock,
  calcularIva,
  cantidadValida,
  creditoMaximo,
  enPeriodo,
  filtrarVentas,
  limitarAlStock,
  LEYENDA_CREDITO_FISCAL,
  resumenDeErrores,
  subtotalDeItem,
  textoEstado,
  textoTipo,
  totalDelCarrito,
  validarCobro,
  validarCreditoAUsar,
} from "../../frontend/js/ventas.js";

const productos = [
  { id: 1, nombre: "Sifón", cantidad: 2, precio_venta: 1200 },
  { id: 2, nombre: "Bidón", cantidad: 0, precio_venta: 2200 },
  { id: 3, nombre: "Detergente", cantidad: 24, precio_venta: 980 },
];

describe("cantidad del carrito", () => {
  it("acepta solo enteros mayores a 0", () => {
    expect(["1", "25", " 3 "].every(cantidadValida)).toBe(true);
    expect(["", "0", "-1", "1.5", "abc", "1e3", null, undefined].some(cantidadValida)).toBe(false);
  });

  it("calcula el subtotal y el total sumando los subtotales", () => {
    expect(subtotalDeItem(980, "3")).toBe(2940);
    expect(totalDelCarrito([{ producto_id: 3, cantidad: "2" }, { producto_id: 1, cantidad: "1" }], productos)).toBe(3160);
  });

  it("una cantidad inválida no suma hasta que se corrige", () => {
    expect(totalDelCarrito([{ producto_id: 3, cantidad: "" }, { producto_id: 1, cantidad: "1" }], productos)).toBe(1200);
    expect(totalDelCarrito([], productos)).toBe(0);
  });
});

describe("aviso de stock de cada producto", () => {
  it("stock 0: 'Sin stock'", () => {
    expect(avisoDeStock(productos[1], 1)).toEqual({ tipo: "SIN_STOCK", texto: "Sin stock" });
  });

  it("cantidad mayor al stock: 'Solo quedan N en stock'", () => {
    expect(avisoDeStock(productos[0], 3)).toEqual({ tipo: "INSUFICIENTE", texto: "Solo quedan 2 en stock" });
    expect(avisoDeStock({ cantidad: 1 }, 2).texto).toBe("Solo queda 1 en stock");
  });

  it("si alcanza no hay aviso", () => {
    expect(avisoDeStock(productos[0], 2)).toBeNull();
    expect(avisoDeStock(productos[2], 24)).toBeNull();
  });
});

describe("tope de la cantidad en el carrito", () => {
  it("una cantidad mayor al stock se baja al stock y avisa que se excedió", () => {
    expect(limitarAlStock("5", 2)).toEqual({ cantidad: "2", excedido: true });
    expect(limitarAlStock(3, 2)).toEqual({ cantidad: "2", excedido: true });
  });

  it("una cantidad que alcanza queda igual", () => {
    expect(limitarAlStock("2", 2)).toEqual({ cantidad: "2", excedido: false });
    expect(limitarAlStock("1", 24)).toEqual({ cantidad: "1", excedido: false });
  });

  it("una cantidad inválida no se toca (se marca con su error)", () => {
    expect(limitarAlStock("", 2)).toEqual({ cantidad: "", excedido: false });
    expect(limitarAlStock("abc", 2)).toEqual({ cantidad: "abc", excedido: false });
    expect(limitarAlStock("0", 2)).toEqual({ cantidad: "0", excedido: false });
  });
});

describe("IVA según la categoría del negocio y del cliente", () => {
  it("negocio Responsable Inscripto: discrimina con RI y Monotributista (con leyenda)", () => {
    const ri = calcularIva(1210, "RESPONSABLE_INSCRIPTO", "RESPONSABLE_INSCRIPTO");
    expect(ri).toEqual({ modo: "DISCRIMINA", neto: 1000, iva: 210, leyenda: null });
    const mono = calcularIva(1210, "RESPONSABLE_INSCRIPTO", "MONOTRIBUTISTA");
    expect(mono.modo).toBe("DISCRIMINA");
    expect(mono.leyenda).toBe(LEYENDA_CREDITO_FISCAL);
  });

  it("negocio Responsable Inscripto: incluye el IVA con Exento y Consumidor final", () => {
    expect(calcularIva(1000, "RESPONSABLE_INSCRIPTO", "EXENTO")).toEqual({ modo: "INCLUIDO", texto: "El precio incluye IVA." });
    expect(calcularIva(1000, "RESPONSABLE_INSCRIPTO", "CONSUMIDOR_FINAL").modo).toBe("INCLUIDO");
  });

  it("negocio Monotributista o Exento: nunca discrimina", () => {
    for (const cliente of ["RESPONSABLE_INSCRIPTO", "MONOTRIBUTISTA", "EXENTO", "CONSUMIDOR_FINAL"]) {
      expect(calcularIva(1000, "MONOTRIBUTISTA", cliente).modo).toBe("NINGUNO");
      expect(calcularIva(1000, "EXENTO", cliente).modo).toBe("NINGUNO");
    }
    expect(calcularIva(1000, "EXENTO", "CONSUMIDOR_FINAL").texto).toContain("débito fiscal");
  });

  it("sin conocer la categoría del cliente o del negocio lo calcula el Backend", () => {
    expect(calcularIva(1000, "RESPONSABLE_INSCRIPTO", undefined).modo).toBe("PENDIENTE");
    expect(calcularIva(1000, undefined, "EXENTO").modo).toBe("PENDIENTE");
  });

  it("el neto más el IVA da el total", () => {
    const iva = calcularIva(3100, "RESPONSABLE_INSCRIPTO", "RESPONSABLE_INSCRIPTO");
    expect(Math.round((iva.neto + iva.iva) * 100) / 100).toBe(3100);
  });
});

describe("saldo a favor a usar", () => {
  it("el máximo es lo menor entre lo que tiene el cliente y el total de la venta", () => {
    expect(creditoMaximo(660, 590)).toBe(590);
    expect(creditoMaximo(200, 590)).toBe(200);
    expect(creditoMaximo(0, 590)).toBe(0);
  });

  it("valida el monto con su mensaje", () => {
    expect(validarCreditoAUsar("", 660, 590)).toBe("Ingresá cuánto saldo a favor querés usar.");
    expect(validarCreditoAUsar("abc", 660, 590)).toBe("El saldo a favor a usar debe ser un número.");
    expect(validarCreditoAUsar("0", 660, 590)).toBe("El saldo a favor a usar debe ser mayor a 0.");
    expect(validarCreditoAUsar("-5", 660, 590)).toBe("El saldo a favor a usar debe ser mayor a 0.");
    expect(validarCreditoAUsar("700", 660, 590)).toContain("No podés usar más de");
    expect(validarCreditoAUsar("600", 660, 590)).toContain("No puede superar el total de la venta");
    expect(validarCreditoAUsar("200", 660, 590)).toBeNull();
    expect(validarCreditoAUsar("590", 660, 590)).toBeNull();
  });
});

describe("validación del cobro", () => {
  it("contado exige medio de pago, salvo que el saldo a favor cubra todo", () => {
    expect(validarCobro({ tipo: "CONTADO", clienteId: null, medioPagoId: "", aCobrar: 500 })).toEqual({ medio_pago: "Seleccioná el medio de pago de la venta." });
    expect(validarCobro({ tipo: "CONTADO", clienteId: null, medioPagoId: "1", aCobrar: 500 })).toEqual({});
    expect(validarCobro({ tipo: "CONTADO", clienteId: 2, medioPagoId: "", aCobrar: 0 })).toEqual({});
  });

  it("cuenta corriente exige un cliente registrado y no pide medio de pago", () => {
    expect(validarCobro({ tipo: "CUENTA_CORRIENTE", clienteId: null, medioPagoId: "", aCobrar: 500 })).toEqual({ cliente: "Seleccioná un cliente registrado para una venta a cuenta corriente." });
    expect(validarCobro({ tipo: "CUENTA_CORRIENTE", clienteId: 1, medioPagoId: "", aCobrar: 500 })).toEqual({});
  });

  it("resume los datos que faltan", () => {
    expect(resumenDeErrores({ cliente: "x", medio_pago: "y" })).toBe("Revisá estos datos: cliente, medio de pago.");
    expect(resumenDeErrores({})).toBe("");
  });
});

describe("cuerpo del POST /ventas", () => {
  it("no manda fecha, hora, número ni precios", () => {
    const cuerpo = armarPayloadVenta({ items: [{ producto_id: 3, cantidad: "2" }], tipo: "CONTADO", clienteId: null, medioPagoId: "1" });
    expect(cuerpo).toEqual({ tipo: "CONTADO", cliente_id: null, medio_pago_id: 1, saldo_a_favor_usado: 0, items: [{ producto_id: 3, cantidad: 2 }] });
    expect(Object.keys(cuerpo)).not.toContain("fecha_hora");
    expect(Object.keys(cuerpo)).not.toContain("numero");
  });

  it("en cuenta corriente no manda medio de pago y manda el saldo a favor usado", () => {
    const cuerpo = armarPayloadVenta({ items: [{ producto_id: 5, cantidad: "1" }], tipo: "CUENTA_CORRIENTE", clienteId: "1", medioPagoId: "1", creditoUsado: 200 });
    expect(cuerpo).toMatchObject({ tipo: "CUENTA_CORRIENTE", cliente_id: 1, medio_pago_id: null, saldo_a_favor_usado: 200 });
  });
});

describe("historial", () => {
  const ventas = [
    { id: 1, numero: "00001-00000451", tipo: "CUENTA_CORRIENTE", cliente_nombre: "Almacén Don Pedro", fecha_hora: "2026-10-06T12:30:00", anulada: false, oculto: false },
    { id: 2, numero: "00001-00000452", tipo: "CONTADO", cliente_nombre: null, fecha_hora: "2026-11-05T15:10:00", anulada: false, oculto: false },
    { id: 3, numero: "00001-00000453", tipo: "CUENTA_CORRIENTE", cliente_nombre: "Kiosco El Sol", fecha_hora: "2026-11-06T10:00:00", anulada: true, oculto: false },
    { id: 4, numero: "00001-00000454", tipo: "CONTADO", cliente_nombre: null, fecha_hora: "2026-11-07T10:00:00", anulada: false, oculto: true },
  ];
  const hoy = "2026-11-12";

  it("textos de tipo y estado", () => {
    expect(textoTipo("CONTADO")).toBe("Contado");
    expect(textoTipo("CUENTA_CORRIENTE")).toBe("Cuenta corriente");
    expect(textoEstado({ anulada: false })).toBe("Confirmada");
    expect(textoEstado({ anulada: true })).toBe("Anulada");
  });

  it("no muestra las ocultas salvo con 'Ver ocultos' y ordena de la más nueva a la más vieja", () => {
    expect(filtrarVentas(ventas, {}, hoy).map((v) => v.id)).toEqual([3, 2, 1]);
    expect(filtrarVentas(ventas, { ocultos: true }, hoy).map((v) => v.id)).toEqual([4]);
  });

  it("filtra por estado y por tipo", () => {
    expect(filtrarVentas(ventas, { estado: "CONFIRMADA" }, hoy).map((v) => v.id)).toEqual([2, 1]);
    expect(filtrarVentas(ventas, { estado: "ANULADA" }, hoy).map((v) => v.id)).toEqual([3]);
    expect(filtrarVentas(ventas, { estado: "CONTADO" }, hoy).map((v) => v.id)).toEqual([2]);
    expect(filtrarVentas(ventas, { estado: "CUENTA_CORRIENTE" }, hoy).map((v) => v.id)).toEqual([3, 1]);
  });

  it("busca por número con o sin guion, cliente y tipo, sin distinguir mayúsculas", () => {
    expect(filtrarVentas(ventas, { texto: "00001-00000452" }, hoy).map((v) => v.id)).toEqual([2]);
    expect(filtrarVentas(ventas, { texto: "0000100000452" }, hoy).map((v) => v.id)).toEqual([2]);
    expect(filtrarVentas(ventas, { texto: "PEDRO" }, hoy).map((v) => v.id)).toEqual([1]);
    expect(filtrarVentas(ventas, { texto: "consumidor final" }, hoy).map((v) => v.id)).toEqual([2]);
    expect(filtrarVentas(ventas, { texto: "cuenta corriente" }, hoy).map((v) => v.id)).toEqual([3, 1]);
  });

  it("filtra por período con la fecha de hoy", () => {
    expect(enPeriodo("2026-11-12T15:00:00", "hoy", hoy)).toBe(true);
    expect(enPeriodo("2026-11-11T15:00:00", "hoy", hoy)).toBe(false);
    expect(enPeriodo("2026-11-01T15:00:00", "mes", hoy)).toBe(true);
    expect(enPeriodo("2026-10-31T15:00:00", "mes", hoy)).toBe(false);
    expect(enPeriodo("2026-01-05T15:00:00", "anio", hoy)).toBe(true);
    expect(enPeriodo("2025-12-31T15:00:00", "anio", hoy)).toBe(false);
    expect(enPeriodo("no es una fecha", "mes", hoy)).toBe(false);
    expect(enPeriodo("2020-01-01T00:00:00", "todas", hoy)).toBe(true);
  });
});
