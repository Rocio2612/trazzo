from flask import Blueprint, request, jsonify
from psycopg2.extras import RealDictCursor
from decimal import Decimal

from helpers import get_db_connection, verificar_token

ventas_bp = Blueprint('ventas', __name__)

# Roles que pueden operar el mostrador (el Cajero vende; no administra finanzas)
ROLES_VENTA = ['PROPIETARIO', 'ADMIN', 'CAJERO']


# ==========================================
# 1. LISTAR VENTAS (GET /api/ventas)
# ==========================================
@ventas_bp.route('/api/ventas', methods=['GET'])
def listar_ventas():
    payload, error_resp, status = verificar_token(ROLES_VENTA)
    if error_resp:
        return error_resp, status

    emprendimiento_id = payload.get("negocio_id")
    conn = get_db_connection(payload.get("db_name"))
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        cur.execute("""
            SELECT v.id, v.numero_venta, v.tipo_venta, v.total, v.estado, v.fecha_hora, c.nombre_razon_social AS cliente
            FROM ventas.ventas v
            LEFT JOIN ventas.clientes c ON v.cliente_id = c.id
            WHERE v.emprendimiento_id = %s
            ORDER BY v.fecha_hora DESC
        """, (emprendimiento_id,))

        ventas = cur.fetchall()
        return jsonify({"status": "ok", "items": ventas}), 200
    except Exception as e:
        print(f"ERROR EN LISTAR_VENTAS: {e}")
        return jsonify({"status": "error", "mensaje": str(e)}), 500
    finally:
        cur.close()
        conn.close()


