"""
MICROSERVICIO DE TRANSACCIONES (transacciones-service) — PUNTO DE ENTRADA (app.py)

Es el servidor principal de Flask que corre en el puerto 5003 y atiende los tres
módulos comerciales del Sprint 3: Clientes (M7), Ventas (M8) y Cuenta Corriente (M9).

¿POR QUÉ ESTÁ DIVIDIDO EN BLUEPRINTS (carpeta routes/)?
Como dos desarrolladoras trabajan en paralelo sobre este mismo microservicio,
separar las rutas en archivos independientes evita conflictos al mergear en Git:
  - routes/clientes.py -> Módulo 7: Agenda de clientes y alta rápida (Aldi).
  - routes/pagos.py    -> Módulo 9: Pagos de cuenta corriente y saldos (Aldi).
  - routes/ventas.py   -> Módulo 8: Carrito, IVA, stock y anulaciones (Rocío).

REGLA PARA EL EQUIPO:
Una vez configurado y subido a 'main', ninguna necesita volver a editar este
archivo; cada una trabaja exclusivamente dentro de su archivo en 'routes/'.
"""

# Importamos Flask para crear el servidor web y jsonify para responder en formato JSON
from flask import Flask, jsonify
# Importamos os para leer el puerto configurado en el archivo .env
import os
# Importamos load_dotenv para cargar las variables de entorno desde el archivo .env
from dotenv import load_dotenv
# Importamos CORS para permitir peticiones HTTP desde el navegador / Gateway sin bloqueos de origen
from flask_cors import CORS

# Importamos los Blueprints (grupos de rutas) desde cada archivo de la carpeta routes/
from routes.clientes import clientes_bp
from routes.pagos import pagos_bp
from routes.ventas import ventas_bp

# Cargamos las variables definidas en services/transacciones-service/.env
load_dotenv()

# Inicializamos la aplicación principal de Flask
app = Flask(__name__)

# Habilitamos CORS en toda la aplicación para aceptar headers como Authorization (JWT)
CORS(app)

# Registramos cada Blueprint en la aplicación principal:
# Esto conecta todas las rutas @clientes_bp.route, @pagos_bp.route y @ventas_bp.route
# dentro del mismo servidor en el puerto 5003.
app.register_blueprint(clientes_bp)
app.register_blueprint(pagos_bp)
app.register_blueprint(ventas_bp)


# Ruta de verificación de estado (Health Check):
# Sirve para comprobar rápidamente desde el navegador o Postman que el microservicio está encendido.
@app.route('/api/transacciones/health', methods=['GET'])
def health():
    return jsonify({"status": "ok", "service": "transacciones-service"}), 200


# Bloque de arranque cuando se ejecuta 'python app.py' directamente desde la terminal
if __name__ == '__main__':
    # Lee SERVICE_PORT desde el .env (si no existe, usa 5003 por defecto)
    port = int(os.getenv("SERVICE_PORT", 5003))
    # Levanta el servidor local en 127.0.0.1 con modo debug activo para desarrollo
    app.run(host='127.0.0.1', port=port, debug=True)