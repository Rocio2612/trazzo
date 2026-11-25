from flask import Blueprint, request, jsonify
import psycopg2
from psycopg2.extras import RealDictCursor
import os
import jwt
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
            
            cur.execute("""
                UPDATE productos.productos 
                SET cantidad = cantidad - %s 
                WHERE id = %s AND emprendimiento_id = %s AND cantidad >= %s
                RETURNING precio_venta, precio_compra
            """, (item['cantidad'], item['producto_id'], emprendimiento_id, item['cantidad']))
            
            prod = cur.fetchone()
            if not prod:
                conn.rollback()
                return jsonify({"status": "error", "mensaje": f"Stock insuficiente para producto {item['producto_id']}"}), 409
            
            cur.execute("SELECT iva_alicuota FROM productos.productos WHERE id = %s", (item['producto_id'],))
            iva_prod = cur.fetchone()['iva_alicuota']

            subtotal_neto += float(prod['precio_venta']) * int(item['cantidad'])
            items_validados.append({
                "id": item['producto_id'], "cantidad": item['cantidad'],
                "precio": prod['precio_venta'], "costo": prod['precio_compra'], "iva": iva_prod
            })

        total_final = subtotal_neto
        saldo_usado = min(saldo_favor, total_final) if saldo_favor > 0 else 0
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

        if datos['tipo_venta'] == 'CONTADO':
            cur.execute("""
                INSERT INTO ventas.pagos (emprendimiento_id, venta_id, medio_pago_id, monto, creado_por)
                VALUES (%s, %s, %s, %s, %s)
            """, (emprendimiento_id, venta_id, datos['medio_pago_id'], total_a_pagar, usuario))
        
        if saldo_usado > 0 and cliente_id:
            cur.execute("UPDATE ventas.clientes SET saldo_a_favor = saldo_a_favor - %s WHERE id = %s", (saldo_usado, cliente_id))

        conn.commit()
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
        cur.execute("""
            UPDATE ventas.ventas SET estado = 'ANULADA', anulada_por = %s, anulada_en = CURRENT_TIMESTAMP 
            WHERE id = %s AND emprendimiento_id = %s AND estado = 'CONFIRMADA' RETURNING id, cliente_id, saldo_a_favor_usado
        """, (usuario, id, emprendimiento_id))
        
        venta = cur.fetchone()
        if not venta:
            return jsonify({"status": "error", "mensaje": "Venta ya anulada o inexistente"}), 409

        cur.execute("SELECT producto_id, cantidad FROM ventas.venta_detalle WHERE venta_id = %s", (id,))
        for det in cur.fetchall():
            cur.execute("UPDATE productos.productos SET cantidad = cantidad + %s WHERE id = %s", (det['cantidad'], det['producto_id']))

        cur.execute("""
            UPDATE ventas.pagos SET estado = 'ANULADO', anulado_por = %s, anulado_en = CURRENT_TIMESTAMP 
            WHERE venta_id = %s
        """, (usuario, id))

        # Devolver saldo a favor si se usó
        if venta['saldo_a_favor_usado'] > 0 and venta['cliente_id']:
            cur.execute("UPDATE ventas.clientes SET saldo_a_favor = saldo_a_favor + %s WHERE id = %s", (venta['saldo_a_favor_usado'], venta['cliente_id']))

        conn.commit()
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

    conn = get_db(payload.get("db_name"))
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("UPDATE ventas.ventas SET oculto = TRUE WHERE id = %s AND emprendimiento_id = %s RETURNING id", (id, payload.get("negocio_id")))
        if not cur.fetchone():
            return jsonify({"status": "error", "mensaje": "Venta no encontrada"}), 404
        conn.commit()
        return jsonify({"status": "ok", "mensaje": "Venta oculta"}), 200
    except Exception as e:
        conn.rollback()
        return jsonify({"status": "error", "mensaje": str(e)}), 500
    finally:
        cur.close()
        conn.close()

# ==========================================
# 5. RESUMEN PARA REPORTES (CORREGIDO)
# ==========================================
@ventas_bp.route('/internal/ventas/resumen', methods=['GET'])
def resumen_ventas():
    fecha_desde = request.args.get('fecha_desde')
    fecha_hasta = request.args.get('fecha_hasta')
    db_name = request.args.get('db_name', 'trazzo_trazzorocio')
    emprendimiento_id = 1

    if not fecha_desde or not fecha_hasta:
        return jsonify({"status": "error", "mensaje": "Faltan fechas"}), 400

    conn = get_db(db_name)
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        # Vendido y Saldado (Ventas CONFIRMADAS)
        cur.execute("""
            SELECT 
                COALESCE(SUM(total), 0) AS vendido_saldado,
                COUNT(id) AS ventas_por_saldar,
                COALESCE(SUM(subtotal_neto - monto_iva), 0) AS cmv,
                COALESCE(SUM(total - (subtotal_neto - monto_iva)), 0) AS ganancia_bruta
            FROM ventas.ventas 
            WHERE emprendimiento_id = %s AND estado = 'CONFIRMADA' 
              AND fecha_hora >= %s::date AND fecha_hora < (%s::date + INTERVAL '1 day')
        """, (emprendimiento_id, fecha_desde, fecha_hasta))
        
        resumen = cur.fetchone()
        return jsonify({"status": "ok", "datos": resumen}), 200
    except Exception as e:
        return jsonify({"status": "error", "mensaje": str(e)}), 500
    finally:
        cur.close()
        conn.close()