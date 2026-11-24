"""
MÓDULO 9: CUENTA CORRIENTE COMERCIAL Y PAGOS (routes/pagos.py) — Responsable: Aldi
Implementa toda la gestión de cobros de ventas a cuenta corriente y el cálculo
de saldos sobre las tablas 'ventas.pagos', 'ventas.ventas' y 'ventas.clientes'
(dentro de la base física de cada comercio en sesión):
  1. Cálculo en vivo del saldo pendiente (sin columna redundante en BD):
     saldo_pendiente = total_venta - SUM(pagos con estado = 'ACTIVO').
     Si llega a $0 la venta figura como SALDADA; si es > $0 figura como PENDIENTE.
  2. Registro de cobros y excedente automático a 'saldo_a_favor' (POST /api/pagos):
     Si el cliente entrega un monto mayor al saldo pendiente de esa venta, se
     aplica lo necesario para saldarla y la diferencia se suma automáticamente a
     ventas.clientes.saldo_a_favor dentro de la misma transacción atómica.
  3. Listado de cuentas corrientes y detalle de pagos (GET /api/pagos y
     GET /api/pagos/cuentas-corrientes):
     Respeta la privacidad por rol (Ley N° 25.326): el CAJERO nunca recibe
     datos personales ni saldos a favor del cliente.
  4. Edición, anulación sin borrado y visibilidad (Solo Admin / Propietario):
     - PUT /api/pagos/<id>               -> Corrige monto, medio de pago o fecha.
     - PATCH /api/pagos/<id>/anular      -> Pasa estado a 'ANULADO' sin borrar el
                                            registro y recalcula la deuda al instante.
     - PATCH /api/pagos/<id>/visibilidad -> Oculta o restaura visualmente un pago
                                            (oculto = TRUE/FALSE) SIN excluir su monto
                                            del saldo pendiente ni de Reportes.
  5. Resumen financiero interno (GET /internal/pagos/resumen):
     Provee a reportes-service (5005) los ingresos reales cobrados (contado +
     cuenta corriente), el total por cobrar y los saldos a favor vigentes.

REGLAS DE SEGURIDAD Y ARQUITECTURA:
  - Multi-tenant: Cada petición abre conexión contra 'payload["db_name"]' del JWT.
  - Control de roles: Cajero y Admin pueden registrar cobros; solo Admin/Propietario
    puede editar, ocultar, restaurar o anular pagos.
"""

# Importamos datetime para validar que no se registren pagos con fechas futuras y formatear timestamps
import datetime
# Importamos Blueprint, request y jsonify de Flask para definir las rutas del módulo y responder JSON
from flask import Blueprint, request, jsonify
# Importamos RealDictCursor para que PostgreSQL devuelva cada fila como diccionario {columna: valor}
from psycopg2.extras import RealDictCursor
# Importamos desde helpers.py la conexión dinámica multi-base y la validación de tokens JWT
from helpers import get_db_connection, verificar_token

# Creamos el Blueprint de Pagos que luego se registra en app.py
pagos_bp = Blueprint('pagos', __name__)

# Definimos los grupos de roles autorizados para reutilizar en cada endpoint
ROLES_ADMIN = ['PROPIETARIO', 'ADMIN']
TODOS_LOS_ROLES = ['PROPIETARIO', 'ADMIN', 'CAJERO']

# Zona horaria oficial de Argentina (UTC-3) para comparar fechas sin desfases cerca de medianoche
ZONA_AR = datetime.timezone(datetime.timedelta(hours=-3))


# FUNCIONES AUXILIARES DE CÁLCULO, FECHAS Y SERIALIZACIÓN
def calcular_saldo_venta(cur, venta_id, emprendimiento_id):
    """
    Calcula en vivo el estado financiero de una venta:
      saldo_pendiente = total - SUM(pagos con estado = 'ACTIVO').
    Nota: Los pagos con oculto = TRUE SÍ se incluyen en la suma mientras su estado sea 'ACTIVO'.
    Retorna un diccionario con los datos de la venta y su saldo actual, o None si no existe.
    """
    # Consultamos la cabecera de la venta y sumamos únicamente los pagos con estado 'ACTIVO'
    cur.execute("""
        SELECT
            v.id AS venta_id,
            v.numero_venta,
            v.cliente_id,
            v.tipo_venta,
            v.estado AS estado_venta,
            v.total,
            COALESCE(SUM(p.monto) FILTER (WHERE p.estado = 'ACTIVO'), 0) AS total_pagado
        FROM ventas.ventas v
        LEFT JOIN ventas.pagos p ON p.venta_id = v.id
        WHERE v.id = %s AND v.emprendimiento_id = %s
        GROUP BY v.id, v.numero_venta, v.cliente_id, v.tipo_venta, v.estado, v.total
    """, (venta_id, emprendimiento_id))

    fila = cur.fetchone()
    if not fila:
        return None

    # Convertimos Decimal a float redondeado a 2 decimales para operar con exactitud monetaria
    total = round(float(fila["total"] or 0), 2)
    total_pagado = round(float(fila["total_pagado"] or 0), 2)
    # Usamos max(..., 0.0) como resguardo ante cualquier redondeo mínimo
    saldo_pendiente = max(round(total - total_pagado, 2), 0.0)

    return {
        "venta_id": fila["venta_id"],
        "numero_venta": fila["numero_venta"],
        "cliente_id": fila["cliente_id"],
        "tipo_venta": fila["tipo_venta"],
        "estado_venta": fila["estado_venta"],
        "total": total,
        "total_pagado": total_pagado,
        "saldo_pendiente": saldo_pendiente,
        "estado_cuenta": "SALDADA" if saldo_pendiente == 0 else "PENDIENTE"
    }


