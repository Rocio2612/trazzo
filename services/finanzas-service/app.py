"""
PROYECTO TRAZZO - MICROSERVICIO DE FINANZAS (finanzas-service)
Puerto: 5004
Dominios:
  1. Medios de Pago (finanzas.medios_pago)
  2. Gastos Operativos (finanzas.gastos_operativos)
  3. Bienes de Uso (productos.productos WHERE tipo_producto = 'BIEN_DE_USO')
  4. Insumos y Consumos (productos.productos WHERE tipo_producto = 'BIEN_DE_GASTO')
"""
from flask import Flask, request, jsonify
import os
import datetime
import math
import jwt
import psycopg2
from psycopg2.extras import RealDictCursor
from flask_cors import CORS
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
CORS(app)

@app.route('/api/finanzas/health', methods=['GET'])
def health():
    return jsonify({"status": "ok", "service": "finanzas-service"}), 200

# Toma la clave del archivo .env creado por cada una.
SECRET_KEY = os.getenv("JWT_SECRET")

# Configuración de zona horaria oficial de Argentina (UTC-3) para validar fechas de calendario
# sin sufrir desfases cuando en el servidor UTC ya pasó la medianoche.
try:
    from zoneinfo import ZoneInfo
    TZ_ARGENTINA = ZoneInfo("America/Argentina/Buenos_Aires")
except Exception:
    TZ_ARGENTINA = datetime.timezone(datetime.timedelta(hours=-3))


def hoy_argentina():
    """Retorna la fecha de hoy en la zona horaria oficial de Argentina (YYYY-MM-DD)."""
    return datetime.datetime.now(TZ_ARGENTINA).date()


def formatear_utc_z(dt):
    """
    Convierte un objeto datetime de PostgreSQL a formato estándar ISO 8601 UTC terminado en 'Z'
    (ej. '2026-11-10T18:00:57Z'). Permite que el navegador convierta la hora a la zona local del usuario.
    """
    if not dt:
        return None
    if dt.tzinfo is not None:
        dt = dt.astimezone(datetime.timezone.utc)
    return dt.strftime('%Y-%m-%dT%H:%M:%SZ')


def get_db_connection(db_name=None):
    """
    Abre una conexión TCP física contra la base de datos específica del emprendimiento en sesión.
    """
    base_destino = db_name or os.getenv("DB_NAME")
    return psycopg2.connect(
        host=os.getenv("DB_HOST", "127.0.0.1"),
        database=base_destino,
        user=os.getenv("DB_USER", "postgres"),
        password=os.getenv("DB_PASSWORD"),
        port=os.getenv("DB_PORT", "5432"),
        options="-c search_path=finanzas,productos,public"
    )

# Validación de Identidad y Roles (verificar_token)
def verificar_token(roles_permitidos=None):
    """
    Valida el token JWT simétrico de la cabecera Authorization.
    Aisla la operación recuperando el 'negocio_id' y 'db_name' del token,y aplica RBAC según el rol.
    """
    auth_header = request.headers.get('Authorization')
    if not auth_header or not auth_header.startswith('Bearer '):
        return None, jsonify({"status": "error", "mensaje": "Token no proporcionado"}), 401

    token = auth_header.split(" ")[1]
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
        # Verificamos que el token contenga la base de datos física asignada al negocio
        if not payload.get("db_name"):
            return None, jsonify({"status": "error", "mensaje": "Token sin base de datos asignada. Inicie sesión nuevamente."}), 401

        rol = payload.get("rol")
        if roles_permitidos and rol not in roles_permitidos:
            return None, jsonify({"status": "error", "mensaje": "Acceso denegado para su rol"}), 403
        return payload, None, 200
    
    except jwt.ExpiredSignatureError:
        return None, jsonify({"status": "error", "mensaje": "Sesión expirada"}), 401
    except jwt.InvalidTokenError:
        return None, jsonify({"status": "error", "mensaje": "Token inválido"}), 401

def calcular_costo_neto_compra(monto_total, iva_alicuota, cat_negocio, cat_proveedor):
    """
    Calcula el costo neto de una compra resolviendo el crédito fiscal de IVA:
    - Si el comprador es RI y el proveedor es RI, deduce el IVA del costo (crédito fiscal).
    - En cualquier otro escenario (Monotributo, Exento, etc.), el IVA queda adentro del costo.
    """
    if cat_negocio == 'RESPONSABLE_INSCRIPTO' and cat_proveedor == 'RESPONSABLE_INSCRIPTO':
        return round(float(monto_total) / (1.0 + (float(iva_alicuota) / 100.0)), 4)
    return round(float(monto_total), 4)

# GESTIÓN DE MEDIOS DE PAGO (finanzas.medios_pago)
# Listar Medios de Pago (GET /api/medios-pago)
@app.route('/api/medios-pago', methods=['GET'])
def listar_medios_pago():
    """
    Retorna la lista de medios de pago activos del comercio.
    Accesible para Administrador y Cajero (para poblar desplegables de cobro/gasto).
    """
    payload, error_resp, status = verificar_token()
    if error_resp:
        return error_resp, status

    negocio_id = payload.get("negocio_id")
    conn = get_db_connection(payload.get("db_name"))
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # Verificamos primero por la bandera es_predeterminado = TRUE. De este modo, si el usuario le renombró
        # "Efectivo" a "Efectivo Caja", no se vuelve a insertar un segundo "Efectivo" duplicado.
        cur.execute(
            "SELECT id FROM finanzas.medios_pago WHERE emprendimiento_id = %s AND es_predeterminado = TRUE LIMIT 1",
            (negocio_id,)
        )
        if not cur.fetchone():
            # Aseguramos que el comercio tenga al menos "Efectivo" creado por defecto.
            # El ON CONFLICT (emprendimiento_id, lower(nombre)) DO NOTHING aprovecha el índice único de la tabla; si el registro ya existe, la base ignora la inserción sin lanzar errores.
            cur.execute(
                """INSERT INTO finanzas.medios_pago (emprendimiento_id, nombre, es_predeterminado, activo)
                   VALUES (%s, 'Efectivo', TRUE, TRUE)
                   ON CONFLICT (emprendimiento_id, lower(nombre)) DO NOTHING""",
                (negocio_id,)
            )
            conn.commit()

        # Obtenemos todos los medios de pago activos ordenados con el predeterminado primero
        cur.execute(
            """SELECT id, nombre, es_predeterminado 
               FROM finanzas.medios_pago 
               WHERE emprendimiento_id = %s AND activo = TRUE 
               ORDER BY es_predeterminado DESC, nombre ASC""",
            (negocio_id,)
        )
        medios = cur.fetchall()
        return jsonify({"status": "ok", "medios_pago": medios}), 200
    finally:
        cur.close()
        conn.close()


# Alta de Medio de Pago (POST /api/medios-pago)
@app.route('/api/medios-pago', methods=['POST'])
def crear_medio_pago():
    """
    Alta de un nuevo medio de pago (solo Propietario o Admin).
    Si el nombre coincide con un medio que había sido eliminado lógicamente (activo = FALSE),
    lo reactiva automáticamente (activo = TRUE) respetando el índice único uq_medio_pago_nombre_tenant.
    """
    payload, error_resp, status = verificar_token(roles_permitidos=['PROPIETARIO', 'ADMIN'])
    if error_resp:
        return error_resp, status

    negocio_id = payload.get("negocio_id")
    datos = request.get_json(silent=True) or {}
    nombre = (datos.get('nombre') or '').strip()

    if not nombre:
        return jsonify({
            "status": "error",
            "mensaje": "El nombre del medio de pago es obligatorio",
            "errores": {"nombre": "El nombre es obligatorio."}
        }), 400
    if len(nombre) > 50:
        return jsonify({
            "status": "error",
            "mensaje": "El nombre no puede superar los 50 caracteres",
            "errores": {"nombre": "El nombre no puede superar los 50 caracteres."}
        }), 400

    conn = get_db_connection(payload.get("db_name"))
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # Buscamos si existe en la tabla (activo o desactivado) por la restricción uq_medio_pago_nombre_tenant
        cur.execute(
            "SELECT id, activo FROM finanzas.medios_pago WHERE emprendimiento_id = %s AND lower(nombre) = lower(%s)",
            (negocio_id, nombre)
        )
        existente = cur.fetchone()

        if existente:
            if existente['activo']:
                # Si ya está activo, respondemos 409 indicando el campo 'nombre'
                return jsonify({
                    "status": "error",
                    "mensaje": "Ya existe un medio de pago con ese nombre",
                    "errores": {"nombre": "Ya existe un medio de pago con ese nombre."}
                }), 409
            else:
                # Si estaba desactivado por un borrado lógico anterior, lo reactivamos en lugar de duplicar fila
                cur.execute(
                    """UPDATE finanzas.medios_pago 
                       SET activo = TRUE, nombre = %s 
                       WHERE id = %s 
                       RETURNING id, nombre, es_predeterminado""",
                    (nombre, existente['id'])
                )
                reactivado = cur.fetchone()
                conn.commit()
                return jsonify({"status": "ok", "mensaje": "Medio de pago creado", "medio_pago": reactivado}), 201

        cur.execute(
            """INSERT INTO finanzas.medios_pago (emprendimiento_id, nombre, es_predeterminado, activo)
               VALUES (%s, %s, FALSE, TRUE)
               RETURNING id, nombre, es_predeterminado""",
            (negocio_id, nombre)
        )
        nuevo = cur.fetchone()
        conn.commit()
        return jsonify({"status": "ok", "mensaje": "Medio de pago creado", "medio_pago": nuevo}), 201
    
    except psycopg2.IntegrityError:
        conn.rollback()
        return jsonify({
            "status": "error",
            "mensaje": "Ya existe un medio de pago con ese nombre",
            "errores": {"nombre": "Ya existe un medio de pago con ese nombre."}
        }), 409
    finally:
        cur.close()
        conn.close()


