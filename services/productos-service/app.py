from flask import Flask, request, jsonify
import os
import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv

load_dotenv()
app = Flask(__name__)

def get_db():
    return psycopg2.connect(
        host=os.getenv("DB_HOST"), database=os.getenv("DB_NAME"),
        user=os.getenv("DB_USER"), password=os.getenv("DB_PASSWORD"), port=os.getenv("DB_PORT")
    )

# ==========================================
# RUTA 1: BUSCADOR Y LISTADO (TAREA DE ROCI C)
# ==========================================
@app.route('/api/productos', methods=['GET'])
def listar_productos():
    # Simulamos el emprendimiento_id (en el futuro saldrá del token JWT)
    emprendimiento_id = 1 

    # Parámetros de la URL
    q = request.args.get('q', '')
    stock_bajo = request.args.get('stock_bajo', 'false').lower() == 'true'
    pagina = int(request.args.get('pagina', 1))
    limite = int(request.args.get('limite', 10))
    offset = (pagina - 1) * limite

    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    # Armamos la consulta SQL (OJO: auth.productos)
    query = """
        SELECT id, nombre, precio_venta, stock_actual, stock_minimo, activo 
        FROM auth.productos 
        WHERE emprendimiento_id = %s AND activo = TRUE
    """
    params = [emprendimiento_id]

    if q:
        query += " AND nombre ILIKE %s"
        params.append(f"%{q}%")

    if stock_bajo:
        query += " AND stock_actual <= stock_minimo"

    query += " ORDER BY id DESC LIMIT %s OFFSET %s"
    params.extend([limite, offset])

    try:
        cur.execute(query, tuple(params))
        productos = cur.fetchall()
        
        return jsonify({
            "status": "ok",
            "pagina": pagina,
            "items": productos
        }), 200

    except Exception as e:
        return jsonify({"status": "error", "mensaje": str(e)}), 500
    finally:
        cur.close()
        conn.close()
# ==========================================
# RUTA 2: CREAR PRODUCTO (TAREA DE ROCI C)
# ==========================================
@app.route('/api/productos', methods=['POST'])
def crear_producto():
    datos = request.get_json()
    
    # 1. Validar que los datos obligatorios estén presentes
    if not datos or not datos.get('nombre') or datos.get('precio_venta') is None:
        return jsonify({"status": "error", "mensaje": "Faltan datos obligatorios (nombre, precio_venta)"}), 400

    # 2. Validar que el precio no sea negativo ni el stock
    if float(datos['precio_venta']) < 0:
        return jsonify({"status": "error", "mensaje": "El precio de venta no puede ser negativo"}), 400

    # Simulamos el emprendimiento y el usuario (luego vendrán del token)
    emprendimiento_id = 1
    usuario_id = 1 

    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        # 3. Insertar el producto en la base de datos
        cur.execute("""
            INSERT INTO auth.productos 
            (emprendimiento_id, nombre, descripcion, costo_unitario, precio_venta, stock_actual, stock_minimo, creado_por) 
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s) 
            RETURNING id, nombre, precio_venta, stock_actual
        """, (
            emprendimiento_id, 
            datos['nombre'], 
            datos.get('descripcion', ''), 
            datos.get('costo_unitario', 0), 
            datos['precio_venta'], 
            datos.get('stock_actual', 0), 
            datos.get('stock_minimo', 0), 
            usuario_id
        ))
        
        nuevo_producto = cur.fetchone()
        conn.commit()

        return jsonify({
            "status": "ok",
            "mensaje": "Producto creado exitosamente",
            "producto": nuevo_producto
        }), 201

    except Exception as e:
        conn.rollback()
        return jsonify({"status": "error", "mensaje": str(e)}), 500
    finally:
        cur.close()
        conn.close()
# ==========================================
# RUTA 3: REPOSICIÓN ATOMICA (TAREA DE ALDI)
# ==========================================
@app.route('/api/productos/<int:id>/reposicion', methods=['POST'])
def reponer_stock(id):
    # TODO: Aldi programa la lógica transaccional (sumar stock, actualizar costo).
    return jsonify({"mensaje": "Acá Aldi programa la reposición"}), 200

