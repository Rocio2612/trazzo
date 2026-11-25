from flask import Flask, request, jsonify
import os
import jwt
import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv
from flask_cors import CORS

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

# --- ENDPOINT INTERNO (Productos avisa acá) ---
@app.route('/internal/alertas/evaluar', methods=['POST'])
def evaluar_alerta():
    datos = request.get_json()
    db_name = datos.get('db_name')
    emprendimiento_id = datos.get('emprendimiento_id')
    producto_id = datos.get('producto_id')
    nombre_producto = datos.get('nombre_producto')
    stock_actual = datos.get('stock_actual')
    stock_minimo = datos.get('stock_minimo')

    if not db_name:
        return jsonify({"status": "error", "mensaje": "Falta db_name en llamada interna"}), 400

    conn = get_db(db_name)
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        cur.execute("""
            SELECT id FROM notificaciones.alertas_stock 
            WHERE producto_id = %s AND estado = 'ACTIVA' AND emprendimiento_id = %s
        """, (producto_id, emprendimiento_id))
        alerta = cur.fetchone()

        if float(stock_actual) <= float(stock_minimo):
            # [Ajuste formato stock - Aldi]: evita ".00" en el texto cuando la cantidad es entera
            stock_fmt = int(float(stock_actual)) if float(stock_actual).is_integer() else round(float(stock_actual), 2)
            mensaje = f"Quedan {stock_fmt} unidades de {nombre_producto}"
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
        return jsonify({"status": "ok", "mensaje": "Alerta evaluada"}), 200
    except Exception as e:
        conn.rollback()
        return jsonify({"status": "error", "mensaje": str(e)}), 500
    finally:
        cur.close()
        conn.close()

# --- ENDPOINTS PÚBLICOS (Para la campanita del Frontend) ---
@app.route('/api/notificaciones', methods=['GET'])
def listar_alertas():
    payload, error_resp, status = verificar_token()
    if error_resp:
        return error_resp, status

    emprendimiento_id = payload.get("negocio_id")
    usuario_id = payload.get("usuario_id")
    conn = get_db(payload.get("db_name"))
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("""
            SELECT a.id, a.producto_nombre, a.mensaje, a.stock_actual 
            FROM notificaciones.alertas_stock a
            LEFT JOIN notificaciones.alertas_descartes d ON a.id = d.alerta_id AND d.usuario_id = %s
            WHERE a.emprendimiento_id = %s AND a.estado = 'ACTIVA' AND d.id IS NULL
            ORDER BY a.actualizado_en DESC
        """, (usuario_id, emprendimiento_id))

        # [Ajuste serialización stock - Aldi]: convierte Decimal de PostgreSQL a int/float limpio para el Front
        alertas = cur.fetchall()
        for a in alertas:
            val = float(a["stock_actual"])
            a["stock_actual"] = int(val) if val.is_integer() else round(val, 2)
        return jsonify({"status": "ok", "items": alertas}), 200

    except Exception as e:
        return jsonify({"status": "error", "mensaje": str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/notificaciones/contador', methods=['GET'])
def contador_alertas():
    payload, error_resp, status = verificar_token()
    if error_resp:
        return error_resp, status

    emprendimiento_id = payload.get("negocio_id")
    usuario_id = payload.get("usuario_id")
    conn = get_db(payload.get("db_name"))
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("""
            SELECT COUNT(*) as total
            FROM notificaciones.alertas_stock a
            LEFT JOIN notificaciones.alertas_descartes d ON a.id = d.alerta_id AND d.usuario_id = %s
            WHERE a.emprendimiento_id = %s AND a.estado = 'ACTIVA' AND d.id IS NULL
        """, (usuario_id, emprendimiento_id))
        total = cur.fetchone()['total']
        # [Ajuste contrato contador - Aldi]: agrega "cantidad" además de "contador" para coincidir con front
        return jsonify({"status": "ok", "contador": total, "cantidad": total}), 200
    except Exception as e:
        return jsonify({"status": "error", "mensaje": str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/notificaciones/<int:id>/descartar', methods=['PATCH'])
# [Ajuste ruta alias descarte - Aldi]: acepta también /eliminar-vista además de /descartar para coincidir con front
@app.route('/api/notificaciones/<int:id>/eliminar-vista', methods=['PATCH'])
def descartar_alerta(id):
    payload, error_resp, status = verificar_token()
    if error_resp:
        return error_resp, status

    emprendimiento_id = payload.get("negocio_id")
    usuario_id = payload.get("usuario_id")
    conn = get_db(payload.get("db_name"))
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("""
            INSERT INTO notificaciones.alertas_descartes (alerta_id, usuario_id, emprendimiento_id)
            VALUES (%s, %s, %s)
            ON CONFLICT (alerta_id, usuario_id) DO NOTHING
        """, (id, usuario_id, emprendimiento_id))
        conn.commit()
        return jsonify({"status": "ok", "mensaje": "Alerta descartada"}), 200
    except Exception as e:
        conn.rollback()
        return jsonify({"status": "error", "mensaje": str(e)}), 500
    finally:
        cur.close()
        conn.close()

if __name__ == '__main__':
    port = int(os.getenv("SERVICE_PORT", 5006))
    app.run(host='127.0.0.1', port=port, debug=True)