# Actualizar medios de pagos (PUT /api/medios-pago/<id>)
@app.route('/api/medios-pago/<int:medio_id>', methods=['PUT'])
def actualizar_medio_pago(medio_id):
    """
    Actualiza el nombre de un medio de pago.
    Bloquea con 409 (indicando el campo 'nombre') si coincide con otro medio activo
    o con uno que fue eliminado anteriormente (para no mezclar historiales de distintos IDs).
    """
    payload, error_resp, status = verificar_token(roles_permitidos=['PROPIETARIO', 'ADMIN'])
    if error_resp:
        return error_resp, status

    negocio_id = payload.get("negocio_id")
    datos = request.get_json(silent=True) or {}
    nuevo_nombre = (datos.get('nombre') or '').strip()

    if not nuevo_nombre:
        return jsonify({
            "status": "error",
            "mensaje": "El nombre es obligatorio",
            "errores": {"nombre": "El nombre es obligatorio."}
        }), 400
    if len(nuevo_nombre) > 50:
        return jsonify({
            "status": "error",
            "mensaje": "El nombre no puede superar los 50 caracteres",
            "errores": {"nombre": "El nombre no puede superar los 50 caracteres."}
        }), 400

    conn = get_db_connection(payload.get("db_name"))
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # Comprobamos si el nuevo nombre choca con otro registro (activo o desactivado) de este comercio
        cur.execute(
            """SELECT id, activo FROM finanzas.medios_pago 
               WHERE emprendimiento_id = %s AND lower(nombre) = lower(%s) AND id != %s""",
            (negocio_id, nuevo_nombre, medio_id)
        )
        conflicto = cur.fetchone()
        if conflicto:
            if conflicto['activo']:
                msg = "Ya existe otro medio de pago con ese nombre."
            else:
                msg = "Ese nombre pertenece a un medio de pago eliminado anteriormente. Crealo como nuevo para volver a habilitarlo."
            return jsonify({
                "status": "error",
                "mensaje": msg,
                "errores": {"nombre": msg}
            }), 409

        cur.execute(
            """UPDATE finanzas.medios_pago 
               SET nombre = %s 
               WHERE id = %s AND emprendimiento_id = %s AND activo = TRUE
               RETURNING id, nombre, es_predeterminado""",
            (nuevo_nombre, medio_id, negocio_id)
        )
        actualizado = cur.fetchone()
        if not actualizado:
            return jsonify({"status": "error", "mensaje": "Medio de pago no encontrado"}), 404
        conn.commit()
        return jsonify({"status": "ok", "mensaje": "Medio de pago actualizado", "medio_pago": actualizado}), 200
    except psycopg2.IntegrityError:
        conn.rollback()
        return jsonify({
            "status": "error",
            "mensaje": "Ya existe otro medio de pago con ese nombre",
            "errores": {"nombre": "Ya existe otro medio de pago con ese nombre."}
        }), 409
    finally:
        cur.close()
        conn.close()


# Eliminación con preservación contable (DELETE /api/medios-pago/<id>)
@app.route('/api/medios-pago/<int:medio_id>', methods=['DELETE'])
def eliminar_medio_pago(medio_id):
    """
    Elimina un medio de pago.
    Regla: 'Efectivo' (es_predeterminado) nunca puede ser eliminado.
    Si ya fue utilizado en gastos, se realiza borrado lógico (activo = FALSE) para conservar historial.
    """
    payload, error_resp, status = verificar_token(roles_permitidos=['PROPIETARIO', 'ADMIN'])
    if error_resp:
        return error_resp, status

    negocio_id = payload.get("negocio_id")
    conn = get_db_connection(payload.get("db_name"))
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("SELECT id, es_predeterminado FROM finanzas.medios_pago WHERE id = %s AND emprendimiento_id = %s", (medio_id, negocio_id))
        medio = cur.fetchone()
        if not medio:
            return jsonify({"status": "error", "mensaje": "Medio de pago no encontrado"}), 404

        if medio['es_predeterminado']:
            return jsonify({"status": "error", "mensaje": "El medio de pago Efectivo no puede eliminarse"}), 400

        # Verificamos si ya fue utilizado en gastos operativos
        cur.execute("SELECT COUNT(*) AS total FROM finanzas.gastos_operativos WHERE medio_pago_id = %s", (medio_id,))
        en_uso = cur.fetchone()['total'] > 0

        if en_uso:
            # Borrado lógico para mantener la auditoría contable:
            # Si el medio ya fue utilizado en gastos registrados previamente, 
            # no se puede borrar de forma física porque rompería la integridad referencial y distorsionaría los balances históricos. 
            # Al desactivarlo, deja de aparecer en los selectores futuros pero se preserva en los reportes.
            cur.execute("UPDATE finanzas.medios_pago SET activo = FALSE WHERE id = %s", (medio_id,))
        else:
            # Borrado físico si no tiene transacciones asociadas:
            # Si fue creado por error y no tiene ningún movimiento asociado, 
            # se elimina físicamente de la tabla para mantener la base limpia.
            cur.execute("DELETE FROM finanzas.medios_pago WHERE id = %s", (medio_id,))

        conn.commit()
        return jsonify({"status": "ok", "mensaje": "Medio de pago eliminado exitosamente"}), 200
    finally:
        cur.close()
        conn.close()

# GESTIÓN DE CATEGORÍAS DE PRODUCTOS (productos.categorias) 
# Listar Categorías (GET /api/categorias)
@app.route('/api/categorias', methods=['GET'])
@app.route('/api/finanzas/categorias', methods=['GET'])
def listar_categorias():
    """
    Retorna la lista de categorías activas del negocio ordenadas alfabéticamente.
    - Accesible para PROPIETARIO, ADMIN y CAJERO (el Cajero la necesita para el selector de Productos).
    - A diferencia de Medios de Pago, NO crea registros por defecto: si el comercio no tiene categorías,
      devuelve una lista vacía ([]) para que el Frontend muestre 'Sin categorías' según CU-09.
    """
    payload, error_resp, status = verificar_token()
    if error_resp:
        return error_resp, status

    negocio_id = payload.get("negocio_id")
    conn = get_db_connection(payload.get("db_name"))
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # Filtra estrictamente por emprendimiento_id (aislamiento multi-tenant) y activo = TRUE
        cur.execute(
            """SELECT id, nombre
               FROM productos.categorias
               WHERE emprendimiento_id = %s AND activo = TRUE
               ORDER BY nombre ASC""",
            (negocio_id,)
        )
        categorias = cur.fetchall()
        return jsonify({"status": "ok", "categorias": categorias}), 200
    finally:
        cur.close()
        conn.close()


# Alta de Categoría (POST /api/categorias)
@app.route('/api/categorias', methods=['POST'])
@app.route('/api/finanzas/categorias', methods=['POST'])
def crear_categoria():
    """
    Crea una nueva categoría de productos (exclusivo para PROPIETARIO o ADMIN).
    - Valida nombre obligatorio y longitud máxima de 50 caracteres.
    - Controla unicidad por negocio (insensible a mayúsculas/minúsculas).
    - Si existía una categoría con ese nombre pero estaba oculta/desactivada (activo = FALSE),
      la reactiva automáticamente (activo = TRUE) sin duplicar filas en PostgreSQL.
    """
    payload, error_resp, status = verificar_token(roles_permitidos=['PROPIETARIO', 'ADMIN'])
    if error_resp:
        return error_resp, status

    negocio_id = payload.get("negocio_id")
    datos = request.get_json(silent=True) or {}
    nombre = (datos.get('nombre') or '').strip()

    # Validaciones de formato devolviendo diccionario 'errores' por campo para el Frontend
    if not nombre:
        return jsonify({
            "status": "error",
            "mensaje": "El nombre de la categoría es obligatorio",
            "errores": {"nombre": "El nombre es obligatorio."}
        }), 400
    if len(nombre) > 50:
        return jsonify({
            "status": "error",
            "mensaje": "El nombre no puede superar los 50 caracteres",
            "errores": {"nombre": "El nombre no puede superar los 50 caracteres."}
        }), 400

    conn = get_db_connection(payload.get("db_name"))
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # Comprobamos si ya existe en la tabla (activa o desactivada) dentro del mismo comercio
        cur.execute(
            """SELECT id, activo FROM productos.categorias
               WHERE emprendimiento_id = %s AND lower(nombre) = lower(%s)""",
            (negocio_id, nombre)
        )
        existente = cur.fetchone()

        if existente:
            if existente['activo']:
                # Si ya está vigente, bloqueamos con 409 Conflict indicando el campo exacto
                return jsonify({
                    "status": "error",
                    "mensaje": "Ya existe una categoría con ese nombre",
                    "errores": {"nombre": "Ya existe una categoría con ese nombre."}
                }), 409
            else:
                # Si había sido retirada lógicamente porque tenía productos históricos, la reactivamos
                cur.execute(
                    """UPDATE productos.categorias
                       SET activo = TRUE, nombre = %s
                       WHERE id = %s
                       RETURNING id, nombre""",
                    (nombre, existente['id'])
                )
                reactivada = cur.fetchone()
                conn.commit()
                return jsonify({"status": "ok", "mensaje": "Categoría creada", "categoria": reactivada}), 201

        # Inserción limpia de la nueva categoría
        cur.execute(
            """INSERT INTO productos.categorias (emprendimiento_id, nombre, activo)
               VALUES (%s, %s, TRUE)
               RETURNING id, nombre""",
            (negocio_id, nombre)
        )
        nueva = cur.fetchone()
        conn.commit()
        return jsonify({"status": "ok", "mensaje": "Categoría creada", "categoria": nueva}), 201

    except psycopg2.IntegrityError:
        conn.rollback()
        return jsonify({
            "status": "error",
            "mensaje": "Ya existe una categoría con ese nombre",
            "errores": {"nombre": "Ya existe una categoría con ese nombre."}
        }), 409
    finally:
        cur.close()
        conn.close()


# Edición de Categoría (PUT /api/categorias/<id>)
@app.route('/api/categorias/<int:categoria_id>', methods=['PUT'])
@app.route('/api/finanzas/categorias/<int:categoria_id>', methods=['PUT'])
def actualizar_categoria(categoria_id):
    """
    Actualiza el nombre de una categoría existente (exclusivo para PROPIETARIO o ADMIN).
    Verifica que el nuevo nombre no colisione con otra categoría del mismo comercio.
    """
    payload, error_resp, status = verificar_token(roles_permitidos=['PROPIETARIO', 'ADMIN'])
    if error_resp:
        return error_resp, status

    negocio_id = payload.get("negocio_id")
    datos = request.get_json(silent=True) or {}
    nuevo_nombre = (datos.get('nombre') or '').strip()

    if not nuevo_nombre:
        return jsonify({
            "status": "error",
            "mensaje": "El nombre es obligatorio",
            "errores": {"nombre": "El nombre es obligatorio."}
        }), 400
    if len(nuevo_nombre) > 50:
        return jsonify({
            "status": "error",
            "mensaje": "El nombre no puede superar los 50 caracteres",
            "errores": {"nombre": "El nombre no puede superar los 50 caracteres."}
        }), 400

    conn = get_db_connection(payload.get("db_name"))
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # Verificamos si otro registro del mismo comercio ya utiliza ese nombre
        cur.execute(
            """SELECT id, activo FROM productos.categorias
               WHERE emprendimiento_id = %s AND lower(nombre) = lower(%s) AND id != %s""",
            (negocio_id, nuevo_nombre, categoria_id)
        )
        conflicto = cur.fetchone()
        if conflicto:
            if conflicto['activo']:
                msg = "Ya existe otra categoría con ese nombre."
            else:
                msg = "Ese nombre pertenece a una categoría eliminada anteriormente. Creala como nueva para volver a habilitarla."
            return jsonify({
                "status": "error",
                "mensaje": msg,
                "errores": {"nombre": msg}
            }), 409

        cur.execute(
            """UPDATE productos.categorias
               SET nombre = %s
               WHERE id = %s AND emprendimiento_id = %s AND activo = TRUE
               RETURNING id, nombre""",
            (nuevo_nombre, categoria_id, negocio_id)
        )
        actualizada = cur.fetchone()
        if not actualizada:
            return jsonify({"status": "error", "mensaje": "Categoría no encontrada"}), 404

        conn.commit()
        return jsonify({"status": "ok", "mensaje": "Categoría actualizada", "categoria": actualizada}), 200

    except psycopg2.IntegrityError:
        conn.rollback()
        return jsonify({
            "status": "error",
            "mensaje": "Ya existe otra categoría con ese nombre",
            "errores": {"nombre": "Ya existe otra categoría con ese nombre."}
        }), 409
    finally:
        cur.close()
        conn.close()


