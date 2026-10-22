from flask import Flask, request, jsonify
import os
from dotenv import load_dotenv

load_dotenv()
app = Flask(__name__)

@app.route('/api/auth/health', methods=['GET'])
def health():
    return jsonify({"status": "ok", "service": "auth-service"}), 200

# --- RUTA DE REGISTRO ---
@app.route('/api/auth/registro', methods=['POST'])
def registro():
    datos = request.get_json()
    
    # 1. Validar que no falten datos obligatorios
    if not datos or not datos.get('id_negocio') or not datos.get('usuario') or not datos.get('password'):
        return jsonify({
            "status": "error",
            "mensaje": "Faltan datos obligatorios (id_negocio, usuario, password)",
            "campo": "general"
        }), 400

    # 2. Simulamos la respuesta exitosa del contrato
    return jsonify({
        "status": "ok",
        "mensaje": "Negocio y usuario creado",
        "access_token": "token_falso_de_prueba_12345",
        "refresh_token": "refresh_falso_de_prueba_67890",
        "usuario": {
            "id": 1,
            "rol": "ADMIN",
            "negocio_id": 10
        }
    }), 201

if __name__ == '__main__':
    port = int(os.getenv("SERVICE_PORT", 5001))
    app.run(host='127.0.0.1', port=port, debug=True)