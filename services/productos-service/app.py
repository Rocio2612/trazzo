from flask import Flask, request, jsonify
import os
import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv
from flask_cors import CORS

load_dotenv()
app = Flask(__name__)
CORS(app)

def get_db():
    return psycopg2.connect(
        host=os.getenv("DB_HOST"), database=os.getenv("DB_NAME"),
        user=os.getenv("DB_USER"), password=os.getenv("DB_PASSWORD"), port=os.getenv("DB_PORT")
    )

# --- FUNCIÓN DEL IVA ---
def calcular_costo_real(monto, iva, cat_negocio, cat_proveedor):
    if cat_negocio != 'RESPONSABLE_INSCRIPTO' or cat_proveedor != 'RESPONSABLE_INSCRIPTO':
        return monto
    return round(monto / (1 + (iva / 100)), 4)

# --- FUNCIÓN DE ALERTAS ---
def evaluar_alerta_stock(producto_id, nombre_producto, stock_actual, stock_minimo, emprendimiento_id):
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("""
            SELECT id FROM notificaciones.alertas_stock 
            WHERE producto_id = %s AND estado = 'ACTIVA' AND emprendimiento_id = %s
        """, (producto_id, emprendimiento_id))
        alerta = cur.fetchone()

        if float(stock_actual) <= float(stock_minimo):
            mensaje = f"Quedan {stock_actual} unidades de {nombre_producto}"
            if alerta:
                cur.execute("""
                    UPDATE notificaciones.alertas_stock 
                    SET stock_actual = %s, mensaje = %s, actualizado_en = CURRENT_TIMESTAMP 
                    WHERE id = %s
                """, (stock_actual, mensaje, alerta['id']))
            else:
                cur.execute("""
                    INSERT INTO notificaciones.alertas_stock 
                    (emprendimiento_id, producto_id, producto_nombre, stock_actual, stock_minimo, mensaje, estado)
                    VALUES (%s, %s, %s, %s, %s, %s, 'ACTIVA')
                """, (emprendimiento_id, producto_id, nombre_producto, stock_actual, stock_minimo, mensaje))
        else:
            if alerta:
                cur.execute("""
                    UPDATE notificaciones.alertas_stock 
                    SET estado = 'RESUELTA', actualizado_en = CURRENT_TIMESTAMP 
                    WHERE id = %s
                """, (alerta['id'],))
        conn.commit()
    except Exception as e:
        print(f"Error en alerta: {e}")
    finally:
        cur.close()
        conn.close()

