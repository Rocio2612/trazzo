from flask import Flask, jsonify, request, Response
import os
import requests
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)

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