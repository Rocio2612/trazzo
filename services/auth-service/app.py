from flask import Flask, request, jsonify
from flask_cors import CORS  # Manejo seguro de orígenes cruzados (CORS)
import os
import uuid # libreria estandar de python que genera cadenas alfanumericas aleatorias y unicas.
from dotenv import load_dotenv
import jwt
import secrets #es la librería estándar de Python para generar tokens criptográficamente seguros
import datetime
import psycopg2
from psycopg2.extras import RealDictCursor
from werkzeug.security import generate_password_hash, check_password_hash

load_dotenv()
app = Flask(__name__)

# CONFIGURACIÓN DE SEGURIDAD CORS (Restringido sin comodín '*') (mecanismo de seguridad)

#DOMINIOS AUTORIZADOS
# Definimos los orígenes legítimos desde donde el Frontend puede consultar:
# 1. El Gateway local (puerto 5000)
# 2. El Live Server de VS Code (puerto 5500)
# 3. La IP del servidor central en la red local

ORIGENES_PERMITIDOS = [
    # 1. Gateway local llamando por dirección IP de loopback (puerto 5000)
    "http://127.0.0.1:5000",
    # 2. Gateway local llamando por nombre de host local (puerto 5000)
    "http://localhost:5000",
    # 3. Frontend abierto con la extensión 'Live Server' de VS Code por IP (puerto 5500)
    "http://127.0.0.1:5500",
    # 4. Frontend abierto con 'Live Server' por nombre de host (puerto 5500)
    "http://localhost:5500",
    # 5. Computadora principal (servidor central) en la red Wi-Fi local
    "http://192.168.1.43:5000" 
]

CORS(
    # Pasamos la instancia de nuestra app Flask
    app, 
    
    # Indicamos qué rutas aplican esta regla: cualquier endpoint que empiece con /api/
    # asociándolo a la lista estricta de orígenes autorizados
    resources={r"/api/*": {"origins": ORIGENES_PERMITIDOS}},
    
    # Permite que las peticiones incluyan credenciales y cabeceras de autorización (JWT / Cookies)
    supports_credentials=True,
    
    # Métodos HTTP permitidos para interactuar con los endpoints
    methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    
    # Cabeceras HTTP que el navegador tiene permiso de enviar sin que sean bloqueadas
    allow_headers=["Content-Type", "Authorization"]
)

SECRET_KEY = os.getenv("JWT_SECRET", "clave_por_defecto")

def get_db_connection():
    """
    Abre una conexión TCP física contra PostgreSQL usando las credenciales del .env.
    Se define search_path=auth para interactuar directamente con el esquema del microservicio.
    """
    conn = psycopg2.connect(
        host=os.getenv("DB_HOST"), 
        database=os.getenv("DB_NAME"),
        user=os.getenv("DB_USER"),
        password=os.getenv("DB_PASSWORD"),
        port=os.getenv("DB_PORT")
    ) #Abre la conexion y la guarda en la variable conn

    # Garantizamos que las consultas busquen en el esquema auth sin prefijar tabla por tabla
    with conn.cursor() as cur: # Abre un cursor temporal
        cur.execute("SET search_path TO auth, public;") #Configura el esquema de trabajo
    return conn #Entrega la conexion

def token_esta_bloqueado(jti):
    """
    Consulta la base de datos para verificar si el identificador jti del token
    ha sido revocado previamente mediante un logout.
    Retorna True si el token está bloqueado (invalido), False si es legítimo.
    """
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("SELECT id FROM tokens_bloqueados WHERE jti = %s", (jti,))
        resultado = cur.fetchone()
        return resultado is not None
    finally:
        cur.close()
        conn.close()


@app.route('/api/auth/health', methods=['GET'])
def health():
    return jsonify({"status": "ok", "service": "auth-service"}), 200