# --- CRUD PRODUCTOS ---
@app.route('/api/productos', methods=['POST'])
def crear_producto():
    datos = request.get_json()
    emprendimiento_id = 1
    usuario_id = "admin"
    if not datos.get('nombre') or not datos.get('precio_compra') or not datos.get('proveedor_id'):
        return jsonify({"status": "error", "mensaje": "Faltan datos obligatorios"}), 400
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("""
            INSERT INTO productos.productos 
            (emprendimiento_id, proveedor_id, tipo_producto, nombre, precio_compra, iva_alicuota, rentabilidad, precio_venta, cantidad, stock_minimo, unidad_medida, creado_por) 
            VALUES (%s, %s, 'BIEN_DE_CAMBIO', %s, %s, %s, %s, %s, %s, %s, 'unidades', %s) 
            RETURNING id, nombre, precio_venta, cantidad
        """, (emprendimiento_id, datos.get('proveedor_id'), datos['nombre'], datos.get('precio_compra', 0), datos.get('iva_alicuota', 21.00), datos.get('rentabilidad', 0.00), datos.get('precio_venta', 0.00), datos.get('cantidad', 0), datos.get('stock_minimo', 0), usuario_id))
        nuevo_producto = cur.fetchone()
        conn.commit()
        return jsonify({"status": "ok", "mensaje": "Bien de cambio creado", "producto": nuevo_producto}), 201
    except Exception as e:
        conn.rollback()
        return jsonify({"status": "error", "mensaje": str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/productos', methods=['GET'])
def listar_productos():
    emprendimiento_id = 1
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("""
            SELECT id, nombre, precio_compra, precio_venta, cantidad, stock_minimo, activo 
            FROM productos.productos 
            WHERE emprendimiento_id = %s AND tipo_producto = 'BIEN_DE_CAMBIO' AND activo = TRUE
        """, (emprendimiento_id,))
        productos = cur.fetchall()
        return jsonify({"status": "ok", "items": productos}), 200
    except Exception as e:
        return jsonify({"status": "error", "mensaje": str(e)}), 500
    finally:
        cur.close()
        conn.close()

# --- REPOSICIÓN ---
@app.route('/api/productos/<int:id>/reposicion', methods=['POST'])
def reponer_stock(id):
    datos = request.get_json()
    emprendimiento_id = 1
    usuario = "admin"
    if not datos.get('cantidad') or not datos.get('monto_total') or not datos.get('proveedor_id'):
        return jsonify({"status": "error", "mensaje": "Faltan datos"}), 400
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("SELECT * FROM productos.productos WHERE id = %s AND emprendimiento_id = %s", (id, emprendimiento_id))
        producto = cur.fetchone()
        cur.execute("SELECT categoria_impositiva FROM productos.proveedores WHERE id = %s", (datos['proveedor_id'],))
        proveedor = cur.fetchone()
        
        cat_negocio = 'RESPONSABLE_INSCRIPTO' 
        costo_real = calcular_costo_real(float(datos['monto_total']), float(producto['iva_alicuota']), cat_negocio, proveedor['categoria_impositiva'])
        nuevo_stock = float(producto['cantidad']) + float(datos['cantidad'])
        
        cur.execute("""
            INSERT INTO productos.reposiciones (emprendimiento_id, producto_id, proveedor_id, cantidad, monto_total, costo_unitario_real, fecha_adquisicion, creado_por) 
            VALUES (%s, %s, %s, %s, %s, %s, CURRENT_DATE, %s) RETURNING id
        """, (emprendimiento_id, id, datos['proveedor_id'], datos['cantidad'], datos['monto_total'], costo_real / float(datos['cantidad']), usuario))
        reposicion_id = cur.fetchone()['id']

        cur.execute("UPDATE productos.productos SET cantidad = %s, precio_compra = %s, modificado_por = %s WHERE id = %s", (nuevo_stock, costo_real / float(datos['cantidad']), usuario, id))
        cur.execute("INSERT INTO productos.movimientos_stock (emprendimiento_id, producto_id, reposicion_id, tipo, cantidad_movimiento, stock_resultante, usuario) VALUES (%s, %s, %s, 'REPOSICION', %s, %s, %s)", (emprendimiento_id, id, reposicion_id, datos['cantidad'], nuevo_stock, usuario))
        
        # Evaluamos alerta (por si estaba en mínimo y ahora subió)
        evaluar_alerta_stock(id, producto['nombre'], nuevo_stock, producto['stock_minimo'], emprendimiento_id)
        
        conn.commit()
        return jsonify({"status": "ok", "mensaje": "Reposición registrada", "costo_real": costo_real, "nuevo_stock": nuevo_stock}), 201
    except Exception as e:
        conn.rollback()
        return jsonify({"status": "error", "mensaje": str(e)}), 500
    finally:
        cur.close()
        conn.close()

# --- BAJAS (CON ALERTA INTEGRADA) ---
@app.route('/api/productos/<int:id>/baja', methods=['POST'])
def registrar_baja(id):
    datos = request.get_json()
    emprendimiento_id = 1
    usuario = "admin"
    if not datos.get('cantidad') or not datos.get('motivo'):
        return jsonify({"status": "error", "mensaje": "Faltan datos"}), 400
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # Traemos nombre, stock_minimo y cantidad
        cur.execute("SELECT nombre, cantidad, stock_minimo FROM productos.productos WHERE id = %s AND emprendimiento_id = %s", (id, emprendimiento_id))
        producto = cur.fetchone()
        if not producto:
            return jsonify({"status": "error", "mensaje": "Producto no encontrado"}), 404

        cantidad_baja = float(datos['cantidad'])
        stock_actual = float(producto['cantidad'])
        if stock_actual < cantidad_baja:
            return jsonify({"status": "error", "mensaje": "Stock insuficiente"}), 409

        nuevo_stock = stock_actual - cantidad_baja
        cur.execute("UPDATE productos.productos SET cantidad = %s WHERE id = %s", (nuevo_stock, id))
        
        cur.execute("""
            INSERT INTO productos.movimientos_stock 
            (emprendimiento_id, producto_id, tipo, cantidad_movimiento, stock_resultante, motivo, usuario) 
            VALUES (%s, %s, 'BAJA', %s, %s, %s, %s)
        """, (emprendimiento_id, id, -cantidad_baja, nuevo_stock, datos['motivo'], usuario))

        # EVALUAMOS LA ALERTA ACÁ
        evaluar_alerta_stock(id, producto['nombre'], nuevo_stock, producto['stock_minimo'], emprendimiento_id)
        
        conn.commit()
        return jsonify({"status": "ok", "mensaje": "Baja registrada", "nuevo_stock": nuevo_stock}), 201
    except Exception as e:
        conn.rollback()
        return jsonify({"status": "error", "mensaje": str(e)}), 500
    finally:
        cur.close()
        conn.close()

if __name__ == '__main__':
    port = int(os.getenv("SERVICE_PORT", 5002))
    app.run(host='127.0.0.1', port=port, debug=True)