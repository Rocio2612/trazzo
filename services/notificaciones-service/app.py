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

# 1. Endpoint INTERNO que usa el servicio de Productos
@app.route('/internal/alertas/evaluar', methods=['POST'])
def evaluar_alerta():
    datos = request.get_json()
    emprendimiento_id = datos.get('emprendimiento_id')
    producto_id = datos.get('producto_id')
    nombre_producto = datos.get('nombre_producto')
    stock_actual = datos.get('stock_actual')
    stock_minimo = datos.get('stock_minimo')

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
        return jsonify({"status": "ok", "mensaje": "Alerta evaluada"}), 200
    except Exception as e:
        conn.rollback()
        return jsonify({"status": "error", "mensaje": str(e)}), 500
    finally:
        cur.close()
        conn.close()

# 2. Endpoints PARA EL FRONTEND (La campanita)
@app.route('/api/notificaciones', methods=['GET'])
def listar_alertas():
    # Simulamos emprendimiento y usuario (luego vendrán del JWT)
    emprendimiento_id = 1
    usuario_id = 1 
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("""
            SELECT a.id, a.producto_nombre, a.mensaje, a.stock_actual 
            FROM notificaciones.alertas_stock a
            LEFT JOIN notificaciones.alertas_descartes d ON a.id = d.alerta_id AND d.usuario_id = %s
            WHERE a.emprendimiento_id = %s AND a.estado = 'ACTIVA' AND d.id IS NULL
        """, (usuario_id, emprendimiento_id))
        return jsonify({"status": "ok", "items": cur.fetchall()}), 200
    except Exception as e:
        return jsonify({"status": "error", "mensaje": str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/notificaciones/contador', methods=['GET'])
def contador_alertas():
    emprendimiento_id = 1
    usuario_id = 1
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("""
            SELECT COUNT(*) as total
            FROM notificaciones.alertas_stock a
            LEFT JOIN notificaciones.alertas_descartes d ON a.id = d.alerta_id AND d.usuario_id = %s
            WHERE a.emprendimiento_id = %s AND a.estado = 'ACTIVA' AND d.id IS NULL
        """, (usuario_id, emprendimiento_id))
        total = cur.fetchone()['total']
        return jsonify({"status": "ok", "contador": total}), 200
    except Exception as e:
        return jsonify({"status": "error", "mensaje": str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/notificaciones/<int:id>/descartar', methods=['PATCH'])
def descartar_alerta(id):
    usuario_id = 1
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("""
            INSERT INTO notificaciones.alertas_descartes (alerta_id, usuario_id, emprendimiento_id)
            VALUES (%s, %s, 1)
            ON CONFLICT (alerta_id, usuario_id) DO NOTHING
        """, (id, usuario_id))
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