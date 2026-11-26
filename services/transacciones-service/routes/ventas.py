from flask import Blueprint, request, jsonify
import psycopg2
from psycopg2.extras import RealDictCursor
import os
import jwt
#Agregado por Aldi
import requests
from dotenv import load_dotenv

load_dotenv()
ventas_bp = Blueprint('ventas', __name__)
SECRET_KEY = os.getenv("JWT_SECRET")

def get_db(db_name):
    return psycopg2.connect(
        host=os.getenv("DB_HOST"), database=db_name,
        user=os.getenv("DB_USER"), password=os.getenv("DB_PASSWORD"),
        port=os.getenv("DB_PORT")
    )

def verificar_token():
    auth_header = request.headers.get('Authorization')
    if not auth_header or not auth_header.startswith('Bearer '):
        return None, jsonify({"status": "error", "mensaje": "Token no proporcionado"}), 401
    token = auth_header.split(" ")[1]
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
        return payload, None, 200
    except jwt.ExpiredSignatureError:
        return None, jsonify({"status": "error", "mensaje": "Sesión expirada"}), 401
    except jwt.InvalidTokenError:
        return None, jsonify({"status": "error", "mensaje": "Token inválido"}), 401

def calcular_iva_venta(cat_negocio, cat_cliente, monto_total):
    """El precio ya incluye IVA. Devolvemos el desglose sin sumarlo."""
    monto_total = float(monto_total)
    iva_21 = monto_total - (monto_total / 1.21)
    
    if cat_negocio == 'RESPONSABLE_INSCRIPTO':
        if cat_cliente == 'RESPONSABLE_INSCRIPTO':
            return ('DISCRIMINA', round(iva_21, 2), monto_total, None)
        elif cat_cliente == 'MONOTRIBUTISTA':
            leyenda = "El crédito fiscal discriminado en el presente comprobante no puede ser computado"
            return ('DISCRIMINA', round(iva_21, 2), monto_total, leyenda)
        else:
            return ('INCLUIDO', 0.00, monto_total, None)
    else:
        return ('NINGUNO', 0.00, monto_total, None)

# [Ajuste aviso a Notificaciones - Aldi]: comunica cambios de stock al microservicio 5006 sin bloquear la venta si está caído
def avisar_a_notificaciones(producto_id, nombre, stock, minimo, emp_id, db_name):
    url = "http://127.0.0.1:5006/internal/alertas/evaluar"
    payload = {
        "producto_id": producto_id,
        "nombre_producto": nombre,
        "stock_actual": float(stock),
        "stock_minimo": float(minimo),
        "emprendimiento_id": emp_id,
        "db_name": db_name
    }
    try:
        requests.post(url, json=payload, timeout=2)
    except Exception as e:
        print(f"No se pudo avisar a notificaciones: {e}")
        
# ==========================================
# 1. LISTAR VENTAS (CON DETALLES Y PAGOS)
# ==========================================
@ventas_bp.route('/api/ventas', methods=['GET'])
def listar_ventas():
    payload, error_resp, status = verificar_token()
    if error_resp: return error_resp, status
    
    emprendimiento_id = payload.get("negocio_id")
    conn = get_db(payload.get("db_name"))
    cur = conn.cursor(cursor_factory=RealDictCursor)
    
    try:
        cur.execute("""
            SELECT v.id, v.numero_venta, v.tipo_venta, v.total, v.estado, v.fecha_hora, 
                   v.oculto, c.nombre_razon_social AS cliente,
                   json_agg(json_build_object(
                       'producto', p.nombre,
                       'cantidad', vd.cantidad,
                       'precio', vd.precio_unitario_historico,
                       'iva', vd.iva_alicuota_historica
                   )) AS productos,
                   (SELECT mp.nombre FROM ventas.pagos pg 
                    JOIN finanzas.medios_pago mp ON pg.medio_pago_id = mp.id 
                    WHERE pg.venta_id = v.id LIMIT 1) AS medio_pago
            FROM ventas.ventas v
            LEFT JOIN ventas.clientes c ON v.cliente_id = c.id
            LEFT JOIN ventas.venta_detalle vd ON v.id = vd.venta_id
            LEFT JOIN productos.productos p ON vd.producto_id = p.id
            WHERE v.emprendimiento_id = %s
            GROUP BY v.id, c.nombre_razon_social
            ORDER BY v.fecha_hora DESC
        """, (emprendimiento_id,))
        
        return jsonify({"status": "ok", "items": cur.fetchall()}), 200
    except Exception as e:
        return jsonify({"status": "error", "mensaje": str(e)}), 500
    finally:
        cur.close()
        conn.close()