def parsear_fecha_pago(fecha_raw):
    """
    Valida y convierte la fecha de pago enviada por el cliente:
      - Si no se envía (None o vacío), retorna la marca temporal actual en UTC.
      - Si se envía 'YYYY-MM-DD' o formato ISO completo, verifica que no sea una fecha futura.
    Retorna (objeto_datetime_utc, mensaje_error).
    """
    ahora_utc = datetime.datetime.now(datetime.timezone.utc)
    hoy_ar = datetime.datetime.now(ZONA_AR).date()

    # Si no se especificó fecha, usamos el instante actual del servidor
    if not fecha_raw or str(fecha_raw).strip() == "":
        return ahora_utc, None

    texto = str(fecha_raw).strip()
    try:
        # Caso 1: Viene solo la fecha en formato 'YYYY-MM-DD' (ej. '2026-11-24')
        if len(texto) == 10:
            fecha_date = datetime.date.fromisoformat(texto)
            if fecha_date > hoy_ar:
                return None, "La fecha de pago no puede ser posterior a la fecha actual"
            # Asociamos la hora actual en zona Argentina y la pasamos a UTC para guardarla en TIMESTAMPTZ
            hora_actual_ar = datetime.datetime.now(ZONA_AR).time()
            dt_ar = datetime.datetime.combine(fecha_date, hora_actual_ar, tzinfo=ZONA_AR)
            return dt_ar.astimezone(datetime.timezone.utc), None

        # Caso 2: Viene fecha y hora ISO completa (ej. '2026-11-24T15:30:00Z')
        dt = datetime.datetime.fromisoformat(texto.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=ZONA_AR)
        if dt.astimezone(ZONA_AR).date() > hoy_ar:
            return None, "La fecha de pago no puede ser posterior a la fecha actual"
        return dt.astimezone(datetime.timezone.utc), None

    except ValueError:
        return None, "Formato de fecha inválido. Use YYYY-MM-DD o ISO 8601"


def serializar_pago(row, rol):
    """
    Formatea un registro de ventas.pagos para la respuesta JSON:
      - Para CAJERO: omite datos sensibles del cliente (solo devuelve id y nombre).
      - Para ADMIN / PROPIETARIO: incluye datos completos de visibilidad y auditoría.
    """
    pago_base = {
        "id": row["id"],
        "venta_id": row["venta_id"],
        "numero_venta": row.get("numero_venta"),
        "tipo_venta": row.get("tipo_venta"),
        "cliente_id": row.get("cliente_id"),
        "cliente_nombre": row.get("cliente_nombre"),
        "medio_pago_id": row["medio_pago_id"],
        "medio_pago_nombre": row.get("medio_pago_nombre"),
        "monto": round(float(row["monto"] or 0), 2),
        "fecha_pago": row["fecha_pago"].isoformat() if row.get("fecha_pago") else None,
        "estado": row["estado"],
        "creado_por": row["creado_por"]
    }

    # Si es Cajero, retornamos únicamente la información operativa sin campos administrativos
    if rol == 'CAJERO':
        return pago_base

    # Para Admin/Propietario sumamos el estado de ocultamiento y la trazabilidad completa
    pago_base.update({
        "emprendimiento_id": row["emprendimiento_id"],
        "sucursal_id": row["sucursal_id"],
        "oculto": row["oculto"],
        "modificado_por": row.get("modificado_por"),
        "modificado_en": row["modificado_en"].isoformat() if row.get("modificado_en") else None,
        "anulado_por": row.get("anulado_por"),
        "anulado_en": row["anulado_en"].isoformat() if row.get("anulado_en") else None
    })
    return pago_base