# Eliminación con preservación histórica (DELETE /api/categorias/<id>)
@app.route('/api/categorias/<int:categoria_id>', methods=['DELETE'])
@app.route('/api/finanzas/categorias/<int:categoria_id>', methods=['DELETE'])
def eliminar_categoria(categoria_id):
    """
    Elimina una categoría respetando la regla de integridad histórica del Módulo 3.3 (CU-09):
    - Si tiene productos asociados (activos u ocultos), aplica borrado lógico (activo = FALSE):
      deja de aparecer en los desplegables para productos nuevos, pero los productos anteriores
      conservan su referencia histórica sin romperse.
    - Si nunca fue asociada a ningún producto, se elimina físicamente (DELETE) de la base.
    """
    payload, error_resp, status = verificar_token(roles_permitidos=['PROPIETARIO', 'ADMIN'])
    if error_resp:
        return error_resp, status

    negocio_id = payload.get("negocio_id")
    conn = get_db_connection(payload.get("db_name"))
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # Verificamos pertenencia al negocio (aislamiento multi-tenant)
        cur.execute(
            "SELECT id FROM productos.categorias WHERE id = %s AND emprendimiento_id = %s",
            (categoria_id, negocio_id)
        )
        if not cur.fetchone():
            return jsonify({"status": "error", "mensaje": "Categoría no encontrada"}), 404

        # Consultamos si algún artículo en productos.productos tiene asignada esta categoría
        cur.execute(
            "SELECT COUNT(*) AS total FROM productos.productos WHERE categoria_id = %s AND emprendimiento_id = %s",
            (categoria_id, negocio_id)
        )
        en_uso = cur.fetchone()['total'] > 0

        if en_uso:
            # Borrado lógico: mantiene intacta la referencia en productos existentes
            cur.execute("UPDATE productos.categorias SET activo = FALSE WHERE id = %s", (categoria_id,))
        else:
            # Borrado físico: limpia el registro sin uso de la tabla
            cur.execute("DELETE FROM productos.categorias WHERE id = %s", (categoria_id,))

        conn.commit()
        return jsonify({"status": "ok", "mensaje": "Categoría eliminada exitosamente"}), 200
    finally:
        cur.close()
        conn.close()

# GESTIÓN DE GASTOS OPERATIVOS (finanzas.gastos_operativos)
@app.route('/api/gastos', methods=['GET'])
def listar_gastos():
    """
    Lista los gastos operativos del negocio con filtrado opcional por período (?desde=YYYY-MM-DD&hasta=YYYY-MM-DD)
    y búsqueda opcional por texto (?q=...).
    Calcula la sumatoria total en tiempo real mediante suma dinámica (nunca persistida fija).
    """
    payload, error_resp, status = verificar_token(roles_permitidos=['PROPIETARIO', 'ADMIN'])
    if error_resp:
        return error_resp, status

    negocio_id = payload.get("negocio_id")
    fecha_desde = request.args.get('desde')
    fecha_hasta = request.args.get('hasta')
    busqueda_q = (request.args.get('q') or '').strip()

    conn = get_db_connection(payload.get("db_name"))
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # LEFT JOIN con Medios de Pago: Vincula el nombre del medio utilizado sin filtrar por activo = TRUE,
        # para que los gastos históricos sigan mostrando el nombre aunque el medio se haya desactivado después.
        # Incluye también modificado_por y modificado_en para la auditoría del Frontend.
        query = """
            SELECT g.id, g.fecha, g.concepto, g.monto, g.medio_pago_id, 
                   m.nombre AS medio_pago_nombre, 
                   g.creado_por, g.creado_en, g.modificado_por, g.modificado_en
            FROM finanzas.gastos_operativos g
            LEFT JOIN finanzas.medios_pago m ON g.medio_pago_id = m.id
            WHERE g.emprendimiento_id = %s AND g.activo = TRUE
        """
        params = [negocio_id]

        if fecha_desde:
            query += " AND g.fecha >= %s"
            params.append(fecha_desde)
        if fecha_hasta:
            query += " AND g.fecha <= %s"
            params.append(fecha_hasta)
        if busqueda_q:
            # Filtro parcial insensible a mayúsculas/minúsculas sobre concepto o nombre del medio de pago
            query += " AND (g.concepto ILIKE %s OR m.nombre ILIKE %s)"
            patron = f"%{busqueda_q}%"
            params.extend([patron, patron])

        query += " ORDER BY g.fecha DESC, g.id DESC"
        cur.execute(query, tuple(params))
        gastos = cur.fetchall()

        # Cálculo dinámico de sumatoria total del período consultado:
        # Las sumatorias nunca se persisten de forma fija en la base de datos para evitar desfasajes ante modificaciones o bajas de comprobantes.
        total_acumulado = sum(float(g['monto']) for g in gastos)

        # Formateo de fechas (fecha en YYYY-MM-DD y marcas de auditoría en ISO 8601 UTC con 'Z')
        for g in gastos:
            g['fecha'] = g['fecha'].isoformat()
            g['monto'] = float(g['monto'])
            g['creado_en'] = formatear_utc_z(g['creado_en'])
            g['modificado_en'] = formatear_utc_z(g['modificado_en'])

        return jsonify({
            "status": "ok",
            "gastos": gastos,
            "resumen": {
                "total_gastos": round(total_acumulado, 2),
                "cantidad_operaciones": len(gastos)
            }
        }), 200
    finally:
        cur.close()
        conn.close()


# Registro de gasto (POST /api/gastos)
@app.route('/api/gastos', methods=['POST'])
def registrar_gasto():
    """
    Registra un nuevo gasto operativo.
    Valida fecha no futura contra la hora local de Argentina (evita falsos rechazos a medianoche)
    y devuelve errores discriminados por campo bajo la clave 'errores'.
    """
    payload, error_resp, status = verificar_token(roles_permitidos=['PROPIETARIO', 'ADMIN'])
    if error_resp:
        return error_resp, status

    negocio_id = payload.get("negocio_id")
    creador = payload.get("usuario", "admin")
    datos = request.get_json(silent=True) or {}

    concepto = (datos.get('concepto') or '').strip()
    fecha_str = datos.get('fecha')
    medio_pago_id = datos.get('medio_pago_id')

    errores = {}
    if not concepto:
        errores['concepto'] = "El concepto del gasto es obligatorio."

    try:
        monto = float(datos.get('monto') or 0)
        if monto <= 0:
            errores['monto'] = "El monto del gasto debe ser mayor a cero."
    except (ValueError, TypeError):
        monto = 0
        errores['monto'] = "El monto debe ser un número válido."

    # Validación de fecha (por defecto hoy en hora Argentina, no admite fechas futuras)
    # Regla fiscal y temporal: La base contiene la restricción chk_gasto_fecha_no_futura CHECK (fecha <= CURRENT_DATE).
    hoy_local = hoy_argentina()
    if fecha_str:
        try:
            fecha_gasto = datetime.date.fromisoformat(str(fecha_str).strip())
            if fecha_gasto > hoy_local:
                errores['fecha'] = "No se pueden registrar gastos con fecha futura."
        except ValueError:
            fecha_gasto = None
            errores['fecha'] = "Formato de fecha inválido (use YYYY-MM-DD)."
    else:
        fecha_gasto = hoy_local

    if errores:
        return jsonify({
            "status": "error",
            "mensaje": "Error de validación en los datos del gasto",
            "errores": errores
        }), 400

    conn = get_db_connection(payload.get("db_name"))
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # Usamos una CTE (WITH insertado) para insertar y devolver inmediatamente el nombre del medio de pago
        cur.execute(
            """WITH insertado AS (
                   INSERT INTO finanzas.gastos_operativos 
                   (emprendimiento_id, medio_pago_id, fecha, concepto, monto, creado_por, activo)
                   VALUES (%s, %s, %s, %s, %s, %s, TRUE)
                   RETURNING *
               )
               SELECT i.id, i.fecha, i.concepto, i.monto, i.medio_pago_id,
                      m.nombre AS medio_pago_nombre,
                      i.creado_por, i.creado_en, i.modificado_por, i.modificado_en
               FROM insertado i
               LEFT JOIN finanzas.medios_pago m ON i.medio_pago_id = m.id""",
            (negocio_id, medio_pago_id, fecha_gasto, concepto, monto, creador)
        )
        nuevo_gasto = cur.fetchone()
        conn.commit()

        nuevo_gasto['fecha'] = nuevo_gasto['fecha'].isoformat()
        nuevo_gasto['monto'] = float(nuevo_gasto['monto'])
        nuevo_gasto['creado_en'] = formatear_utc_z(nuevo_gasto['creado_en'])
        nuevo_gasto['modificado_en'] = formatear_utc_z(nuevo_gasto['modificado_en'])

        return jsonify({"status": "ok", "mensaje": "Gasto registrado exitosamente", "gasto": nuevo_gasto}), 201
    finally:
        cur.close()
        conn.close()