# ==========================================
# 2. CREAR VENTA (CON ROLES Y SALDO A FAVOR)
# ==========================================
@ventas_bp.route('/api/ventas', methods=['POST'])
def crear_venta():
    payload, error_resp, status = verificar_token()
    if error_resp: return error_resp, status

    datos = request.get_json()
    emprendimiento_id = payload.get("negocio_id")
    usuario = payload.get("usuario", "admin")
    rol = payload.get("rol", "CAJERO")
    db_name = payload.get("db_name")
    cat_negocio = payload.get("categoria_impositiva", "MONOTRIBUTISTA")
    cliente_id = datos.get('cliente_id')

    # Validaciones
    if not datos.get('items') or len(datos['items']) == 0:
        return jsonify({"status": "error", "mensaje": "El carrito está vacío"}), 400
    if datos.get('tipo_venta') not in ['CONTADO', 'CUENTA_CORRIENTE']:
        return jsonify({"status": "error", "mensaje": "Tipo de venta inválido"}), 400
    if datos.get('tipo_venta') == 'CUENTA_CORRIENTE' and not cliente_id:
        return jsonify({"status": "error", "mensaje": "Venta Cta Cte requiere cliente"}), 400
    if datos.get('tipo_venta') == 'CONTADO' and not datos.get('medio_pago_id'):
        return jsonify({"status": "error", "mensaje": "Venta de contado requiere medio de pago"}), 400

    conn = get_db(db_name)
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        cat_cliente = 'CONSUMIDOR_FINAL'
        saldo_favor = 0
        if cliente_id:
            cur.execute("SELECT categoria_impositiva, saldo_a_favor FROM ventas.clientes WHERE id = %s AND emprendimiento_id = %s", (cliente_id, emprendimiento_id))
            cli = cur.fetchone()
            if cli: 
                cat_cliente = cli['categoria_impositiva']
                saldo_favor = float(cli['saldo_a_favor'])

        subtotal_neto = 0
        items_validados = []
        
        for item in datos['items']:
            if int(item['cantidad']) <= 0:
                return jsonify({"status": "error", "mensaje": "Cantidad inválida"}), 400

            # [Ajuste Kardex y Notificaciones - Aldi]: agregamos nombre, iva_alicuota, cantidad y stock_minimo al RETURNING
            cur.execute("""
                UPDATE productos.productos 
                SET cantidad = cantidad - %s 
                WHERE id = %s AND emprendimiento_id = %s AND cantidad >= %s
                RETURNING nombre, precio_venta, precio_compra, iva_alicuota, cantidad, stock_minimo
            """, (item['cantidad'], item['producto_id'], emprendimiento_id, item['cantidad']))
            
            prod = cur.fetchone()
            if not prod:
                conn.rollback()
                return jsonify({"status": "error", "mensaje": f"Stock insuficiente para producto {item['producto_id']}"}), 409
            
            subtotal_neto += float(prod['precio_venta']) * int(item['cantidad'])
            items_validados.append({
                "id": item['producto_id'], "cantidad": int(item['cantidad']),
                "precio": prod['precio_venta'], "costo": prod['precio_compra'], "iva": prod['iva_alicuota'],
                "stock_restante": prod['cantidad'], "stock_minimo": prod['stock_minimo']
            })

        total_final = subtotal_neto
        # El saldo a favor no se descuenta hasta que Cuenta corriente lo tenga en cuenta al calcular la deuda.
        saldo_usado = 0
        total_a_pagar = total_final - saldo_usado

        modo_iva, monto_iva, _, leyenda = calcular_iva_venta(cat_negocio, cat_cliente, total_final)

        cur.execute("SELECT nextval('ventas.seq_numero_venta') as num")
        num_venta = f"{cur.fetchone()['num']:08d}"

        cur.execute("""
            INSERT INTO ventas.ventas 
            (emprendimiento_id, cliente_id, numero_venta, tipo_venta, modo_iva, leyenda_iva, subtotal_neto, monto_iva, saldo_a_favor_usado, total, creado_por) 
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id
        """, (emprendimiento_id, cliente_id, num_venta, datos['tipo_venta'], modo_iva, leyenda, subtotal_neto, monto_iva, saldo_usado, total_a_pagar, usuario))
        venta_id = cur.fetchone()['id']

        for item in items_validados:
            cur.execute("""
                INSERT INTO ventas.venta_detalle 
                (venta_id, producto_id, cantidad, precio_unitario_historico, costo_unitario_historico, iva_alicuota_historica, subtotal) 
                VALUES (%s, %s, %s, %s, %s, %s, %s)
            """, (venta_id, item['id'], item['cantidad'], item['precio'], item['costo'], item['iva'], float(item['precio']) * int(item['cantidad'])))

            # [Ajuste Kardex - Aldi]: registra la salida de stock por venta en productos.movimientos_stock
            cur.execute("""
                INSERT INTO productos.movimientos_stock
                    (emprendimiento_id, producto_id, tipo, cantidad_movimiento, stock_resultante, motivo, usuario)
                VALUES (%s, %s, 'VENTA', %s, %s, %s, %s)
            """, (emprendimiento_id, item['id'], -item['cantidad'], item['stock_restante'], f"Venta {num_venta}", usuario))

        if datos['tipo_venta'] == 'CONTADO':
            cur.execute("""
                INSERT INTO ventas.pagos (emprendimiento_id, venta_id, medio_pago_id, monto, creado_por)
                VALUES (%s, %s, %s, %s, %s)
            """, (emprendimiento_id, venta_id, datos['medio_pago_id'], total_a_pagar, usuario))
        
        if saldo_usado > 0 and cliente_id:
            cur.execute("UPDATE ventas.clientes SET saldo_a_favor = saldo_a_favor - %s WHERE id = %s", (saldo_usado, cliente_id))

        conn.commit()

        # [Ajuste Notificaciones - Aldi]: evalúa si algún producto vendido cayó al stock mínimo
        for item in items_validados:
            avisar_a_notificaciones(
                item['id'], item['nombre'], item['stock_restante'],
                item['stock_minimo'], emprendimiento_id, db_name
            )

        return jsonify({"status": "ok", "mensaje": "Venta confirmada", "venta_id": venta_id, "numero": num_venta, "total": total_a_pagar}), 201

    except Exception as e:
        conn.rollback()
        return jsonify({"status": "error", "mensaje": str(e)}), 500
    finally:
        cur.close()
        conn.close()