# ENDPOINTS PÚBLICOS (CONSUMIDOS POR EL FRONTEND A TRAVÉS DEL GATEWAY)
# 1. LISTAR VENTAS A CUENTA CORRIENTE CON SALDO EN VIVO (GET /api/pagos/cuentas-corrientes)
@pagos_bp.route('/api/pagos/cuentas-corrientes', methods=['GET'])
def listar_cuentas_corrientes():
    # Permitimos acceso a Propietario, Admin y Cajero para consultar saldos pendientes
    payload, error_resp, code = verificar_token(TODOS_LOS_ROLES)
    if error_resp:
        return error_resp, code

    rol = payload.get("rol")
    emprendimiento_id = payload.get("negocio_id")
    db_name = payload.get("db_name")

    # Filtros opcionales desde query params (?cliente_id=, ?solo_pendientes=true, ?q=texto)
    cliente_id = request.args.get('cliente_id', type=int)
    solo_pendientes = request.args.get('solo_pendientes', 'false').lower() == 'true'
    busqueda = (request.args.get('q') or '').strip()

    conn = None
    cur = None
    try:
        conn = get_db_connection(db_name)
        cur = conn.cursor(cursor_factory=RealDictCursor)

        # Obtenemos todas las ventas confirmadas de tipo CUENTA_CORRIENTE calculando su saldo en vivo
        query = """
            SELECT
                v.id AS venta_id,
                v.numero_venta,
                v.fecha_hora,
                v.cliente_id,
                c.nombre_razon_social AS cliente_nombre,
                c.saldo_a_favor AS cliente_saldo_a_favor,
                v.total,
                COALESCE(SUM(p.monto) FILTER (WHERE p.estado = 'ACTIVO'), 0) AS total_pagado
            FROM ventas.ventas v
            JOIN ventas.clientes c ON c.id = v.cliente_id
            LEFT JOIN ventas.pagos p ON p.venta_id = v.id
            WHERE v.emprendimiento_id = %s
              AND v.estado = 'CONFIRMADA'
              AND v.tipo_venta = 'CUENTA_CORRIENTE'
        """
        params = [emprendimiento_id]

        # Filtramos por cliente puntual si se solicitó
        if cliente_id:
            query += " AND v.cliente_id = %s"
            params.append(cliente_id)

        # Filtramos por número de comprobante o nombre de cliente si se ingresó búsqueda
        if busqueda:
            query += " AND (v.numero_venta ILIKE %s OR c.nombre_razon_social ILIKE %s)"
            params.extend([f"%{busqueda}%", f"%{busqueda}%"])

        query += """
            GROUP BY v.id, v.numero_venta, v.fecha_hora, v.cliente_id,
                     c.nombre_razon_social, c.saldo_a_favor, v.total
            ORDER BY v.fecha_hora DESC, v.id DESC
        """

        cur.execute(query, tuple(params))
        filas = cur.fetchall()

        items = []
        for f in filas:
            total = round(float(f["total"] or 0), 2)
            pagado = round(float(f["total_pagado"] or 0), 2)
            saldo = max(round(total - pagado, 2), 0.0)

            # Si se pidió ?solo_pendientes=true, omitimos las ventas que ya tienen saldo 0
            if solo_pendientes and saldo == 0:
                continue

            item = {
                "venta_id": f["venta_id"],
                "numero_venta": f["numero_venta"],
                "fecha_hora": f["fecha_hora"].isoformat() if f.get("fecha_hora") else None,
                "cliente_id": f["cliente_id"],
                "cliente_nombre": f["cliente_nombre"],
                "total": total,
                "total_pagado": pagado,
                "saldo_pendiente": saldo,
                "estado_cuenta": "SALDADA" if saldo == 0 else "PENDIENTE"
            }

            # Solo Admin/Propietario recibe el saldo a favor del cliente (privacidad Ley 25.326)
            if rol in ROLES_ADMIN:
                item["saldo_a_favor_cliente"] = round(float(f["cliente_saldo_a_favor"] or 0), 2)

            items.append(item)

        return jsonify({"status": "ok", "items": items}), 200

    except Exception as e:
        return jsonify({"status": "error", "mensaje": f"Error al consultar cuentas corrientes: {str(e)}"}), 500
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()


# 2. LISTAR PAGOS REGISTRADOS (GET /api/pagos)
@pagos_bp.route('/api/pagos', methods=['GET'])
def listar_pagos():
    payload, error_resp, code = verificar_token(TODOS_LOS_ROLES)
    if error_resp:
        return error_resp, code

    rol = payload.get("rol")
    emprendimiento_id = payload.get("negocio_id")
    db_name = payload.get("db_name")

    # Parámetros opcionales de filtrado
    venta_id = request.args.get('venta_id', type=int)
    cliente_id = request.args.get('cliente_id', type=int)
    incluir_ocultos = request.args.get('incluir_ocultos', 'false').lower() == 'true'
    todos_los_tipos = request.args.get('todos', 'false').lower() == 'true'

    conn = None
    cur = None
    try:
        conn = get_db_connection(db_name)
        cur = conn.cursor(cursor_factory=RealDictCursor)

        # Unimos pagos con ventas, clientes y medios_pago para devolver los nombres listos para mostrar
        query = """
            SELECT
                p.*,
                v.numero_venta,
                v.tipo_venta,
                v.cliente_id,
                c.nombre_razon_social AS cliente_nombre,
                mp.nombre AS medio_pago_nombre
            FROM ventas.pagos p
            JOIN ventas.ventas v ON v.id = p.venta_id
            LEFT JOIN ventas.clientes c ON c.id = v.cliente_id
            JOIN finanzas.medios_pago mp ON mp.id = p.medio_pago_id
            WHERE p.emprendimiento_id = %s
        """
        params = [emprendimiento_id]

        # Si no se pidió una venta puntual ni ?todos=true, mostramos los cobros de Cuenta Corriente
        if not venta_id and not todos_los_tipos:
            query += " AND v.tipo_venta = 'CUENTA_CORRIENTE'"

        if venta_id:
            query += " AND p.venta_id = %s"
            params.append(venta_id)

        if cliente_id:
            query += " AND v.cliente_id = %s"
            params.append(cliente_id)

        # Los pagos ocultos solo se muestran si un Admin/Propietario envía ?incluir_ocultos=true
        if rol == 'CAJERO' or not incluir_ocultos:
            query += " AND p.oculto = FALSE"

        query += " ORDER BY p.fecha_pago DESC, p.id DESC"

        cur.execute(query, tuple(params))
        filas = cur.fetchall()

        items = [serializar_pago(fila, rol) for fila in filas]
        return jsonify({"status": "ok", "items": items}), 200

    except Exception as e:
        return jsonify({"status": "error", "mensaje": f"Error al listar pagos: {str(e)}"}), 500
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()


