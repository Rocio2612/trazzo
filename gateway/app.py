from flask import Flask, jsonify, request, Response, send_from_directory
from flask_cors import CORS
import os
import requests
from dotenv import load_dotenv

load_dotenv()
app = Flask(__name__)

ORIGENES_PERMITIDOS = ["*"]
CORS(app, resources={r"/api/*": {"origins": ORIGENES_PERMITIDOS}}, supports_credentials=True)

SERVICES = {
    "auth": os.getenv("AUTH_URL", "http://127.0.0.1:5001"),
    "productos": os.getenv("PRODUCTOS_URL", "http://127.0.0.1:5002")
}

@app.route('/api/<service>/<path:path>', methods=['GET', 'POST', 'PUT', 'DELETE'])
def proxy(service, path):
    if service not in SERVICES:
        return jsonify({"error": "Servicio no encontrado"}), 404
    target_url = f"{SERVICES[service]}/api/{service}/{path}"
    try:
        resp = requests.request(method=request.method, url=target_url, headers={k: v for k, v in request.headers if k != 'Host'}, data=request.get_data(), timeout=5)
        return Response(resp.content, resp.status_code, resp.headers.items())
    except requests.exceptions.ConnectionError:
        return jsonify({"error": "Servicio apagado"}), 503

# --- CONFIGURACIÓN DE RUTAS INTELIGENTE ---
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND_DIR = os.path.join(BASE_DIR, 'frontend')

def buscar_archivo(filename):
    """Busca el archivo en la carpeta frontend o en sus subcarpetas (pages, css, js)"""
    # 1. Buscar directo en frontend (por si están sueltos como en tu captura)
    ruta_directa = os.path.join(FRONTEND_DIR, filename)
    if os.path.exists(ruta_directa):
        return ruta_directa
    
    # 2. Si no está, buscar en 'pages'
    ruta_pages = os.path.join(FRONTEND_DIR, 'pages', filename)
    if os.path.exists(ruta_pages):
        return ruta_pages
        
    # 3. Si no está, buscar en 'css', 'js' o 'assets' según corresponda
    for carpeta in ['css', 'js', 'assets']:
        ruta_especifica = os.path.join(FRONTEND_DIR, carpeta, filename)
        if os.path.exists(ruta_especifica):
            return ruta_especifica
            
    return None

@app.route('/')
def index():
    return send_from_directory(FRONTEND_DIR, 'login.html')

@app.route('/<path:path>')
def serve_static(path):
    archivo = buscar_archivo(path)
    if archivo:
        # Si lo encuentra, lo devuelve
        return send_from_directory(os.path.dirname(archivo), os.path.basename(archivo))
    
    # Si no lo encuentra, error 404
    return jsonify({"error": "Archivo no encontrado", "buscado": path}), 404

if __name__ == '__main__':
    port = int(os.getenv("GATEWAY_PORT", 5000))
    app.run(host='0.0.0.0', port=port, debug=True)