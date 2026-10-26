from flask import Flask, jsonify, request, Response
from flask_cors import CORS  # Manejo de CORS en el Gateway
import os
import requests
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)

# Permitir que el Frontend en Live Server (puerto 5500) se comunique con el Gateway (puerto 5000)
ORIGENES_PERMITIDOS = [
    "http://127.0.0.1:5500",
    "http://localhost:5500",
    "http://127.0.0.1:5000",
    "http://localhost:5000",
    "http://192.168.1.43:5000"
]

CORS(app, resources={r"/api/*": {"origins": ORIGENES_PERMITIDOS}}, supports_credentials=True)

# Diccionario de rutas: si la URL empieza con esto, va a este puerto
SERVICES = {
    "auth": os.getenv("AUTH_URL"),
    "productos": os.getenv("PRODUCTOS_URL"),
    "transacciones": os.getenv("TRANSACCIONES_URL"),
    "finanzas": os.getenv("FINANZAS_URL"),
    "reportes": os.getenv("REPORTES_URL")
}

@app.route('/api/<service>/<path:path>', methods=['GET', 'POST', 'PUT', 'DELETE'])
def proxy(service, path):
    if service not in SERVICES or not SERVICES[service]:
        return jsonify({"error": "Servicio no encontrado"}), 404

    target_url = f"{SERVICES[service]}/api/{service}/{path}"
    
    try:
        # Redirige la petición al microservicio correspondiente
        resp = requests.request(
            method=request.method,
            url=target_url,
            headers={key: value for (key, value) in request.headers if key != 'Host'},
            data=request.get_data(),
            cookies=request.cookies,
            allow_redirects=False,
            timeout=5
        )
        return Response(resp.content, resp.status_code, resp.headers.items())
    except requests.exceptions.ConnectionError:
        return jsonify({"error": f"El servicio '{service}' está apagado o no responde"}), 503

if __name__ == '__main__':
    port = int(os.getenv("GATEWAY_PORT", 5000))
    # OJO: host='0.0.0.0' permite que tus compañeras se conecten por Wi-Fi
    app.run(host='0.0.0.0', port=port, debug=True)