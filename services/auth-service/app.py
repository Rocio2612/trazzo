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
import re  # Módulo estándar para validación de patrones (Regex)

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

# Carga estrictamente desde .env (sin secretos hardcodeados)
SECRET_KEY = os.getenv("JWT_SECRET")

def get_db_connection():
    """
    Abre una conexión TCP física contra PostgreSQL.
    Configura search_path a nivel de protocolo (options) para que todas las consultas
    encuentren el esquema 'auth' sin fallar.
    """
    conn = psycopg2.connect(
        host=os.getenv("DB_HOST"), 
        database=os.getenv("DB_NAME"),
        user=os.getenv("DB_USER", "postgres"),
        password=os.getenv("DB_PASSWORD"),
        port=os.getenv("DB_PORT", "5432"),
        options="-c search_path=auth,public"
    )
    return conn

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

    # Si el front no manda nombre, usamos id_negocio para cumplir el NOT NULL
    nombre_comercial = datos.get('nombre_negocio') or datos.get('nombre_comercial') or id_negocio
    rubro = datos.get('rubro') or 'General'
    
    # Si el front aún no manda categoría, por defecto es MONOTRIBUTISTA
    categoria_impositiva = (datos.get('categoria_impositiva') or 'MONOTRIBUTISTA').strip().upper()

    if categoria_impositiva not in ['RESPONSABLE_INSCRIPTO', 'MONOTRIBUTISTA', 'EXENTO']:
        categoria_impositiva = 'MONOTRIBUTISTA'

    if not id_negocio or not usuario or not password or not correo:
        return jsonify({"status": "error", "mensaje": "Faltan datos obligatorios"}), 400

    password_hash = generate_password_hash(password)
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        # Inserta el negocio con esquema explícito
        cur.execute(
            """INSERT INTO auth.emprendimientos (identificador, nombre_comercial, rubro, categoria_impositiva) 
               VALUES (%s, %s, %s, %s) RETURNING id, categoria_impositiva""",
            (id_negocio.lower().strip(), nombre_comercial.strip(), rubro.strip(), categoria_impositiva)
        )
        emp = cur.fetchone()
        emprendimiento_id = emp['id']
        emp_categoria = emp['categoria_impositiva']

        # Inserta el usuario admin con esquema explícito
        cur.execute(
            """INSERT INTO auth.usuarios (emprendimiento_id, usuario, correo, password_hash, rol) 
               VALUES (%s, %s, %s, %s, 'PROPIETARIO') RETURNING id""",
            (emprendimiento_id, usuario.lower().strip(), correo.lower().strip(), password_hash)
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
            "usuario": usuario.lower().strip(),
            "negocio_id": emprendimiento_id,
            #agregado
            "categoria_impositiva": emp_categoria,
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
            """SELECT u.*, e.identificador AS negocio, e.categoria_impositiva 
               FROM usuarios u JOIN emprendimientos e ON u.emprendimiento_id = e.id 
               WHERE lower(e.identificador) = %s AND lower(u.usuario) = %s AND u.activo = TRUE""",
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
                #agregado
                "categoria_impositiva": usuario_bd['categoria_impositiva'],
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
            """SELECT u.id, u.usuario, u.rol, u.activo, u.emprendimiento_id, e.categoria_impositiva 
               FROM usuarios u 
               JOIN emprendimientos e ON u.emprendimiento_id = e.id 
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
            #agregado
            "categoria_impositiva": usuario['categoria_impositiva'],
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
@app.route('/api/auth/negocio', methods=['PUT'])
def actualizar_negocio():
    """
    Permite al PROPIETARIO o ADMIN actualizar el nombre comercial, rubro de su negocio o/y categoria impositiva del negocio.
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
        categoria_impositiva = datos.get('categoria_impositiva')

        # Validación de al menos un campo presente
        if not nombre_comercial and not rubro and not categoria_impositiva:
            return jsonify({
                "status": "error", 
                "mensaje": "Debe proporcionar al menos un campo para actualizar (nombre_comercial, rubro o categoria_impositiva)"
            }), 400

        if categoria_impositiva:
            categoria_impositiva = categoria_impositiva.strip().upper()
            if categoria_impositiva not in ['RESPONSABLE_INSCRIPTO', 'MONOTRIBUTISTA', 'EXENTO']:
                return jsonify({
                    "status": "error",
                    "mensaje": "Categoría impositiva inválida. Debe ser RESPONSABLE_INSCRIPTO, MONOTRIBUTISTA o EXENTO"
                }), 400

        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)

        try:
            # 7. Actualización dinámica en PostgreSQL preservando datos existentes si alguno viene nulo
            cur.execute(
                """UPDATE emprendimientos 
                   SET nombre_comercial = COALESCE(%s, nombre_comercial),
                       rubro = COALESCE(%s, rubro),
                       categoria_impositiva = COALESCE(%s, categoria_impositiva)
                   WHERE id = %s
                   RETURNING id, identificador, nombre_comercial, rubro, categoria_impositiva""",
                (nombre_comercial, rubro, categoria_impositiva, negocio_id)
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
                    "rubro": negocio_actualizado['rubro'],
                    "categoria_impositiva": negocio_actualizado['categoria_impositiva']
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

#--------------------------------------------------------------------------------------- ALDI.
# MÓDULO DE PERSONALIZACIÓN
# Gestión de negocio y personal
def verificar_sesion_y_rol(roles_autorizados=None):
    """
    Función auxiliar centralizada de seguridad (Autenticación y RBAC).
    1. Extrae y valida la cabecera 'Authorization: Bearer <token>'.
    2. Decodifica el JWT comprobando firma criptográfica simétrica y vigencia (exp).
    3. Verifica que el identificador 'jti' no esté revocado en 'auth.tokens_bloqueados'.
    4. Comprueba que el usuario pertenezca a un negocio activo y no haya sido deshabilitado.
    5. Aplica Control de Acceso Basado en Roles si se define 'roles_autorizados'.
    
    Retorna: (payload_del_token, error_response, status_code)
    """
    # Lee la cabecera HTTP estándar donde el navegador o cliente envía sus credenciales.
    auth_header = request.headers.get('Authorization')
    # Control de formato. Si el cliente no mandó la cabecera o si no empieza con la palabra clave "Bearer " (el estándar internacional de tokens JWT), rechaza la petición con código 401 Unauthorized.
    if not auth_header or not auth_header.startswith('Bearer '):
        return None, jsonify({"status": "error", "mensaje": "Token de autenticación no proporcionado"}), 401

    # Separa el texto "Bearer <cadena_del_token>" por el espacio en blanco y extrae la posición [1], quedándose únicamente con la firma alfanumérica del token.   
    token = auth_header.split(" ")[1]

    # Intenta decodificar matemáticamente el token con la clave maestra SECRET_KEY. Si nadie alteró el token y no ha vencido, 
    # extrae el diccionario interno (payload) con los datos de sesión (jti, usuario_id, negocio_id, rol).
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
        jti = payload.get("jti")
        usuario_id = payload.get("usuario_id")
        negocio_id = payload.get("negocio_id")
        rol = payload.get("rol")

        # Comprobación de seguridad en lista negra. Si el usuario hizo "Cerrar Sesión" previamente, el token queda invalidado y devuelve 401.
        if jti and token_esta_bloqueado(jti):
            return None, jsonify({"status": "error", "mensaje": "Sesión invalidada por cierre o cambio de credenciales"}), 401

        # Verificamos estado real en la base de datos
        # Abre la conexión
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        try:
            cur.execute("SELECT activo FROM auth.usuarios WHERE id = %s AND emprendimiento_id = %s", (usuario_id, negocio_id))
            user_db = cur.fetchone()
            # Si un administrador lo deshabilitó mientras tenía la sesión abierta, lo bloquea de inmediato con 401.
            if not user_db or not user_db['activo']:
                return None, jsonify({"status": "error", "mensaje": "Usuario deshabilitado o inexistente"}), 401
        finally:
            cur.close()
            conn.close()

        # Validación estricta de Roles (RBAC)
        if roles_autorizados and rol not in roles_autorizados:
            return None, jsonify({"status": "error", "mensaje": f"Acceso denegado. Se requiere uno de los roles: {roles_autorizados}"}), 403

        # Si todo es legítimo, retorna:
        return payload, None, 200

    # Se dispara automáticamente si la fecha actual superó los 15 minutos de vida del token (exp).
    except jwt.ExpiredSignatureError:
        return None, jsonify({"status": "error", "mensaje": "El token ha expirado"}), 401
    # Se dispara si el token fue manipulado, está corrupto o fue firmado con otra clave.
    except jwt.InvalidTokenError:
        return None, jsonify({"status": "error", "mensaje": "Token de seguridad inválido"}), 401

# Consulta de perfil del negocio (GET /api/auth/negocio)
@app.route('/api/auth/negocio', methods=['GET'])
def obtener_datos_negocio():
    """
    Retorna la información legal y comercial del comercio vinculado al JWT.
    Permite a la pantalla 'Mi negocio' renderizar datos reales.
    """

    # Guarda en payload el contenido del token, o en error_resp el mensaje de error si falló.
    payload, error_resp, status = verificar_sesion_y_rol(roles_autorizados=['PROPIETARIO', 'ADMIN'])
    # Si la validación falló (ej. token vencido o usuario no autorizado), interrumpe la ejecución de inmediato y devuelve el error con su código (401 o 403).
    if error_resp:
        return error_resp, status

    # Extrae el ID del comercio del token (garantizando aislamiento multi-tenant).
    negocio_id = payload.get("negocio_id")
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        cur.execute(
            """SELECT identificador, nombre_comercial, rubro, categoria_impositiva, fecha_registro 
               FROM auth.emprendimientos 
               WHERE id = %s""",
            (negocio_id,)
        )
        negocio = cur.fetchone() # Trae el único registro del comercio.
        # Si por algún motivo el ID no existiera, responde 404 Not Found.
        if not negocio:
            return jsonify({"status": "error", "mensaje": "Emprendimiento no encontrado"}), 404

        return jsonify({
            "status": "ok",
            "negocio": {
                "identificador": negocio['identificador'],
                "nombre_comercial": negocio['nombre_comercial'],
                "rubro": negocio['rubro'],
                "categoria_impositiva": negocio['categoria_impositiva'],
                "fecha_registro": negocio['fecha_registro'].isoformat() if negocio['fecha_registro'] else None
            }
        }), 200
    finally:
        cur.close()
        conn.close()


# Listar personal del negocio (GET /api/auth/personal)
@app.route('/api/auth/personal', methods=['GET'])
def listar_personal():
    """
    Devuelve la nómina de usuarios registrados dentro del tenant actual.
    Ordena por jerarquía (Propietario primero) y luego cronológicamente por id.
    """
    payload, error_resp, status = verificar_sesion_y_rol(roles_autorizados=['PROPIETARIO', 'ADMIN'])
    if error_resp:
        return error_resp, status

    negocio_id = payload.get("negocio_id")
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        # Ordena la lista con lógica jerárquica. Primero muestra al Propietario, debajo a los Administradores y al final a los Empleados/Cajeros.
        cur.execute(
            """SELECT id, usuario, correo, nombre, apellido, dni, rol, activo, fecha_creacion 
               FROM auth.usuarios 
               WHERE emprendimiento_id = %s 
               ORDER BY CASE rol 
                   WHEN 'PROPIETARIO' THEN 1 
                   WHEN 'ADMIN' THEN 2 
                   ELSE 3 
               END ASC, id ASC""",
            (negocio_id,)
        )
        # Trae la lista completa de empleados.
        usuarios = cur.fetchall()

        # Formateo compatible con el contrato de configuracion-personal.js
        resultado = []
        for u in usuarios:
            resultado.append({
                "id": u['id'],
                "usuario": u['usuario'],
                "correo": u['correo'],
                "nombre": u['nombre'] or "",
                "apellido": u['apellido'] or "",
                "dni": u['dni'],
                "rol": u['rol'],
                "activo": u['activo'],
                "fecha_creacion": u['fecha_creacion'].isoformat() if u['fecha_creacion'] else None
            })

        return jsonify({"status": "ok", "personal": resultado}), 200
    finally:
        cur.close()
        conn.close()

# Alta de personal (POST /api/auth/personal)
@app.route('/api/auth/personal', methods=['POST'])
def crear_personal():
    """
    Registra un nuevo miembro del equipo (Cajero o Administrador).
    Aplica las reglas acordadas:
    - Validación de contraseña segura (8-64 caracteres, mayús, minús, núm, símbolo).
    - Unicidad de 'usuario' y 'correo' dentro del mismo negocio.
    - Prohíbe crear usuarios con rol PROPIETARIO (solo hay uno por negocio).
    """
    payload, error_resp, status = verificar_sesion_y_rol(roles_autorizados=['PROPIETARIO', 'ADMIN'])
    if error_resp:
        return error_resp, status

    negocio_id = payload.get("negocio_id")
    datos = request.get_json(silent=True) or {}

    usuario = (datos.get('usuario') or '').strip().lower()
    correo = (datos.get('correo') or datos.get('email') or '').strip().lower()
    password = datos.get('password') or ''
    nombre = (datos.get('nombre') or '').strip()
    apellido = (datos.get('apellido') or '').strip()
    dni = (str(datos.get('dni') or '')).strip() or None
    rol = (datos.get('rol') or 'CAJERO').strip().upper()

    # Controles de negocio e integridad:
    # Validaciones obligatorias
    if not usuario or not correo or not password or not nombre or not apellido:
        return jsonify({"status": "error", "mensaje": "Todos los campos obligatorios deben estar completos"}), 400

    # No se puede crear otro PROPIETARIO
    if rol not in ['ADMIN', 'CAJERO']:
        return jsonify({"status": "error", "mensaje": "Rol inválido. Solo se pueden crear Administradores o Empleados"}), 400

    # Formato de usuario: minúsculas y números, 4 a 20 caracteres
    if not re.match(r'^[a-z0-9]{4,20}$', usuario):
        return jsonify({"status": "error", "mensaje": "El usuario debe tener entre 4 y 20 caracteres (solo letras minúsculas y números)"}), 400

    # Validación de contraseña fuerte según especificación OWASP
    if len(password) < 8 or len(password) > 64:
        return jsonify({"status": "error", "mensaje": "La contraseña debe tener entre 8 y 64 caracteres"}), 400
    if not re.search(r'[A-Z]', password) or not re.search(r'[a-z]', password) or not re.search(r'\d', password) or not re.search(r'[^A-Za-z0-9\s]', password):
        return jsonify({"status": "error", "mensaje": "La contraseña debe incluir al menos una mayúscula, una minúscula, un número y un símbolo especial"}), 400

    # Validación de DNI (opcional pero si viene debe ser de 7 u 8 dígitos)
    if dni and not re.match(r'^\d{7,8}$', dni):
        return jsonify({"status": "error", "mensaje": "El DNI debe tener 7 u 8 números sin puntos"}), 400

    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        # Verificar duplicados dentro del mismo comercio
        cur.execute(
            "SELECT id FROM auth.usuarios WHERE emprendimiento_id = %s AND (usuario = %s OR lower(correo) = %s)",
            (negocio_id, usuario, correo)
        )
        if cur.fetchone():
            return jsonify({"status": "error", "mensaje": "El nombre de usuario o correo ya está en uso en este negocio"}), 409

        # Guarda la versión cifrada irreversible de la clave. La base de datos nunca almacena contraseñas en texto plano.
        password_hash = generate_password_hash(password)

        cur.execute(
            """INSERT INTO auth.usuarios 
               (emprendimiento_id, usuario, correo, password_hash, nombre, apellido, dni, rol, activo)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, TRUE)
               RETURNING id, usuario, correo, nombre, apellido, rol, activo, fecha_creacion""",
            (negocio_id, usuario, correo, password_hash, nombre, apellido, dni, rol)
        )
        nuevo_usuario = cur.fetchone()
        conn.commit()

        return jsonify({
            "status": "ok",
            "mensaje": "Usuario creado exitosamente",
            "usuario": {
                "id": nuevo_usuario['id'],
                "usuario": nuevo_usuario['usuario'],
                "nombre": nuevo_usuario['nombre'],
                "apellido": nuevo_usuario['apellido'],
                "rol": nuevo_usuario['rol'],
                "activo": nuevo_usuario['activo'],
                "fecha_creacion": nuevo_usuario['fecha_creacion'].isoformat()
            }
        }), 201

    # Se dispara ante cualquier fallo inesperado durante la inserción en PostgreSQL (ej. caída de conexión, error de sintaxis SQL o timeout).
    except Exception as e:
        conn.rollback()
        return jsonify({"status": "error", "mensaje": f"Error al crear usuario: {str(e)}"}), 500
    finally:
        cur.close()
        conn.close()

# Edición de personal (PUT /api/auth/personal/<id>)
@app.route('/api/auth/personal/<int:usuario_id>', methods=['PUT'])
def actualizar_personal(usuario_id):
    """
    Actualiza datos de un usuario existente.
    - Propietario edita a todos; Admin solo edita Cajeros o a sí mismo.
    - El rol del Propietario no se puede modificar.
    - La contraseña es opcional: si viene vacía, no se altera.
    """
    payload, error_resp, status = verificar_sesion_y_rol(roles_autorizados=['PROPIETARIO', 'ADMIN'])
    if error_resp:
        return error_resp, status

    actor_id = payload.get("usuario_id")
    actor_rol = payload.get("rol")
    negocio_id = payload.get("negocio_id")
    datos = request.get_json(silent=True) or {}

    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        # Busca al usuario objetivo en la base de datos; si no existe, devuelve 404 Not Found.
        cur.execute("SELECT * FROM auth.usuarios WHERE id = %s AND emprendimiento_id = %s", (usuario_id, negocio_id))
        objetivo = cur.fetchone()
        if not objetivo:
            return jsonify({"status": "error", "mensaje": "Usuario no encontrado"}), 404

        # Reglas de permisos entre roles
        if actor_rol == 'ADMIN' and objetivo['rol'] in ['PROPIETARIO', 'ADMIN'] and actor_id != usuario_id:
            return jsonify({"status": "error", "mensaje": "Solo el Propietario puede editar a otros administradores"}), 403

        nombre = (datos.get('nombre') or objetivo['nombre']).strip()
        apellido = (datos.get('apellido') or objetivo['apellido']).strip()
        correo = (datos.get('correo') or objetivo['correo']).strip().lower()
        dni = (str(datos.get('dni') or '')).strip() or None
        nuevo_rol = datos.get('rol') or objetivo['rol']
        nueva_password = datos.get('password')

        # El rol del Propietario está blindado
        if objetivo['rol'] == 'PROPIETARIO' and nuevo_rol != 'PROPIETARIO':
            return jsonify({"status": "error", "mensaje": "No se puede cambiar el rol del Propietario"}), 400

        # Si se envía nueva contraseña, se valida.
        password_hash = objetivo['password_hash']
        if nueva_password and nueva_password.strip():
            if len(nueva_password) < 8 or len(nueva_password) > 64:
                return jsonify({"status": "error", "mensaje": "La nueva contraseña debe tener entre 8 y 64 caracteres"}), 400
            password_hash = generate_password_hash(nueva_password)

        cur.execute(
            """UPDATE auth.usuarios 
               SET nombre = %s, apellido = %s, correo = %s, dni = %s, rol = %s, password_hash = %s
               WHERE id = %s AND emprendimiento_id = %s
               RETURNING id, usuario, correo, nombre, apellido, rol, activo""",
            (nombre, apellido, correo, dni, nuevo_rol, password_hash, usuario_id, negocio_id)
        )
        conn.commit()

        return jsonify({"status": "ok", "mensaje": "Usuario actualizado correctamente"}), 200

    except Exception as e:
        conn.rollback()
        return jsonify({"status": "error", "mensaje": f"Error al actualizar: {str(e)}"}), 500
    finally:
        cur.close()
        conn.close()


# Habilitar / Deshabilitar usuario (PATCH)
@app.route('/api/auth/personal/<int:usuario_id>/habilitar', methods=['PATCH'])
def habilitar_usuario(usuario_id):
    payload, error_resp, status = verificar_sesion_y_rol(roles_autorizados=['PROPIETARIO', 'ADMIN'])
    if error_resp:
        return error_resp, status

    negocio_id = payload.get("negocio_id")
    conn = get_db_connection()
    cur = conn.cursor()

    try:
        cur.execute("UPDATE auth.usuarios SET activo = TRUE WHERE id = %s AND emprendimiento_id = %s", (usuario_id, negocio_id))
        conn.commit()
        return jsonify({"status": "ok", "mensaje": "Usuario habilitado correctamente"}), 200
    finally:
        cur.close()
        conn.close()


@app.route('/api/auth/personal/<int:usuario_id>/deshabilitar', methods=['PATCH'])
def deshabilitar_usuario(usuario_id):
    """
    Deshabilita el acceso de un usuario.
    Reglas críticas:
    - El Propietario no se puede deshabilitar.
    - No podés auto-deshabilitarte.
    - MOTIVO_ULTIMO_ADMIN: Debe quedar siempre al menos un Administrador activo.
    - Revoca inmediatamente todas las sesiones activas en tokens_bloqueados.
    """
    payload, error_resp, status = verificar_sesion_y_rol(roles_autorizados=['PROPIETARIO', 'ADMIN'])
    if error_resp:
        return error_resp, status

    actor_id = payload.get("usuario_id")
    actor_rol = payload.get("rol")
    negocio_id = payload.get("negocio_id")

    # Comprueba que la persona no esté intentando deshabilitar o eliminar su propia cuenta de usuario en sesión. 
    # Si un administrador pudiera auto-deshabilitarse, se bloquearía el acceso al panel a sí mismo.
    if actor_id == usuario_id:
        return jsonify({"status": "error", "mensaje": "No podés deshabilitar tu propia cuenta"}), 400

    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        cur.execute("SELECT id, rol, activo FROM auth.usuarios WHERE id = %s AND emprendimiento_id = %s", (usuario_id, negocio_id))
        objetivo = cur.fetchone()
        if not objetivo:
            return jsonify({"status": "error", "mensaje": "Usuario no encontrado"}), 404

        if objetivo['rol'] == 'PROPIETARIO':
            return jsonify({"status": "error", "mensaje": "El Propietario no puede ser deshabilitado"}), 400

        if actor_rol == 'ADMIN' and objetivo['rol'] == 'ADMIN':
            return jsonify({"status": "error", "mensaje": "Solo el Propietario puede gestionar a otros administradores"}), 403

        # Verificación de último Administrador activo
        # Cuenta cuántos administradores activos quedan en el negocio (COUNT(*)). 
        # Si el resultado es menor o igual a 1, devuelve 409 Conflict impidiendo la acción, porque el sistema nunca puede quedarse sin administradores.   
        if objetivo['rol'] in ['PROPIETARIO', 'ADMIN'] and objetivo['activo']:
            cur.execute(
                """SELECT COUNT(*) AS total 
                   FROM auth.usuarios 
                   WHERE emprendimiento_id = %s AND rol IN ('PROPIETARIO', 'ADMIN') AND activo = TRUE""",
                (negocio_id,)
            )
            total_admins = cur.fetchone()['total']
            if total_admins <= 1:
                return jsonify({"status": "error", "mensaje": "Siempre debe quedar al menos un administrador activo"}), 409

        # Deshabilitar usuario
        cur.execute("UPDATE auth.usuarios SET activo = FALSE WHERE id = %s", (usuario_id,))

        # Revocación de sesiones activas: invalidamos con un registro de bloqueo preventivo
        # Inserta un registro en auth.tokens_bloqueados asociado al usuario_id. De este modo, 
        # si ese empleado tenía la página abierta en su computadora, su token queda revocado y la próxima acción que intente hacer lo expulsará al login.
        expiracion = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=7)
        cur.execute(
            """INSERT INTO auth.tokens_bloqueados (jti, usuario_id, fecha_expiracion)
               VALUES (%s, %s, %s)
               ON CONFLICT (jti) DO NOTHING""",
            (f"revoked-user-{usuario_id}-{uuid.uuid4()}", usuario_id, expiracion)
        )

        conn.commit()
        return jsonify({"status": "ok", "mensaje": "Usuario deshabilitado y sesiones revocadas"}), 200

    finally:
        cur.close()
        conn.close()