# ==========================================
# 3. ANULAR VENTA (BLOQUEO ANTI-DOBLE CLIC)
# ==========================================
@ventas_bp.route('/api/ventas/<int:id>/anular', methods=['PATCH'])
def anular_venta(id):
    payload, error_resp, status = verificar_token()
    if error_resp: return error_resp, status

    emprendimiento_id = payload.get("negocio_id")
    usuario = payload.get("usuario", "admin")
    
    conn = get_db(payload.get("db_name"))
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        # Bloqueo: Solo actualiza si sigue confirmada
        # [Ajuste Kardex - Aldi]: incluimos numero_venta en el RETURNING para registrar el motivo en movimientos_stock
        cur.execute("""
            UPDATE ventas.ventas SET estado = 'ANULADA', anulada_por = %s, anulada_en = CURRENT_TIMESTAMP 
            WHERE id = %s AND emprendimiento_id = %s AND estado = 'CONFIRMADA' RETURNING id, numero_venta, cliente_id, saldo_a_favor_usado
        """, (usuario, id, emprendimiento_id))
        
        venta = cur.fetchone()
        if not venta:
            return jsonify({"status": "error", "mensaje": "Venta ya anulada o inexistente"}), 409

        productos_repuestos = []
        cur.execute("SELECT producto_id, cantidad FROM ventas.venta_detalle WHERE venta_id = %s", (id,))
        for det in cur.fetchall():
            # [Ajuste Kardex y Notificaciones - Aldi]: devuelve datos del producto para registrar movimiento y reevaluar alerta
            cur.execute("""
                UPDATE productos.productos 
                SET cantidad = cantidad + %s, modificado_por = %s, modificado_en = CURRENT_TIMESTAMP
                WHERE id = %s AND emprendimiento_id = %s
                RETURNING nombre, cantidad, stock_minimo
            """, (det['cantidad'], usuario, det['producto_id'], emprendimiento_id))
            prod_rep = cur.fetchone()

            if prod_rep:
                # Nota: chk_mov_tipo admite 'AJUSTE_MANUAL' para devoluciones por anulación de venta
                cur.execute("""
                    INSERT INTO productos.movimientos_stock
                        (emprendimiento_id, producto_id, tipo, cantidad_movimiento, stock_resultante, motivo, usuario)
                    VALUES (%s, %s, 'AJUSTE_MANUAL', %s, %s, %s, %s)
                """, (emprendimiento_id, det['producto_id'], det['cantidad'], prod_rep['cantidad'], f"Anulación Venta {venta['numero_venta']}", usuario))

                productos_repuestos.append({
                    "id": det['producto_id'],
                    "nombre": prod_rep['nombre'],
                    "stock_actual": prod_rep['cantidad'],
                    "stock_minimo": prod_rep['stock_minimo']
                })

        cur.execute("""
            UPDATE ventas.pagos SET estado = 'ANULADO', anulado_por = %s, anulado_en = CURRENT_TIMESTAMP 
            WHERE venta_id = %s
        """, (usuario, id))

        # Devolver saldo a favor si se usó
        if venta['saldo_a_favor_usado'] > 0 and venta['cliente_id']:
            cur.execute("UPDATE ventas.clientes SET saldo_a_favor = saldo_a_favor + %s WHERE id = %s", (venta['saldo_a_favor_usado'], venta['cliente_id']))

        conn.commit()

        # [Ajuste Notificaciones - Aldi]: si el stock repuesto superó el mínimo, resuelve la alerta activa
        for p in productos_repuestos:
            avisar_a_notificaciones(
                p['id'], p['nombre'], p['stock_actual'],
                p['stock_minimo'], emprendimiento_id, payload.get("db_name")
            )

        return jsonify({"status": "ok", "mensaje": "Venta anulada"}), 200
    except Exception as e:
        conn.rollback()
        return jsonify({"status": "error", "mensaje": str(e)}), 500
    finally:
        cur.close()
        conn.close()