# 3. REGISTRAR COBRO EN CUENTA CORRIENTE + EXCEDENTE A SALDO A FAVOR (POST /api/pagos)
@pagos_bp.route('/api/pagos', methods=['POST'])
def registrar_pago():
    # Tanto Admin/Propietario como Cajero pueden registrar cobros de clientes
    payload, error_resp, code = verificar_token(TODOS_LOS_ROLES)
    if error_resp:
        return error_resp, code

    rol = payload.get("rol")
    emprendimiento_id = payload.get("negocio_id")
    sucursal_id = payload.get("sucursal_id", 1)
    usuario = payload.get("nombre") or payload.get("usuario") or "sistema"
    db_name = payload.get("db_name")

    datos = request.get_json(silent=True) or {}
    venta_id = datos.get('venta_id')
    medio_pago_id = datos.get('medio_pago_id')
    monto_raw = datos.get('monto')
    fecha_raw = datos.get('fecha_pago')

    # Validamos presencia de campos obligatorios
    if not venta_id or not medio_pago_id or monto_raw is None:
        return jsonify({
            "status": "error",
            "mensaje": "Los campos venta_id, medio_pago_id y monto son obligatorios"
        }), 400

    # Validamos que el monto sea numérico y estrictamente mayor a cero
    try:
        monto_entregado = round(float(monto_raw), 2)
    except (TypeError, ValueError):
        return jsonify({"status": "error", "mensaje": "El monto debe ser un valor numérico válido"}), 400

    if monto_entregado <= 0:
        return jsonify({"status": "error", "mensaje": "El monto del pago debe ser mayor a cero"}), 400

    # Validamos que la fecha de pago tenga formato correcto y no sea futura
    fecha_pago_dt, error_fecha = parsear_fecha_pago(fecha_raw)
    if error_fecha:
        return jsonify({"status": "error", "mensaje": error_fecha}), 400

    conn = None
    cur = None
    try:
        conn = get_db_connection(db_name)
        cur = conn.cursor(cursor_factory=RealDictCursor)

        # 1. Verificamos que el medio de pago exista en el comercio y esté activo
        cur.execute("""
            SELECT id, nombre, activo
            FROM finanzas.medios_pago
            WHERE id = %s AND emprendimiento_id = %s
        """, (medio_pago_id, emprendimiento_id))
        medio_pago = cur.fetchone()

        if not medio_pago:
            return jsonify({"status": "error", "mensaje": "El medio de pago seleccionado no existe"}), 404
        if not medio_pago["activo"]:
            return jsonify({"status": "error", "mensaje": "El medio de pago seleccionado está inactivo"}), 400

        # 2. Verificamos la venta y calculamos su saldo pendiente actual en vivo
        estado_venta = calcular_saldo_venta(cur, venta_id, emprendimiento_id)
        if not estado_venta:
            return jsonify({"status": "error", "mensaje": "La venta indicada no existe"}), 404

        if estado_venta["estado_venta"] != 'CONFIRMADA':
            return jsonify({"status": "error", "mensaje": "No se pueden registrar pagos sobre una venta anulada"}), 409

        if estado_venta["tipo_venta"] != 'CUENTA_CORRIENTE':
            return jsonify({
                "status": "error",
                "mensaje": "Solo se pueden registrar cobros manuales sobre ventas a Cuenta Corriente"
            }), 400

        saldo_pendiente = estado_venta["saldo_pendiente"]
        if saldo_pendiente <= 0:
            return jsonify({
                "status": "error",
                "mensaje": "Esta venta ya se encuentra completamente saldada"
            }), 409

        # 3. Calculamos cuánto se aplica a la venta y si existe excedente para saldo_a_favor
        if monto_entregado > saldo_pendiente:
            monto_aplicado = saldo_pendiente
            excedente = round(monto_entregado - saldo_pendiente, 2)
        else:
            monto_aplicado = monto_entregado
            excedente = 0.0

        # 4. Insertamos el pago en ventas.pagos por el monto efectivamente aplicado a la venta
        cur.execute("""
            INSERT INTO ventas.pagos (
                emprendimiento_id, sucursal_id, venta_id, medio_pago_id,
                monto, fecha_pago, estado, creado_por
            )
            VALUES (%s, %s, %s, %s, %s, %s, 'ACTIVO', %s)
            RETURNING *
        """, (
            emprendimiento_id, sucursal_id, venta_id, medio_pago_id,
            monto_aplicado, fecha_pago_dt, usuario
        ))
        nuevo_pago = cur.fetchone()

        # 5. Si hubo dinero extra, lo sumamos automáticamente al saldo_a_favor del cliente
        nuevo_saldo_favor = None
        if excedente > 0 and estado_venta["cliente_id"]:
            cur.execute("""
                UPDATE ventas.clientes
                SET saldo_a_favor = saldo_a_favor + %s,
                    modificado_por = %s,
                    modificado_en = CURRENT_TIMESTAMP
                WHERE id = %s AND emprendimiento_id = %s
                RETURNING saldo_a_favor
            """, (excedente, usuario, estado_venta["cliente_id"], emprendimiento_id))
            cliente_act = cur.fetchone()
            if cliente_act:
                nuevo_saldo_favor = round(float(cliente_act["saldo_a_favor"] or 0), 2)

        # Obtenemos el nombre del cliente para completar la respuesta serializada
        cur.execute("SELECT nombre_razon_social FROM ventas.clientes WHERE id = %s", (estado_venta["cliente_id"],))
        cli_row = cur.fetchone()

        # Confirmamos toda la operación de forma atómica (pago + actualización de saldo a favor)
        conn.commit()

        # Enriquecemos el diccionario del pago con los textos de referencia
        nuevo_pago["numero_venta"] = estado_venta["numero_venta"]
        nuevo_pago["tipo_venta"] = estado_venta["tipo_venta"]
        nuevo_pago["cliente_id"] = estado_venta["cliente_id"]
        nuevo_pago["cliente_nombre"] = cli_row["nombre_razon_social"] if cli_row else None
        nuevo_pago["medio_pago_nombre"] = medio_pago["nombre"]

        saldo_restante_venta = max(round(saldo_pendiente - monto_aplicado, 2), 0.0)

        respuesta = {
            "status": "ok",
            "mensaje": "Pago registrado correctamente" if excedente == 0 else "Pago registrado y excedente acreditado como saldo a favor",
            "pago": serializar_pago(nuevo_pago, rol),
            "monto_aplicado": monto_aplicado,
            "excedente_a_favor": excedente,
            "saldo_pendiente_venta": saldo_restante_venta,
            "estado_venta_cuenta": "SALDADA" if saldo_restante_venta == 0 else "PENDIENTE"
        }

        # Solo exponemos el saldo a favor acumulado del cliente a Admin/Propietario
        if rol in ROLES_ADMIN and nuevo_saldo_favor is not None:
            respuesta["nuevo_saldo_a_favor_cliente"] = nuevo_saldo_favor

        return jsonify(respuesta), 201

    except Exception as e:
        if conn:
            conn.rollback()
        return jsonify({"status": "error", "mensaje": f"Error al registrar pago: {str(e)}"}), 500
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()


