from flask import Flask, jsonify, request, Response, send_from_directory
from flask_cors import CORS
import os
import requests
from dotenv import load_dotenv

load_dotenv()
app = Flask(__name__)

#Esta prohibido usar * porque vuelve fragil la seguridad de acceso. Ademas el navegador bloqueara el acceso.
ORIGENES_PERMITIDOS = [
    "http://127.0.0.1:5500",
    "http://localhost:5500",
    "http://127.0.0.1:5000",
    "http://localhost:5000",
    "http://192.168.1.43:5000"
]
CORS(app, resources={r"/api/*": {"origins": ORIGENES_PERMITIDOS}}, supports_credentials=True)

#Temporal y cambiar dependiendo del SM
SERVICES = {
    "auth": os.getenv("AUTH_URL", "http://127.0.0.1:5001"),
    "productos": os.getenv("PRODUCTOS_URL", "http://127.0.0.1:5002"),
    "reposiciones": os.getenv("PRODUCTOS_URL", "http://127.0.0.1:5002"),
    "categorias": os.getenv("PRODUCTOS_URL", "http://127.0.0.1:5002"),
    "proveedores": os.getenv("PRODUCTOS_URL", "http://127.0.0.1:5002"),
    "transacciones": os.getenv("TRANSACCIONES_URL", "http://127.0.0.1:5003"),
    "finanzas": os.getenv("FINANZAS_URL", "http://127.0.0.1:5004"),
    "medios-pago": os.getenv("FINANZAS_URL", "http://127.0.0.1:5004"),
    "gastos": os.getenv("FINANZAS_URL", "http://127.0.0.1:5004"),
    "reportes": os.getenv("REPORTES_URL", "http://127.0.0.1:5005"),
    "notificaciones": os.getenv("NOTIFICACIONES_URL", "http://127.0.0.1:5006")
}

# Cabeceras HTTP de transporte que no deben propagarse al cliente
CABECERAS_EXCLUIDAS = {'content-encoding', 'content-length', 'transfer-encoding', 'connection'}

# Enrutador universal: tolera llamadas con o sin barra sin emitir redirecciones 308
@app.route('/api/<service>', defaults={'path': ''}, strict_slashes=False, methods=['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])
@app.route('/api/<service>/<path:path>', strict_slashes=False, methods=['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])
def proxy(service, path):
    if service not in SERVICES:
        return jsonify({"status": "error", "mensaje": f"Microservicio '{service}' no registrado en el Gateway"}), 404

    # Construcción dinámica de la URL destino
    target_url = f"{SERVICES[service]}/api/{service}/{path}" if path else f"{SERVICES[service]}/api/{service}"

    try:
        # Reenvío transparente de método, cabeceras, parámetros (?desde=&hasta=) y body
        resp = requests.request(
            method=request.method,
            url=target_url,
            headers={k: v for k, v in request.headers if k.lower() != 'host'},
            data=request.get_data(),
            params=request.args,
            timeout=10
        )

        # Depuración de cabeceras de red para compatibilidad con navegadores
        headers_limpias = [(k, v) for k, v in resp.headers.items() if k.lower() not in CABECERAS_EXCLUIDAS]
        return Response(resp.content, resp.status_code, headers_limpias)

    except requests.exceptions.ConnectionError:
        return jsonify({"status": "error", "mensaje": f"El servicio '{service}' se encuentra temporalmente apagado o inaccesible"}), 503
    except requests.exceptions.Timeout:
        return jsonify({"status": "error", "mensaje": f"Tiempo de espera agotado al conectar con '{service}'"}), 504

# --- CONFIGURACIÓN DE RUTAS INTELIGENTE (gestion de archivos estaticos frontend) ---
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND_DIR = os.path.join(BASE_DIR, 'frontend')

def buscar_archivo(filename):
    """Busca el archivo en la carpeta frontend o en sus subcarpetas (pages, css, js)"""
    # 1. Buscar directo en frontend.
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

    # Blindaje: Si una ruta empieza con 'api/' y llegó acá, es un endpoint inexistente, no un archivo
    if path.startswith('api/'):
        return jsonify({"status": "error", "mensaje": "Ruta de API inexistente", "solicitado": path}), 404

    archivo = buscar_archivo(path)
    if archivo:
        # Si lo encuentra, lo devuelve
        return send_from_directory(os.path.dirname(archivo), os.path.basename(archivo))
    
    # Si no lo encuentra, error 404
    return jsonify({"error": "Archivo no encontrado", "buscado": path}), 404

if __name__ == '__main__':
    port = int(os.getenv("GATEWAY_PORT", 5000))
    app.run(host='0.0.0.0', port=port, debug=True)