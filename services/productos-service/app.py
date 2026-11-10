from flask import Flask, request, jsonify
import os
import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv
from flask_cors import CORS

load_dotenv()
app = Flask(__name__)
CORS(app)
def calcular_costo_real(monto_total, iva_porcentaje, cat_negocio, cat_proveedor):
    """
    Calcula el costo neto de una compra según la regla de IVA.
    Si el negocio es RI y el proveedor es RI, separa el IVA. En el resto, lo deja adentro.
    """
    # Si el negocio NO es RI, o el proveedor NO es RI, el IVA se queda adentro.
    if cat_negocio != 'RESPONSABLE_INSCRIPTO' or cat_proveedor != 'RESPONSABLE_INSCRIPTO':
        return monto_total
    
    # Si ambos son RI, calculamos el neto.
    costo_neto = monto_total / (1 + (iva_porcentaje / 100))
    return round(costo_neto, 4)
def get_db():
    return psycopg2.connect(
        host=os.getenv("DB_HOST"), database=os.getenv("DB_NAME"),
        user=os.getenv("DB_USER"), password=os.getenv("DB_PASSWORD"), port=os.getenv("DB_PORT")
    )

# ==========================================
# RUTA 1: LISTAR BIENES DE CAMBIO (TAREA DE ROCI)
# ==========================================
@app.route('/api/productos', methods=['GET'])
def listar_productos():
    # Por ahora simulamos el negocio_id = 1 (luego vendrá del JWT)
    emprendimiento_id = 1
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        # Solo traemos los que son BIEN_DE_CAMBIO
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
@app.route('/api/productos', methods=['POST'])
def crear_producto():
    datos = request.get_json()
    # Simulamos el negocio y usuario (luego vendrán del JWT)
    emprendimiento_id = 1
    usuario_id = "admin" 

    # 1. Validar datos obligatorios
    if not datos.get('nombre') or not datos.get('precio_compra') or not datos.get('proveedor_id'):
        return jsonify({"status": "error", "mensaje": "Faltan datos obligatorios (nombre, precio_compra, proveedor_id)"}), 400

    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        # 2. Insertar el producto en la base de datos
        # Nota: Usamos RETURNING para que la base nos devuelva el ID generado
        cur.execute("""
            INSERT INTO productos.productos 
            (emprendimiento_id, proveedor_id, tipo_producto, nombre, precio_compra, iva_alicuota, rentabilidad, precio_venta, cantidad, stock_minimo, unidad_medida, creado_por) 
            VALUES (%s, %s, 'BIEN_DE_CAMBIO', %s, %s, %s, %s, %s, %s, %s, 'unidades', %s) 
            RETURNING id, nombre, precio_venta, cantidad
        """, (
            emprendimiento_id, 
            datos.get('proveedor_id'),
            datos['nombre'],
            datos.get('precio_compra', 0),
            datos.get('iva_alicuota', 21.00),
            datos.get('rentabilidad', 0.00),
            datos.get('precio_venta', 0.00), # Este precio puede venir calculado o editado
            datos.get('cantidad', 0),
            datos.get('stock_minimo', 0),
            usuario_id
        ))
        
        nuevo_producto = cur.fetchone()
        conn.commit()

        return jsonify({
            "status": "ok",
            "mensaje": "Bien de cambio creado exitosamente",
            "producto": nuevo_producto
        }), 201

    except Exception as e:
        conn.rollback()
        return jsonify({"status": "error", "mensaje": str(e)}), 500
    finally:
        cur.close()
        conn.close()
def calcular_costo_real(monto, iva, cat_negocio, cat_proveedor):
    if cat_negocio != 'RESPONSABLE_INSCRIPTO' or cat_proveedor != 'RESPONSABLE_INSCRIPTO':
        return monto
    return round(monto / (1 + (iva / 100)), 4)