# 4. EDITAR PAGO ACTIVO — SOLO ADMIN (PUT /api/pagos/<id>)
@pagos_bp.route('/api/pagos/<int:id>', methods=['PUT'])
def editar_pago(id):
    # Restringimos la edición exclusivamente a Propietario y Administrador
    payload, error_resp, code = verificar_token(ROLES_ADMIN)
    if error_resp:
        return error_resp, code

    rol = payload.get("rol")
    emprendimiento_id = payload.get("negocio_id")
    usuario = payload.get("nombre") or payload.get("usuario") or "admin"
    db_name = payload.get("db_name")

    datos = request.get_json(silent=True) or {}

    conn = None
    cur = None
    try:
        conn = get_db_connection(db_name)
        cur = conn.cursor(cursor_factory=RealDictCursor)

        # 1. Buscamos el pago existente junto con los datos de su venta asociada
        cur.execute("""
            SELECT p.*, v.total AS venta_total, v.estado AS venta_estado,
                   v.tipo_venta, v.numero_venta, v.cliente_id
            FROM ventas.pagos p
            JOIN ventas.ventas v ON v.id = p.venta_id
            WHERE p.id = %s AND p.emprendimiento_id = %s
        """, (id, emprendimiento_id))
        pago_actual = cur.fetchone()

        if not pago_actual:
            return jsonify({"status": "error", "mensaje": "Pago no encontrado"}), 404

        if pago_actual["estado"] != 'ACTIVO':
            return jsonify({"status": "error", "mensaje": "No se puede editar un pago anulado"}), 409

        if pago_actual["venta_estado"] != 'CONFIRMADA' or pago_actual["tipo_venta"] != 'CUENTA_CORRIENTE':
            return jsonify({
                "status": "error",
                "mensaje": "Solo se pueden editar pagos de ventas confirmadas a Cuenta Corriente"
            }), 409

        # 2. Tomamos los nuevos valores o conservamos los actuales si no vinieron en el body
        nuevo_medio_id = datos.get('medio_pago_id', pago_actual["medio_pago_id"])
        monto_raw = datos.get('monto', pago_actual["monto"])

        try:
            nuevo_monto = round(float(monto_raw), 2)
        except (TypeError, ValueError):
            return jsonify({"status": "error", "mensaje": "El monto debe ser un valor numérico válido"}), 400

        if nuevo_monto <= 0:
            return jsonify({"status": "error", "mensaje": "El monto del pago debe ser mayor a cero"}), 400

        # Validamos fecha si fue enviada; si no, conservamos la original
        if 'fecha_pago' in datos and datos.get('fecha_pago'):
            nueva_fecha, error_fecha = parsear_fecha_pago(datos.get('fecha_pago'))
            if error_fecha:
                return jsonify({"status": "error", "mensaje": error_fecha}), 400
        else:
            nueva_fecha = pago_actual["fecha_pago"]

        # 3. Verificamos que el medio de pago exista y esté activo
        cur.execute("""
            SELECT id, nombre, activo
            FROM finanzas.medios_pago
            WHERE id = %s AND emprendimiento_id = %s
        """, (nuevo_medio_id, emprendimiento_id))
        medio_pago = cur.fetchone()
        if not medio_pago or not medio_pago["activo"]:
            return jsonify({"status": "error", "mensaje": "El medio de pago seleccionado no es válido o está inactivo"}), 400

        # 4. Calculamos cuánto queda pendiente de la venta excluyendo este pago para evitar superar el total
        cur.execute("""
            SELECT COALESCE(SUM(monto), 0) AS otros_pagos
            FROM ventas.pagos
            WHERE venta_id = %s AND estado = 'ACTIVO' AND id <> %s
        """, (pago_actual["venta_id"], id))
        otros_pagos = round(float(cur.fetchone()["otros_pagos"] or 0), 2)
        venta_total = round(float(pago_actual["venta_total"] or 0), 2)
        maximo_permitido = max(round(venta_total - otros_pagos, 2), 0.0)

        if nuevo_monto > maximo_permitido:
            return jsonify({
                "status": "error",
                "mensaje": f"El monto editado (${nuevo_monto:.2f}) supera el saldo pendiente de la venta (${maximo_permitido:.2f})"
            }), 400

        # 5. Actualizamos el pago con su trazabilidad de modificación
        cur.execute("""
            UPDATE ventas.pagos
            SET monto = %s,
                medio_pago_id = %s,
                fecha_pago = %s,
                modificado_por = %s,
                modificado_en = CURRENT_TIMESTAMP
            WHERE id = %s AND emprendimiento_id = %s
            RETURNING *
        """, (nuevo_monto, nuevo_medio_id, nueva_fecha, usuario, id, emprendimiento_id))
        pago_editado = cur.fetchone()

        cur.execute("SELECT nombre_razon_social FROM ventas.clientes WHERE id = %s", (pago_actual["cliente_id"],))
        cli_row = cur.fetchone()

        conn.commit()

        pago_editado["numero_venta"] = pago_actual["numero_venta"]
        pago_editado["tipo_venta"] = pago_actual["tipo_venta"]
        pago_editado["cliente_id"] = pago_actual["cliente_id"]
        pago_editado["cliente_nombre"] = cli_row["nombre_razon_social"] if cli_row else None
        pago_editado["medio_pago_nombre"] = medio_pago["nombre"]

        saldo_restante = max(round(maximo_permitido - nuevo_monto, 2), 0.0)

        return jsonify({
            "status": "ok",
            "mensaje": "Pago actualizado correctamente",
            "pago": serializar_pago(pago_editado, rol),
            "saldo_pendiente_venta": saldo_restante,
            "estado_venta_cuenta": "SALDADA" if saldo_restante == 0 else "PENDIENTE"
        }), 200

    except Exception as e:
        if conn:
            conn.rollback()
        return jsonify({"status": "error", "mensaje": f"Error al editar pago: {str(e)}"}), 500
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()


