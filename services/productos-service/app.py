from flask import Flask, request, jsonify
import os
import jwt
import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv
from flask_cors import CORS
import requests

load_dotenv()
app = Flask(__name__)
CORS(app)

SECRET_KEY = os.getenv("JWT_SECRET")

def get_db(db_name=None):
    if not db_name:
        raise ValueError("No se especificó la base de datos del emprendimiento (db_name faltante)")
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
        if not payload.get("db_name"):
            return None, jsonify({"status": "error", "mensaje": "Token sin base de datos asignada"}), 401
        return payload, None, 200
    except jwt.ExpiredSignatureError:
        return None, jsonify({"status": "error", "mensaje": "Sesión expirada"}), 401
    except jwt.InvalidTokenError:
        return None, jsonify({"status": "error", "mensaje": "Token inválido"}), 401

# --- FUNCIÓN DEL IVA ---
def calcular_costo_real(monto, iva, cat_negocio, cat_proveedor):
    if cat_negocio != 'RESPONSABLE_INSCRIPTO' or cat_proveedor != 'RESPONSABLE_INSCRIPTO':
        return monto
    return round(monto / (1 + (iva / 100)), 4)

# --- AVISO A NOTIFICACIONES ---
def avisar_a_notificaciones(producto_id, nombre, stock, minimo, emp_id, db_name):
    url = "http://127.0.0.1:5006/internal/alertas/evaluar"
    payload = {
        "producto_id": producto_id, "nombre_producto": nombre,
        "stock_actual": float(stock), "stock_minimo": float(minimo),
        "emprendimiento_id": emp_id, "db_name": db_name
    }
    try:
        requests.post(url, json=payload, timeout=2)
    except Exception as e:
        print(f"No se pudo avisar a notificaciones: {e}")

