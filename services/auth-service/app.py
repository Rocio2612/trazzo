from flask import Flask, request, jsonify
import os
from dotenv import load_dotenv
from werkzeug.security import generate_password_hash, check_password_hash
import jwt
import datetime

load_dotenv()
app = Flask(__name__)

SECRET_KEY = os.getenv("JWT_SECRET", "clave_por_defecto")

# Simulamos una "base de datos" en memoria para probar la seguridad
USUARIOS_SIMULADOS = []

@app.route('/api/auth/health', methods=['GET'])
def health():
    return jsonify({"status": "ok", "service": "auth-service"}), 200

@app.route('/api/auth/registro', methods=['POST'])
def registro():
    datos = request.get_json()
    
    if not datos or not datos.get('id_negocio') or not datos.get('usuario') or not datos.get('password'):
        return jsonify({"status": "error", "mensaje": "Faltan datos obligatorios"}), 400

    # 1. Hashear la contraseña (Seguridad)
    password_hash = generate_password_hash(datos['password'])
    
    # Guardamos en la lista simulada
    USUARIOS_SIMULADOS.append({
        "id_negocio": datos['id_negocio'],
        "usuario": datos['usuario'],
        "password_hash": password_hash
    })

    # 2. Generar Tokens JWT reales
    payload = {
        "usuario": datos['usuario'],
        "id_negocio": datos['id_negocio'],
        "rol": "ADMIN",
        "exp": datetime.datetime.utcnow() + datetime.timedelta(minutes=15)
    }
    access_token = jwt.encode(payload, SECRET_KEY, algorithm="HS256")
    refresh_token = jwt.encode({"usuario": datos['usuario'], "type": "refresh"}, SECRET_KEY, algorithm="HS256")

    return jsonify({
        "status": "ok",
        "mensaje": "Negocio y usuario creado",
        "access_token": access_token,
        "refresh_token": refresh_token,
        "usuario": {"id": 1, "rol": "ADMIN", "negocio_id": 10}
    }), 201

@app.route('/api/auth/login', methods=['POST'])
def login():
    datos = request.get_json()
    
    if not datos or not datos.get('usuario') or not datos.get('password'):
        return jsonify({"status": "error", "mensaje": "Faltan datos"}), 400

    # Buscamos el usuario en la lista simulada
    usuario_encontrado = next((u for u in USUARIOS_SIMULADOS if u['usuario'] == datos['usuario']), None)

    # 1. Validar si el usuario existe y si la contraseña coincide
    if usuario_encontrado and check_password_hash(usuario_encontrado['password_hash'], datos['password']):
        
        # 2. Generar Tokens JWT reales
        payload = {
            "usuario": usuario_encontrado['usuario'],
            "id_negocio": usuario_encontrado['id_negocio'],
            "rol": "ADMIN",
            "exp": datetime.datetime.utcnow() + datetime.timedelta(minutes=15)
        }
        access_token = jwt.encode(payload, SECRET_KEY, algorithm="HS256")
        refresh_token = jwt.encode({"usuario": usuario_encontrado['usuario'], "type": "refresh"}, SECRET_KEY, algorithm="HS256")

        return jsonify({
            "status": "ok",
            "access_token": access_token,
            "refresh_token": refresh_token,
            "usuario": {"id": 1, "rol": "ADMIN", "nombre": "Rocío"}
        }), 200
    else:
        return jsonify({"status": "error", "mensaje": "Negocio, usuario o contraseña incorrectos"}), 401

if __name__ == '__main__':
    port = int(os.getenv("SERVICE_PORT", 5001))
    app.run(host='127.0.0.1', port=port, debug=True)