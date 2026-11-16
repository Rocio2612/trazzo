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


def get_db_connection():
    """
    Abre una conexión TCP física contra PostgreSQL.
    Configura search_path en finanzas, productos, auth y public para resolver tablas entre esquemas.
    """
    return psycopg2.connect(
        host=os.getenv("DB_HOST"),
        database=os.getenv("DB_NAME"),
        user=os.getenv("DB_USER", "postgres"),
        password=os.getenv("DB_PASSWORD"),
        port=os.getenv("DB_PORT", "5432"),
        options="-c search_path=finanzas,productos,auth,public"
        # Le indica a PostgreSQL a qué esquema debe apuntar por defecto en cada consulta de esta conexión. 
    )

# Validación de Identidad y Roles (verificar_token)
def verificar_token(roles_permitidos=None):
    """
    Valida el token JWT simétrico de la cabecera Authorization.
    Aisla la operación recuperando el 'negocio_id' y aplica RBAC según el rol.
    """
    auth_header = request.headers.get('Authorization')
    if not auth_header or not auth_header.startswith('Bearer '):
        return None, jsonify({"status": "error", "mensaje": "Token no proporcionado"}), 401

    token = auth_header.split(" ")[1]
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
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
    conn = get_db_connection()
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

    conn = get_db_connection()
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

    conn = get_db_connection()
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
    conn = get_db_connection()
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

    conn = get_db_connection()
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

    conn = get_db_connection()
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

    conn = get_db_connection()
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
    conn = get_db_connection()
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
    Calcula valorTotal dinámico (cantidad * precio_compra) y suma al patrimonio solo los activos.
    """
    payload, error_resp, status = verificar_token(roles_permitidos=['PROPIETARIO', 'ADMIN'])
    if error_resp:
        return error_resp, status

    negocio_id = payload.get("negocio_id")
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        # Ejecuta una consulta SQL relacional con dos LEFT JOIN hacia productos.proveedores y productos.categorias.
        # Aplica tres filtros concurrentes:
        # p.emprendimiento_id = %s: asegura aislamiento multi-tenant (solo trae bienes del comercio en sesión).   
        # p.tipo_producto = 'BIEN_DE_USO': discrimina los activos fijos de la mercadería y de los consumibles.   
        # p.activo = TRUE: excluye los bienes que fueron dados de baja u ocultados lógicamente.  
        # CAMBIO: Quitamos 'AND p.activo = TRUE' del WHERE para devolver activos y ocultos con su bandera correspondiente
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

            # El resumen patrimonial suma únicamente los bienes activos (activo = TRUE)
            if esta_activo:
                # actúa como acumulador contable sumando en vivo el valor monetario de todos los activos fijos del negocio.
                patrimonio_total += subtotal
                # acumula el volumen físico de unidades operativas.
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
    Reglas: tipo_producto = 'BIEN_DE_USO', unidad_medida = 'unidades', precio_venta = 0.
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

    if not nombre or not proveedor_id:
        return jsonify({"status": "error", "mensaje": "Nombre y proveedor son obligatorios"}), 400
    if precio_compra <= 0 or cantidad < 0 or stock_minimo < 0:
        return jsonify({"status": "error", "mensaje": "El costo debe ser mayor a cero y las cantidades no pueden ser negativas"}), 400

    # Si envían fecha_adquisicion (YYYY-MM-DD), la convertimos a timestamp; si no, usa CURRENT_TIMESTAMP
    fecha_registro_dt = None
    if fecha_adq_str:
        try:
            fecha_solo = datetime.date.fromisoformat(fecha_adq_str[:10])
            fecha_registro_dt = datetime.datetime.combine(fecha_solo, datetime.time(12, 0), tzinfo=TZ_ARGENTINA)
        except ValueError:
            return jsonify({"status": "error", "mensaje": "Formato de fecha_adquisicion inválido (use YYYY-MM-DD)"}), 400

    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        #Ejecuta el INSERT INTO productos.productos asignando valores fijos obligatorios por modelo de negocio:
        # tipo_producto = 'BIEN_DE_USO' (clasificación patrimonial).   
        # precio_venta = 0.00 y rentabilidad = 0.00 (las máquinas no son mercadería para venta minorista).   
        # unidad_medida = 'unidades' (regla de enteros).   
        # creado_por = creador (auditoría automática extraída del token). 

        #Usa la cláusula RETURNING id, nombre, precio_compra, cantidad, creado_en para capturar en un solo paso los valores finales asignados por PostgreSQL.
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

@app.route('/api/bienes-uso/<int:id>/ocultar', methods=['PATCH'])
@app.route('/api/finanzas/bienes-uso/<int:id>/ocultar', methods=['PATCH'])
def ocultar_bien_uso(id):
    """Borrado lógico (activo = FALSE) de un bien de uso."""
    payload, error_resp, status = verificar_token(roles_permitidos=['PROPIETARIO', 'ADMIN'])
    if error_resp:
        return error_resp, status

    negocio_id = payload.get("negocio_id")
    usuario = payload.get("usuario", "admin")
    conn = get_db_connection()
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
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    # Implementa una política de borrado físico protegido con validación de integridad contable. 
    # Antes de emitir una orden de destrucción de datos, comprueba sistemáticamente que el registro no tenga historial operativo asociado.
    try:
        # Implementa una política de borrado físico protegido con validación de integridad contable. Antes de emitir una orden de destrucción de datos, comprueba sistemáticamente que el registro no tenga historial operativo asociado.
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
    - Excluye registros desactivados (activo = TRUE).
    - Computa en tiempo de ejecución el valor total del inventario consumible.
    - Devuelve 'fecha', 'creado_en', 'activo' y 'oculto' para soportar el botón 'Ver ocultos' en Front.
    """
    # Verificación de credenciales JWT (Administrador o Propietario)
    payload, error_resp, status = verificar_token(roles_permitidos=['PROPIETARIO', 'ADMIN'])
    if error_resp:
        return error_resp, status

    negocio_id = payload.get("negocio_id")
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        # Consulta relacional vinculando proveedor y categoría asignada
        # CAMBIO: Se incluyo p.creado_en y quitamos 'AND p.activo = TRUE' para que la pantalla pueda filtrar ocultos
        cur.execute(
            """SELECT p.id, p.nombre, p.precio_compra, p.cantidad, p.stock_minimo,
                      p.iva_alicuota, p.activo, p.creado_en, p.proveedor_id, pr.nombre AS proveedor_nombre,
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
    Registra un nuevo artículo consumible en el catálogo unificado.
    Reglas de negocio:
    - tipo_producto fijado en 'BIEN_DE_GASTO'.
    - precio_venta = 0.00 y rentabilidad = 0.00 (no están destinados a la reventa).
    - unidad_medida fijada en 'unidades' según restricciones de integridad de la base.
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

    # Validación de tipos de datos numéricos
    try:
        precio_compra = float(datos.get('precio_compra') or datos.get('costo') or 0)
        cantidad = int(datos.get('cantidad', 0))
        stock_minimo = int(datos.get('stock_minimo', 0))
        iva_alicuota = float(datos.get('iva_alicuota', 21.00))
    except (ValueError, TypeError):
        return jsonify({"status": "error", "mensaje": "Las cantidades y costos deben contener valores numéricos válidos"}), 400

    # Validaciones obligatorias de campos
    if not nombre or not proveedor_id:
        return jsonify({"status": "error", "mensaje": "El nombre y el proveedor son obligatorios"}), 400
    if precio_compra <= 0 or cantidad < 0 or stock_minimo < 0:
        return jsonify({"status": "error", "mensaje": "El costo debe ser positivo y las cantidades no pueden ser negativas"}), 400

    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        cur.execute(
            """INSERT INTO productos.productos 
               (emprendimiento_id, proveedor_id, categoria_id, tipo_producto, nombre,
                precio_compra, iva_alicuota, rentabilidad, precio_venta, cantidad, stock_minimo,
                unidad_medida, activo, creado_por)
               VALUES (%s, %s, %s, 'BIEN_DE_GASTO', %s, %s, %s, 0.00, 0.00, %s, %s, 'unidades', TRUE, %s)
               RETURNING id, nombre, precio_compra, cantidad, stock_minimo, creado_en""",
            (negocio_id, proveedor_id, categoria_id, nombre, precio_compra, iva_alicuota, cantidad, stock_minimo, creador)
        )
        nuevo_item = cur.fetchone()
        conn.commit()

        # Formateo de respuesta
        nuevo_item['costo_unitario'] = float(nuevo_item.pop('precio_compra'))
        nuevo_item['cantidad'] = int(nuevo_item['cantidad'])
        nuevo_item['stock_minimo'] = int(nuevo_item['stock_minimo'])
        nuevo_item['creado_en'] = formatear_utc_z(nuevo_item['creado_en'])

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


# REPOSICIÓN DE STOCK DE BIEN DE GASTO (POST)
@app.route('/api/bienes-gasto/<int:id>/reposicion', methods=['POST'])
@app.route('/api/insumos/<int:id>/reposicion', methods=['POST'])
def reponer_bien_gasto(id):
    """
    Abastecimiento de existencias para bienes consumibles:
    1. Resuelve la condición tributaria negocio-proveedor (discriminación de IVA).
    2. Inserta la compra en productos.reposiciones.
    3. Suma el stock e impacta el nuevo costo en productos.productos.
    4. Asienta la entrada en el Kardex (productos.movimientos_stock) con tipo 'REPOSICION'.
    Nota contable: La reposición NO computa como pérdida operativa hasta que no se consuma.
    """
    payload, error_resp, status = verificar_token(roles_permitidos=['PROPIETARIO', 'ADMIN'])
    if error_resp:
        return error_resp, status

    negocio_id = payload.get("negocio_id")
    usuario = payload.get("usuario", "admin")
    datos = request.get_json(silent=True) or {}
    proveedor_id = datos.get('proveedor_id')

    try:
        cantidad = int(datos.get('cantidad', 0))
        monto_total = float(datos.get('monto_total', 0))
    except (ValueError, TypeError):
        return jsonify({"status": "error", "mensaje": "Cantidad y monto total deben ser números válidos"}), 400

    if cantidad <= 0 or monto_total <= 0 or not proveedor_id:
        return jsonify({"status": "error", "mensaje": "Cantidad (>0), monto total (>0) y proveedor_id son obligatorios"}), 400

    conn = get_db_connection()
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

        # Registro en tabla de compras
        cur.execute(
            """INSERT INTO productos.reposiciones 
               (emprendimiento_id, producto_id, proveedor_id, cantidad, monto_total, costo_unitario_real, fecha_adquisicion, estado, creado_por)
               VALUES (%s, %s, %s, %s, %s, %s, CURRENT_DATE, 'ACTIVA', %s)
               RETURNING id""",
            (negocio_id, id, proveedor_id, cantidad, monto_total, costo_unitario_real, usuario)
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
    Registra el consumo interno de un bien de gasto:
    - Descuenta las existencias físicas en productos.productos.
    - Bloquea la transacción si la cantidad a consumir supera el stock disponible.
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

    try:
        cantidad_consumo = int(datos.get('cantidad', 0))
    except (ValueError, TypeError):
        return jsonify({"status": "error", "mensaje": "La cantidad consumida debe ser un número entero"}), 400

    if cantidad_consumo <= 0:
        return jsonify({"status": "error", "mensaje": "La cantidad a consumir debe ser mayor a cero"}), 400

    conn = get_db_connection()
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

        # Salida por consumo en Kardex
        cur.execute(
            """INSERT INTO productos.movimientos_stock 
               (emprendimiento_id, producto_id, tipo, cantidad_movimiento, stock_resultante, motivo, usuario)
               VALUES (%s, %s, 'CONSUMO', %s, %s, %s, %s)""",
            (negocio_id, id, -cantidad_consumo, nuevo_stock, motivo, usuario)
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

    conn = get_db_connection()
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
            m['fecha'] = m['fecha'].isoformat()
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
    conn = get_db_connection()
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
    conn = get_db_connection()
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