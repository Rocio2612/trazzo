from flask import Flask, request, jsonify
import os
from dotenv import load_dotenv

load_dotenv()
app = Flask(__name__)

@app.route('/api/auth/health', methods=['GET'])
def health():
    return jsonify({"status": "ok", "service": "auth-service"}), 200

@app.route('/api/auth/registro', methods=['POST'])
def registro():
    datos = request.get_json()
    if not datos or not datos.get('id_negocio') or not datos.get('usuario') or not datos.get('password'):
        return jsonify({"status": "error", "mensaje": "Faltan datos obligatorios"}), 400

    return jsonify({
        "status": "ok",
        "mensaje": "Negocio y usuario creado",
        "access_token": "token_falso_de_prueba_12345",
        "refresh_token": "refresh_falso_de_prueba_67890",
        "usuario": {"id": 1, "rol": "ADMIN", "negocio_id": 10}
    }), 201

@app.route('/api/auth/login', methods=['POST'])
def login():
    datos = request.get_json()
    
    if not datos or not datos.get('id_negocio') or not datos.get('usuario') or not datos.get('password'):
        return jsonify({"status": "error", "mensaje": "Faltan datos obligatorios"}), 400

    if datos.get('usuario') == 'rocio_admin' and datos.get('password') == 'Password123!':
        return jsonify({
            "status": "ok",
            "access_token": "token_falso_login_12345",
            "refresh_token": "refresh_falso_login_67890",
            "usuario": {"id": 1, "rol": "ADMIN", "nombre": "Rocío"}
        }), 200
    else:
        return jsonify({"status": "error", "mensaje": "Negocio, usuario o contraseña incorrectos"}), 401

if __name__ == '__main__':
    port = int(os.getenv("SERVICE_PORT", 5001))
    app.run(host='127.0.0.1', port=port, debug=True)