# Edición de gasto (PUT /api/gastos/<id>)
@app.route('/api/gastos/<int:gasto_id>', methods=['PUT'])
def actualizar_gasto(gasto_id):
    """
    Edita un gasto operativo existente (fecha, concepto, monto y medio_pago_id).
    - Si no se envía medio_pago_id, conserva el que tenía (incluso si ese medio fue desactivado después).
    - Asienta automáticamente la auditoría en modificado_por y modificado_en.
    """
    payload, error_resp, status = verificar_token(roles_permitidos=['PROPIETARIO', 'ADMIN'])
    if error_resp:
        return error_resp, status

    negocio_id = payload.get("negocio_id")
    editor = payload.get("usuario", "admin")
    datos = request.get_json(silent=True) or {}

    conn = get_db_connection(payload.get("db_name"))
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # Verificamos que el gasto exista y pertenezca al comercio del token
        cur.execute(
            "SELECT * FROM finanzas.gastos_operativos WHERE id = %s AND emprendimiento_id = %s AND activo = TRUE",
            (gasto_id, negocio_id)
        )
        actual = cur.fetchone()
        if not actual:
            return jsonify({"status": "error", "mensaje": "Gasto no encontrado"}), 404

        concepto = (datos.get('concepto') if 'concepto' in datos else actual['concepto'] or '').strip()
        fecha_str = datos.get('fecha') if 'fecha' in datos else actual['fecha'].isoformat()
        medio_pago_id = datos.get('medio_pago_id') if 'medio_pago_id' in datos else actual['medio_pago_id']

        errores = {}
        if not concepto:
            errores['concepto'] = "El concepto del gasto es obligatorio."

        try:
            monto_raw = datos.get('monto') if 'monto' in datos else actual['monto']
            monto = float(monto_raw or 0)
            if monto <= 0:
                errores['monto'] = "El monto del gasto debe ser mayor a cero."
        except (ValueError, TypeError):
            monto = 0
            errores['monto'] = "El monto debe ser un número válido."

        hoy_local = hoy_argentina()
        try:
            fecha_gasto = datetime.date.fromisoformat(str(fecha_str).strip())
            if fecha_gasto > hoy_local:
                errores['fecha'] = "No se pueden registrar gastos con fecha futura."
        except ValueError:
            fecha_gasto = None
            errores['fecha'] = "Formato de fecha inválido (use YYYY-MM-DD)."

        if errores:
            return jsonify({
                "status": "error",
                "mensaje": "Error de validación en los datos del gasto",
                "errores": errores
            }), 400

        # Actualiza el registro, asienta auditoría (modificado_por, modificado_en) y devuelve datos completos
        cur.execute(
            """WITH actualizado AS (
                   UPDATE finanzas.gastos_operativos
                   SET fecha = %s, concepto = %s, monto = %s, medio_pago_id = %s,
                       modificado_por = %s, modificado_en = CURRENT_TIMESTAMP
                   WHERE id = %s AND emprendimiento_id = %s
                   RETURNING *
               )
               SELECT a.id, a.fecha, a.concepto, a.monto, a.medio_pago_id,
                      m.nombre AS medio_pago_nombre,
                      a.creado_por, a.creado_en, a.modificado_por, a.modificado_en
               FROM actualizado a
               LEFT JOIN finanzas.medios_pago m ON a.medio_pago_id = m.id""",
            (fecha_gasto, concepto, monto, medio_pago_id, editor, gasto_id, negocio_id)
        )
        gasto_editado = cur.fetchone()
        conn.commit()

        gasto_editado['fecha'] = gasto_editado['fecha'].isoformat()
        gasto_editado['monto'] = float(gasto_editado['monto'])
        gasto_editado['creado_en'] = formatear_utc_z(gasto_editado['creado_en'])
        gasto_editado['modificado_en'] = formatear_utc_z(gasto_editado['modificado_en'])

        return jsonify({
            "status": "ok",
            "mensaje": "Gasto actualizado correctamente",
            "gasto": gasto_editado
        }), 200
    finally:
        cur.close()
        conn.close()


# Eliminación definitiva (DELETE /api/gastos/<id>)
@app.route('/api/gastos/<int:gasto_id>', methods=['DELETE'])
def eliminar_gasto(gasto_id):
    """
    Eliminación directa de un gasto tras confirmación del usuario.
    A diferencia de las entidades transaccionales de inventario, 
    los gastos operativos no manejan stock ni generan registros en cascada. 
    Por diseño del sistema, se eliminan físicamente tras la confirmación del usuario.
    """
    payload, error_resp, status = verificar_token(roles_permitidos=['PROPIETARIO', 'ADMIN'])
    if error_resp:
        return error_resp, status

    negocio_id = payload.get("negocio_id")
    conn = get_db_connection(payload.get("db_name"))
    cur = conn.cursor()
    try:
        # La cláusula AND emprendimiento_id = %s asegura que ningún usuario pueda eliminar registros de otro comercio modificando el ID en la URL. 
        # cur.rowcount == 0 detecta si la fila no existía o pertenecía a otro tenant.
        cur.execute("DELETE FROM finanzas.gastos_operativos WHERE id = %s AND emprendimiento_id = %s", (gasto_id, negocio_id))
        if cur.rowcount == 0:
            return jsonify({"status": "error", "mensaje": "Gasto no encontrado"}), 404
        conn.commit()
        return jsonify({"status": "ok", "mensaje": "Gasto eliminado correctamente"}), 200
    finally:
        cur.close()
        conn.close()

# BIENES DE USO (tipo_producto = 'BIEN_DE_USO')
# Enrutamiento doble:
# Permite que el servicio responda sin importar si el Gateway o el Frontend deciden anteponer el prefijo /api/bienes-uso o /api/finanzas/bienes-uso.
@app.route('/api/bienes-uso', methods=['GET'])
@app.route('/api/finanzas/bienes-uso', methods=['GET'])
def listar_bienes_uso():
    """
    Lista todos los bienes de uso (activos y ocultos) para permitir el filtro 'Ver ocultos' en Front.
    Regla SM (CU-18): Ocultar un bien de uso lo quita de la vista activa pero sigue sumando al patrimonio;
    solo al eliminarlo definitivamente deja de sumar.
    """
    payload, error_resp, status = verificar_token(roles_permitidos=['PROPIETARIO', 'ADMIN'])
    if error_resp:
        return error_resp, status

    negocio_id = payload.get("negocio_id")
    conn = get_db_connection(payload.get("db_name"))
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        # Ejecuta una consulta SQL relacional con dos LEFT JOIN hacia productos.proveedores y productos.categorias.
        # Aplica dos filtros concurrentes:
        # p.emprendimiento_id = %s: asegura aislamiento multi-tenant (solo trae bienes del comercio en sesión).   
        # p.tipo_producto = 'BIEN_DE_USO': discrimina los activos fijos de la mercadería y de los consumibles.   
        # No se filtra por p.activo = TRUE en el SQL para devolver tanto los activos como los ocultos,
        # permitiendo que la pantalla alterne entre ambos estados con el botón 'Ver ocultos'.
        cur.execute(
            """SELECT p.id, p.nombre, p.precio_compra, p.cantidad, p.stock_minimo,
                      p.iva_alicuota, p.activo, p.proveedor_id, pr.nombre AS proveedor_nombre,
                      p.categoria_id, c.nombre AS categoria_nombre, p.creado_por, p.creado_en
               FROM productos.productos p
               LEFT JOIN productos.proveedores pr ON p.proveedor_id = pr.id
               LEFT JOIN productos.categorias c ON p.categoria_id = c.id
               WHERE p.emprendimiento_id = %s AND p.tipo_producto = 'BIEN_DE_USO'
               ORDER BY p.activo DESC, p.nombre ASC""",
            (negocio_id,)
        )
        filas = cur.fetchall() # Descarga todas las filas en formato de diccionario gracias a RealDictCursor.

        patrimonio_total = 0.0
        cantidad_activos = 0
        items = []

        # El bucle recorre cada activo registrado y procesa la información contable fila por fila
        for f in filas:
            esta_activo = bool(f['activo'])
            # normaliza los tipos de datos de PostgreSQL (NUMERIC) a tipos nativos de Python para evitar errores de serialización JSON.
            qty = int(f['cantidad'])
            costo = float(f['precio_compra'])
            # calcula el valor patrimonial actual de esa maquinaria o herramienta en particular (cantidad X costo de adquisición). 
            subtotal = round(qty * costo, 2)

            # Regla oficial de Reportes (CU-18): todos los bienes no eliminados (activos y ocultos)
            # continúan sumando en la inversión patrimonial; solo dejan de sumar si se borran con DELETE.
            patrimonio_total += subtotal

            # El contador físico de equipos vigentes solo contabiliza los que están visibles (activo = TRUE).
            if esta_activo:
                cantidad_activos += qty

            fecha_iso = formatear_utc_z(f['creado_en'])

            # construye un nuevo objeto limpio donde formatea las fechas a formato estándar ISO UTC terminado en 'Z'
            # y devuelve tanto los nombres del proveedor y categoría como sus IDs para la interfaz visual.
            items.append({
                "id": f['id'],
                "nombre": f['nombre'],
                "costo_adquisicion": costo,
                "cantidad": qty,
                "stock_minimo": int(f['stock_minimo']),
                "valor_total": subtotal,
                "iva_alicuota": float(f['iva_alicuota']),
                "activo": esta_activo,
                "oculto": not esta_activo,
                "fecha_adquisicion": fecha_iso,
                "creado_en": fecha_iso,
                "proveedor_id": f['proveedor_id'],
                "proveedor_nombre": f['proveedor_nombre'],
                "categoria_id": f['categoria_id'],
                "categoria_nombre": f['categoria_nombre'],
                "creado_por": f['creado_por']
            })

        # Devuelve una respuesta HTTP 200 OK con un payload JSON compuesto por dos secciones:
        # "bienes_uso": la lista detallada de los activos para poblar la tabla del frontend.   
        # "resumen": un bloque de métricas consolidadas en tiempo real (patrimonio_total, unidades_totales, cantidad_bienes) para que la pantalla pinte tarjetas de balance sin necesidad de recalcular en JavaScript. 
        return jsonify({
            "status": "ok",
            "bienes_uso": items,
            "resumen": {
                "patrimonio_total": round(patrimonio_total, 2),
                "unidades_totales": cantidad_activos,
                "cantidad_bienes": sum(1 for i in items if i['activo'])
            }
        }), 200
    finally:
        cur.close()
        conn.close()