# ==========================================
# 2. CREAR VENTA (POST /api/ventas)
# ==========================================
@ventas_bp.route('/api/ventas', methods=['POST'])
def crear_venta():
    """Registra una venta completa en UNA sola transacción atómica.

    Qué hace, en orden (todo o nada: si algo falla, rollback de todo):
      1. Valida el carrito (ítems, cantidades enteras > 0, tipo de venta,
         cliente obligatorio en cuenta corriente, medio de pago en contado).
      2. Genera el número de venta correlativo de 8 dígitos con la secuencia
         de la base del negocio (ventas.seq_numero_venta).
      3. Descuenta stock con un UPDATE condicional (cantidad >= pedido), así
         dos ventas simultáneas nunca dejan stock negativo.
      4. Inserta la cabecera y el detalle con precio, costo y alícuota
         congelados (Decimal/NUMERIC, nunca float ni datos del frontend).
      5. Registra el movimiento en el Kardex (productos.movimientos_stock).
      6. Si es CONTADO, genera el pago automático por el total.
    """
    payload, error_resp, status = verificar_token(ROLES_VENTA)
    if error_resp:
        return error_resp, status

    datos = request.get_json(silent=True) or {}
    emprendimiento_id = payload.get("negocio_id")
    sucursal_id = payload.get("sucursal_id", 1)
    usuario = payload.get("usuario", "admin")
    db_name = payload.get("db_name")

    # ---------- 1. Validaciones del carrito ----------
    items = datos.get('items') or []
    if len(items) == 0:
        return jsonify({"status": "error", "mensaje": "El carrito está vacío"}), 400

    tipo_venta = datos.get('tipo_venta')
    if tipo_venta not in ['CONTADO', 'CUENTA_CORRIENTE']:
        return jsonify({"status": "error", "mensaje": "Tipo de venta inválido"}), 400

    cliente_id = datos.get('cliente_id')
    medio_pago_id = datos.get('medio_pago_id')

    if tipo_venta == 'CUENTA_CORRIENTE' and not cliente_id:
        return jsonify({"status": "error", "mensaje": "Venta a cuenta corriente requiere cliente"}), 400

    # Un único medio de pago por venta: se rechaza una lista de medios
    if isinstance(medio_pago_id, (list, dict)) or isinstance(cliente_id, (list, dict)):
        return jsonify({"status": "error", "mensaje": "Solo se admite un cliente y un medio de pago por venta"}), 400

    if tipo_venta == 'CONTADO' and not medio_pago_id:
        return jsonify({"status": "error", "mensaje": "Venta de contado requiere medio de pago"}), 400

    # Las cantidades del detalle son enteras y mayores a cero (chk_vdetalle_cantidad)
    for item in items:
        if not item.get('producto_id'):
            return jsonify({"status": "error", "mensaje": "Cada ítem necesita producto_id"}), 400
        try:
            item['cantidad'] = int(item.get('cantidad'))
        except (TypeError, ValueError):
            return jsonify({"status": "error", "mensaje": "Cantidad inválida"}), 400
        if item['cantidad'] <= 0:
            return jsonify({"status": "error", "mensaje": "La cantidad debe ser mayor a cero"}), 400

    conn = get_db_connection(db_name)
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        # ---------- Validaciones contra la base ----------
        if cliente_id:
            cur.execute(
                "SELECT 1 FROM ventas.clientes "
                "WHERE id = %s AND emprendimiento_id = %s AND activo = TRUE",
                (cliente_id, emprendimiento_id)
            )
            if not cur.fetchone():
                conn.rollback()
                return jsonify({"status": "error", "mensaje": "Cliente no encontrado"}), 404

        if tipo_venta == 'CONTADO':
            cur.execute(
                "SELECT 1 FROM finanzas.medios_pago "
                "WHERE id = %s AND emprendimiento_id = %s AND activo = TRUE",
                (medio_pago_id, emprendimiento_id)
            )
            if not cur.fetchone():
                conn.rollback()
                return jsonify({"status": "error", "mensaje": "Medio de pago no encontrado"}), 404

        # ---------- 2. Número correlativo atómico ----------
        cur.execute("SELECT nextval('ventas.seq_numero_venta') AS n")
        numero_venta = f"{cur.fetchone()['n']:08d}"

        # ---------- 3 y 4. Precios reales, stock y foto histórica ----------
        detalle = []
        subtotal = Decimal('0.00')

        for item in items:
            cur.execute("""
                SELECT id, nombre, tipo_producto, precio_venta, precio_compra, iva_alicuota, cantidad
                FROM productos.productos
                WHERE id = %s AND emprendimiento_id = %s AND activo = TRUE
            """, (item['producto_id'], emprendimiento_id))
            prod = cur.fetchone()

            if not prod:
                conn.rollback()
                return jsonify({
                    "status": "error",
                    "mensaje": f"Producto {item['producto_id']} no encontrado"
                }), 404

            if prod['tipo_producto'] != 'BIEN_DE_CAMBIO':
                conn.rollback()
                return jsonify({
                    "status": "error",
                    "mensaje": f"'{prod['nombre']}' no es un producto vendible (solo BIEN_DE_CAMBIO)"
                }), 400

            # Descuento atómico: el WHERE evita vender stock inexistente aunque
            # dos cajeros confirmen al mismo tiempo (nunca queda negativo).
            cur.execute("""
                UPDATE productos.productos
                   SET cantidad = cantidad - %s,
                       modificado_por = %s,
                       modificado_en = CURRENT_TIMESTAMP
                 WHERE id = %s
                   AND emprendimiento_id = %s
                   AND cantidad >= %s
                RETURNING cantidad
            """, (item['cantidad'], usuario, item['producto_id'],
                  emprendimiento_id, item['cantidad']))
            actualizado = cur.fetchone()

            if not actualizado:
                conn.rollback()
                return jsonify({
                    "status": "error",
                    "mensaje": (f"Stock insuficiente para '{prod['nombre']}': "
                                f"disponible {prod['cantidad']}, solicitado {item['cantidad']}")
                }), 409

            linea = (prod['precio_venta'] * item['cantidad']).quantize(Decimal('0.01'))
            subtotal += linea
            detalle.append((prod, item['cantidad'], linea, actualizado['cantidad']))

        total = subtotal.quantize(Decimal('0.01'))

        # ---------- 5. Cabecera de la venta ----------
        # El modo de IVA se resuelve en la tarea de IVA (hoy queda 'NINGUNO')
        cur.execute("""
            INSERT INTO ventas.ventas
    git pull            (emprendimiento_id, sucursal_id, cliente_id, numero_venta, tipo_venta,
                 modo_iva, subtotal_neto, monto_iva, total, creado_por)
            VALUES (%s, %s, %s, %s, %s, 'NINGUNO', %s, 0.00, %s, %s)
            RETURNING id
        """, (emprendimiento_id, sucursal_id, cliente_id, numero_venta,
              tipo_venta, subtotal, total, usuario))

        venta_id = cur.fetchone()['id']

        # ---------- 5b. Detalle + Kardex ----------
        for prod, cantidad, linea, stock_resultante in detalle:
            cur.execute("""
                INSERT INTO ventas.venta_detalle
                    (venta_id, producto_id, cantidad, precio_unitario_historico,
                     costo_unitario_historico, iva_alicuota_historica, subtotal)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
            """, (venta_id, prod['id'], cantidad, prod['precio_venta'],
                  prod['precio_compra'], prod['iva_alicuota'], linea))

            cur.execute("""
                INSERT INTO productos.movimientos_stock
                    (emprendimiento_id, sucursal_id, producto_id, tipo,
                     cantidad_movimiento, stock_resultante, motivo, usuario)
                VALUES (%s, %s, %s, 'VENTA', %s, %s, %s, %s)
            """, (emprendimiento_id, sucursal_id, prod['id'], -cantidad,
                  stock_resultante, f"Venta {numero_venta}", usuario))

        # ---------- 6. Pago automático de contado ----------
        pago_id = None
        if tipo_venta == 'CONTADO':
            cur.execute("""
                INSERT INTO ventas.pagos
                    (emprendimiento_id, sucursal_id, venta_id, medio_pago_id,
                     monto, estado, creado_por)
                VALUES (%s, %s, %s, %s, %s, 'ACTIVO', %s)
                RETURNING id
            """, (emprendimiento_id, sucursal_id, venta_id, medio_pago_id,
                  total, usuario))
            pago_id = cur.fetchone()['id']

        conn.commit()

        return jsonify({
            "status": "ok",
            "mensaje": "Venta creada",
            "venta_id": venta_id,
            "numero_venta": numero_venta,
            "total": float(total),
            "pago_id": pago_id,
            "items": [
                {"producto_id": p['id'], "cantidad": c, "stock_restante": float(s)}
                for p, c, _, s in detalle
            ]
        }), 201

    except Exception as e:
        conn.rollback()
        print(f"ERROR EN CREAR_VENTA: {e}")
        return jsonify({"status": "error", "mensaje": str(e)}), 500
    finally:
        cur.close()
        conn.close()


# ==========================================
# 3. VENTA CONFIRMADA = INMUTABLE
# ==========================================
@ventas_bp.route('/api/ventas/<int:venta_id>', methods=['PUT', 'PATCH', 'DELETE'])
def editar_venta(venta_id):
    """Bloquea cualquier intento de edición o borrado de una venta ya confirmada.

    Una venta confirmada es un comprobante: no se modifica ni se elimina. La
    única forma legal de revertirla es la anulación (PATCH /api/ventas/{id}/anular),
    que repone el stock y anula los pagos conservando el número de venta.
    """
    payload, error_resp, status = verificar_token(ROLES_VENTA)
    if error_resp:
        return error_resp, status

    return jsonify({
        "status": "error",
        "mensaje": (f"La venta {venta_id} está confirmada y no se puede modificar ni eliminar. "
                    f"Para revertirla usá PATCH /api/ventas/{venta_id}/anular")
    }), 409
