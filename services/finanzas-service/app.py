"""
PROYECTO TRAZZO - MICROSERVICIO DE FINANZAS (finanzas-service)
Puerto: 5004
Dominio: Medios de Pago y Gastos Operativos
Esquema de BD: finanzas.*
"""
from flask import Flask, request, jsonify
import os
import datetime
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

def get_db_connection():
    return psycopg2.connect(
        host=os.getenv("DB_HOST", "127.0.0.1"),
        database=os.getenv("DB_NAME", "trazzo"),
        user=os.getenv("DB_USER", "postgres"),
        password=os.getenv("DB_PASSWORD"),
        port=os.getenv("DB_PORT", "5432"),
        options="-c search_path=finanzas,public"
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
        # Aseguramos que el comercio tenga al menos "Efectivo" creado por defecto.
        # El ON CONFLICT (emprendimiento_id, lower(nombre)) DO NOTHING aprovecha el índice único de la tabla; si el registro ya existe, la base ignora la inserción sin lanzar errores.
        cur.execute(
            """INSERT INTO finanzas.medios_pago (emprendimiento_id, nombre, es_predeterminado, activo)
               VALUES (%s, 'Efectivo', TRUE, TRUE)
               ON CONFLICT (emprendimiento_id, lower(nombre)) DO NOTHING""",
            (negocio_id,)
        )
        conn.commit()

        # Obtenemos todos los medios de pago activos
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
    """Alta de un nuevo medio de pago (solo Propietario o Admin)."""
    payload, error_resp, status = verificar_token(roles_permitidos=['PROPIETARIO', 'ADMIN'])
    if error_resp:
        return error_resp, status

    negocio_id = payload.get("negocio_id")
    datos = request.get_json(silent=True) or {}
    nombre = (datos.get('nombre') or '').strip()

    if not nombre:
        return jsonify({"status": "error", "mensaje": "El nombre del medio de pago es obligatorio"}), 400
    if len(nombre) > 50:
        return jsonify({"status": "error", "mensaje": "El nombre no puede superar los 50 caracteres"}), 400

    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute(
            """INSERT INTO finanzas.medios_pago (emprendimiento_id, nombre, es_predeterminado, activo)
               VALUES (%s, %s, FALSE, TRUE)
               RETURNING id, nombre, es_predeterminado""",
            (negocio_id, nombre)
        )
        nuevo = cur.fetchone()
        conn.commit()
        return jsonify({"status": "ok", "mensaje": "Medio de pago creado", "medio_pago": nuevo}), 201
    
    # La base tiene la restricción uq_medio_pago_nombre_tenant. En lugar de hacer un SELECT previo que genera condiciones de carrera (race conditions), 
    # se intenta el INSERT directamente dentro de un bloque try. 
    # Si el nombre ya está registrado, PostgreSQL dispara un IntegrityError, el cual se captura para ejecutar conn.rollback() y responder 409 Conflict.
    except psycopg2.IntegrityError:
        conn.rollback()
        return jsonify({"status": "error", "mensaje": "Ya existe un medio de pago con ese nombre"}), 409
    finally:
        cur.close()
        conn.close()

# Actualizar medios de pagos (PUT /api/medios-pago)
@app.route('/api/medios-pago/<int:medio_id>', methods=['PUT'])
def actualizar_medio_pago(medio_id):
    """Actualiza el nombre de un medio de pago."""
    payload, error_resp, status = verificar_token(roles_permitidos=['PROPIETARIO', 'ADMIN'])
    if error_resp:
        return error_resp, status

    negocio_id = payload.get("negocio_id")
    datos = request.get_json(silent=True) or {}
    nuevo_nombre = (datos.get('nombre') or '').strip()

    if not nuevo_nombre:
        return jsonify({"status": "error", "mensaje": "El nombre es obligatorio"}), 400

    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute(
            """UPDATE finanzas.medios_pago 
               SET nombre = %s 
               WHERE id = %s AND emprendimiento_id = %s
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
        return jsonify({"status": "error", "mensaje": "Ya existe otro medio de pago con ese nombre"}), 409
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
    Lista los gastos operativos del negocio con filtrado opcional por período (?desde=YYYY-MM-DD&hasta=YYYY-MM-DD).
    Calcula la sumatoria total en tiempo real mediante SQL SUM() (nunca persistida fija).
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
        # LEFT JOIN con Medios de Pago: Vincula el nombre del medio utilizado. 
        # Es un LEFT JOIN porque medio_pago_id admite valores NULL según el modelo relacional.
        query = """
            SELECT g.id, g.fecha, g.concepto, g.monto, g.medio_pago_id, 
                   m.nombre AS medio_pago_nombre, g.creado_por, g.creado_en
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

        query += " ORDER BY g.fecha DESC, g.id DESC"
        cur.execute(query, tuple(params))
        gastos = cur.fetchall()

        # Cálculo dinámico de sumatoria total del período consultado:
        # Las sumatorias nunca se persisten de forma fija en la base de datos para evitar desfasajes ante modificaciones o bajas de comprobantes.
        total_acumulado = sum(float(g['monto']) for g in gastos)

        # Formateo de fechas
        for g in gastos:
            g['fecha'] = g['fecha'].isoformat()
            g['monto'] = float(g['monto'])
            g['creado_en'] = g['creado_en'].isoformat()

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
    """Registra un nuevo gasto operativo. Fecha no futura y monto > 0 obligatorios."""
    payload, error_resp, status = verificar_token(roles_permitidos=['PROPIETARIO', 'ADMIN'])
    if error_resp:
        return error_resp, status

    negocio_id = payload.get("negocio_id")
    creador = payload.get("usuario", "admin")
    datos = request.get_json(silent=True) or {}

    concepto = (datos.get('concepto') or '').strip()
    fecha_str = datos.get('fecha')
    medio_pago_id = datos.get('medio_pago_id')

    try:
        monto = float(datos.get('monto') or 0)
    except (ValueError, TypeError):
        return jsonify({"status": "error", "mensaje": "El monto debe ser un número válido"}), 400

    if not concepto:
        return jsonify({"status": "error", "mensaje": "El concepto del gasto es obligatorio"}), 400
    if monto <= 0:
        return jsonify({"status": "error", "mensaje": "El monto del gasto debe ser mayor a cero"}), 400

    # Validación de fecha (por defecto hoy, no admite fechas futuras)
    if fecha_str:
        try:
            fecha_gasto = datetime.date.fromisoformat(fecha_str)
        except ValueError:
            return jsonify({"status": "error", "mensaje": "Formato de fecha inválido (use YYYY-MM-DD)"}), 400
    else:
        fecha_gasto = datetime.date.today()

    # Regla fiscal y temporal: 
    # La base contiene la restricción chk_gasto_fecha_no_futura CHECK (fecha <= CURRENT_DATE). 
    # El backend valida esta condición antes de emitir la consulta para devolver una respuesta clara en caso de error.
    if fecha_gasto > datetime.date.today():
        return jsonify({"status": "error", "mensaje": "No se pueden registrar gastos con fecha futura"}), 400

    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute(
            """INSERT INTO finanzas.gastos_operativos 
               (emprendimiento_id, medio_pago_id, fecha, concepto, monto, creado_por, activo)
               VALUES (%s, %s, %s, %s, %s, %s, TRUE)
               RETURNING id, fecha, concepto, monto, medio_pago_id, creado_por, creado_en""",
            (negocio_id, medio_pago_id, fecha_gasto, concepto, monto, creador)
        )
        nuevo_gasto = cur.fetchone()
        conn.commit()

        nuevo_gasto['fecha'] = nuevo_gasto['fecha'].isoformat()
        nuevo_gasto['monto'] = float(nuevo_gasto['monto'])
        nuevo_gasto['creado_en'] = nuevo_gasto['creado_en'].isoformat()

        return jsonify({"status": "ok", "mensaje": "Gasto registrado exitosamente", "gasto": nuevo_gasto}), 201
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

if __name__ == '__main__':
    port = int(os.getenv("SERVICE_PORT", 5004))
    print(f" Microservicio Finanzas activo en http://127.0.0.1:{port}")
    app.run(host='127.0.0.1', port=port, debug=True)