@app.route('/api/bienes-uso', methods=['POST'])
@app.route('/api/finanzas/bienes-uso', methods=['POST'])
def crear_bien_uso():
    """
    Alta de un nuevo bien de uso en productos.productos.
    Reglas SM (CU-18): tipo_producto = 'BIEN_DE_USO', unidad_medida = 'unidades', precio_venta = 0,
    cantidad > 0, costo > 0 y fecha de adquisición no futura.
    Acepta opcionalmente 'fecha_adquisicion' (YYYY-MM-DD) y la almacena en 'creado_en'.
    """
    payload, error_resp, status = verificar_token(roles_permitidos=['PROPIETARIO', 'ADMIN'])
    if error_resp:
        return error_resp, status

    negocio_id = payload.get("negocio_id")
    creador = payload.get("usuario", "admin")
    datos = request.get_json(silent=True) or {}
    #Con silent=True, Flask no lanza ninguna excepción: 
    # devuelve None de forma silenciosa. Al encadenarlo con or {}, 
    # la variable datos queda como un diccionario vacío y el código puede validar los campos con mensajes claros en formato JSON.

    nombre = (datos.get('nombre') or '').strip()
    proveedor_id = datos.get('proveedor_id')
    categoria_id = datos.get('categoria_id')
    fecha_adq_str = (datos.get('fecha_adquisicion') or '').strip()

    # intercepta el fallo y devuelve un error HTTP 400 indicando exactamente que los campos numéricos son inválidos.
    try:
        precio_compra = float(datos.get('precio_compra') or datos.get('costo') or 0)
        cantidad = int(datos.get('cantidad', 1))
        stock_minimo = int(datos.get('stock_minimo', 0))
        iva_alicuota = float(datos.get('iva_alicuota', 21.00))
    except (ValueError, TypeError):
        return jsonify({"status": "error", "mensaje": "Datos numéricos inválidos (cantidad y stock deben ser enteros)"}), 400

    if not nombre:
        return jsonify({
            "status": "error",
            "mensaje": "El nombre es obligatorio",
            "errores": {"nombre": "El nombre es obligatorio."}
        }), 400
    if precio_compra <= 0 or cantidad <= 0 or stock_minimo < 0:
        return jsonify({"status": "error", "mensaje": "El costo y la cantidad deben ser mayores a cero"}), 400

    # Validación de fecha de adquisición: si envían fecha_adquisicion (YYYY-MM-DD), verifica que no sea futura
    # respecto a la hora oficial de Argentina y la convierte a timestamp; si no viene, COALESCE usa CURRENT_TIMESTAMP.
    fecha_registro_dt = None
    if fecha_adq_str:
        try:
            fecha_solo = datetime.date.fromisoformat(fecha_adq_str[:10])
            if fecha_solo > hoy_argentina():
                return jsonify({
                    "status": "error",
                    "mensaje": "La fecha de adquisición no puede ser futura",
                    "errores": {"fecha_adquisicion": "La fecha de adquisición no puede ser futura."}
                }), 400
            fecha_registro_dt = datetime.datetime.combine(fecha_solo, datetime.time(12, 0), tzinfo=TZ_ARGENTINA)
        except ValueError:
            return jsonify({"status": "error", "mensaje": "Formato de fecha_adquisicion inválido (use YYYY-MM-DD)"}), 400

    conn = get_db_connection(payload.get("db_name"))
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # Si el formulario del Frontend no envía proveedor_id (porque su diseño no incluye selector),
        # buscamos automáticamente el primer proveedor activo del negocio en sesión para cumplir la clave foránea.
        if not proveedor_id:
            cur.execute(
                "SELECT id FROM productos.proveedores WHERE emprendimiento_id = %s AND activo = TRUE ORDER BY id ASC LIMIT 1",
                (negocio_id,)
            )
            prov = cur.fetchone()
            if not prov:
                return jsonify({"status": "error", "mensaje": "Debe registrar al menos un proveedor antes de cargar bienes de uso"}), 400
            proveedor_id = prov['id']

        #Ejecuta el INSERT INTO productos.productos asignando valores fijos obligatorios por modelo de negocio:
        # tipo_producto = 'BIEN_DE_USO' (clasificación patrimonial).   
        # precio_venta = 0.00 y rentabilidad = 0.00 (las máquinas no son mercadería para venta minorista).   
        # unidad_medida = 'unidades' (regla de enteros).   
        # creado_por = creador (auditoría automática extraída del token). 
        #Usa la cláusula RETURNING id, nombre, precio_compra, cantidad, activo, creado_en para capturar en un solo paso los valores finales asignados por PostgreSQL.
        cur.execute(
            """INSERT INTO productos.productos 
               (emprendimiento_id, proveedor_id, categoria_id, tipo_producto, nombre,
                precio_compra, iva_alicuota, rentabilidad, precio_venta, cantidad, stock_minimo,
                unidad_medida, activo, creado_por, creado_en)
               VALUES (%s, %s, %s, 'BIEN_DE_USO', %s, %s, %s, 0.00, 0.00, %s, %s, 'unidades', TRUE, %s, COALESCE(%s, CURRENT_TIMESTAMP))
               RETURNING id, nombre, precio_compra, cantidad, activo, creado_en""",
            (negocio_id, proveedor_id, categoria_id, nombre, precio_compra, iva_alicuota, cantidad, stock_minimo, creador, fecha_registro_dt)
        )
        nuevo = cur.fetchone()
        conn.commit()

        fecha_iso = formatear_utc_z(nuevo['creado_en'])
        nuevo['costo_adquisicion'] = float(nuevo.pop('precio_compra'))
        nuevo['cantidad'] = int(nuevo['cantidad'])
        nuevo['activo'] = bool(nuevo['activo'])
        nuevo['oculto'] = not nuevo['activo']
        nuevo['fecha_adquisicion'] = fecha_iso
        nuevo['creado_en'] = fecha_iso
        nuevo['valor_total'] = round(nuevo['cantidad'] * nuevo['costo_adquisicion'], 2)

        return jsonify({"status": "ok", "mensaje": "Bien de uso registrado exitosamente", "bien_uso": nuevo}), 201
    except psycopg2.IntegrityError as e:
        conn.rollback()
        return jsonify({"status": "error", "mensaje": f"Error de integridad relacional: {str(e)}"}), 409
    finally:
        cur.close()
        conn.close()


# EDICIÓN DE BIEN DE USO (PUT /api/bienes-uso/<id>)
@app.route('/api/bienes-uso/<int:id>', methods=['PUT'])
@app.route('/api/finanzas/bienes-uso/<int:id>', methods=['PUT'])
def actualizar_bien_uso(id):
    """
    Edita los datos de un bien de uso existente (nombre, valor unitario, cantidad y fecha_adquisicion).
    Cumple con CU-18: valida fecha no futura, recalcula el valor total y deja registro de auditoría
    (modificado_por y modificado_en) porque el cambio impacta en los indicadores patrimoniales.
    """
    payload, error_resp, status = verificar_token(roles_permitidos=['PROPIETARIO', 'ADMIN'])
    if error_resp:
        return error_resp, status

    negocio_id = payload.get("negocio_id")
    usuario = payload.get("usuario", "admin")
    datos = request.get_json(silent=True) or {}

    conn = get_db_connection(payload.get("db_name"))
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # Comprobamos que el equipo exista y pertenezca al negocio del token (aislamiento multi-tenant)
        cur.execute(
            "SELECT * FROM productos.productos WHERE id = %s AND emprendimiento_id = %s AND tipo_producto = 'BIEN_DE_USO'",
            (id, negocio_id)
        )
        actual = cur.fetchone()
        if not actual:
            return jsonify({"status": "error", "mensaje": "Bien de uso no encontrado"}), 404

        # Si algún campo no viene en el JSON (ej. el modal de edición no pide cantidad), conserva el valor actual
        nombre = (datos.get('nombre') if 'nombre' in datos else actual['nombre'] or '').strip()
        try:
            precio_raw = datos.get('precio_compra') if 'precio_compra' in datos else actual['precio_compra']
            precio_compra = float(precio_raw or 0)
            cant_raw = datos.get('cantidad') if 'cantidad' in datos else actual['cantidad']
            cantidad = int(cant_raw or 0)
        except (ValueError, TypeError):
            return jsonify({"status": "error", "mensaje": "Datos numéricos inválidos"}), 400

        if not nombre:
            return jsonify({"status": "error", "mensaje": "El nombre es obligatorio"}), 400
        if precio_compra <= 0 or cantidad <= 0:
            return jsonify({"status": "error", "mensaje": "El valor y la cantidad deben ser mayores a cero"}), 400

        creado_en = actual['creado_en']
        fecha_adq_str = (datos.get('fecha_adquisicion') or '').strip()
        if fecha_adq_str:
            try:
                fecha_solo = datetime.date.fromisoformat(fecha_adq_str[:10])
                if fecha_solo > hoy_argentina():
                    return jsonify({"status": "error", "mensaje": "La fecha de adquisición no puede ser futura"}), 400
                creado_en = datetime.datetime.combine(fecha_solo, datetime.time(12, 0), tzinfo=TZ_ARGENTINA)
            except ValueError:
                return jsonify({"status": "error", "mensaje": "Formato de fecha_adquisicion inválido (use YYYY-MM-DD)"}), 400

        cur.execute(
            """UPDATE productos.productos
               SET nombre = %s, precio_compra = %s, cantidad = %s, creado_en = %s,
                   modificado_por = %s, modificado_en = CURRENT_TIMESTAMP
               WHERE id = %s AND emprendimiento_id = %s
               RETURNING id, nombre, precio_compra, cantidad, activo, creado_en""",
            (nombre, precio_compra, cantidad, creado_en, usuario, id, negocio_id)
        )
        editado = cur.fetchone()
        conn.commit()

        fecha_iso = formatear_utc_z(editado['creado_en'])
        editado['costo_adquisicion'] = float(editado.pop('precio_compra'))
        editado['cantidad'] = int(editado['cantidad'])
        editado['activo'] = bool(editado['activo'])
        editado['oculto'] = not editado['activo']
        editado['fecha_adquisicion'] = fecha_iso
        editado['creado_en'] = fecha_iso
        editado['valor_total'] = round(editado['cantidad'] * editado['costo_adquisicion'], 2)

        return jsonify({"status": "ok", "mensaje": "Bien de uso actualizado", "bien_uso": editado}), 200
    finally:
        cur.close()
        conn.close()


@app.route('/api/bienes-uso/<int:id>/ocultar', methods=['PATCH'])
@app.route('/api/finanzas/bienes-uso/<int:id>/ocultar', methods=['PATCH'])
def ocultar_bien_uso(id):
    """Borrado lógico (activo = FALSE) de un bien de uso."""
    payload, error_resp, status = verificar_token(roles_permitidos=['PROPIETARIO', 'ADMIN'])
    if error_resp:
        return error_resp, status

    negocio_id = payload.get("negocio_id")
    usuario = payload.get("usuario", "admin")
    conn = get_db_connection(payload.get("db_name"))
    cur = conn.cursor()
    try:
        cur.execute(
            """UPDATE productos.productos 
               SET activo = FALSE, modificado_por = %s, modificado_en = CURRENT_TIMESTAMP
               WHERE id = %s AND emprendimiento_id = %s AND tipo_producto = 'BIEN_DE_USO'""",
            (usuario, id, negocio_id)
        )
        if cur.rowcount == 0:
            return jsonify({"status": "error", "mensaje": "Bien de uso no encontrado"}), 404
        conn.commit()
        return jsonify({"status": "ok", "mensaje": "Bien de uso ocultado exitosamente"}), 200
    finally:
        cur.close()
        conn.close()


# RESTAURAR BIEN DE USO OCULTO (PATCH /api/bienes-uso/<id>/restaurar)
@app.route('/api/bienes-uso/<int:id>/restaurar', methods=['PATCH'])
@app.route('/api/finanzas/bienes-uso/<int:id>/restaurar', methods=['PATCH'])
def restaurar_bien_uso(id):
    """
    Revierte el ocultamiento lógico (activo = TRUE) de un bien de uso para que vuelva
    a mostrarse en la tabla principal y deja asentada la auditoría de quién lo restauró.
    """
    payload, error_resp, status = verificar_token(roles_permitidos=['PROPIETARIO', 'ADMIN'])
    if error_resp:
        return error_resp, status

    negocio_id = payload.get("negocio_id")
    usuario = payload.get("usuario", "admin")
    conn = get_db_connection(payload.get("db_name"))
    cur = conn.cursor()
    try:
        cur.execute(
            """UPDATE productos.productos 
               SET activo = TRUE, modificado_por = %s, modificado_en = CURRENT_TIMESTAMP
               WHERE id = %s AND emprendimiento_id = %s AND tipo_producto = 'BIEN_DE_USO'""",
            (usuario, id, negocio_id)
        )
        if cur.rowcount == 0:
            return jsonify({"status": "error", "mensaje": "Bien de uso no encontrado"}), 404
        conn.commit()
        return jsonify({"status": "ok", "mensaje": "Bien de uso restaurado exitosamente"}), 200
    finally:
        cur.close()
        conn.close()


