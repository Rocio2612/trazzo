from flask import Flask, request, jsonify
import os
import psycopg2
from psycopg2.extras import RealDictCursor
from werkzeug.security import generate_password_hash, check_password_hash
from dotenv import load_dotenv
import jwt
import datetime
from flask_cors import CORS

load_dotenv()
app = Flask(__name__)
CORS(app)

SECRET_KEY = os.getenv("JWT_SECRET", "clave_secreta")

# Función para conectar a trazzo_master (Base de Datos Maestra)
def get_db():
    return psycopg2.connect(
        host=os.getenv("DB_HOST"), 
        database=os.getenv("DB_NAME"), # En el .env va a decir trazzo_master
        user=os.getenv("DB_USER"), 
        password=os.getenv("DB_PASSWORD"), 
        port=os.getenv("DB_PORT")
    )

@app.route('/api/auth/health', methods=['GET'])
def health():
    return jsonify({"status": "ok", "service": "auth-service"}), 200

@app.route('/api/auth/registro', methods=['POST'])
def registro():
    datos = request.get_json()
    if not datos or not datos.get('id_negocio') or not datos.get('usuario') or not datos.get('password') or not datos.get('correo'):
        return jsonify({"status": "error", "mensaje": "Faltan datos obligatorios"}), 400

    password_hash = generate_password_hash(datos['password'])
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        # Por ahora, para probar, todos los negocios nuevos apuntan a trazzo_plantilla.
        # En un futuro, acá iría el código que clona la base (CREATE DATABASE trazzo_xyz TEMPLATE trazzo_plantilla)
        nombre_bd = "trazzo_plantilla"

        # 1. Crear el emprendimiento en la base maestra
        cur.execute(
            "INSERT INTO auth.emprendimientos (identificador, nombre_comercial, rubro, categoria_impositiva, nombre_bd) VALUES (%s, %s, %s, %s, %s) RETURNING id",
            (datos['id_negocio'], datos.get('nombre_negocio', 'Sin nombre'), datos.get('rubro', 'General'), 'MONOTRIBUTISTA', nombre_bd)
        )
        emprendimiento_id = cur.fetchone()['id']

        # 2. Crear el usuario Administrador (Propietario)
        cur.execute(
            """INSERT INTO auth.usuarios (emprendimiento_id, usuario, correo, password_hash, rol) 
               VALUES (%s, %s, %s, %s, 'PROPIETARIO') RETURNING id""",
            (emprendimiento_id, datos['usuario'], datos['correo'], password_hash)
        )
        usuario_id = cur.fetchone()['id']
        conn.commit()

        # 3. Generar Tokens JWT
        payload = {
            "usuario_id": usuario_id,
            "usuario": datos['usuario'],
            "negocio_id": emprendimiento_id,
            "rol": "PROPIETARIO",
            "categoria_impositiva": "MONOTRIBUTISTA",
            "db_name": nombre_bd, # <--- CLAVE PARA LOS MICROSERVICIOS
            "exp": datetime.datetime.utcnow() + datetime.timedelta(minutes=15)
        }
        access_token = jwt.encode(payload, SECRET_KEY, algorithm="HS256")
        refresh_token = jwt.encode({"usuario_id": usuario_id, "type": "refresh"}, SECRET_KEY, algorithm="HS256")

        return jsonify({
            "status": "ok",
            "mensaje": "Negocio y usuario creado con éxito",
            "access_token": access_token,
            "refresh_token": refresh_token
        }), 201

    except Exception as e:
        conn.rollback()
        return jsonify({"status": "error", "mensaje": f"Error: {str(e)}"}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/auth/login', methods=['POST'])
def login():
    datos = request.get_json()
    if not datos or not datos.get('id_negocio') or not datos.get('usuario') or not datos.get('password'):
        return jsonify({"status": "error", "mensaje": "Faltan datos"}), 400

    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        cur.execute(
            """SELECT u.*, e.identificador AS negocio, e.nombre_bd, e.categoria_impositiva 
               FROM auth.usuarios u JOIN auth.emprendimientos e ON u.emprendimiento_id = e.id 
               WHERE e.identificador = %s AND u.usuario = %s""",
            (datos['id_negocio'], datos['usuario'])
        )
        usuario = cur.fetchone()

        if usuario and check_password_hash(usuario['password_hash'], datos['password']):
            payload = {
                "usuario_id": usuario['id'],
                "usuario": usuario['usuario'],
                "negocio_id": usuario['emprendimiento_id'],
                "rol": usuario['rol'],
                "categoria_impositiva": usuario['categoria_impositiva'],
                "db_name": usuario['nombre_bd'], # <--- CLAVE PARA LOS MICROSERVICIOS
                "exp": datetime.datetime.utcnow() + datetime.timedelta(minutes=15)
            }
            access_token = jwt.encode(payload, SECRET_KEY, algorithm="HS256")
            refresh_token = jwt.encode({"usuario_id": usuario['id'], "type": "refresh"}, SECRET_KEY, algorithm="HS256")

            return jsonify({
                "status": "ok",
                "access_token": access_token,
                "refresh_token": refresh_token,
                "usuario": {"id": usuario['id'], "rol": usuario['rol'], "nombre": usuario.get('nombre', '')}
            }), 200
        else:
            return jsonify({"status": "error", "mensaje": "Negocio, usuario o contraseña incorrectos"}), 401

    except Exception as e:
        return jsonify({"status": "error", "mensaje": f"Error: {str(e)}"}), 500
    finally:
        cur.close()
        conn.close()

if __name__ == '__main__':
    port = int(os.getenv("SERVICE_PORT", 5001))
    app.run(host='127.0.0.1', port=port, debug=True)