"""
UTILIDADES COMPARTIDAS DE BASE DE DATOS Y SEGURIDAD (helpers.py)

Centraliza las dos funciones que necesitan todos los archivos de 'routes/':
  1. get_db_connection(db_name): Abre la conexión PostgreSQL contra la base
     física del comercio en sesión (ej. 'trazzo_kiosco2').
  2. verificar_token(roles_permitidos): Valida el token JWT enviado por el
     Frontend, verifica el rol del usuario y extrae su identidad.

¿POR QUÉ EXISTE ESTE ARCHIVO APARTE DE app.py?
En Python, si 'app.py' importa 'routes/ventas.py' y al mismo tiempo 'ventas.py'
intenta importar funciones desde 'app.py', se produce un error de "importación
circular" y el servidor no arranca. Poner estas funciones en 'helper.py' corta
ese ciclo y permite que tanto clientes.py, pagos.py como ventas.py las usen.
"""

# Importamos os para leer credenciales de PostgreSQL y la clave JWT desde .env
import os
# Importamos jwt (PyJWT) para decodificar y verificar la firma de los tokens de sesión
import jwt
# Importamos psycopg2 para conectarnos al motor PostgreSQL
import psycopg2
# Importamos request y jsonify de Flask para leer headers HTTP y devolver errores estándar
from flask import request, jsonify
# Importamos load_dotenv para asegurar que las variables de .env estén disponibles
from dotenv import load_dotenv

# Cargamos las variables del archivo .env
load_dotenv()

# Obtenemos la clave secreta compartida con auth-service para validar que el token no fue adulterado
SECRET_KEY = os.getenv("JWT_SECRET")


def get_db_connection(db_name=None):
    """
    Abre y devuelve una conexión TCP a la base de datos específica del emprendimiento.
    Parámetro:
      - db_name (str): Nombre físico de la base extraído del JWT (ej. 'trazzo_kiosco2').
    """
    # Medida de seguridad multi-tenant: si no llega db_name, bloqueamos antes de tocar ninguna base
    if not db_name:
        raise ValueError("No se especificó la base de datos del emprendimiento (db_name faltante)")

    # Abrimos la conexión contra PostgreSQL usando las credenciales del .env y la base del negocio
    return psycopg2.connect(
        host=os.getenv("DB_HOST", "127.0.0.1"),
        database=db_name,
        user=os.getenv("DB_USER", "postgres"),
        password=os.getenv("DB_PASSWORD"),
        port=os.getenv("DB_PORT", "5432")
    )


def verificar_token(roles_permitidos=None):
    """
    Valida el header 'Authorization: Bearer <token>' en cada petición protegida.
    Parámetro opcional:
      - roles_permitidos (list): Ej. ['PROPIETARIO', 'ADMIN']. Si se indica, rechaza
        con 403 Forbidden a cualquier usuario cuyo rol no esté en la lista.
    Retorna una tupla de 3 elementos: (payload, respuesta_error, codigo_http)
    """
    # Leemos la cabecera Authorization enviada por el navegador
    auth_header = request.headers.get('Authorization')

    # Si no viene cabecera o no empieza con 'Bearer ', rechazamos con 401 Unauthorized
    if not auth_header or not auth_header.startswith('Bearer '):
        return None, jsonify({"status": "error", "mensaje": "Token no proporcionado"}), 401

    # Extraemos únicamente la cadena del token quitando la palabra 'Bearer '
    token = auth_header.split(" ")[1]

    try:
        # Decodificamos el token verificando su firma digital y su fecha de expiración (exp)
        payload = jwt.decode(token, SECRET_KEY, algorithms=["HS256"])

        # Verificamos que el token traiga asignada la base de datos física del negocio
        if not payload.get("db_name"):
            return None, jsonify({"status": "error", "mensaje": "Token sin base de datos asignada"}), 401

        # Si la ruta restringe roles (ej. solo Admin), validamos el rol firmado en el token
        rol_usuario = payload.get("rol")
        if roles_permitidos and rol_usuario not in roles_permitidos:
            return None, jsonify({"status": "error", "mensaje": "No tiene permisos para realizar esta acción"}), 403

        # Si todo es válido, devolvemos el diccionario con los datos del usuario (negocio_id, usuario_id, rol, db_name, etc.)
        return payload, None, 200

    except jwt.ExpiredSignatureError:
        # El access_token superó sus 15 minutos de vida; el Frontend usará el refresh_token para renovarlo
        return None, jsonify({"status": "error", "mensaje": "Sesión expirada"}), 401
    except jwt.InvalidTokenError:
        # El token está mal formado o su firma no coincide con JWT_SECRET
        return None, jsonify({"status": "error", "mensaje": "Token inválido"}), 401