@app.route('/api/bienes-uso/<int:id>', methods=['DELETE'])
@app.route('/api/finanzas/bienes-uso/<int:id>', methods=['DELETE'])
def eliminar_bien_uso(id):
    """
    Eliminación física con validación de historial:
    Bloquea con 409 Conflict si existen reposiciones o movimientos registrados.
    """
    payload, error_resp, status = verificar_token(roles_permitidos=['PROPIETARIO', 'ADMIN'])
    if error_resp:
        return error_resp, status

    negocio_id = payload.get("negocio_id")
    conn = get_db_connection(payload.get("db_name"))
    cur = conn.cursor(cursor_factory=RealDictCursor)

    # Implementa una política de borrado físico protegido con validación de integridad contable. 
    # Antes de emitir una orden de destrucción de datos, comprueba sistemáticamente que el registro no tenga historial operativo asociado.
    try:
        cur.execute("SELECT id FROM productos.productos WHERE id = %s AND emprendimiento_id = %s AND tipo_producto = 'BIEN_DE_USO'", (id, negocio_id))
        if not cur.fetchone():
            return jsonify({"status": "error", "mensaje": "Bien de uso no encontrado"}), 404

        # Verificación contable en facturas de compra. 
        # Busca si existen registros en productos.reposiciones. 
        # Si se borrara un bien con reposiciones, se rompería la clave foránea fk_reposiciones_producto o se destruiría el historial de compras. 
        # Con LIMIT 1 la consulta se detiene apenas encuentra una coincidencia para máxima velocidad
        cur.execute("SELECT id FROM productos.reposiciones WHERE producto_id = %s LIMIT 1", (id,))
        tiene_repos = cur.fetchone()

        # Verificación de auditoría en el Kardex. Si el activo tuvo movimientos de inventario registrados en productos.movimientos_stock, no debe desaparecer de la base.
        cur.execute("SELECT id FROM productos.movimientos_stock WHERE producto_id = %s LIMIT 1", (id,))
        tiene_movs = cur.fetchone()

        if tiene_repos or tiene_movs:
            return jsonify({"status": "error", "mensaje": "No se puede eliminar: el bien de uso registra historial contable. Utilice la opción de ocultar."}), 409

        # Eliminación física definitiva. Como no tiene ningún comprobante vinculado, borra la fila limpia de PostgreSQL y confirma con conn.commit().
        cur.execute("DELETE FROM productos.productos WHERE id = %s AND emprendimiento_id = %s", (id, negocio_id))
        conn.commit()
        return jsonify({"status": "ok", "mensaje": "Bien de uso eliminado definitivamente"}), 200
    finally:
        cur.close()
        conn.close()


# BIENES DE GASTO E INSUMOS OPERATIVOS (tipo_producto = 'BIEN_DE_GASTO')
# LISTAR BIENES DE GASTO / INSUMOS (GET)
@app.route('/api/bienes-gasto', methods=['GET'])
@app.route('/api/insumos', methods=['GET'])
@app.route('/api/finanzas/bienes-gasto', methods=['GET'])
def listar_bienes_gasto():
    """
    Recupera el inventario de bienes de gasto (consumibles operativos) del comercio.
    - Aplica aislamiento multi-tenant por emprendimiento_id.
    - Filtra estrictamente por tipo_producto = 'BIEN_DE_GASTO'.
    - Computa en tiempo de ejecución el valor total del inventario consumible activo.
    - Devuelve 'fecha', 'creado_en', 'activo' y 'oculto' para soportar el botón 'Ver ocultos' en Front.
    """
    # Verificación de credenciales JWT (Administrador o Propietario)
    payload, error_resp, status = verificar_token(roles_permitidos=['PROPIETARIO', 'ADMIN'])
    if error_resp:
        return error_resp, status

    negocio_id = payload.get("negocio_id")
    conn = get_db_connection(payload.get("db_name"))
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        # Consulta relacional vinculando proveedor y categoría asignada.
        # Incluye p.creado_en y devuelve tanto registros activos como ocultos (sin filtrar p.activo = TRUE en el WHERE)
        # para que la interfaz pueda filtrarlos con el botón 'Ver ocultos'.
        cur.execute(
            """SELECT p.id, p.nombre, p.precio_compra, p.cantidad, p.stock_minimo,
                      p.iva_alicuota, p.activo, p.creado_por, p.creado_en,
                      p.proveedor_id, pr.nombre AS proveedor_nombre,
                      p.categoria_id, c.nombre AS categoria_nombre
               FROM productos.productos p
               LEFT JOIN productos.proveedores pr ON p.proveedor_id = pr.id
               LEFT JOIN productos.categorias c ON p.categoria_id = c.id
               WHERE p.emprendimiento_id = %s 
                 AND p.tipo_producto = 'BIEN_DE_GASTO'
               ORDER BY p.activo DESC, p.nombre ASC""",
            (negocio_id,)
        )
        filas = cur.fetchall()

        valor_stock_acumulado = 0.0
        lista_bienes = []

        # Normalización y cálculo dinámico por cada artículo consumible
        for f in filas:
            esta_activo = bool(f['activo'])
            qty = int(f['cantidad'])
            costo = float(f['precio_compra'])
            subtotal = round(qty * costo, 2)

            # Solo los insumos activos suman al valor de existencias vigentes en pantalla
            if esta_activo:
                valor_stock_acumulado += subtotal

            fecha_iso = formatear_utc_z(f['creado_en'])
            lista_bienes.append({
                "id": f['id'],
                "nombre": f['nombre'],
                "costo_unitario": costo,
                "cantidad": qty,
                "stock_minimo": int(f['stock_minimo']),
                "valor_stock": subtotal,
                "iva_alicuota": float(f['iva_alicuota']),
                "activo": esta_activo,
                "oculto": not esta_activo,
                "fecha": fecha_iso,
                "creado_en": fecha_iso,
                "creado_por": f['creado_por'],
                "proveedor_id": f['proveedor_id'],
                "proveedor_nombre": f['proveedor_nombre'],
                "categoria_id": f['categoria_id'],
                "categoria_nombre": f['categoria_nombre']
            })

        return jsonify({
            "status": "ok",
            "bienes_gasto": lista_bienes,
            "resumen": {
                "valor_inventario_total": round(valor_stock_acumulado, 2),
                "total_articulos": sum(1 for b in lista_bienes if b['activo'])
            }
        }), 200

    finally:
        # Cierre seguro de recursos
        cur.close()
        conn.close()


# ALTA DE BIEN DE GASTO / INSUMO (POST)
@app.route('/api/bienes-gasto', methods=['POST'])
@app.route('/api/insumos', methods=['POST'])
@app.route('/api/finanzas/bienes-gasto', methods=['POST'])
def crear_bien_gasto():
    """
    Registra un nuevo artículo consumible en el catálogo unificado (CU-19).
    Reglas de negocio:
    - tipo_producto fijado en 'BIEN_DE_GASTO'.
    - precio_venta = 0.00 y rentabilidad = 0.00 (no están destinados a la reventa).
    - unidad_medida fijada en 'unidades' según restricciones de integridad de la base.
    - Exige nombre, proveedor, costo > 0, cantidad > 0 y fecha opcional no futura.
    """
    payload, error_resp, status = verificar_token(roles_permitidos=['PROPIETARIO', 'ADMIN'])
    if error_resp:
        return error_resp, status

    negocio_id = payload.get("negocio_id")
    creador = payload.get("usuario", "admin")
    datos = request.get_json(silent=True) or {}

    nombre = (datos.get('nombre') or '').strip()
    proveedor_id = datos.get('proveedor_id')
    categoria_id = datos.get('categoria_id')
    fecha_str = (datos.get('fecha') or '').strip()

    # Validación de tipos de datos numéricos
    try:
        precio_compra = float(datos.get('precio_compra') or datos.get('costo') or 0)
        cantidad = int(datos.get('cantidad', 0))
        stock_minimo = int(datos.get('stock_minimo', 0))
        iva_alicuota = float(datos.get('iva_alicuota', 21.00))
    except (ValueError, TypeError):
        return jsonify({"status": "error", "mensaje": "Las cantidades y costos deben contener valores numéricos válidos"}), 400

    # Validaciones obligatorias de campos según CU-19 (costo > 0 y cantidad inicial > 0)
    if not nombre or not proveedor_id:
        return jsonify({"status": "error", "mensaje": "El nombre y el proveedor son obligatorios"}), 400
    if precio_compra <= 0 or cantidad <= 0 or stock_minimo < 0:
        return jsonify({"status": "error", "mensaje": "El costo y la cantidad inicial deben ser mayores a cero"}), 400

    # Si el frontend envía una fecha específica (YYYY-MM-DD), validamos que no sea futura
    fecha_registro_dt = None
    if fecha_str:
        try:
            fecha_solo = datetime.date.fromisoformat(fecha_str[:10])
            if fecha_solo > hoy_argentina():
                return jsonify({"status": "error", "mensaje": "La fecha no puede ser futura"}), 400
            fecha_registro_dt = datetime.datetime.combine(fecha_solo, datetime.time(12, 0), tzinfo=TZ_ARGENTINA)
        except ValueError:
            return jsonify({"status": "error", "mensaje": "Formato de fecha inválido (use YYYY-MM-DD)"}), 400

    conn = get_db_connection(payload.get("db_name"))
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        cur.execute(
            """INSERT INTO productos.productos 
               (emprendimiento_id, proveedor_id, categoria_id, tipo_producto, nombre,
                precio_compra, iva_alicuota, rentabilidad, precio_venta, cantidad, stock_minimo,
                unidad_medida, activo, creado_por, creado_en)
               VALUES (%s, %s, %s, 'BIEN_DE_GASTO', %s, %s, %s, 0.00, 0.00, %s, %s, 'unidades', TRUE, %s, COALESCE(%s, CURRENT_TIMESTAMP))
               RETURNING id, nombre, precio_compra, cantidad, stock_minimo, activo, creado_en""",
            (negocio_id, proveedor_id, categoria_id, nombre, precio_compra, iva_alicuota, cantidad, stock_minimo, creador, fecha_registro_dt)
        )
        nuevo_item = cur.fetchone()
        conn.commit()

        # Formateo de respuesta
        fecha_iso = formatear_utc_z(nuevo_item['creado_en'])
        nuevo_item['costo_unitario'] = float(nuevo_item.pop('precio_compra'))
        nuevo_item['cantidad'] = int(nuevo_item['cantidad'])
        nuevo_item['stock_minimo'] = int(nuevo_item['stock_minimo'])
        nuevo_item['activo'] = bool(nuevo_item['activo'])
        nuevo_item['oculto'] = not nuevo_item['activo']
        nuevo_item['fecha'] = fecha_iso
        nuevo_item['creado_en'] = fecha_iso

        return jsonify({
            "status": "ok", 
            "mensaje": "Bien de gasto registrado exitosamente", 
            "bien_gasto": nuevo_item
        }), 201

    except psycopg2.IntegrityError as e:
        conn.rollback()
        return jsonify({"status": "error", "mensaje": f"Violación de clave foránea o datos duplicados: {str(e)}"}), 409
    finally:
        cur.close()
        conn.close()