# ==========================================
# RUTA 4: DESCUENTO DE STOCK (TAREA DE ALDI)
# ==========================================
@app.route('/api/productos/<int:id>/descontar', methods=['POST'])
def descontar_stock(id):
    # TODO: Aldi programa el UPDATE condicional.
    return jsonify({"mensaje": "Acá Aldi programa el descuento"}), 200



@app.route('/api/productos/<int:id>', methods=['PUT'])
def editar_producto(id):
    datos = request.get_json()
    if not datos:
        return jsonify({"status": "error", "mensaje": "No se enviaron datos"}), 400

    usuario_id = 1 # Simulamos el usuario del token
    
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        # 1. Verificar que el producto existe y pertenece al emprendimiento (Aislamiento)
        cur.execute("SELECT id FROM auth.productos WHERE id = %s AND emprendimiento_id = 1", (id,))
        if not cur.fetchone():
            return jsonify({"status": "error", "mensaje": "Producto no encontrado"}), 404

        # 2. Validar que el stock no sea negativo
        if datos.get('stock_actual') is not None and int(datos['stock_actual']) < 0:
            return jsonify({"status": "error", "mensaje": "El stock no puede ser negativo"}), 400

        # 3. Actualizar (usamos COALESCE para actualizar solo lo que envían)
        cur.execute("""
            UPDATE auth.productos SET 
                nombre = COALESCE(%s, nombre),
                descripcion = COALESCE(%s, descripcion),
                costo_unitario = COALESCE(%s, costo_unitario),
                precio_venta = COALESCE(%s, precio_venta),
                stock_actual = COALESCE(%s, stock_actual),
                stock_minimo = COALESCE(%s, stock_minimo),
                modificado_por = %s,
                fecha_modificacion = CURRENT_TIMESTAMP
            WHERE id = %s AND emprendimiento_id = 1
            RETURNING id, nombre, stock_actual
        """, (
            datos.get('nombre'), datos.get('descripcion'), datos.get('costo_unitario'),
            datos.get('precio_venta'), datos.get('stock_actual'), datos.get('stock_minimo'),
            usuario_id, id
        ))
        
        producto_editado = cur.fetchone()
        conn.commit()

        return jsonify({"status": "ok", "mensaje": "Producto actualizado", "producto": producto_editado}), 200
    except Exception as e:
        conn.rollback()
        return jsonify({"status": "error", "mensaje": str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/productos/<int:id>/visibilidad', methods=['PATCH'])
def cambiar_visibilidad(id):
    datos = request.get_json()
    if 'activo' not in datos:
        return jsonify({"status": "error", "mensaje": "Falta el campo 'activo'"}), 400

    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        # Aislamiento: solo actualiza si es de este emprendimiento
        cur.execute(
            "UPDATE auth.productos SET activo = %s, modificado_por = 1 WHERE id = %s AND emprendimiento_id = 1 RETURNING id, activo", 
            (datos['activo'], id)
        )
        producto = cur.fetchone()
        if not producto:
            return jsonify({"status": "error", "mensaje": "Producto no encontrado"}), 404
            
        conn.commit()
        estado = "visible" if producto['activo'] else "oculto"
        return jsonify({"status": "ok", "mensaje": f"Producto ahora esta {estado}"}), 200
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
        # 1. Buscamos si el producto existe (Aislamiento estricto)
        cur.execute("SELECT id FROM auth.productos WHERE id = %s AND emprendimiento_id = 1", (id,))
        if not cur.fetchone():
            return jsonify({"status": "error", "mensaje": "Producto no encontrado"}), 404

        # (Acá en el futuro validaremos si tiene ventas o reposiciones. Por ahora simulamos que no tiene).
        
        # 2. Lo eliminamos de la base de datos
        cur.execute("DELETE FROM auth.productos WHERE id = %s AND emprendimiento_id = 1", (id,))
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