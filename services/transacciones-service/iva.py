"""
CÁLCULO DEL IVA EN VENTAS (Módulo 8) — función pura, sin base de datos.

REGLA DEL NEGOCIO (definida en el proyecto):
  * El `precio_venta` cargado en Productos es el PRECIO FINAL de venta al público.
    Si el negocio es Responsable Inscripto, ese precio ya tiene el IVA adentro.
  * "Discriminar" = mostrar el comprobante con el IVA separado (neto + IVA).
  * "No discriminar" = un único precio final, sin desglose de impuestos.

TABLA DE LAS 5 REGLAS
  | Negocio (vendedor)      | Cliente (comprador)              | Resultado                                  |
  |-------------------------|----------------------------------|--------------------------------------------|
  | RESPONSABLE_INSCRIPTO   | RESPONSABLE_INSCRIPTO            | DISCRIMINA                                 |
  | RESPONSABLE_INSCRIPTO   | MONOTRIBUTISTA                   | DISCRIMINA + leyenda de crédito fiscal no  |
  |                         |                                  | computable (Ley 27.618)                    |
  | RESPONSABLE_INSCRIPTO   | EXENTO / CONSUMIDOR_FINAL        | INCLUIDO (IVA adentro, sin discriminar)    |
  | MONOTRIBUTISTA          | cualquiera                       | NINGUNO (no se calcula ni se muestra IVA)  |
  | EXENTO                  | cualquiera                       | NINGUNO (no genera débito fiscal)          |

La función principal es `calcular_iva_venta(negocio_categoria, cliente_categoria,
monto_neto, alicuota)` y es pura: no toca la base ni hace redondeos "mágicos",
siempre devuelve importes con 2 decimales.
"""

from decimal import Decimal, ROUND_HALF_UP

CENTAVO = Decimal('0.01')

# Leyenda obligatoria cuando un Responsable Inscripto le vende a un Monotributista
LEYENDA_CREDITO_NO_COMPUTABLE = (
    "IVA Crédito Fiscal no computable para el adquirente (Ley N° 27.618)"
)

# Valores permitidos por el CHECK de la tabla ventas.ventas (chk_venta_modo_iva)
MODO_DISCRIMINA = 'DISCRIMINA'
MODO_INCLUIDO = 'INCLUIDO'
MODO_NINGUNO = 'NINGUNO'

CATEGORIAS_VALIDAS = [
    'RESPONSABLE_INSCRIPTO',
    'MONOTRIBUTISTA',
    'EXENTO',
    'CONSUMIDOR_FINAL',
]


def _dec(valor):
    """Convierte a Decimal sin pasar por float (evita 0.1 + 0.2 = 0.30000000000004)."""
    return Decimal(str(valor))


def _normalizar(categoria):
    """Deja la categoría en mayúsculas y sin espacios. Vacío/None = CONSUMIDOR_FINAL."""
    if not categoria:
        return 'CONSUMIDOR_FINAL'
    return str(categoria).strip().upper()


def resolver_modo_iva(negocio_categoria, cliente_categoria):
    """Devuelve (modo, leyenda) según quién vende y quién compra.

    modo: 'DISCRIMINA' | 'INCLUIDO' | 'NINGUNO'  (los 3 valores del CHECK en la BD)
    leyenda: texto legal o None
    """
    negocio = _normalizar(negocio_categoria)
    cliente = _normalizar(cliente_categoria)

    # Monotributista o Exento: nunca discriminan IVA ni generan débito fiscal
    if negocio != 'RESPONSABLE_INSCRIPTO':
        return MODO_NINGUNO, None

    # A partir de acá el vendedor es Responsable Inscripto
    if cliente == 'RESPONSABLE_INSCRIPTO':
        return MODO_DISCRIMINA, None

    if cliente == 'MONOTRIBUTISTA':
        return MODO_DISCRIMINA, LEYENDA_CREDITO_NO_COMPUTABLE

    # Exento o Consumidor Final: el IVA va adentro del precio, sin desglosar
    return MODO_INCLUIDO, None


def calcular_iva_venta(negocio_categoria, cliente_categoria, monto_neto, alicuota=21.00):
    """Función pura del checklist: aplica las 5 reglas de IVA.

    Parámetros:
      negocio_categoria -> categoría impositiva del emprendimiento (viene del JWT)
      cliente_categoria -> categoría impositiva del cliente (ventas.clientes)
      monto_neto        -> importe de la operación SIN IVA (base imponible)
      alicuota          -> alícuota de IVA del producto (21, 10.5, 27 o 0)

    Retorna dict:
      {
        "modo":          'DISCRIMINA' | 'INCLUIDO' | 'NINGUNO',
        "subtotal_neto": Decimal,   # base imponible
        "monto_iva":     Decimal,   # 0 si no se discrimina
        "total":         Decimal,   # lo que paga el cliente
        "leyenda":       str | None
      }
    """
    neto = _dec(monto_neto).quantize(CENTAVO, rounding=ROUND_HALF_UP)
    if neto < 0:
        raise ValueError("El monto no puede ser negativo")

    modo, leyenda = resolver_modo_iva(negocio_categoria, cliente_categoria)

    if modo == MODO_DISCRIMINA:
        iva = (neto * _dec(alicuota) / Decimal('100')).quantize(CENTAVO, rounding=ROUND_HALF_UP)
        total = (neto + iva).quantize(CENTAVO, rounding=ROUND_HALF_UP)
    else:
        # INCLUIDO: el precio ya trae el IVA adentro, no se desglosa.
        # NINGUNO: el negocio no cobra IVA.
        iva = Decimal('0.00')
        total = neto

    return {
        "modo": modo,
        "subtotal_neto": neto,
        "monto_iva": iva,
        "total": total,
        "leyenda": leyenda,
    }


def calcular_totales_venta(negocio_categoria, cliente_categoria, total_carrito, alicuota=21.00):
    """Igual que calcular_iva_venta, pero partiendo del TOTAL del carrito.

    El carrito suma precios de venta al público (con IVA adentro si el negocio es RI),
    así que cuando hay que discriminar se despeja la base imponible:

        neto = total / (1 + alícuota/100)

    y se calcula el IVA sobre ese neto. El total NUNCA cambia: es lo que paga el cliente.
    """
    total = _dec(total_carrito).quantize(CENTAVO, rounding=ROUND_HALF_UP)
    modo, _ = resolver_modo_iva(negocio_categoria, cliente_categoria)

    if modo == MODO_DISCRIMINA:
        neto = (total / (Decimal('1') + _dec(alicuota) / Decimal('100'))).quantize(
            CENTAVO, rounding=ROUND_HALF_UP
        )
        resultado = calcular_iva_venta(negocio_categoria, cliente_categoria, neto, alicuota)
        # Ajuste de cierre: si por redondeo el neto + IVA no da el total exacto
        # del carrito, el IVA absorbe la diferencia de 1 centavo.
        resultado["monto_iva"] = (total - resultado["subtotal_neto"]).quantize(CENTAVO)
        resultado["total"] = total
        return resultado

    return calcular_iva_venta(negocio_categoria, cliente_categoria, total, alicuota)