# EDICIÓN DE BIEN DE GASTO / INSUMO (PUT /api/bienes-gasto/<id>)
@app.route('/api/bienes-gasto/<int:id>', methods=['PUT'])
@app.route('/api/insumos/<int:id>', methods=['PUT'])
@app.route('/api/finanzas/bienes-gasto/<int:id>', methods=['PUT'])
def actualizar_bien_gasto(id):
    """
    Edita los datos maestros de un insumo existente (nombre, proveedor, costo unitario,
    stock mínimo, alícuota de IVA y fecha), registrando auditoría (modificado_por y modificado_en).
    """
    payload, error_resp, status = verificar_token(roles_permitidos=['PROPIETARIO', 'ADMIN'])
    if error_resp:
        return error_resp, status

    negocio_id = payload.get("negocio_id")
    usuario = payload.get("usuario", "admin")
    datos = request.get_json(silent=True) or {}

    conn = get_db_connection(payload.get("db_name"))
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute(
            "SELECT * FROM productos.productos WHERE id = %s AND emprendimiento_id = %s AND tipo_producto = 'BIEN_DE_GASTO'",
            (id, negocio_id)
        )
        actual = cur.fetchone()
        if not actual:
            return jsonify({"status": "error", "mensaje": "Bien de gasto no encontrado"}), 404

        nombre = (datos.get('nombre') if 'nombre' in datos else actual['nombre'] or '').strip()
        proveedor_id = datos.get('proveedor_id') if 'proveedor_id' in datos else actual['proveedor_id']
        try:
            precio_raw = (datos.get('precio_compra') or datos.get('costo')) if ('precio_compra' in datos or 'costo' in datos) else actual['precio_compra']
            precio_compra = float(precio_raw or 0)
            stock_min = int(datos.get('stock_minimo') if 'stock_minimo' in datos else actual['stock_minimo'])
            iva_alic = float(datos.get('iva_alicuota') if 'iva_alicuota' in datos else actual['iva_alicuota'])
        except (ValueError, TypeError):
            return jsonify({"status": "error", "mensaje": "Valores numéricos inválidos"}), 400

        if not nombre or precio_compra <= 0 or stock_min < 0:
            return jsonify({"status": "error", "mensaje": "Nombre obligatorio, costo mayor a cero y stock mínimo no negativo"}), 400

        creado_en = actual['creado_en']
        fecha_str = (datos.get('fecha') or '').strip()
        if fecha_str:
            try:
                fecha_solo = datetime.date.fromisoformat(fecha_str[:10])
                if fecha_solo > hoy_argentina():
                    return jsonify({"status": "error", "mensaje": "La fecha no puede ser futura"}), 400
                creado_en = datetime.datetime.combine(fecha_solo, datetime.time(12, 0), tzinfo=TZ_ARGENTINA)
            except ValueError:
                return jsonify({"status": "error", "mensaje": "Formato de fecha inválido (use YYYY-MM-DD)"}), 400

        cur.execute(
            """UPDATE productos.productos
               SET nombre = %s, proveedor_id = %s, precio_compra = %s, stock_minimo = %s,
                   iva_alicuota = %s, creado_en = %s, modificado_por = %s, modificado_en = CURRENT_TIMESTAMP
               WHERE id = %s AND emprendimiento_id = %s
               RETURNING id, nombre, precio_compra, cantidad, stock_minimo, activo, creado_en""",
            (nombre, proveedor_id, precio_compra, stock_min, iva_alic, creado_en, usuario, id, negocio_id)
        )
        editado = cur.fetchone()
        conn.commit()

        fecha_iso = formatear_utc_z(editado['creado_en'])
        editado['costo_unitario'] = float(editado.pop('precio_compra'))
        editado['cantidad'] = int(editado['cantidad'])
        editado['stock_minimo'] = int(editado['stock_minimo'])
        editado['activo'] = bool(editado['activo'])
        editado['oculto'] = not editado['activo']
        editado['fecha'] = fecha_iso
        editado['creado_en'] = fecha_iso

        return jsonify({"status": "ok", "mensaje": "Bien de gasto actualizado", "bien_gasto": editado}), 200
    finally:
        cur.close()
        conn.close()


# REPOSICIÓN DE STOCK DE BIEN DE GASTO (POST)
@app.route('/api/bienes-gasto/<int:id>/reposicion', methods=['POST'])
@app.route('/api/insumos/<int:id>/reposicion', methods=['POST'])
def reponer_bien_gasto(id):
    """
    Abastecimiento de existencias para bienes consumibles (CU-20):
    1. Resuelve la condición tributaria negocio-proveedor (discriminación de IVA).
    2. Valida que la fecha de adquisición (opcional, por defecto hoy) no sea futura.
    3. Inserta la compra en productos.reposiciones.
    4. Suma el stock e impacta el nuevo costo en productos.productos.
    5. Asienta la entrada en el Kardex (productos.movimientos_stock) con tipo 'REPOSICION'.
    Nota contable: La reposición NO computa como pérdida operativa hasta que no se consuma.
    """
    payload, error_resp, status = verificar_token(roles_permitidos=['PROPIETARIO', 'ADMIN'])
    if error_resp:
        return error_resp, status

    negocio_id = payload.get("negocio_id")
    usuario = payload.get("usuario", "admin")
    datos = request.get_json(silent=True) or {}
    proveedor_id = datos.get('proveedor_id')
    fecha_str = (datos.get('fecha') or datos.get('fecha_adquisicion') or '').strip()

    try:
        cantidad = int(datos.get('cantidad', 0))
        monto_total = float(datos.get('monto_total', 0))
    except (ValueError, TypeError):
        return jsonify({"status": "error", "mensaje": "Cantidad y monto total deben ser números válidos"}), 400

    if cantidad <= 0 or monto_total <= 0 or not proveedor_id:
        return jsonify({"status": "error", "mensaje": "Cantidad (>0), monto total (>0) y proveedor_id son obligatorios"}), 400

    # Si envían fecha de compra, validamos que no sea futura; si no, usamos la fecha de hoy en Argentina
    fecha_repo = hoy_argentina()
    if fecha_str:
        try:
            fecha_repo = datetime.date.fromisoformat(fecha_str[:10])
            if fecha_repo > hoy_argentina():
                return jsonify({"status": "error", "mensaje": "La fecha de reposición no puede ser futura"}), 400
        except ValueError:
            return jsonify({"status": "error", "mensaje": "Formato de fecha inválido (use YYYY-MM-DD)"}), 400

    conn = get_db_connection(payload.get("db_name"))
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        # Obtener IVA y saldo actual del consumible
        cur.execute(
            """SELECT cantidad, iva_alicuota 
               FROM productos.productos 
               WHERE id = %s AND emprendimiento_id = %s AND tipo_producto = 'BIEN_DE_GASTO'""",
            (id, negocio_id)
        )
        item = cur.fetchone()
        if not item:
            return jsonify({"status": "error", "mensaje": "Bien de gasto no encontrado"}), 404

        # Condición fiscal del negocio comprador
        cur.execute("SELECT categoria_impositiva FROM auth.emprendimientos WHERE id = %s", (negocio_id,))
        cat_negocio = cur.fetchone()['categoria_impositiva']

        # Condición fiscal del proveedor vendedor
        cur.execute("SELECT categoria_impositiva FROM productos.proveedores WHERE id = %s AND emprendimiento_id = %s", (proveedor_id, negocio_id))
        prov = cur.fetchone()
        if not prov:
            return jsonify({"status": "error", "mensaje": "Proveedor no encontrado"}), 404
        cat_proveedor = prov['categoria_impositiva']

        # Determinación de crédito fiscal e impacto neto
        costo_neto_total = calcular_costo_neto_compra(monto_total, item['iva_alicuota'], cat_negocio, cat_proveedor)
        costo_unitario_real = round(costo_neto_total / cantidad, 4)
        nuevo_stock = int(item['cantidad']) + cantidad

        # Registro en tabla de compras con la fecha de adquisición validada
        cur.execute(
            """INSERT INTO productos.reposiciones 
               (emprendimiento_id, producto_id, proveedor_id, cantidad, monto_total, costo_unitario_real, fecha_adquisicion, estado, creado_por)
               VALUES (%s, %s, %s, %s, %s, %s, %s, 'ACTIVA', %s)
               RETURNING id""",
            (negocio_id, id, proveedor_id, cantidad, monto_total, costo_unitario_real, fecha_repo, usuario)
        )
        repo_id = cur.fetchone()['id']

        # Actualización de inventario en catálogo
        cur.execute(
            """UPDATE productos.productos 
               SET cantidad = %s, precio_compra = %s, modificado_por = %s, modificado_en = CURRENT_TIMESTAMP
               WHERE id = %s""",
            (nuevo_stock, costo_unitario_real, usuario, id)
        )

        # Asiento en Kardex de movimientos
        cur.execute(
            """INSERT INTO productos.movimientos_stock 
               (emprendimiento_id, producto_id, reposicion_id, tipo, cantidad_movimiento, stock_resultante, motivo, usuario)
               VALUES (%s, %s, %s, 'REPOSICION', %s, %s, 'Reposición de insumo/bien de gasto', %s)""",
            (negocio_id, id, repo_id, cantidad, nuevo_stock, usuario)
        )

        conn.commit()
        return jsonify({
            "status": "ok",
            "mensaje": "Reposición registrada correctamente",
            "reposicion_id": repo_id,
            "nuevo_stock": nuevo_stock,
            "costo_unitario_real": costo_unitario_real
        }), 201

    except Exception as e:
        conn.rollback()
        return jsonify({"status": "error", "mensaje": f"Fallo al asentar la reposición: {str(e)}"}), 500
    finally:
        cur.close()
        conn.close()