# ==========================================
# 4. OCULTAR VENTA (SOLO ADMIN)
# ==========================================
@ventas_bp.route('/api/ventas/<int:id>/ocultar', methods=['PATCH'])
def ocultar_venta(id):
    payload, error_resp, status = verificar_token()
    if error_resp: return error_resp, status

    if payload.get("rol") not in ["ADMIN", "PROPIETARIO"]:
        return jsonify({"status": "error", "mensaje": "Solo Admin"}), 403

    # {"oculto": true} oculta la venta y {"oculto": false} la restaura. Sin dato, la oculta.
    oculto = (request.get_json(silent=True) or {}).get('oculto', True)
    if not isinstance(oculto, bool):
        return jsonify({"status": "error", "mensaje": "El campo oculto debe ser true o false"}), 400

    conn = get_db(payload.get("db_name"))
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("UPDATE ventas.ventas SET oculto = %s WHERE id = %s AND emprendimiento_id = %s RETURNING id", (oculto, id, payload.get("negocio_id")))
        if not cur.fetchone():
            return jsonify({"status": "error", "mensaje": "Venta no encontrada"}), 404
        conn.commit()
        return jsonify({"status": "ok", "mensaje": "Venta oculta" if oculto else "Venta restaurada"}), 200
    except Exception as e:
        conn.rollback()
        return jsonify({"status": "error", "mensaje": str(e)}), 500
    finally:
        cur.close()
        conn.close()