# 5. ANULAR PAGO SIN BORRARLO — SOLO ADMIN (PATCH /api/pagos/<id>/anular)
@pagos_bp.route('/api/pagos/<int:id>/anular', methods=['PATCH'])
def anular_pago(id):
    # Solo el Administrador o Propietario puede anular cobros
    payload, error_resp, code = verificar_token(ROLES_ADMIN)
    if error_resp:
        return error_resp, code

    rol = payload.get("rol")
    emprendimiento_id = payload.get("negocio_id")
    usuario = payload.get("nombre") or payload.get("usuario") or "admin"
    db_name = payload.get("db_name")

    conn = None
    cur = None
    try:
        conn = get_db_connection(db_name)
        cur = conn.cursor(cursor_factory=RealDictCursor)

        # Buscamos el pago y su venta asociada
        cur.execute("""
            SELECT p.*, v.numero_venta, v.tipo_venta, v.estado AS venta_estado,
                   v.cliente_id, mp.nombre AS medio_pago_nombre
            FROM ventas.pagos p
            JOIN ventas.ventas v ON v.id = p.venta_id
            JOIN finanzas.medios_pago mp ON mp.id = p.medio_pago_id
            WHERE p.id = %s AND p.emprendimiento_id = %s
        """, (id, emprendimiento_id))
        pago = cur.fetchone()

        if not pago:
            return jsonify({"status": "error", "mensaje": "Pago no encontrado"}), 404

        if pago["estado"] == 'ANULADO':
            return jsonify({"status": "error", "mensaje": "Este pago ya se encuentra anulado"}), 409

        if pago["tipo_venta"] == 'CONTADO':
            return jsonify({
                "status": "error",
                "mensaje": "Los cobros de ventas de contado solo se revierten anulando la venta completa"
            }), 409

        # Marcamos estado = 'ANULADO' sin eliminar físicamente la fila para conservar auditoría
        cur.execute("""
            UPDATE ventas.pagos
            SET estado = 'ANULADO',
                anulado_por = %s,
                anulado_en = CURRENT_TIMESTAMP
            WHERE id = %s AND emprendimiento_id = %s
            RETURNING *
        """, (usuario, id, emprendimiento_id))
        pago_anulado = cur.fetchone()

        # Recalculamos en vivo el nuevo saldo pendiente de la venta tras anular el cobro
        estado_venta = calcular_saldo_venta(cur, pago["venta_id"], emprendimiento_id)

        cur.execute("SELECT nombre_razon_social FROM ventas.clientes WHERE id = %s", (pago["cliente_id"],))
        cli_row = cur.fetchone()

        conn.commit()

        pago_anulado["numero_venta"] = pago["numero_venta"]
        pago_anulado["tipo_venta"] = pago["tipo_venta"]
        pago_anulado["cliente_id"] = pago["cliente_id"]
        pago_anulado["cliente_nombre"] = cli_row["nombre_razon_social"] if cli_row else None
        pago_anulado["medio_pago_nombre"] = pago["medio_pago_nombre"]

        return jsonify({
            "status": "ok",
            "mensaje": "Pago anulado correctamente; el saldo de la venta fue recalculado",
            "pago": serializar_pago(pago_anulado, rol),
            "saldo_pendiente_venta": estado_venta["saldo_pendiente"],
            "estado_venta_cuenta": estado_venta["estado_cuenta"]
        }), 200

    except Exception as e:
        if conn:
            conn.rollback()
        return jsonify({"status": "error", "mensaje": f"Error al anular pago: {str(e)}"}), 500
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()


