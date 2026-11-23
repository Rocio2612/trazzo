from flask import Flask, request, jsonify
import os
import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv
from flask_cors import CORS
import requests

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

# --- FUNCIÓN PARA AVISAR A NOTIFICACIONES ---
def avisar_a_notificaciones(producto_id, nombre, stock, minimo, emp_id):
    url = "http://127.0.0.1:5006/internal/alertas/evaluar"
    payload = {
        "producto_id": producto_id, "nombre_producto": nombre,
        "stock_actual": stock, "stock_minimo": minimo, "emprendimiento_id": emp_id
    }
    try:
        requests.post(url, json=payload, timeout=2)
    except Exception as e:
        print(f"No se pudo avisar a notificaciones: {e}")

# ==========================================
# CRUD DE PRODUCTOS
# ==========================================
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

@app.route('/api/productos/<int:id>/ocultar', methods=['PATCH'])
def ocultar_producto(id):
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("UPDATE productos.productos SET activo = FALSE WHERE id = %s RETURNING id", (id,))
        if not cur.fetchone():
            return jsonify({"status": "error", "mensaje": "Producto no encontrado"}), 404
        conn.commit()
        return jsonify({"status": "ok", "mensaje": "Producto oculto"}), 200
    except Exception as e:
        conn.rollback()
        return jsonify({"status": "error", "mensaje": str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/productos/<int:id>', methods=['DELETE'])
def eliminar_producto(id):
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("SELECT id FROM productos.movimientos_stock WHERE producto_id = %s LIMIT 1", (id,))
        if cur.fetchone():
            return jsonify({"status": "error", "mensaje": "No se puede eliminar: tiene movimientos"}), 409
        cur.execute("DELETE FROM productos.productos WHERE id = %s", (id,))
        conn.commit()
        return jsonify({"status": "ok", "mensaje": "Producto eliminado"}), 200
    except Exception as e:
        conn.rollback()
        return jsonify({"status": "error", "mensaje": str(e)}), 500
    finally:
        cur.close()
        conn.close()

# ==========================================
# REPOSICIÓN Y BAJAS
# ==========================================
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
        
        avisar_a_notificaciones(id, producto['nombre'], nuevo_stock, producto['stock_minimo'], emprendimiento_id)
        
        conn.commit()
        return jsonify({"status": "ok", "mensaje": "Reposición registrada", "costo_real": costo_real, "nuevo_stock": nuevo_stock}), 201
    except Exception as e:
        conn.rollback()
        return jsonify({"status": "error", "mensaje": str(e)}), 500
    finally:
        cur.close()
        conn.close()

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
            INSERT INTO productos.movimientos_stock (emprendimiento_id, producto_id, tipo, cantidad_movimiento, stock_resultante, motivo, usuario) 
            VALUES (%s, %s, 'BAJA', %s, %s, %s, %s)
        """, (emprendimiento_id, id, -cantidad_baja, nuevo_stock, datos['motivo'], usuario))

        avisar_a_notificaciones(id, producto['nombre'], nuevo_stock, producto['stock_minimo'], emprendimiento_id)
        
        conn.commit()
        return jsonify({"status": "ok", "mensaje": "Baja registrada", "nuevo_stock": nuevo_stock}), 201
    except Exception as e:
        conn.rollback()
        return jsonify({"status": "error", "mensaje": str(e)}), 500
    finally:
        cur.close()
        conn.close()

# ==========================================
# CRUD DE PROVEEDORES (ACTUALIZADO PARA JIMENA)
# ==========================================
@app.route('/api/proveedores', methods=['POST'])
def crear_proveedor():
    datos = request.get_json()
    emprendimiento_id = 1
    if not datos.get('nombre') or not datos.get('numero_documento') or not datos.get('categoria_impositiva'):
        return jsonify({"status": "error", "mensaje": "Faltan datos obligatorios"}), 400
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("""
            INSERT INTO productos.proveedores 
            (emprendimiento_id, nombre, tipo_documento, numero_documento, categoria_impositiva, telefono, correo, descripcion_compra) 
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING id, nombre
        """, (emprendimiento_id, datos['nombre'], datos.get('tipo_documento', 'CUIT'), datos['numero_documento'], datos['categoria_impositiva'], datos.get('telefono', ''), datos.get('correo', ''), datos.get('descripcion_compra', '')))
        proveedor = cur.fetchone()
        conn.commit()
        return jsonify({"status": "ok", "mensaje": "Proveedor creado", "proveedor": proveedor}), 201
    except Exception as e:
        conn.rollback()
        if "uq_proveedor_doc_tenant" in str(e):
            return jsonify({"status": "error", "mensaje": "Proveedor ya existe"}), 409
        return jsonify({"status": "error", "mensaje": str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/proveedores', methods=['GET'])
def listar_proveedores():
    emprendimiento_id = 1
    q = request.args.get('q', '')
    ocultos = request.args.get('ocultos', 'false').lower() == 'true'

    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        query = """
            SELECT 
                p.id, p.nombre, p.tipo_documento, p.numero_documento, 
                p.categoria_impositiva, p.telefono, p.correo, p.descripcion_compra, p.activo,
                EXISTS(SELECT 1 FROM productos.productos WHERE proveedor_id = p.id) OR 
                EXISTS(SELECT 1 FROM productos.reposiciones WHERE proveedor_id = p.id) AS tiene_movimientos
            FROM productos.proveedores p
            WHERE p.emprendimiento_id = %s
        """
        params = [emprendimiento_id]

        if ocultos:
            query += " AND p.activo = FALSE"
        else:
            query += " AND p.activo = TRUE"

        if q:
            query += """ AND (
                p.nombre ILIKE %s OR 
                p.numero_documento ILIKE %s OR 
                p.telefono ILIKE %s OR 
                p.descripcion_compra ILIKE %s
            )"""
            search_term = f"%{q}%"
            params.extend([search_term, search_term, search_term, search_term])

        query += " ORDER BY p.nombre ASC"

        cur.execute(query, tuple(params))
        proveedores = cur.fetchall()
        return jsonify({"status": "ok", "items": proveedores}), 200
    except Exception as e:
        return jsonify({"status": "error", "mensaje": str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/proveedores/<int:id>', methods=['PUT'])
def editar_proveedor(id):
    datos = request.get_json()
    emprendimiento_id = 1
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("SELECT id FROM productos.proveedores WHERE id = %s AND emprendimiento_id = %s", (id, emprendimiento_id))
        if not cur.fetchone():
            return jsonify({"status": "error", "mensaje": "Proveedor no encontrado"}), 404

        cur.execute("""
            UPDATE productos.proveedores SET 
                nombre = COALESCE(%s, nombre),
                tipo_documento = COALESCE(%s, tipo_documento),
                numero_documento = COALESCE(%s, numero_documento),
                categoria_impositiva = COALESCE(%s, categoria_impositiva),
                telefono = COALESCE(%s, telefono),
                correo = COALESCE(%s, correo),
                descripcion_compra = COALESCE(%s, descripcion_compra)
            WHERE id = %s
            RETURNING id, nombre
        """, (datos.get('nombre'), datos.get('tipo_documento'), datos.get('numero_documento'), datos.get('categoria_impositiva'), datos.get('telefono'), datos.get('correo'), datos.get('descripcion_compra'), id))
        proveedor = cur.fetchone()
        conn.commit()
        return jsonify({"status": "ok", "mensaje": "Proveedor actualizado", "proveedor": proveedor}), 200
    except Exception as e:
        conn.rollback()
        if "uq_proveedor_doc_tenant" in str(e):
            return jsonify({"status": "error", "mensaje": "El documento ya existe en otro proveedor"}), 409
        return jsonify({"status": "error", "mensaje": str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/proveedores/<int:id>/visibilidad', methods=['PATCH'])
def cambiar_visibilidad_proveedor(id):
    datos = request.get_json()
    if 'activo' not in datos:
        return jsonify({"status": "error", "mensaje": "Falta el campo activo"}), 400
    
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("UPDATE productos.proveedores SET activo = %s WHERE id = %s RETURNING id, activo", (datos['activo'], id))
        proveedor = cur.fetchone()
        if not proveedor:
            return jsonify({"status": "error", "mensaje": "Proveedor no encontrado"}), 404
        conn.commit()
        estado = "visible" if proveedor['activo'] else "oculto"
        return jsonify({"status": "ok", "mensaje": f"Proveedor ahora está {estado}"}), 200
    except Exception as e:
        conn.rollback()
        return jsonify({"status": "error", "mensaje": str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/proveedores/<int:id>', methods=['DELETE'])
def eliminar_proveedor(id):
    emprendimiento_id = 1
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("SELECT id, activo FROM productos.proveedores WHERE id = %s AND emprendimiento_id = %s", (id, emprendimiento_id))
        proveedor = cur.fetchone()
        if not proveedor:
            return jsonify({"status": "error", "mensaje": "Proveedor no encontrado"}), 404
        
        if proveedor['activo'] == True:
            return jsonify({"status": "error", "mensaje": "Primero debes ocultar el proveedor para eliminarlo"}), 409

        cur.execute("SELECT 1 FROM productos.productos WHERE proveedor_id = %s LIMIT 1", (id,))
        if cur.fetchone():
            return jsonify({"status": "error", "mensaje": "No se puede eliminar: tiene productos asociados"}), 409

        cur.execute("SELECT 1 FROM productos.reposiciones WHERE proveedor_id = %s LIMIT 1", (id,))
        if cur.fetchone():
            return jsonify({"status": "error", "mensaje": "No se puede eliminar: tiene reposiciones asociadas"}), 409

        cur.execute("DELETE FROM productos.proveedores WHERE id = %s", (id,))
        conn.commit()
        return jsonify({"status": "ok", "mensaje": "Proveedor eliminado definitivamente"}), 200
    except Exception as e:
        conn.rollback()
        return jsonify({"status": "error", "mensaje": str(e)}), 500
    finally:
        cur.close()
        conn.close()

if __name__ == '__main__':
    port = int(os.getenv("SERVICE_PORT", 5002))
    app.run(host='127.0.0.1', port=port, debug=True)