# ==========================================
# 5. RESUMEN PARA REPORTES (CORREGIDO)
# ==========================================
# [Ajuste contrato y fórmulas Reportes - Aldi]:
# - Lee emprendimiento_id dinámico desde query params (no fijo en 1)
# - Filtra por fecha local Argentina (America/Argentina/Buenos_Aires)
# - Calcula vendido_saldado real (contado + cta cte con saldo <= 0) y ventas_por_saldar (cta cte con saldo > 0)
# - Calcula CMV real desde venta_detalle (cantidad * costo_unitario_historico) y Ganancia Bruta (subtotal_neto - CMV)
# - Devuelve los campos en el primer nivel del JSON (sin envolver en "datos")
@ventas_bp.route('/internal/ventas/resumen', methods=['GET'])
def resumen_ventas():
    fecha_desde = request.args.get('fecha_desde')
    fecha_hasta = request.args.get('fecha_hasta')
    db_name = request.args.get('db_name')
    emprendimiento_id = request.args.get('emprendimiento_id')

    if not fecha_desde or not fecha_hasta or not db_name or not emprendimiento_id:
        return jsonify({"status": "error", "mensaje": "Faltan parámetros requeridos (db_name, emprendimiento_id, fecha_desde, fecha_hasta)"}), 400

    emp_id = int(emprendimiento_id)
    conn = get_db(db_name)
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        # 1. Ventas saldadas, ventas por saldar y subtotal neto vendido del período
        cur.execute("""
            SELECT 
                COALESCE(SUM(
                    CASE 
                        WHEN v.tipo_venta = 'CONTADO' THEN v.total
                        WHEN (v.total - COALESCE((
                            SELECT SUM(p.monto) FROM ventas.pagos p 
                            WHERE p.venta_id = v.id AND p.estado = 'ACTIVO'
                        ), 0)) <= 0 THEN v.total
                        ELSE 0
                    END
                ), 0) AS vendido_saldado,
                COALESCE(SUM(
                    CASE 
                        WHEN v.tipo_venta = 'CUENTA_CORRIENTE'
                         AND (v.total - COALESCE((
                            SELECT SUM(p.monto) FROM ventas.pagos p 
                            WHERE p.venta_id = v.id AND p.estado = 'ACTIVO'
                        ), 0)) > 0 THEN 1
                        ELSE 0
                    END
                ), 0) AS ventas_por_saldar,
                COALESCE(SUM(v.subtotal_neto), 0) AS total_neto_vendido
            FROM ventas.ventas v
            WHERE v.emprendimiento_id = %s 
              AND v.estado = 'CONFIRMADA' 
              AND (v.fecha_hora AT TIME ZONE 'America/Argentina/Buenos_Aires')::date BETWEEN %s::date AND %s::date
        """, (emp_id, fecha_desde, fecha_hasta))
        cab = cur.fetchone()

        # 2. Costo de Mercadería Vendida (CMV) usando el costo histórico congelado en venta_detalle
        cur.execute("""
            SELECT COALESCE(SUM(vd.cantidad * vd.costo_unitario_historico), 0) AS cmv
            FROM ventas.venta_detalle vd
            JOIN ventas.ventas v ON vd.venta_id = v.id
            WHERE v.emprendimiento_id = %s
              AND v.estado = 'CONFIRMADA'
              AND (v.fecha_hora AT TIME ZONE 'America/Argentina/Buenos_Aires')::date BETWEEN %s::date AND %s::date
        """, (emp_id, fecha_desde, fecha_hasta))
        det = cur.fetchone()

        vendido_saldado = round(float(cab['vendido_saldado']), 2)
        ventas_por_saldar = int(cab['ventas_por_saldar'])
        cmv = round(float(det['cmv']), 2)
        ganancia_bruta = round(float(cab['total_neto_vendido']) - cmv, 2)
        return jsonify({"status": "ok", "vendido_saldado": vendido_saldado, "ventas_por_saldar": ventas_por_saldar, "cmv": cmv, "ganancia_bruta": ganancia_bruta}), 200
    except Exception as e:
        return jsonify({"status": "error", "mensaje": str(e)}), 500
    finally:
        cur.close()
        conn.close()