# 6. OCULTAMIENTO REVERSIBLE — SOLO ADMIN (PATCH /api/pagos/<id>/visibilidad)
@pagos_bp.route('/api/pagos/<int:id>/visibilidad', methods=['PATCH'])
@pagos_bp.route('/api/pagos/<int:id>/ocultar', methods=['PATCH'])
def cambiar_visibilidad_pago(id):
    # Solo el Administrador puede ocultar o restaurar pagos en la tabla visual
    payload, error_resp, code = verificar_token(ROLES_ADMIN)
    if error_resp:
        return error_resp, code

    emprendimiento_id = payload.get("negocio_id")
    usuario = payload.get("nombre") or payload.get("usuario") or "admin"
    db_name = payload.get("db_name")

    datos = request.get_json(silent=True) or {}

    conn = None
    cur = None
    try:
        conn = get_db_connection(db_name)
        cur = conn.cursor(cursor_factory=RealDictCursor)

        cur.execute("""
            SELECT id, oculto
            FROM ventas.pagos
            WHERE id = %s AND emprendimiento_id = %s
        """, (id, emprendimiento_id))
        pago = cur.fetchone()

        if not pago:
            return jsonify({"status": "error", "mensaje": "Pago no encontrado"}), 404

        # Si el body indica {"oculto": true/false}, aplicamos ese valor; si no, invertimos el estado
        if "oculto" in datos and isinstance(datos["oculto"], bool):
            nuevo_oculto = datos["oculto"]
        else:
            nuevo_oculto = not pago["oculto"]

        # Nota: ocultar un pago NO cambia su estado ('ACTIVO'), por lo que sigue sumando en saldos y Reportes
        cur.execute("""
            UPDATE ventas.pagos
            SET oculto = %s,
                modificado_por = %s,
                modificado_en = CURRENT_TIMESTAMP
            WHERE id = %s AND emprendimiento_id = %s
            RETURNING id, venta_id, monto, estado, oculto
        """, (nuevo_oculto, usuario, id, emprendimiento_id))
        actualizado = cur.fetchone()
        conn.commit()

        accion = "ocultado" if nuevo_oculto else "restaurado"
        return jsonify({
            "status": "ok",
            "mensaje": f"Pago {accion} visualmente (el saldo de la venta no se altera)",
            "pago": {
                "id": actualizado["id"],
                "venta_id": actualizado["venta_id"],
                "monto": round(float(actualizado["monto"] or 0), 2),
                "estado": actualizado["estado"],
                "oculto": actualizado["oculto"]
            }
        }), 200

    except Exception as e:
        if conn:
            conn.rollback()
        return jsonify({"status": "error", "mensaje": f"Error al cambiar visibilidad del pago: {str(e)}"}), 500
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()