# ==========================================
# CRUD PRODUCTOS
# ==========================================
@app.route('/api/productos', methods=['POST'])
def crear_producto():
    payload, error_resp, status = verificar_token()
    if error_resp:
        return error_resp, status

    datos = request.get_json()
    emprendimiento_id = payload.get("negocio_id")
    usuario_id = payload.get("usuario", "admin")
    db_name = payload.get("db_name")

    if not datos.get('nombre') or not datos.get('precio_compra') or not datos.get('proveedor_id'):
        return jsonify({"status": "error", "mensaje": "Faltan datos obligatorios"}), 400

    conn = get_db(db_name)
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
        
        # Evaluamos si necesita alerta desde el inicio
        avisar_a_notificaciones(nuevo_producto['id'], nuevo_producto['nombre'], nuevo_producto['cantidad'], datos.get('stock_minimo', 0), emprendimiento_id, db_name)

        return jsonify({"status": "ok", "mensaje": "Bien de cambio creado", "producto": nuevo_producto}), 201
    except Exception as e:
        conn.rollback()
        return jsonify({"status": "error", "mensaje": str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/productos', methods=['GET'])
def listar_productos():
    payload, error_resp, status = verificar_token()
    if error_resp:
        return error_resp, status

    emprendimiento_id = payload.get("negocio_id")
    conn = get_db(payload.get("db_name"))
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("""
            SELECT id, nombre, precio_compra, precio_venta, cantidad, stock_minimo, activo 
            FROM productos.productos 
            WHERE emprendimiento_id = %s AND tipo_producto = 'BIEN_DE_CAMBIO' AND activo = TRUE
        """, (emprendimiento_id,))
        return jsonify({"status": "ok", "items": cur.fetchall()}), 200
    except Exception as e:
        return jsonify({"status": "error", "mensaje": str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/productos/<int:id>/ocultar', methods=['PATCH'])
def ocultar_producto(id):
    payload, error_resp, status = verificar_token()
    if error_resp:
        return error_resp, status

    emprendimiento_id = payload.get("negocio_id")
    conn = get_db(payload.get("db_name"))
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("UPDATE productos.productos SET activo = FALSE, modificado_por = %s, modificado_en = CURRENT_TIMESTAMP WHERE id = %s AND emprendimiento_id = %s RETURNING id", (payload.get("usuario"), id, emprendimiento_id))
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
    payload, error_resp, status = verificar_token()
    if error_resp:
        return error_resp, status

    emprendimiento_id = payload.get("negocio_id")
    conn = get_db(payload.get("db_name"))
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("SELECT id FROM productos.movimientos_stock WHERE producto_id = %s LIMIT 1", (id,))
        if cur.fetchone():
            return jsonify({"status": "error", "mensaje": "No se puede eliminar: tiene movimientos"}), 409
        cur.execute("DELETE FROM productos.productos WHERE id = %s AND emprendimiento_id = %s", (id, emprendimiento_id))
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
    payload, error_resp, status = verificar_token()
    if error_resp:
        return error_resp, status

    datos = request.get_json()
    emprendimiento_id = payload.get("negocio_id")
    usuario = payload.get("usuario", "admin")
    db_name = payload.get("db_name")
    cat_negocio = payload.get("categoria_impositiva", "MONOTRIBUTISTA")

    if not datos.get('cantidad') or not datos.get('monto_total') or not datos.get('proveedor_id'):
        return jsonify({"status": "error", "mensaje": "Faltan datos"}), 400

    conn = get_db(db_name)
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("SELECT * FROM productos.productos WHERE id = %s AND emprendimiento_id = %s", (id, emprendimiento_id))
        producto = cur.fetchone()
        cur.execute("SELECT categoria_impositiva FROM productos.proveedores WHERE id = %s AND emprendimiento_id = %s", (datos['proveedor_id'], emprendimiento_id))
        proveedor = cur.fetchone()
        
        costo_real = calcular_costo_real(float(datos['monto_total']), float(producto['iva_alicuota']), cat_negocio, proveedor['categoria_impositiva'])
        nuevo_stock = float(producto['cantidad']) + float(datos['cantidad'])
        
        cur.execute("""
            INSERT INTO productos.reposiciones (emprendimiento_id, producto_id, proveedor_id, cantidad, monto_total, costo_unitario_real, fecha_adquisicion, creado_por) 
            VALUES (%s, %s, %s, %s, %s, %s, CURRENT_DATE, %s) RETURNING id
        """, (emprendimiento_id, id, datos['proveedor_id'], datos['cantidad'], datos['monto_total'], costo_real / float(datos['cantidad']), usuario))
        reposicion_id = cur.fetchone()['id']

        cur.execute("UPDATE productos.productos SET cantidad = %s, precio_compra = %s, modificado_por = %s, modificado_en = CURRENT_TIMESTAMP WHERE id = %s AND emprendimiento_id = %s", (nuevo_stock, costo_real / float(datos['cantidad']), usuario, id, emprendimiento_id))
        cur.execute("INSERT INTO productos.movimientos_stock (emprendimiento_id, producto_id, reposicion_id, tipo, cantidad_movimiento, stock_resultante, usuario) VALUES (%s, %s, %s, 'REPOSICION', %s, %s, %s)", (emprendimiento_id, id, reposicion_id, datos['cantidad'], nuevo_stock, usuario))
        
        avisar_a_notificaciones(id, producto['nombre'], nuevo_stock, producto['stock_minimo'], emprendimiento_id, db_name)
        
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
    payload, error_resp, status = verificar_token()
    if error_resp:
        return error_resp, status

    datos = request.get_json()
    emprendimiento_id = payload.get("negocio_id")
    usuario = payload.get("usuario", "admin")
    db_name = payload.get("db_name")

    if not datos.get('cantidad') or not datos.get('motivo'):
        return jsonify({"status": "error", "mensaje": "Faltan datos"}), 400

    conn = get_db(db_name)
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
        cur.execute("UPDATE productos.productos SET cantidad = %s, modificado_por = %s, modificado_en = CURRENT_TIMESTAMP WHERE id = %s AND emprendimiento_id = %s", (nuevo_stock, usuario, id, emprendimiento_id))
        cur.execute("""
            INSERT INTO productos.movimientos_stock 
            (emprendimiento_id, producto_id, tipo, cantidad_movimiento, stock_resultante, motivo, usuario) 
            VALUES (%s, %s, 'BAJA', %s, %s, %s, %s)
        """, (emprendimiento_id, id, -cantidad_baja, nuevo_stock, datos['motivo'], usuario))

        avisar_a_notificaciones(id, producto['nombre'], nuevo_stock, producto['stock_minimo'], emprendimiento_id, db_name)
        
        conn.commit()
        return jsonify({"status": "ok", "mensaje": "Baja registrada", "nuevo_stock": nuevo_stock}), 201
    except Exception as e:
        conn.rollback()
        return jsonify({"status": "error", "mensaje": str(e)}), 500
    finally:
        cur.close()
        conn.close()

# ==========================================
# CRUD PROVEEDORES
# ==========================================
@app.route('/api/proveedores', methods=['POST'])
def crear_proveedor():
    payload, error_resp, status = verificar_token()
    if error_resp:
        return error_resp, status

    # [Ajuste permisos RBAC - Aldi]: solo ADMIN o PROPIETARIO pueden dar de alta proveedores
    if (payload.get("rol") or "").upper() not in ("ADMIN", "PROPIETARIO"):
        return jsonify({"status": "error", "mensaje": "No tenés permiso para esta acción"}), 403

    datos = request.get_json(silent=True) or {}
    emprendimiento_id = payload.get("negocio_id")

    if not datos.get('nombre') or not datos.get('numero_documento') or not datos.get('categoria_impositiva'):
        return jsonify({"status": "error", "mensaje": "Faltan datos obligatorios"}), 400

    conn = get_db(payload.get("db_name"))
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("""
            INSERT INTO productos.proveedores 
            (emprendimiento_id, nombre, tipo_documento, numero_documento, categoria_impositiva, telefono, correo, descripcion_compra) 
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING id, nombre
        """, (emprendimiento_id, datos['nombre'].strip(), datos.get('tipo_documento', 'CUIT'), datos['numero_documento'].strip(), datos['categoria_impositiva'], (datos.get('telefono') or '').strip(), (datos.get('correo') or '').strip(), (datos.get('descripcion_compra') or '').strip()))
        proveedor = cur.fetchone()
        conn.commit()
        return jsonify({"status": "ok", "mensaje": "Proveedor creado", "proveedor": proveedor}), 201
    except Exception as e:
        conn.rollback()
        if "uq_proveedor_doc_tenant" in str(e):
            return jsonify({"status": "error", "campo": "numero_documento","mensaje": "Ya hay un proveedor con ese documento (revisá también los ocultos)"}), 409
        return jsonify({"status": "error", "mensaje": str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/proveedores', methods=['GET'])
def listar_proveedores():
    # GET permanece abierto también para CAJERO porque lo necesita en el desplegable de Reposición de stock
    payload, error_resp, status = verificar_token()
    if error_resp:
        return error_resp, status

    emprendimiento_id = payload.get("negocio_id")
    q = request.args.get('q', '')
    ocultos = request.args.get('ocultos', 'false').lower() == 'true'

    conn = get_db(payload.get("db_name"))
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        query = """
            SELECT p.id, p.nombre, p.tipo_documento, p.numero_documento, p.categoria_impositiva, 
                   p.telefono, p.correo, p.descripcion_compra, p.activo,
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
            query += " AND (p.nombre ILIKE %s OR p.numero_documento ILIKE %s OR p.telefono ILIKE %s OR p.descripcion_compra ILIKE %s)"
            search_term = f"%{q}%"
            params.extend([search_term, search_term, search_term, search_term])

        query += " ORDER BY p.nombre ASC"
        cur.execute(query, tuple(params))
        items = cur.fetchall()

        # [Ajuste privacidad por rol - Aldi]: al Cajero se le devuelven solo los campos necesarios para reponer stock
        if (payload.get("rol") or "").upper() == "CAJERO":
            items = [
                {
                    "id": p["id"],
                    "nombre": p["nombre"],
                    "categoria_impositiva": p["categoria_impositiva"],
                    "activo": p["activo"]
                }
                for p in items
            ]

        return jsonify({"status": "ok", "items": items}), 200
    except Exception as e:
        return jsonify({"status": "error", "mensaje": str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/proveedores/<int:id>', methods=['PUT'])
def editar_proveedor(id):
    payload, error_resp, status = verificar_token()
    if error_resp:
        return error_resp, status

    # [Ajuste permisos RBAC - Aldi]: solo ADMIN o PROPIETARIO pueden editar proveedores
    if (payload.get("rol") or "").upper() not in ("ADMIN", "PROPIETARIO"):
        return jsonify({"status": "error", "mensaje": "No tenés permiso para esta acción"}), 403

    datos = request.get_json(silent=True) or {}
    emprendimiento_id = payload.get("negocio_id")
    conn = get_db(payload.get("db_name"))
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # [Ajuste edición campos vacíos - Aldi]: traemos el registro completo para distinguir
        # "no vino en el JSON" (conserva el valor actual) de "vino vacío ('' o null)" (permite vaciar el campo sin COALESCE).
        cur.execute("SELECT * FROM productos.proveedores WHERE id = %s AND emprendimiento_id = %s", (id, emprendimiento_id))
        actual = cur.fetchone()
        if not actual:
            return jsonify({"status": "error", "mensaje": "Proveedor no encontrado"}), 404

        campos_obligatorios = ['nombre', 'tipo_documento', 'numero_documento', 'categoria_impositiva']
        campos_opcionales = ['telefono', 'correo', 'descripcion_compra']
        valores = {}

        for c in campos_obligatorios:
            raw = datos[c] if c in datos else actual[c]
            limpio = str(raw).strip() if raw is not None else ''
            if not limpio:
                return jsonify({"status": "error", "campo": c, "mensaje": f"El campo {c} es obligatorio"}), 400
            valores[c] = limpio

        for c in campos_opcionales:
            valores[c] = (datos[c] or '').strip() if c in datos else actual[c]

        cur.execute("""
            UPDATE productos.proveedores SET 
                nombre = %s, tipo_documento = %s,
                numero_documento = %s, categoria_impositiva = %s,
                telefono = %s, correo = %s, descripcion_compra = %s
            WHERE id = %s AND emprendimiento_id = %s
            RETURNING id, nombre
        """, (
            valores['nombre'], valores['tipo_documento'],
            valores['numero_documento'], valores['categoria_impositiva'],
            valores['telefono'], valores['correo'], valores['descripcion_compra'],
            id, emprendimiento_id
        ))
        proveedor = cur.fetchone()
        conn.commit()
        return jsonify({"status": "ok", "mensaje": "Proveedor actualizado", "proveedor": proveedor}), 200
    except Exception as e:
        conn.rollback()
        if "uq_proveedor_doc_tenant" in str(e):
            # [Ajuste contrato 409 - Aldi]: envía 'campo' para que el Front marque el input y avisa revisar ocultos
            return jsonify({"status": "error", "campo": "numero_documento", "mensaje": "Ya hay un proveedor con ese documento (revisá también los ocultos)"}), 409
        return jsonify({"status": "error", "mensaje": str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/proveedores/<int:id>/visibilidad', methods=['PATCH'])
def cambiar_visibilidad_proveedor(id):
    payload, error_resp, status = verificar_token()
    if error_resp:
        return error_resp, status

    # [Ajuste permisos RBAC - Aldi]: solo ADMIN o PROPIETARIO pueden ocultar/restaurar proveedores
    if (payload.get("rol") or "").upper() not in ("ADMIN", "PROPIETARIO"):
        return jsonify({"status": "error", "mensaje": "No tenés permiso para esta acción"}), 403

    datos = request.get_json(silent=True) or {}
    if 'activo' not in datos:
        return jsonify({"status": "error", "mensaje": "Falta el campo activo"}), 400

    emprendimiento_id = payload.get("negocio_id")
    conn = get_db(payload.get("db_name"))
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # [Ajuste aislamiento multi-tenant - Aldi]: agrega filtro por emprendimiento_id en el UPDATE
        cur.execute(
            "UPDATE productos.proveedores SET activo = %s WHERE id = %s AND emprendimiento_id = %s RETURNING id, activo",
            (datos['activo'], id, emprendimiento_id)
        )
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
    payload, error_resp, status = verificar_token()
    if error_resp:
        return error_resp, status

    # [Ajuste permisos RBAC - Aldi]: solo ADMIN o PROPIETARIO pueden eliminar proveedores
    if (payload.get("rol") or "").upper() not in ("ADMIN", "PROPIETARIO"):
        return jsonify({"status": "error", "mensaje": "No tenés permiso para esta acción"}), 403

    emprendimiento_id = payload.get("negocio_id")
    conn = get_db(payload.get("db_name"))
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

        cur.execute("DELETE FROM productos.proveedores WHERE id = %s AND emprendimiento_id = %s", (id, emprendimiento_id))
        conn.commit()
        return jsonify({"status": "ok", "mensaje": "Proveedor eliminado definitivamente"}), 200
    except Exception as e:
        conn.rollback()
        return jsonify({"status": "error", "mensaje": str(e)}), 500
    finally:
        cur.close()
        conn.close()

# ENDPOINT INTERNO PARA REPORTES (5005)
# [Agregado para Reportes - Aldi]: calcula la inversión actual en inventario
# sobre bienes de cambio sin filtrar fecha ni activo (los ocultos siguen siendo capital invertido).
@app.route('/internal/productos/resumen', methods=['GET'])
def resumen_productos_reportes():
    db_name = request.args.get('db_name')
    emprendimiento_id = request.args.get('emprendimiento_id')

    if not db_name or not emprendimiento_id:
        return jsonify({"status": "error", "mensaje": "Faltan db_name o emprendimiento_id"}), 400

    conn = get_db(db_name)
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("""
            SELECT 
                nombre AS producto,
                cantidad AS unidades,
                precio_compra AS costo_unitario,
                ROUND(cantidad * precio_compra, 2) AS inversion
            FROM productos.productos
            WHERE emprendimiento_id = %s
              AND tipo_producto = 'BIEN_DE_CAMBIO'
              AND cantidad > 0
            ORDER BY inversion DESC, nombre ASC
        """, (int(emprendimiento_id),))

        filas = cur.fetchall()
        desglose = []
        inventario_total = 0.0

        for f in filas:
            unidades_val = float(f['unidades'])
            unidades_fmt = int(unidades_val) if unidades_val.is_integer() else round(unidades_val, 2)
            costo_fmt = round(float(f['costo_unitario']), 2)
            inv_fmt = round(float(f['inversion']), 2)
            inventario_total += inv_fmt

            desglose.append({
                "producto": f['producto'],
                "unidades": unidades_fmt,
                "costo_unitario": costo_fmt,
                "inversion": inv_fmt
            })

        return jsonify({
            "status": "ok",
            "inventario_actual": round(inventario_total, 2),
            "desglose_inversion": desglose
        }), 200
    except Exception as e:
        return jsonify({"status": "error", "mensaje": str(e)}), 500
    finally:
        cur.close()
        conn.close()

if __name__ == '__main__':
    port = int(os.getenv("SERVICE_PORT", 5002))
    app.run(host='127.0.0.1', port=port, debug=True)