# REGISTRAR CONSUMO OPERATIVO (POST)
@app.route('/api/bienes-gasto/<int:id>/consumo', methods=['POST'])
@app.route('/api/insumos/<int:id>/consumo', methods=['POST'])
def registrar_consumo_bien_gasto(id):
    """
    Registra el consumo interno de un bien de gasto (CU-21):
    - Descuenta las existencias físicas en productos.productos.
    - Bloquea la transacción si la cantidad a consumir supera el stock disponible.
    - Valida que la fecha de consumo (opcional, por defecto hoy) no sea futura.
    - Asienta un movimiento tipo 'CONSUMO' en Kardex con cantidad negativa.
    - Este consumo devengado sí afecta la Ganancia Neta Operativa del negocio.
    """
    payload, error_resp, status = verificar_token(roles_permitidos=['PROPIETARIO', 'ADMIN'])
    if error_resp:
        return error_resp, status

    negocio_id = payload.get("negocio_id")
    usuario = payload.get("usuario", "admin")
    datos = request.get_json(silent=True) or {}
    motivo = (datos.get('motivo') or 'Consumo operativo interno').strip()
    fecha_str = (datos.get('fecha') or '').strip()

    try:
        cantidad_consumo = int(datos.get('cantidad', 0))
    except (ValueError, TypeError):
        return jsonify({"status": "error", "mensaje": "La cantidad consumida debe ser un número entero"}), 400

    if cantidad_consumo <= 0:
        return jsonify({"status": "error", "mensaje": "La cantidad a consumir debe ser mayor a cero"}), 400

    # Si envían fecha de consumo (YYYY-MM-DD), validamos que no sea futura
    fecha_consumo_dt = None
    if fecha_str:
        try:
            fecha_solo = datetime.date.fromisoformat(fecha_str[:10])
            if fecha_solo > hoy_argentina():
                return jsonify({"status": "error", "mensaje": "La fecha de consumo no puede ser futura"}), 400
            fecha_consumo_dt = datetime.datetime.combine(fecha_solo, datetime.time(12, 0), tzinfo=TZ_ARGENTINA)
        except ValueError:
            return jsonify({"status": "error", "mensaje": "Formato de fecha inválido (use YYYY-MM-DD)"}), 400

    conn = get_db_connection(payload.get("db_name"))
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        cur.execute(
            """SELECT cantidad, precio_compra, nombre 
               FROM productos.productos 
               WHERE id = %s AND emprendimiento_id = %s AND tipo_producto = 'BIEN_DE_GASTO'""",
            (id, negocio_id)
        )
        item = cur.fetchone()
        if not item:
            return jsonify({"status": "error", "mensaje": "Bien de gasto no encontrado"}), 404

        stock_disponible = int(item['cantidad'])
        if stock_disponible < cantidad_consumo:
            return jsonify({"status": "error", "mensaje": f"Stock insuficiente (Disponible: {stock_disponible}, Solicitado: {cantidad_consumo})"}), 409

        nuevo_stock = stock_disponible - cantidad_consumo
        costo_devengado = round(cantidad_consumo * float(item['precio_compra']), 2)

        # Actualización de saldo en productos
        cur.execute(
            """UPDATE productos.productos 
               SET cantidad = %s, modificado_por = %s, modificado_en = CURRENT_TIMESTAMP
               WHERE id = %s""",
            (nuevo_stock, usuario, id)
        )

        # Salida por consumo en Kardex (con fecha personalizada si vino en el body, o timestamp actual)
        cur.execute(
            """INSERT INTO productos.movimientos_stock 
               (emprendimiento_id, producto_id, tipo, cantidad_movimiento, stock_resultante, motivo, usuario, fecha)
               VALUES (%s, %s, 'CONSUMO', %s, %s, %s, %s, COALESCE(%s, CURRENT_TIMESTAMP))""",
            (negocio_id, id, -cantidad_consumo, nuevo_stock, motivo, usuario, fecha_consumo_dt)
        )

        conn.commit()
        return jsonify({
            "status": "ok",
            "mensaje": "Consumo registrado exitosamente",
            "articulo": item['nombre'],
            "cantidad_consumida": cantidad_consumo,
            "costo_devengado": costo_devengado,
            "stock_restante": nuevo_stock
        }), 201

    except Exception as e:
        conn.rollback()
        return jsonify({"status": "error", "mensaje": f"Fallo al registrar consumo: {str(e)}"}), 500
    finally:
        cur.close()
        conn.close()


# RESUMEN DE CONSUMOS DEVENGADOS POR PERÍODO (GET)
@app.route('/api/bienes-gasto/resumen', methods=['GET'])
@app.route('/api/insumos/resumen', methods=['GET'])
def resumen_consumos_periodo():
    """
    Retorna el costo acumulado de insumos consumidos en un rango de fechas (?desde=&hasta=).
    Este total es el que se resta en reportes financieros para calcular la Ganancia Neta.
    """
    payload, error_resp, status = verificar_token(roles_permitidos=['PROPIETARIO', 'ADMIN'])
    if error_resp:
        return error_resp, status

    negocio_id = payload.get("negocio_id")
    fecha_desde = request.args.get('desde')
    fecha_hasta = request.args.get('hasta')

    conn = get_db_connection(payload.get("db_name"))
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        query = """
            SELECT m.id, m.fecha, m.motivo, m.usuario, 
                   ABS(m.cantidad_movimiento) AS cantidad, 
                   p.nombre AS bien_nombre, p.precio_compra AS costo_unitario,
                   ROUND(ABS(m.cantidad_movimiento) * p.precio_compra, 2) AS costo_total
            FROM productos.movimientos_stock m
            JOIN productos.productos p ON m.producto_id = p.id
            WHERE m.emprendimiento_id = %s 
              AND m.tipo = 'CONSUMO' 
              AND p.tipo_producto = 'BIEN_DE_GASTO'
        """
        params = [negocio_id]

        if fecha_desde:
            query += " AND m.fecha::date >= %s"
            params.append(fecha_desde)
        if fecha_hasta:
            query += " AND m.fecha::date <= %s"
            params.append(fecha_hasta)

        query += " ORDER BY m.fecha DESC"
        cur.execute(query, tuple(params))
        movimientos = cur.fetchall()

        costo_total_acumulado = sum(float(m['costo_total']) for m in movimientos)

        for m in movimientos:
            # Serializamos en formato ISO 8601 UTC terminado en 'Z' para conversión exacta en el navegador
            m['fecha'] = formatear_utc_z(m['fecha'])
            m['cantidad'] = int(m['cantidad'])
            m['costo_unitario'] = float(m['costo_unitario'])
            m['costo_total'] = float(m['costo_total'])

        return jsonify({
            "status": "ok",
            "consumos": movimientos,
            "resumen": {
                "costo_total_consumido": round(costo_total_acumulado, 2),
                "cantidad_eventos": len(movimientos)
            }
        }), 200

    finally:
        cur.close()
        conn.close()


# OCULTAR BIEN DE GASTO (PATCH)
@app.route('/api/bienes-gasto/<int:id>/ocultar', methods=['PATCH'])
@app.route('/api/insumos/<int:id>/ocultar', methods=['PATCH'])
def ocultar_bien_gasto(id):
    """Borrado lógico (activo = FALSE) para conservar la trazabilidad contable."""
    payload, error_resp, status = verificar_token(roles_permitidos=['PROPIETARIO', 'ADMIN'])
    if error_resp:
        return error_resp, status

    negocio_id = payload.get("negocio_id")
    usuario = payload.get("usuario", "admin")
    conn = get_db_connection(payload.get("db_name"))
    cur = conn.cursor()

    try:
        cur.execute(
            """UPDATE productos.productos 
               SET activo = FALSE, modificado_por = %s, modificado_en = CURRENT_TIMESTAMP
               WHERE id = %s AND emprendimiento_id = %s AND tipo_producto = 'BIEN_DE_GASTO'""",
            (usuario, id, negocio_id)
        )
        if cur.rowcount == 0:
            return jsonify({"status": "error", "mensaje": "Bien de gasto no encontrado"}), 404
        conn.commit()
        return jsonify({"status": "ok", "mensaje": "Bien de gasto ocultado correctamente"}), 200
    finally:
        cur.close()
        conn.close()


# RESTAURAR BIEN DE GASTO OCULTO (PATCH /api/bienes-gasto/<id>/restaurar)
@app.route('/api/bienes-gasto/<int:id>/restaurar', methods=['PATCH'])
@app.route('/api/insumos/<int:id>/restaurar', methods=['PATCH'])
def restaurar_bien_gasto(id):
    """
    Revierte el ocultamiento lógico (activo = TRUE) de un insumo para devolverlo
    al listado principal de existencias activas y asienta la auditoría de modificación.
    """
    payload, error_resp, status = verificar_token(roles_permitidos=['PROPIETARIO', 'ADMIN'])
    if error_resp:
        return error_resp, status

    negocio_id = payload.get("negocio_id")
    usuario = payload.get("usuario", "admin")
    conn = get_db_connection(payload.get("db_name"))
    cur = conn.cursor()

    try:
        cur.execute(
            """UPDATE productos.productos 
               SET activo = TRUE, modificado_por = %s, modificado_en = CURRENT_TIMESTAMP
               WHERE id = %s AND emprendimiento_id = %s AND tipo_producto = 'BIEN_DE_GASTO'""",
            (usuario, id, negocio_id)
        )
        if cur.rowcount == 0:
            return jsonify({"status": "error", "mensaje": "Bien de gasto no encontrado"}), 404
        conn.commit()
        return jsonify({"status": "ok", "mensaje": "Bien de gasto restaurado correctamente"}), 200
    finally:
        cur.close()
        conn.close()


# ELIMINACIÓN FÍSICA PROTEGIDA (DELETE)
@app.route('/api/bienes-gasto/<int:id>', methods=['DELETE'])
@app.route('/api/insumos/<int:id>', methods=['DELETE'])
def eliminar_bien_gasto(id):
    """
    Elimina físicamente el consumible solo si no registra reposiciones ni movimientos.
    Si registra historial, bloquea con 409 Conflict exigiendo el uso de borrado lógico.
    """
    payload, error_resp, status = verificar_token(roles_permitidos=['PROPIETARIO', 'ADMIN'])
    if error_resp:
        return error_resp, status

    negocio_id = payload.get("negocio_id")
    conn = get_db_connection(payload.get("db_name"))
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        cur.execute(
            """SELECT id FROM productos.productos 
               WHERE id = %s AND emprendimiento_id = %s AND tipo_producto = 'BIEN_DE_GASTO'""",
            (id, negocio_id)
        )
        if not cur.fetchone():
            return jsonify({"status": "error", "mensaje": "Bien de gasto no encontrado"}), 404

        cur.execute("SELECT id FROM productos.reposiciones WHERE producto_id = %s LIMIT 1", (id,))
        if cur.fetchone():
            return jsonify({"status": "error", "mensaje": "No se puede eliminar: registra reposiciones contables. Utilice la opción de ocultar."}), 409

        cur.execute("SELECT id FROM productos.movimientos_stock WHERE producto_id = %s LIMIT 1", (id,))
        if cur.fetchone():
            return jsonify({"status": "error", "mensaje": "No se puede eliminar: registra movimientos en Kardex. Utilice la opción de ocultar."}), 409

        cur.execute("DELETE FROM productos.productos WHERE id = %s AND emprendimiento_id = %s", (id, negocio_id))
        conn.commit()
        return jsonify({"status": "ok", "mensaje": "Bien de gasto eliminado definitivamente"}), 200

    finally:
        cur.close()
        conn.close()

if __name__ == '__main__':
    port = int(os.getenv("SERVICE_PORT", 5004))
    print(f" Microservicio Finanzas activo en http://127.0.0.1:{port}")
    app.run(host='127.0.0.1', port=port, debug=True)