# ENDPOINT INTERNO (PARA CONSUMO DESDE REPORTES-SERVICE — PUERTO 5005)
# 7. RESUMEN DE INGRESOS COBRADOS Y CUENTAS POR COBRAR (GET /internal/pagos/resumen)
@pagos_bp.route('/internal/pagos/resumen', methods=['GET'])
def resumen_pagos_interno():
    # Los endpoints internos reciben el nombre de la base del negocio por query param (?db_name=...)
    db_name = request.args.get('db_name') or request.headers.get('X-DB-Name')
    if not db_name:
        return jsonify({"status": "error", "mensaje": "Falta el parámetro obligatorio db_name"}), 400

    emprendimiento_id = request.args.get('emprendimiento_id', type=int)
    sucursal_id = request.args.get('sucursal_id', type=int)
    fecha_desde = (request.args.get('fecha_desde') or '').strip()
    fecha_hasta = (request.args.get('fecha_hasta') or '').strip()

    conn = None
    cur = None
    try:
        conn = get_db_connection(db_name)
        cur = conn.cursor(cursor_factory=RealDictCursor)

        # 1. Sumamos todos los cobros reales con estado 'ACTIVO' sobre ventas 'CONFIRMADA'
        # (Incluye pagos ocultos porque oculto es solo visual y no excluye ingresos reales)
        query_cobros = """
            SELECT
                COALESCE(SUM(p.monto), 0) AS ingresos_totales_cobrados,
                COALESCE(SUM(p.monto) FILTER (WHERE v.tipo_venta = 'CONTADO'), 0) AS ingresos_contado,
                COALESCE(SUM(p.monto) FILTER (WHERE v.tipo_venta = 'CUENTA_CORRIENTE'), 0) AS ingresos_cuenta_corriente
            FROM ventas.pagos p
            JOIN ventas.ventas v ON v.id = p.venta_id
            WHERE p.estado = 'ACTIVO'
              AND v.estado = 'CONFIRMADA'
        """
        params_cobros = []

        if emprendimiento_id:
            query_cobros += " AND p.emprendimiento_id = %s"
            params_cobros.append(emprendimiento_id)
        if sucursal_id:
            query_cobros += " AND p.sucursal_id = %s"
            params_cobros.append(sucursal_id)
        if fecha_desde:
            query_cobros += " AND DATE(p.fecha_pago AT TIME ZONE 'America/Argentina/Mendoza') >= %s"
            params_cobros.append(fecha_desde)
        if fecha_hasta:
            query_cobros += " AND DATE(p.fecha_pago AT TIME ZONE 'America/Argentina/Mendoza') <= %s"
            params_cobros.append(fecha_hasta)

        cur.execute(query_cobros, tuple(params_cobros))
        totales_cobros = cur.fetchone()

        # 2. Desglose de ingresos reales por medio de pago
        query_medios = """
            SELECT
                mp.id AS medio_pago_id,
                mp.nombre AS medio_pago,
                COALESCE(SUM(p.monto), 0) AS total_cobrado,
                COUNT(p.id) AS cantidad_operaciones
            FROM ventas.pagos p
            JOIN ventas.ventas v ON v.id = p.venta_id
            JOIN finanzas.medios_pago mp ON mp.id = p.medio_pago_id
            WHERE p.estado = 'ACTIVO'
              AND v.estado = 'CONFIRMADA'
        """
        params_medios = []
        if emprendimiento_id:
            query_medios += " AND p.emprendimiento_id = %s"
            params_medios.append(emprendimiento_id)
        if sucursal_id:
            query_medios += " AND p.sucursal_id = %s"
            params_medios.append(sucursal_id)
        if fecha_desde:
            query_medios += " AND DATE(p.fecha_pago AT TIME ZONE 'America/Argentina/Mendoza') >= %s"
            params_medios.append(fecha_desde)
        if fecha_hasta:
            query_medios += " AND DATE(p.fecha_pago AT TIME ZONE 'America/Argentina/Mendoza') <= %s"
            params_medios.append(fecha_hasta)

        query_medios += " GROUP BY mp.id, mp.nombre ORDER BY total_cobrado DESC"
        cur.execute(query_medios, tuple(params_medios))
        desglose_medios = [
            {
                "medio_pago_id": r["medio_pago_id"],
                "medio_pago": r["medio_pago"],
                "total_cobrado": round(float(r["total_cobrado"] or 0), 2),
                "cantidad_operaciones": r["cantidad_operaciones"]
            }
            for r in cur.fetchall()
        ]

        # 3. Calculamos el saldo total pendiente por cobrar de todas las cuentas corrientes activas
        query_deuda = """
            SELECT COALESCE(SUM(saldo_venta), 0) AS cuentas_por_cobrar_total
            FROM (
                SELECT
                    GREATEST(
                        v.total - COALESCE(SUM(p.monto) FILTER (WHERE p.estado = 'ACTIVO'), 0),
                        0
                    ) AS saldo_venta
                FROM ventas.ventas v
                LEFT JOIN ventas.pagos p ON p.venta_id = v.id
                WHERE v.estado = 'CONFIRMADA'
                  AND v.tipo_venta = 'CUENTA_CORRIENTE'
        """
        params_deuda = []
        if emprendimiento_id:
            query_deuda += " AND v.emprendimiento_id = %s"
            params_deuda.append(emprendimiento_id)
        if sucursal_id:
            query_deuda += " AND v.sucursal_id = %s"
            params_deuda.append(sucursal_id)

        query_deuda += " GROUP BY v.id, v.total ) sub"
        cur.execute(query_deuda, tuple(params_deuda))
        cuentas_por_cobrar = round(float(cur.fetchone()["cuentas_por_cobrar_total"] or 0), 2)

        # 4. Sumamos el total de saldos a favor vigentes en clientes
        query_favor = "SELECT COALESCE(SUM(saldo_a_favor), 0) AS saldos_a_favor FROM ventas.clientes WHERE activo = TRUE"
        params_favor = []
        if emprendimiento_id:
            query_favor += " AND emprendimiento_id = %s"
            params_favor.append(emprendimiento_id)

        cur.execute(query_favor, tuple(params_favor))
        saldos_a_favor = round(float(cur.fetchone()["saldos_a_favor"] or 0), 2)

        return jsonify({
            "status": "ok",
            "ingresos_totales_cobrados": round(float(totales_cobros["ingresos_totales_cobrados"] or 0), 2),
            "ingresos_contado": round(float(totales_cobros["ingresos_contado"] or 0), 2),
            "ingresos_cuenta_corriente": round(float(totales_cobros["ingresos_cuenta_corriente"] or 0), 2),
            "cuentas_por_cobrar_total": cuentas_por_cobrar,
            "saldos_a_favor_clientes": saldos_a_favor,
            "desglose_por_medio_pago": desglose_medios
        }), 200

    except Exception as e:
        return jsonify({"status": "error", "mensaje": f"Error interno al generar resumen de pagos: {str(e)}"}), 500
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()