@app.route('/api/productos/<int:id>/reposicion', methods=['POST'])
def reponer_stock(id):
    datos = request.get_json()
    emprendimiento_id = 1
    usuario = "admin"

    # Validaciones básicas
    if not datos.get('cantidad') or not datos.get('monto_total') or not datos.get('proveedor_id'):
        return jsonify({"status": "error", "mensaje": "Faltan datos obligatorios"}), 400

    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        # 1. Buscamos el producto para saber su IVA y su stock actual
        cur.execute("SELECT * FROM productos.productos WHERE id = %s AND emprendimiento_id = %s", (id, emprendimiento_id))
        producto = cur.fetchone()
        if not producto:
            return jsonify({"status": "error", "mensaje": "Producto no encontrado"}), 404

        # 2. Buscamos el proveedor para saber su categoría impositiva
        cur.execute("SELECT categoria_impositiva FROM productos.proveedores WHERE id = %s AND emprendimiento_id = %s", (datos['proveedor_id'], emprendimiento_id))
        proveedor = cur.fetchone()
        if not proveedor:
            return jsonify({"status": "error", "mensaje": "Proveedor no encontrado"}), 404

        # 3. Buscamos la categoría impositiva del negocio (simulada como RI por ahora)
        cat_negocio = 'RESPONSABLE_INSCRIPTO' 

        # 4. Calculamos el costo real usando la función
        costo_real = calcular_costo_real(float(datos['monto_total']), float(producto['iva_alicuota']), cat_negocio, proveedor['categoria_impositiva'])

        # 5. Calculamos el nuevo stock
        nuevo_stock = float(producto['cantidad']) + float(datos['cantidad'])
        
        # 6. Insertamos la reposición
        cur.execute("""
            INSERT INTO productos.reposiciones 
            (emprendimiento_id, producto_id, proveedor_id, cantidad, monto_total, costo_unitario_real, fecha_adquisicion, creado_por) 
            VALUES (%s, %s, %s, %s, %s, %s, CURRENT_DATE, %s) RETURNING id
        """, (emprendimiento_id, id, datos['proveedor_id'], datos['cantidad'], datos['monto_total'], costo_real / float(datos['cantidad']), usuario))
        
        reposicion_id = cur.fetchone()['id']

        # 7. Actualizamos el producto (stock y precio_compra)
        cur.execute("""
            UPDATE productos.productos 
            SET cantidad = %s, precio_compra = %s, modificado_por = %s, modificado_en = CURRENT_TIMESTAMP
            WHERE id = %s
        """, (nuevo_stock, costo_real / float(datos['cantidad']), usuario, id))

        # 8. Registramos en el Kardex
        cur.execute("""
            INSERT INTO productos.movimientos_stock 
            (emprendimiento_id, producto_id, reposicion_id, tipo, cantidad_movimiento, stock_resultante, usuario) 
            VALUES (%s, %s, %s, 'REPOSICION', %s, %s, %s)
        """, (emprendimiento_id, id, reposicion_id, datos['cantidad'], nuevo_stock, usuario))

        # Si todo salió bien, confirmamos los cambios
        conn.commit()

        return jsonify({
            "status": "ok",
            "mensaje": "Reposición registrada con éxito",
            "costo_real_compra": costo_real,
            "nuevo_stock": nuevo_stock
        }), 201

    except Exception as e:
        conn.rollback() # Si algo falla, volvemos todo atrás
        return jsonify({"status": "error", "mensaje": str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/reposiciones/<int:id>/anular', methods=['PATCH'])
def anular_reposicion(id):
    emprendimiento_id = 1
    usuario = "admin"

    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        # 1. Buscamos la reposición y verificamos que esté ACTIVA
        cur.execute("""
            SELECT r.*, p.cantidad AS stock_actual 
            FROM productos.reposiciones r
            JOIN productos.productos p ON r.producto_id = p.id
            WHERE r.id = %s AND r.emprendimiento_id = %s AND r.estado = 'ACTIVA'
        """, (id, emprendimiento_id))
        
        reposicion = cur.fetchone()
        if not reposicion:
            return jsonify({"status": "error", "mensaje": "Reposición no encontrada o ya anulada"}), 404

        # 2. Verificamos que el stock no quede negativo al restar
        stock_actual = float(reposicion['stock_actual'])
        cantidad_reposicion = float(reposicion['cantidad'])
        
        if stock_actual < cantidad_reposicion:
            return jsonify({"status": "error", "mensaje": "No se puede anular: el stock quedaría negativo"}), 409

        # 3. Calculamos el nuevo stock
        nuevo_stock = stock_actual - cantidad_reposicion

        # 4. Cambiamos el estado de la reposición a ANULADA
        cur.execute("""
            UPDATE productos.reposiciones 
            SET estado = 'ANULADA', anulada_por = %s, anulada_en = CURRENT_TIMESTAMP 
            WHERE id = %s
        """, (usuario, id))

        # 5. Restamos el stock del producto
        cur.execute("UPDATE productos.productos SET cantidad = %s WHERE id = %s", (nuevo_stock, reposicion['producto_id']))

        # 6. Registramos en el Kardex (movimiento negativo)
        cur.execute("""
            INSERT INTO productos.movimientos_stock 
            (emprendimiento_id, producto_id, reposicion_id, tipo, cantidad_movimiento, stock_resultante, usuario, motivo) 
            VALUES (%s, %s, %s, 'ANULACION_REPOSICION', %s, %s, %s, 'Anulación de reposición')
        """, (emprendimiento_id, reposicion['producto_id'], id, -cantidad_reposicion, nuevo_stock, usuario))

        conn.commit()
        return jsonify({"status": "ok", "mensaje": "Reposición anulada", "nuevo_stock": nuevo_stock}), 200

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

    # Validaciones obligatorias
    if not datos.get('cantidad') or not datos.get('motivo'):
        return jsonify({"status": "error", "mensaje": "Faltan datos: cantidad y motivo son obligatorios"}), 400

    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        # 1. Buscamos el producto
        cur.execute("SELECT cantidad FROM productos.productos WHERE id = %s AND emprendimiento_id = %s", (id, emprendimiento_id))
        producto = cur.fetchone()
        if not producto:
            return jsonify({"status": "error", "mensaje": "Producto no encontrado"}), 404

        cantidad_baja = float(datos['cantidad'])
        stock_actual = float(producto['cantidad'])

        # 2. Validamos que el stock no quede negativo
        if stock_actual < cantidad_baja:
            return jsonify({"status": "error", "mensaje": "No hay stock suficiente para dar de baja esa cantidad"}), 409

        # 3. Calculamos nuevo stock
        nuevo_stock = stock_actual - cantidad_baja

        # 4. Restamos el stock del producto
        cur.execute("UPDATE productos.productos SET cantidad = %s WHERE id = %s", (nuevo_stock, id))

        # 5. Registramos en el Kardex con tipo 'BAJA'
        cur.execute("""
            INSERT INTO productos.movimientos_stock 
            (emprendimiento_id, producto_id, tipo, cantidad_movimiento, stock_resultante, motivo, usuario) 
            VALUES (%s, %s, 'BAJA', %s, %s, %s, %s)
        """, (emprendimiento_id, id, -cantidad_baja, nuevo_stock, datos['motivo'], usuario))

        conn.commit()
        return jsonify({"status": "ok", "mensaje": "Baja registrada exitosamente", "nuevo_stock": nuevo_stock}), 201

    except Exception as e:
        conn.rollback()
        return jsonify({"status": "error", "mensaje": str(e)}), 500
    finally:
        cur.close()
        conn.close()
@app.route('/api/productos/<int:id>/ocultar', methods=['PATCH'])
def ocultar_producto(id):
    emprendimiento_id = 1
    usuario = "admin"

    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        # 1. Verificamos que el producto existe y pertenece al negocio
        cur.execute("SELECT activo FROM productos.productos WHERE id = %s AND emprendimiento_id = %s", (id, emprendimiento_id))
        producto = cur.fetchone()
        
        if not producto:
            return jsonify({"status": "error", "mensaje": "Producto no encontrado"}), 404

        # 2. Cambiamos su estado a inactivo (oculto)
        cur.execute("""
            UPDATE productos.productos 
            SET activo = FALSE, modificado_por = %s, modificado_en = CURRENT_TIMESTAMP 
            WHERE id = %s
        """, (usuario, id))
        
        conn.commit()
        return jsonify({"status": "ok", "mensaje": "Producto oculto correctamente"}), 200

    except Exception as e:
        conn.rollback()
        return jsonify({"status": "error", "mensaje": str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/productos/<int:id>', methods=['DELETE'])
def eliminar_producto(id):
    emprendimiento_id = 1

    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        # 1. Verificamos que el producto existe
        cur.execute("SELECT id FROM productos.productos WHERE id = %s AND emprendimiento_id = %s", (id, emprendimiento_id))
        if not cur.fetchone():
            return jsonify({"status": "error", "mensaje": "Producto no encontrado"}), 404

        # 2. Verificamos si tiene movimientos (reposiciones, movimientos de stock)
        cur.execute("SELECT id FROM productos.movimientos_stock WHERE producto_id = %s LIMIT 1", (id,))
        if cur.fetchone():
            return jsonify({"status": "error", "mensaje": "No se puede eliminar: el producto tiene movimientos. Se sugiere ocultarlo."}), 409

        # 3. Si no tiene movimientos, lo borramos
        cur.execute("DELETE FROM productos.productos WHERE id = %s", (id,))
        
        conn.commit()
        return jsonify({"status": "ok", "mensaje": "Producto eliminado definitivamente"}), 200

    except Exception as e:
        conn.rollback()
        return jsonify({"status": "error", "mensaje": str(e)}), 500
    finally:
        cur.close()
        conn.close()
if __name__ == '__main__':
    port = int(os.getenv("SERVICE_PORT", 5002))
    app.run(host='127.0.0.1', port=port, debug=True)