@app.route('/api/auth/registro', methods=['POST'])
def registro():
    datos = request.get_json(silent=True) or {}
    
    # Extrae el dato respetando el contrato oficial y tolerando alias del front
    id_negocio = datos.get('id_negocio') or datos.get('negocio') or datos.get('identificador')
    usuario = datos.get('usuario') or datos.get('usuario_admin')
    password = datos.get('password') or datos.get('contrasena') or datos.get('clave')
    correo = datos.get('correo') or datos.get('email')
    nombre_comercial = datos.get('nombre_comercial') or datos.get('nombre_negocio') or 'Sin nombre'
    rubro = datos.get('rubro') or 'General'

    if not id_negocio or not usuario or not password or not correo:
        return jsonify({"status": "error", "mensaje": "Faltan datos obligatorios"}), 400

    password_hash = generate_password_hash(password)
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        # Inserta el negocio
        cur.execute(
            "INSERT INTO emprendimientos (identificador, nombre_comercial, rubro) VALUES (%s, %s, %s) RETURNING id",
            (id_negocio, nombre_comercial, rubro)
        )
        emprendimiento_id = cur.fetchone()['id']

        # Inserta el usuario admin inicial
        cur.execute(
            """INSERT INTO usuarios (emprendimiento_id, usuario, correo, password_hash, rol) 
               VALUES (%s, %s, %s, %s, 'PROPIETARIO') RETURNING id""",
            (emprendimiento_id, usuario, correo, password_hash)
        )
        usuario_id = cur.fetchone()['id']
        conn.commit()

        # Generación de identificadores únicos para los tokens (jti)
        access_jti = str(uuid.uuid4())
        refresh_jti = str(uuid.uuid4())

        #Los payload son paquetes de datos que lleva info del token dentro

        #token rapido 
        payload_access = {
            "usuario_id": usuario_id,
            "usuario": usuario,
            "negocio_id": emprendimiento_id,
            "rol": "PROPIETARIO",
            "jti": access_jti,
            "exp": datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(minutes=15)
        }

        #se usa cuando el access_token vencio. pidiendo uno nuevo al front
        payload_refresh = {
            "usuario_id": usuario_id,
            "jti": refresh_jti,
            "type": "refresh",
            "exp": datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=7)
        }

        #Empaqueta todos los datos en JSON dificil de falsificar.
        access_token = jwt.encode(payload_access, SECRET_KEY, algorithm="HS256") #HS256: es un algoritmo de clave simétrica. Significa que la misma clave privada (SECRET_KEY) que usa el servidor para crear el token es la que usa para comprobar que nadie lo haya alterado.
        refresh_token = jwt.encode(payload_refresh, SECRET_KEY, algorithm="HS256")

        return jsonify({
            "status": "ok",
            "mensaje": "Negocio y usuario creado con éxito en la BD",
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
    datos = request.get_json(silent=True) or {}
    
    id_negocio = datos.get('id_negocio') or datos.get('negocio') or datos.get('identificador')
    usuario = datos.get('usuario')
    password = datos.get('password') or datos.get('contrasena') or datos.get('clave')

    if not id_negocio or not usuario or not password:
        return jsonify({"status": "error", "mensaje": "Faltan datos obligatorios"}), 400

    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        cur.execute(
            """SELECT u.*, e.identificador AS negocio 
               FROM usuarios u JOIN emprendimientos e ON u.emprendimiento_id = e.id 
               WHERE e.identificador = %s AND u.usuario = %s AND u.activo = TRUE""",
            (id_negocio, usuario)
        )
        usuario_bd = cur.fetchone()

        if usuario_bd and check_password_hash(usuario_bd['password_hash'], password):
            access_jti = str(uuid.uuid4())
            refresh_jti = str(uuid.uuid4())

            payload_access = {
                "usuario_id": usuario_bd['id'],
                "usuario": usuario_bd['usuario'],
                "negocio_id": usuario_bd['emprendimiento_id'],
                "rol": usuario_bd['rol'],
                "jti": access_jti,
                "exp": datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(minutes=15)
            }

            payload_refresh = {
                "usuario_id": usuario_bd['id'],
                "jti": refresh_jti,
                "type": "refresh",
                "exp": datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=7)
            }

            access_token = jwt.encode(payload_access, SECRET_KEY, algorithm="HS256")
            refresh_token = jwt.encode(payload_refresh, SECRET_KEY, algorithm="HS256")

            # ACÁ ESTABA EL ERROR: devolvemos usuario_bd['usuario'] en vez de 'nombre'
            return jsonify({
                "status": "ok",
                "access_token": access_token,
                "refresh_token": refresh_token,
                "usuario": {
                    "id": usuario_bd['id'], 
                    "rol": usuario_bd['rol'], 
                    "nombre": usuario_bd['usuario']
                }
            }), 200
        else:
            return jsonify({"status": "error", "mensaje": "Negocio, usuario o contraseña incorrectos"}), 401

    except Exception as e:
        return jsonify({"status": "error", "mensaje": f"Error: {str(e)}"}), 500
    finally:
        cur.close()
        conn.close()

#CIERRE DE SESION CON REVOCACION REAL (POST /api/auth/logout)
@app.route('/api/auth/logout', methods=['POST'])
def logout():
    """
    Invalida el token del cliente guardando su jti en la tabla tokens_bloqueados.
    Requiere que el token sea enviado en el header 'Authorization: Bearer <token>'.
    """
    auth_header = request.headers.get('Authorization')
    if not auth_header or not auth_header.startswith('Bearer '):
        return jsonify({"status": "error", "mensaje": "Token no proporcionado"}), 401

    #cuando una página web manda un token al backend, no lo manda suelto, 
    # sino en una cabecera HTTP con esta estructura fija (Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..)
    #split corta la cadena por el espacio y [1] guarda la segunda parte.
    token = auth_header.split(" ")[1]

    try:
        # Decodificamos el token para extraer sus metadatos de auditoría
        payload = jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
        #Abre el token, verifica que la firma matemática coincida con SECRET_KEY y extrae su contenido.
        jti = payload.get("jti")
        usuario_id = payload.get("usuario_id")
        exp_timestamp = payload.get("exp")

        #valida que el token tenga un jti, sino lo rechaza.
        if not jti:
            return jsonify({"status": "error", "mensaje": "Token inválido (sin identificador de sesión)"}), 400

        # Convertimos la marca UNIX 'exp' a un objeto datetime UTC para PostgreSQL
        fecha_expiracion = datetime.datetime.fromtimestamp(exp_timestamp, tz=datetime.timezone.utc)

        # Persistimos el bloqueo en la base de datos
        conn = get_db_connection()
        cur = conn.cursor()
        try:
            cur.execute(
                """INSERT INTO tokens_bloqueados (jti, usuario_id, fecha_expiracion)
                   VALUES (%s, %s, %s)
                   ON CONFLICT (jti) DO NOTHING""", #Si el usuario hace doble clic rápido en "Cerrar Sesión", la base no tira error de clave duplicada; simplemente ignora el segundo intento en silencio.
                (jti, usuario_id, fecha_expiracion)
            )

            #Si el Frontend además envió el refresh_token en el body, también lo invalidamos
            body = request.get_json(silent=True) or {}
            refresh_token_raw = body.get("refresh_token")
            if refresh_token_raw:
                try:
                    payload_ref = jwt.decode(refresh_token_raw, SECRET_KEY, algorithms=["HS256"])
                    ref_jti = payload_ref.get("jti")
                    ref_exp = datetime.datetime.fromtimestamp(payload_ref.get("exp"), tz=datetime.timezone.utc)
                    if ref_jti:
                        cur.execute(
                            """INSERT INTO tokens_bloqueados (jti, usuario_id, fecha_expiracion)
                               VALUES (%s, %s, %s)
                               ON CONFLICT (jti) DO NOTHING""",
                            (ref_jti, usuario_id, ref_exp)
                        )
                except (jwt.InvalidTokenError, jwt.ExpiredSignatureError):
                    pass  # Si el refresh ya expiró o era inválido, no frena el logout

            conn.commit()
            return jsonify({"status": "ok", "mensaje": "Sesión cerrada correctamente"}), 200
        finally:
            cur.close()
            conn.close()

    except jwt.ExpiredSignatureError:
        # Si el token ya expiró cronológicamente, no representa peligro
        return jsonify({"status": "ok", "mensaje": "Sesión expirada previamente"}), 200
    except jwt.InvalidTokenError:
        #por si envian una cadena corrupta, responde con 401
        return jsonify({"status": "error", "mensaje": "Token inválido"}), 401
    except Exception as e:
        #responde a otros imprevistos
        return jsonify({"status": "error", "mensaje": f"Error al cerrar sesión: {str(e)}"}), 500


#ENDPOINT /yo (verifica la lista negra)
#Es el guardia de seguridad, depende de el estado de la sesion te deja entrar o te envia a iniciar sesion de nuevo
@app.route('/api/auth/yo', methods=['GET'])
def obtener_mi_perfil():
    auth_header = request.headers.get('Authorization')
    if not auth_header or not auth_header.startswith('Bearer '):
        return jsonify({"status": "error", "mensaje": "Token no proporcionado"}), 401

    token = auth_header.split(" ")[1]

    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
        #
        jti = payload.get("jti")

        # Comprobación de seguridad: ¿Hizo logout con este token?
        if jti and token_esta_bloqueado(jti):
            return jsonify({"status": "error", "mensaje": "Sesión invalidada. Inicie sesión nuevamente"}), 401

        usuario_id = payload.get("usuario_id")

        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute(
            """SELECT u.usuario, u.correo, u.rol, u.activo, e.identificador AS negocio_id 
               FROM usuarios u JOIN emprendimientos e ON u.emprendimiento_id = e.id 
               WHERE u.id = %s""", 
            (usuario_id,)
        )
        usuario_bd = cur.fetchone()
        cur.close()
        conn.close()

        if not usuario_bd:
            return jsonify({"status": "error", "mensaje": "Usuario no encontrado"}), 404

        #
        if not usuario_bd['activo']:
            return jsonify({"status": "error", "mensaje": "Usuario deshabilitado por administración"}), 401

        return jsonify({
            "status": "ok",
            "mensaje": "Acceso concedido",
            "usuario": {
                "usuario": usuario_bd['usuario'],
                "correo": usuario_bd['correo'],
                "negocio_id": usuario_bd['negocio_id'],
                "rol": usuario_bd['rol']
            }
        }), 200
        
    except jwt.ExpiredSignatureError:
        return jsonify({"status": "error", "mensaje": "El token ha expirado"}), 401
    except jwt.InvalidTokenError:
        return jsonify({"status": "error", "mensaje": "Token inválido"}), 401
    except Exception as e:
        return jsonify({"status": "error", "mensaje": f"Error en BD: {str(e)}"}), 500

#REFRESCAR TOKEN (POST /api/auth/refresh)
@app.route('/api/auth/refresh', methods=['POST'])
def refresh():
    """
    Recibe un refresh_token válido y emite un nuevo access_token de 15 minutos.
    Evita que el usuario tenga que volver a iniciar sesión constantemente.
    """
    # 1. Intentamos leer el token desde el cuerpo JSON o desde el header Authorization
    body = request.get_json(silent=True) or {}
    refresh_token = body.get("refresh_token")

    if not refresh_token:
        auth_header = request.headers.get('Authorization')
        if auth_header and auth_header.startswith('Bearer '):
            refresh_token = auth_header.split(" ")[1]

    if not refresh_token:
        return jsonify({"status": "error", "mensaje": "Refresh token no proporcionado"}), 400

    try:
        # 2. Decodificamos y verificamos la firma criptográfica
        payload = jwt.decode(refresh_token, SECRET_KEY, algorithms=["HS256"])

        # 3. Validamos que sea estrictamente un token de refresco y no uno de acceso
        if payload.get("type") != "refresh":
            return jsonify({"status": "error", "mensaje": "Tipo de token inválido para esta operación"}), 400

        # 4. Verificamos que este refresh token no haya sido revocado en un logout
        jti = payload.get("jti")
        if jti and token_esta_bloqueado(jti):
            return jsonify({"status": "error", "mensaje": "Sesión invalidada. Inicie sesión nuevamente"}), 401

        usuario_id = payload.get("usuario_id")

        # 5. Consultamos los datos actuales del usuario en la base para armar el nuevo token
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute(
            """SELECT u.id, u.usuario, u.rol, u.activo, u.emprendimiento_id 
               FROM usuarios u 
               WHERE u.id = %s""",
            (usuario_id,)
        )
        usuario = cur.fetchone()
        cur.close()
        conn.close()

        if not usuario:
            return jsonify({"status": "error", "mensaje": "Usuario no encontrado"}), 404

        if not usuario['activo']:
            return jsonify({"status": "error", "mensaje": "Usuario deshabilitado por administración"}), 401

        # 6. Generamos un access token nuevo con un JTI fresco de 15 minutos
        nuevo_access_jti = str(uuid.uuid4())
        payload_access = {
            "usuario_id": usuario['id'],
            "usuario": usuario['usuario'],
            "negocio_id": usuario['emprendimiento_id'],
            "rol": usuario['rol'],
            "jti": nuevo_access_jti,
            "exp": datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(minutes=15)
        }

        nuevo_access_token = jwt.encode(payload_access, SECRET_KEY, algorithm="HS256")

        return jsonify({
            "status": "ok",
            "mensaje": "Access token renovado exitosamente",
            "access_token": nuevo_access_token
        }), 200

    except jwt.ExpiredSignatureError:
        return jsonify({"status": "error", "mensaje": "El refresh token ha expirado. Inicie sesión nuevamente"}), 401
    except jwt.InvalidTokenError:
        return jsonify({"status": "error", "mensaje": "Refresh token inválido"}), 401
    except Exception as e:
        return jsonify({"status": "error", "mensaje": f"Error al refrescar sesión: {str(e)}"}), 500

#SOLICITAR RECUPERACIÓN DE CLAVE (POST /api/auth/recuperar)
@app.route('/api/auth/recuperar', methods=['POST'])
def solicitar_recuperacion():
    datos = request.get_json(silent=True) or {}
    # Soporta tanto 'correo' (contrato oficial) como 'email' (frontend)
    correo = (datos.get('correo') or datos.get('email') or '').strip().lower()

    if not correo:
        return jsonify({"status": "error", "mensaje": "Debe proporcionar un correo electrónico"}), 400
    
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        # Buscamos si existe algún usuario asociado a ese correo
        cur.execute("SELECT id, usuario FROM usuarios WHERE lower(correo) = %s AND activo = TRUE", (correo,))
        usuarios = cur.fetchall()

        if usuarios:
            # Generamos un token criptográfico seguro de 32 bytes (64 caracteres hexadecimales)
            token_seguridad = secrets.token_hex(32)
            expiracion = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(minutes=30)

            # Registramos el token para los usuarios asociados a esa casilla
            for u in usuarios:
                cur.execute(
                    """INSERT INTO recuperacion_claves (usuario_id, token_seguridad, fecha_expiracion, usado)
                       VALUES (%s, %s, %s, FALSE)""",
                    (u['id'], token_seguridad, expiracion)
                )
            conn.commit()

            # SIMULACIÓN DE ENVÍO DE EMAIL (Modo Desarrollo según documento del equipo)
            enlace_recuperacion = f"http://127.0.0.1:5000/restablecer.html?token={token_seguridad}"
            print("\n" + "="*70)
            print(" [SIMULADOR DE EMAIL - RECUPERACIÓN DE CLAVE]")
            print(f" Para: {correo}")
            print(f" Asunto: Recuperación de acceso a Trazzo")
            print(f" Enlace temporal (Vence en 30 min): {enlace_recuperacion}")
            print("="*70 + "\n")

        # Mensaje idéntico tanto si el correo existe como si no existe (Regla de Seguridad OWASP)
        return jsonify({
            "status": "ok",
            "mensaje": "Si el correo está registrado en el sistema, recibirás un enlace de recuperación."
        }), 200

    except Exception as e:
        conn.rollback()
        return jsonify({"status": "error", "mensaje": f"Error al procesar solicitud: {str(e)}"}), 500
    finally:
        cur.close()
        conn.close()

#RESTABLECER CONTRASEÑA (POST /api/auth/restablecer)
@app.route('/api/auth/restablecer', methods=['POST'])
def restablecer_password():
    """
    Recibe el token de seguridad temporal y la nueva contraseña.
    Valida vigencia y estado del token, actualiza el hash de la clave y lo marca como usado.
    """
    datos = request.get_json(silent=True) or {}
    #nombres aceptados (flexible)
    token = datos.get('token_recuperacion') or datos.get('token')
    nueva_password = datos.get('nueva_password') or datos.get('password')

    if not token or not nueva_password:
        return jsonify({"status": "error", "mensaje": "Token y nueva contraseña son obligatorios"}), 400

    # Validación de longitud mínima según reglas del negocio (mínimo 8 caracteres)
    if len(nueva_password) < 8:
        return jsonify({"status": "error", "mensaje": "La contraseña debe tener al menos 8 caracteres"}), 400

    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        # Buscamos el token en la tabla verificando que no haya sido usado
        cur.execute(
            """SELECT id, usuario_id, fecha_expiracion, usado 
               FROM recuperacion_claves 
               WHERE token_seguridad = %s""",
            (token,)
        )
        registro_token = cur.fetchone()

        if not registro_token:
            return jsonify({"status": "error", "mensaje": "El enlace de recuperación es inválido"}), 400

        if registro_token['usado']:
            return jsonify({"status": "error", "mensaje": "Este enlace ya fue utilizado previamente"}), 400

        # Verificamos si expiró cronológicamente (más de 30 minutos)
        ahora_utc = datetime.datetime.now(datetime.timezone.utc)
        if registro_token['fecha_expiracion'] < ahora_utc:
            return jsonify({"status": "error", "mensaje": "El enlace de recuperación ha expirado"}), 400

        # Hasheamos la nueva contraseña con Werkzeug
        nuevo_hash = generate_password_hash(nueva_password)

        # 1. Actualizamos la clave del usuario
        cur.execute(
            "UPDATE usuarios SET password_hash = %s WHERE id = %s",
            (nuevo_hash, registro_token['usuario_id'])
        )

        # 2. Marcamos el token como usado para que quede inutilizable
        cur.execute(
            "UPDATE recuperacion_claves SET usado = TRUE WHERE id = %s",
            (registro_token['id'],)
        )

        conn.commit()

        return jsonify({
            "status": "ok",
            "mensaje": "Contraseña actualizada exitosamente. Ya puede iniciar sesión."
        }), 200

    except Exception as e:
        conn.rollback()
        return jsonify({"status": "error", "mensaje": f"Error al restablecer contraseña: {str(e)}"}), 500
    finally:
        cur.close()
        conn.close()

#ACTUALIZAR DATOS DEL NEGOCIO (PUT /api/negocio)
@app.route('/api/negocio', methods=['PUT'])
def actualizar_negocio():
    """
    Permite al PROPIETARIO o ADMIN actualizar el nombre comercial y/o rubro de su negocio.
    Aplica Control de Acceso por Roles (RBAC) rechazando a roles no autorizados (CAJERO) con 403.
    Garantiza aislamiento multi-tenant extrayendo el negocio_id estrictamente del JWT.
    """
    # 1. Verificación de la cabecera de autorización
    auth_header = request.headers.get('Authorization')
    if not auth_header or not auth_header.startswith('Bearer '):
        return jsonify({"status": "error", "mensaje": "Token no proporcionado"}), 401

    token = auth_header.split(" ")[1]

    try:
        # 2. Decodificación y validación criptográfica del token
        payload = jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
        jti = payload.get("jti")

        # 3. Comprobación de seguridad en la lista negra
        if jti and token_esta_bloqueado(jti):
            return jsonify({"status": "error", "mensaje": "Sesión invalidada. Inicie sesión nuevamente"}), 401

        # 4. Control de Acceso basado en Roles (RBAC)
        rol = payload.get("rol")
        if rol not in ['PROPIETARIO', 'ADMIN']:
            return jsonify({
                "status": "error", 
                "mensaje": "Acceso denegado: solo usuarios con rol PROPIETARIO o ADMIN pueden modificar el negocio"
            }), 403

        # 5. Extracción segura del tenant (negocio) desde el token
        negocio_id = payload.get("negocio_id")
        if not negocio_id:
            return jsonify({"status": "error", "mensaje": "Token carece de identificación de negocio"}), 400

        # 6. Lectura y validación de datos a actualizar
        datos = request.get_json(silent=True) or {}
        nombre_comercial = datos.get('nombre_comercial') or datos.get('nombre')
        rubro = datos.get('rubro')

        if not nombre_comercial and not rubro:
            return jsonify({
                "status": "error", 
                "mensaje": "Debe proporcionar al menos un campo para actualizar (nombre_comercial o rubro)"
            }), 400

        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)

        try:
            # 7. Actualización dinámica en PostgreSQL preservando datos existentes si alguno viene nulo
            cur.execute(
                """UPDATE emprendimientos 
                   SET nombre_comercial = COALESCE(%s, nombre_comercial),
                       rubro = COALESCE(%s, rubro)
                   WHERE id = %s
                   RETURNING id, identificador, nombre_comercial, rubro""",
                (nombre_comercial, rubro, negocio_id)
            )
            negocio_actualizado = cur.fetchone()

            if not negocio_actualizado:
                return jsonify({"status": "error", "mensaje": "Negocio no encontrado"}), 404

            conn.commit()

            return jsonify({
                "status": "ok",
                "mensaje": "Datos del negocio actualizados correctamente",
                "negocio": {
                    "identificador": negocio_actualizado['identificador'],
                    "nombre_comercial": negocio_actualizado['nombre_comercial'],
                    "rubro": negocio_actualizado['rubro']
                }
            }), 200

        finally:
            cur.close()
            conn.close()

    except jwt.ExpiredSignatureError:
        return jsonify({"status": "error", "mensaje": "El token ha expirado"}), 401
    except jwt.InvalidTokenError:
        return jsonify({"status": "error", "mensaje": "Token inválido"}), 401
    except Exception as e:
        return jsonify({"status": "error", "mensaje": f"Error al actualizar datos del negocio: {str(e)}"}), 500

if __name__ == '__main__':
    port = int(os.getenv("SERVICE_PORT", 5001))
    app.run(host='127.0.0.1', port=port, debug=True)