# Eliminación de personal (DELETE /api/auth/personal/<id>)
@app.route('/api/auth/personal/<int:usuario_id>', methods=['DELETE'])
def eliminar_usuario(usuario_id):
    """
    Elimina físicamente las credenciales de acceso del usuario.
    Asegura que el nombre y las acciones históricas queden registradas intactas 
    en los movimientos y gastos (que guardan el nombre como texto independiente).
    """
    payload, error_resp, status = verificar_sesion_y_rol(roles_autorizados=['PROPIETARIO', 'ADMIN'])
    if error_resp:
        return error_resp, status

    actor_id = payload.get("usuario_id")
    actor_rol = payload.get("rol")
    negocio_id = payload.get("negocio_id")

    if actor_id == usuario_id:
        return jsonify({"status": "error", "mensaje": "No podés eliminar tu propia cuenta"}), 400

    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        cur.execute("SELECT id, rol, activo FROM auth.usuarios WHERE id = %s AND emprendimiento_id = %s", (usuario_id, negocio_id))
        objetivo = cur.fetchone()
        if not objetivo:
            return jsonify({"status": "error", "mensaje": "Usuario no encontrado"}), 404

        if objetivo['rol'] == 'PROPIETARIO':
            return jsonify({"status": "error", "mensaje": "El Propietario no puede ser eliminado"}), 400

        if actor_rol == 'ADMIN' and objetivo['rol'] == 'ADMIN':
            return jsonify({"status": "error", "mensaje": "Solo el Propietario puede eliminar a otros administradores"}), 403

        # Si era administrador activo, comprobar que no sea el último
        if objetivo['rol'] in ['PROPIETARIO', 'ADMIN'] and objetivo['activo']:
            cur.execute(
                """SELECT COUNT(*) AS total 
                   FROM auth.usuarios 
                   WHERE emprendimiento_id = %s AND rol IN ('PROPIETARIO', 'ADMIN') AND activo = TRUE""",
                (negocio_id,)
            )
            total_admins = cur.fetchone()['total']
            if total_admins <= 1:
                return jsonify({"status": "error", "mensaje": "Siempre debe quedar al menos un administrador activo"}), 409

        # Eliminación en base de datos
        cur.execute("DELETE FROM auth.usuarios WHERE id = %s AND emprendimiento_id = %s", (usuario_id, negocio_id))
        conn.commit()

        return jsonify({"status": "ok", "mensaje": "Usuario eliminado correctamente"}), 200

    except Exception as e:
        conn.rollback()
        return jsonify({"status": "error", "mensaje": f"Error al eliminar usuario: {str(e)}"}), 500
    finally:
        cur.close()
        conn.close()
#------------------------------------------------------------------------------------------------------------- ALDI.

if __name__ == '__main__':
    port = int(os.getenv("SERVICE_PORT", 5001))
    app.run(host='127.0.0.1', port=port, debug=True)