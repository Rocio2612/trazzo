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

# Importamos re (expresiones regulares) para validar formatos de fecha dd-mm-aaaa y hh:mm
import re
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
def formatear_nro_venta(sucursal_id, numero_venta):
    """Formatea el comprobante con punto de venta de 5 dígitos y número de 8 (ej. 00001-00000001)."""
    suc = int(sucursal_id or 1)
    num = str(numero_venta or "0").zfill(8)
    return f"{suc:05d}-{num}"


def formatear_nro_pago(pago_id):
    """Formatea el número de pago con 8 dígitos con ceros a la izquierda (ej. 00000001)."""
    return f"{int(pago_id):08d}"


def obtener_productos_de_ventas(cur, venta_ids):
    """
    Consulta ventas.venta_detalle para una lista de ventas y agrupa sus ítems
    en el formato {nombre, precio, cantidad, subtotal} que espera el modal Ver Detalle.
    """
    if not venta_ids:
        return {}

    cur.execute("""
        SELECT *
        FROM ventas.venta_detalle
        WHERE venta_id = ANY(%s)
        ORDER BY id ASC
    """, (list(venta_ids),))

    agrupado = {vid: [] for vid in venta_ids}
    for d in cur.fetchall():
        vid = d["venta_id"]
        precio = round(float(d.get("precio_unitario") or d.get("precio") or 0), 2)
        cantidad = float(d.get("cantidad") or 0)
        subtotal = round(float(d.get("subtotal") or (precio * cantidad)), 2)
        agrupado.setdefault(vid, []).append({
            "nombre": d.get("nombre_producto") or d.get("producto_nombre") or d.get("nombre") or "Producto",
            "precio": precio,
            "cantidad": int(cantidad) if cantidad.is_integer() else cantidad,
            "subtotal": subtotal
        })
    return agrupado


def calcular_saldo_venta(cur, venta_id, emprendimiento_id):
    """
    Calcula en vivo el estado financiero de una venta:
      - saldo = total - SUM(pagos 'ACTIVO') -> puede ser > 0 (deuda), 0 (saldada) o < 0 (saldo a favor).
      - saldo_pendiente = max(saldo, 0.0) -> deuda exigible.
    Nota: Los pagos con oculto = TRUE SÍ se incluyen mientras su estado sea 'ACTIVO'.
    """
    cur.execute("""
        SELECT
            v.id AS venta_id,
            v.sucursal_id,
            v.numero_venta,
            v.fecha_hora,
            v.cliente_id,
            v.tipo_venta,
            v.estado AS estado_venta,
            v.total,
            COALESCE(SUM(p.monto) FILTER (WHERE p.estado = 'ACTIVO'), 0) AS total_pagado
        FROM ventas.ventas v
        LEFT JOIN ventas.pagos p ON p.venta_id = v.id
        WHERE v.id = %s AND v.emprendimiento_id = %s
        GROUP BY v.id, v.sucursal_id, v.numero_venta, v.fecha_hora, v.cliente_id, v.tipo_venta, v.estado, v.total
    """, (venta_id, emprendimiento_id))

    fila = cur.fetchone()
    if not fila:
        return None

    total = round(float(fila["total"] or 0), 2)
    total_pagado = round(float(fila["total_pagado"] or 0), 2)
    saldo = round(total - total_pagado, 2)
    saldo_pendiente = max(saldo, 0.0)

    if fila["estado_venta"] == 'ANULADA':
        estado_cuenta = "ANULADA"
    elif saldo <= 0:
        estado_cuenta = "SALDADA"
    else:
        estado_cuenta = "PENDIENTE"

    return {
        "venta_id": fila["venta_id"],
        "sucursal_id": fila["sucursal_id"],
        "numero_venta": fila["numero_venta"],
        "nro_venta": formatear_nro_venta(fila["sucursal_id"], fila["numero_venta"]),
        "fecha_hora": fila["fecha_hora"],
        "cliente_id": fila["cliente_id"],
        "tipo_venta": fila["tipo_venta"],
        "estado_venta": fila["estado_venta"],
        "total": total,
        "total_pagado": total_pagado,
        "saldo": saldo,
        "saldo_pendiente": saldo_pendiente,
        "estado_cuenta": estado_cuenta
    }


def parsear_fecha_pago(fecha_raw, fecha_venta_dt=None):
    """
    Valida y convierte la fecha/hora de pago enviada por el cliente:
      - Acepta 'YYYY-MM-DD', 'DD-MM-YYYY', 'DD-MM-YYYY HH:MM' o ISO 8601 completo.
      - Verifica que no sea una fecha futura.
      - Si se pasa fecha_venta_dt, verifica que el pago no sea anterior a la venta.
    Retorna (objeto_datetime_utc, mensaje_error).
    """
    ahora_utc = datetime.datetime.now(datetime.timezone.utc)
    hoy_ar = datetime.datetime.now(ZONA_AR).date()
    solo_fecha = False

    if not fecha_raw or str(fecha_raw).strip() == "":
        dt_utc = ahora_utc
    else:
        texto = str(fecha_raw).strip()
        try:
            # Caso 1: Solo fecha ISO 'YYYY-MM-DD'
            if re.fullmatch(r'\d{4}-\d{2}-\d{2}', texto):
                solo_fecha = True
                fecha_date = datetime.date.fromisoformat(texto)
                if fecha_date > hoy_ar:
                    return None, "La fecha de pago no puede ser posterior a la fecha actual"
                hora_actual_ar = datetime.datetime.now(ZONA_AR).time()
                dt_utc = datetime.datetime.combine(fecha_date, hora_actual_ar, tzinfo=ZONA_AR).astimezone(datetime.timezone.utc)

            # Caso 2: Solo fecha argentina 'DD-MM-YYYY'
            elif re.fullmatch(r'\d{2}-\d{2}-\d{4}', texto):
                solo_fecha = True
                fecha_date = datetime.datetime.strptime(texto, "%d-%m-%Y").date()
                if fecha_date > hoy_ar:
                    return None, "La fecha de pago no puede ser posterior a la fecha actual"
                hora_actual_ar = datetime.datetime.now(ZONA_AR).time()
                dt_utc = datetime.datetime.combine(fecha_date, hora_actual_ar, tzinfo=ZONA_AR).astimezone(datetime.timezone.utc)

            # Caso 3: Fecha y hora argentina 'DD-MM-YYYY HH:MM'
            elif re.fullmatch(r'\d{2}-\d{2}-\d{4}\s+\d{2}:\d{2}', texto):
                dt_naive = datetime.datetime.strptime(texto, "%d-%m-%Y %H:%M")
                dt_ar = dt_naive.replace(tzinfo=ZONA_AR)
                if dt_ar.date() > hoy_ar:
                    return None, "La fecha de pago no puede ser posterior a la fecha actual"
                dt_utc = dt_ar.astimezone(datetime.timezone.utc)

            # Caso 4: Formato ISO 8601 completo (ej. '2026-11-24T15:30:00Z')
            else:
                dt = datetime.datetime.fromisoformat(texto.replace("Z", "+00:00"))
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=ZONA_AR)
                if dt.astimezone(ZONA_AR).date() > hoy_ar:
                    return None, "La fecha de pago no puede ser posterior a la fecha actual"
                dt_utc = dt.astimezone(datetime.timezone.utc)

        except ValueError:
            return None, "Formato de fecha inválido. Use dd-mm-aaaa hh:mm o ISO 8601"

    # Control contra la fecha y hora de emisión de la venta
    if fecha_venta_dt:
        venta_utc = fecha_venta_dt if fecha_venta_dt.tzinfo else fecha_venta_dt.replace(tzinfo=datetime.timezone.utc)
        if solo_fecha:
            if dt_utc.astimezone(ZONA_AR).date() < venta_utc.astimezone(ZONA_AR).date():
                fecha_v_txt = venta_utc.astimezone(ZONA_AR).strftime("%d-%m-%Y %H:%M")
                return None, f"La fecha y hora del pago no pueden ser anteriores a las de la venta ({fecha_v_txt})"
        else:
            if dt_utc.replace(second=0, microsecond=0) < venta_utc.replace(second=0, microsecond=0):
                fecha_v_txt = venta_utc.astimezone(ZONA_AR).strftime("%d-%m-%Y %H:%M")
                return None, f"La fecha y hora del pago no pueden ser anteriores a las de la venta ({fecha_v_txt})"

    return dt_utc, None


def serializar_pago(row, rol):
    """
    Formatea un registro de ventas.pagos compatible tanto con el contrato API
    como con las propiedades esperadas por cuenta-corriente.js:
      - Para CAJERO: omite el estado de ocultamiento y datos administrativos.
      - Para ADMIN / PROPIETARIO: incluye oculto y trazabilidad completa.
    """
    nro_venta_fmt = formatear_nro_venta(
        row.get("venta_sucursal_id") or row.get("sucursal_id") or 1,
        row.get("numero_venta")
    )
    fecha_iso = row["fecha_pago"].isoformat() if row.get("fecha_pago") else None

    pago_base = {
        "id": row["id"],
        "nro_pago": formatear_nro_pago(row["id"]),
        "venta_id": row["venta_id"],
        "numero_venta": row.get("numero_venta"),
        "nro_venta": nro_venta_fmt,
        "tipo_venta": row.get("tipo_venta"),
        "cliente_id": row.get("cliente_id"),
        "cliente_nombre": row.get("cliente_nombre"),
        "cliente": row.get("cliente_nombre"),  # Alias usado en tabla y modales del Front
        "medio_pago_id": row["medio_pago_id"],
        "medio_pago_nombre": row.get("medio_pago_nombre"),
        "medio_pago": row.get("medio_pago_nombre"),  # Alias usado en tabla y modales del Front
        "monto": round(float(row["monto"] or 0), 2),
        "fecha_pago": fecha_iso,
        "fecha": fecha_iso,  # Alias usado por fechaHoraParaMostrar() en el Front
        "estado": row["estado"],
        "anulado": row["estado"] == 'ANULADO'
    }

    # RNF-13 / RF-91: La auditoría de responsables y visibilidad solo se expone al Administrador
    if rol == 'CAJERO':
        return pago_base

    pago_base.update({
        "emprendimiento_id": row["emprendimiento_id"],
        "sucursal_id": row["sucursal_id"],
        "oculto": bool(row["oculto"]),
        "creado_por": row["creado_por"],
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
    # Permitimos acceso a Propietario, Admin y Cajero para consultar saldos y movimientos
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

        # Incluimos CONFIRMADA y ANULADA para soportar el filtro Todas/Pendientes/Saldadas/Anuladas
        query = """
            SELECT
                v.id AS venta_id,
                v.sucursal_id,
                v.numero_venta,
                v.fecha_hora,
                v.estado AS estado_venta,
                v.cliente_id,
                c.nombre_razon_social AS cliente_nombre,
                c.saldo_a_favor AS cliente_saldo_a_favor,
                v.total,
                COALESCE(SUM(p.monto) FILTER (WHERE p.estado = 'ACTIVO'), 0) AS total_pagado
            FROM ventas.ventas v
            JOIN ventas.clientes c ON c.id = v.cliente_id
            LEFT JOIN ventas.pagos p ON p.venta_id = v.id
            WHERE v.emprendimiento_id = %s
              AND v.tipo_venta = 'CUENTA_CORRIENTE'
        """
        params = [emprendimiento_id]

        if cliente_id:
            query += " AND v.cliente_id = %s"
            params.append(cliente_id)

        if busqueda:
            busqueda_sin_guion = busqueda.replace("-", "")
            query += """
                AND (
                    v.numero_venta ILIKE %s
                    OR LPAD(v.sucursal_id::text, 5, '0') || LPAD(v.numero_venta, 8, '0') ILIKE %s
                    OR c.nombre_razon_social ILIKE %s
                )
            """
            params.extend([f"%{busqueda_sin_guion}%", f"%{busqueda_sin_guion}%", f"%{busqueda}%"])

        query += """
            GROUP BY v.id, v.sucursal_id, v.numero_venta, v.fecha_hora, v.estado,
                     v.cliente_id, c.nombre_razon_social, c.saldo_a_favor, v.total
            ORDER BY v.fecha_hora DESC, v.id DESC
        """

        cur.execute(query, tuple(params))
        filas = cur.fetchall()

        # Obtenemos en una sola consulta los productos vendidos de todas estas ventas
        productos_por_venta = obtener_productos_de_ventas(cur, [f["venta_id"] for f in filas])

        items = []
        for f in filas:
            es_anulada = f["estado_venta"] == 'ANULADA'
            total = round(float(f["total"] or 0), 2)
            pagado = round(float(f["total_pagado"] or 0), 2)
            saldo = round(total - pagado, 2)
            saldo_pendiente = max(saldo, 0.0)

            if solo_pendientes and (es_anulada or saldo_pendiente == 0):
                continue

            if es_anulada:
                estado_cuenta = "ANULADA"
            elif saldo <= 0:
                estado_cuenta = "SALDADA"
            else:
                estado_cuenta = "PENDIENTE"

            nro_venta_fmt = formatear_nro_venta(f["sucursal_id"], f["numero_venta"])
            fecha_iso = f["fecha_hora"].isoformat() if f.get("fecha_hora") else None

            item = {
                "id": f["venta_id"],
                "venta_id": f["venta_id"],
                "numero_venta": f["numero_venta"],
                "nro_venta": nro_venta_fmt,
                "fecha_hora": fecha_iso,
                "fecha": fecha_iso,
                "cliente_id": f["cliente_id"],
                "cliente_nombre": f["cliente_nombre"],
                "cliente": f["cliente_nombre"],
                "total": total,
                "total_pagado": pagado,
                "pagado": pagado,
                "saldo": saldo,
                "saldo_pendiente": saldo_pendiente,
                "anulada": es_anulada,
                "estado_cuenta": estado_cuenta,
                "productos": productos_por_venta.get(f["venta_id"], [])
            }

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

    venta_id = request.args.get('venta_id', type=int)
    cliente_id = request.args.get('cliente_id', type=int)
    incluir_ocultos = request.args.get('incluir_ocultos', 'false').lower() == 'true'
    todos_los_tipos = request.args.get('todos', 'false').lower() == 'true'

    conn = None
    cur = None
    try:
        conn = get_db_connection(db_name)
        cur = conn.cursor(cursor_factory=RealDictCursor)

        query = """
            SELECT
                p.*,
                v.sucursal_id AS venta_sucursal_id,
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

        if not venta_id and not todos_los_tipos:
            query += " AND v.tipo_venta = 'CUENTA_CORRIENTE'"

        if venta_id:
            query += " AND p.venta_id = %s"
            params.append(venta_id)

        if cliente_id:
            query += " AND v.cliente_id = %s"
            params.append(cliente_id)

        # Los pagos ocultos solo se muestran si Admin/Propietario envía ?incluir_ocultos=true
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

    if not venta_id or not medio_pago_id or monto_raw is None:
        return jsonify({
            "status": "error",
            "mensaje": "Los campos venta_id, medio_pago_id y monto son obligatorios"
        }), 400

    try:
        monto_entregado = round(float(monto_raw), 2)
    except (TypeError, ValueError):
        return jsonify({"status": "error", "mensaje": "El monto debe ser un valor numérico válido"}), 400

    if monto_entregado <= 0:
        return jsonify({"status": "error", "mensaje": "El monto del pago debe ser mayor a cero"}), 400

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

        # 3. Validamos fecha/hora de pago (no futura y no anterior a la emisión de la venta)
        fecha_pago_dt, error_fecha = parsear_fecha_pago(fecha_raw, estado_venta["fecha_hora"])
        if error_fecha:
            return jsonify({"status": "error", "mensaje": error_fecha}), 400

        # 4. Calculamos cuánto cubre deuda y cuánto excedente va a saldo_a_favor del cliente
        if monto_entregado > saldo_pendiente:
            monto_aplicado = saldo_pendiente
            excedente = round(monto_entregado - saldo_pendiente, 2)
        else:
            monto_aplicado = monto_entregado
            excedente = 0.0

        # 5. Guardamos el monto completo abonado en ventas.pagos para reflejar el saldo exacto en la venta
        cur.execute("""
            INSERT INTO ventas.pagos (
                emprendimiento_id, sucursal_id, venta_id, medio_pago_id,
                monto, fecha_pago, estado, creado_por
            )
            VALUES (%s, %s, %s, %s, %s, %s, 'ACTIVO', %s)
            RETURNING *
        """, (
            emprendimiento_id, sucursal_id, venta_id, medio_pago_id,
            monto_entregado, fecha_pago_dt, usuario
        ))
        nuevo_pago = cur.fetchone()

        # 6. Si hubo dinero extra, lo sumamos automáticamente al saldo_a_favor del cliente
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

        cur.execute("SELECT nombre_razon_social FROM ventas.clientes WHERE id = %s", (estado_venta["cliente_id"],))
        cli_row = cur.fetchone()

        conn.commit()

        nuevo_pago["venta_sucursal_id"] = estado_venta["sucursal_id"]
        nuevo_pago["numero_venta"] = estado_venta["numero_venta"]
        nuevo_pago["tipo_venta"] = estado_venta["tipo_venta"]
        nuevo_pago["cliente_id"] = estado_venta["cliente_id"]
        nuevo_pago["cliente_nombre"] = cli_row["nombre_razon_social"] if cli_row else None
        nuevo_pago["medio_pago_nombre"] = medio_pago["nombre"]

        saldo_final_venta = round(saldo_pendiente - monto_entregado, 2)
        saldo_restante_venta = max(saldo_final_venta, 0.0)

        respuesta = {
            "status": "ok",
            "mensaje": "Pago registrado correctamente" if excedente == 0 else "Pago registrado y excedente acreditado como saldo a favor",
            "pago": serializar_pago(nuevo_pago, rol),
            "monto_aplicado": monto_aplicado,
            "excedente_a_favor": excedente,
            "saldo_venta": saldo_final_venta,
            "saldo_pendiente_venta": saldo_restante_venta,
            "estado_venta_cuenta": "SALDADA" if saldo_restante_venta == 0 else "PENDIENTE"
        }

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


# 4. EDITAR PAGO ACTIVO — ADMIN Y CAJERO (PUT /api/pagos/<id>)
@pagos_bp.route('/api/pagos/<int:id>', methods=['PUT'])
def editar_pago(id):
    # Tanto Admin/Propietario como Cajero pueden editar pagos vigentes
    payload, error_resp, code = verificar_token(TODOS_LOS_ROLES)
    if error_resp:
        return error_resp, code

    rol = payload.get("rol")
    emprendimiento_id = payload.get("negocio_id")
    usuario = payload.get("nombre") or payload.get("usuario") or "sistema"
    db_name = payload.get("db_name")

    datos = request.get_json(silent=True) or {}

    conn = None
    cur = None
    try:
        conn = get_db_connection(db_name)
        cur = conn.cursor(cursor_factory=RealDictCursor)

        # 1. Buscamos el pago existente junto con los datos de su venta original
        cur.execute("""
            SELECT p.*, v.total AS venta_total, v.estado AS venta_estado,
                   v.tipo_venta, v.numero_venta, v.sucursal_id AS venta_sucursal_id,
                   v.fecha_hora AS venta_fecha_hora, v.cliente_id
            FROM ventas.pagos p
            JOIN ventas.ventas v ON v.id = p.venta_id
            WHERE p.id = %s AND p.emprendimiento_id = %s
        """, (id, emprendimiento_id))
        pago_actual = cur.fetchone()

        if not pago_actual:
            return jsonify({"status": "error", "mensaje": "Pago no encontrado"}), 404

        if pago_actual["estado"] != 'ACTIVO':
            return jsonify({"status": "error", "mensaje": "No se puede editar un pago anulado"}), 409

        # 2. Permitimos cambiar la venta asociada si vino en el body (o conservamos la actual)
        nueva_venta_id = int(datos.get('venta_id') or pago_actual["venta_id"])
        estado_venta_dest = calcular_saldo_venta(cur, nueva_venta_id, emprendimiento_id)
        if not estado_venta_dest:
            return jsonify({"status": "error", "mensaje": "La venta seleccionada no existe"}), 404

        if estado_venta_dest["estado_venta"] != 'CONFIRMADA' or estado_venta_dest["tipo_venta"] != 'CUENTA_CORRIENTE':
            return jsonify({
                "status": "error",
                "mensaje": "Solo se pueden asociar pagos a ventas confirmadas de Cuenta Corriente"
            }), 409

        nuevo_medio_id = datos.get('medio_pago_id', pago_actual["medio_pago_id"])
        monto_raw = datos.get('monto', pago_actual["monto"])

        try:
            nuevo_monto = round(float(monto_raw), 2)
        except (TypeError, ValueError):
            return jsonify({"status": "error", "mensaje": "El monto debe ser un valor numérico válido"}), 400

        if nuevo_monto <= 0:
            return jsonify({"status": "error", "mensaje": "El monto del pago debe ser mayor a cero"}), 400

        # Validamos fecha contra la fecha/hora de la venta destino (incluso si solo cambió venta_id)
        if 'fecha_pago' in datos and datos.get('fecha_pago'):
            nueva_fecha, error_fecha = parsear_fecha_pago(datos.get('fecha_pago'), estado_venta_dest["fecha_hora"])
            if error_fecha:
                return jsonify({"status": "error", "mensaje": error_fecha}), 400
        else:
            nueva_fecha = pago_actual["fecha_pago"]
            venta_dest_utc = estado_venta_dest["fecha_hora"] if estado_venta_dest["fecha_hora"].tzinfo else estado_venta_dest["fecha_hora"].replace(tzinfo=datetime.timezone.utc)
            if nueva_fecha.replace(second=0, microsecond=0) < venta_dest_utc.replace(second=0, microsecond=0):
                fecha_v_txt = venta_dest_utc.astimezone(ZONA_AR).strftime("%d-%m-%Y %H:%M")
                return jsonify({
                    "status": "error",
                    "mensaje": f"La fecha y hora del pago no pueden ser anteriores a las de la venta ({fecha_v_txt})"
                }), 400

        # 3. Verificamos que el medio de pago exista y esté activo
        cur.execute("""
            SELECT id, nombre, activo
            FROM finanzas.medios_pago
            WHERE id = %s AND emprendimiento_id = %s
        """, (nuevo_medio_id, emprendimiento_id))
        medio_pago = cur.fetchone()
        if not medio_pago or not medio_pago["activo"]:
            return jsonify({"status": "error", "mensaje": "El medio de pago seleccionado no es válido o está inactivo"}), 400

        # 4. Registramos el sobrepago anterior en la(s) venta(s) involucrada(s) para sincronizar saldo_a_favor
        ventas_afectadas = {pago_actual["venta_id"], nueva_venta_id}
        sobrepago_antes = {}
        for vid in ventas_afectadas:
            est = calcular_saldo_venta(cur, vid, emprendimiento_id)
            sobrepago_antes[vid] = (est["cliente_id"], max(round(est["total_pagado"] - est["total"], 2), 0.0))

        # 5. Actualizamos el pago con su trazabilidad de modificación
        cur.execute("""
            UPDATE ventas.pagos
            SET venta_id = %s,
                monto = %s,
                medio_pago_id = %s,
                fecha_pago = %s,
                modificado_por = %s,
                modificado_en = CURRENT_TIMESTAMP
            WHERE id = %s AND emprendimiento_id = %s
            RETURNING *
        """, (nueva_venta_id, nuevo_monto, nuevo_medio_id, nueva_fecha, usuario, id, emprendimiento_id))
        pago_editado = cur.fetchone()

        # 6. Sincronizamos la variación de saldo_a_favor verificando que no haya sido ya consumido
        for vid in ventas_afectadas:
            est_despues = calcular_saldo_venta(cur, vid, emprendimiento_id)
            cli_id, sp_antes = sobrepago_antes[vid]
            sp_despues = max(round(est_despues["total_pagado"] - est_despues["total"], 2), 0.0)
            delta = round(sp_despues - sp_antes, 2)
            if delta != 0 and cli_id:
                cur.execute("SELECT saldo_a_favor FROM ventas.clientes WHERE id = %s AND emprendimiento_id = %s", (cli_id, emprendimiento_id))
                cli_saldo = cur.fetchone()
                saldo_disponible = round(float(cli_saldo["saldo_a_favor"] or 0), 2) if cli_saldo else 0.0
                if round(saldo_disponible + delta, 2) < 0:
                    conn.rollback()
                    return jsonify({
                        "status": "error",
                        "mensaje": "No se puede reducir el pago porque el saldo a favor generado ya fue utilizado en otra venta"
                    }), 409

                cur.execute("""
                    UPDATE ventas.clientes
                    SET saldo_a_favor = ROUND(saldo_a_favor + %s, 2),
                        modificado_por = %s,
                        modificado_en = CURRENT_TIMESTAMP
                    WHERE id = %s AND emprendimiento_id = %s
                """, (delta, usuario, cli_id, emprendimiento_id))

        estado_final_dest = calcular_saldo_venta(cur, nueva_venta_id, emprendimiento_id)
        cur.execute("SELECT nombre_razon_social FROM ventas.clientes WHERE id = %s", (estado_final_dest["cliente_id"],))
        cli_row = cur.fetchone()

        conn.commit()

        pago_editado["venta_sucursal_id"] = estado_final_dest["sucursal_id"]
        pago_editado["numero_venta"] = estado_final_dest["numero_venta"]
        pago_editado["tipo_venta"] = estado_final_dest["tipo_venta"]
        pago_editado["cliente_id"] = estado_final_dest["cliente_id"]
        pago_editado["cliente_nombre"] = cli_row["nombre_razon_social"] if cli_row else None
        pago_editado["medio_pago_nombre"] = medio_pago["nombre"]

        return jsonify({
            "status": "ok",
            "mensaje": "Pago actualizado correctamente",
            "pago": serializar_pago(pago_editado, rol),
            "saldo_venta": estado_final_dest["saldo"],
            "saldo_pendiente_venta": estado_final_dest["saldo_pendiente"],
            "estado_venta_cuenta": estado_final_dest["estado_cuenta"]
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

# 5. ANULAR PAGO SIN BORRARLO — ADMIN Y CAJERO (PATCH /api/pagos/<id>/anular)
@pagos_bp.route('/api/pagos/<int:id>/anular', methods=['PATCH'])
def anular_pago(id):
    # Tanto Admin/Propietario como Cajero pueden anular pagos vigentes
    payload, error_resp, code = verificar_token(TODOS_LOS_ROLES)
    if error_resp:
        return error_resp, code

    rol = payload.get("rol")
    emprendimiento_id = payload.get("negocio_id")
    usuario = payload.get("nombre") or payload.get("usuario") or "sistema"
    db_name = payload.get("db_name")

    conn = None
    cur = None
    try:
        conn = get_db_connection(db_name)
        cur = conn.cursor(cursor_factory=RealDictCursor)

        cur.execute("""
            SELECT p.*, v.sucursal_id AS venta_sucursal_id, v.numero_venta, v.tipo_venta,
                   v.estado AS venta_estado, v.cliente_id, mp.nombre AS medio_pago_nombre
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

        # Calculamos el sobrepago previo a la anulación para ajustar saldo_a_favor si correspondía
        estado_antes = calcular_saldo_venta(cur, pago["venta_id"], emprendimiento_id)
        sobrepago_antes = max(round(estado_antes["total_pagado"] - estado_antes["total"], 2), 0.0)

        # Marcamos estado = 'ANULADO' sin eliminar físicamente la fila
        cur.execute("""
            UPDATE ventas.pagos
            SET estado = 'ANULADO',
                anulado_por = %s,
                anulado_en = CURRENT_TIMESTAMP
            WHERE id = %s AND emprendimiento_id = %s
            RETURNING *
        """, (usuario, id, emprendimiento_id))
        pago_anulado = cur.fetchone()

        # Recalculamos en vivo el nuevo saldo de la venta y ajustamos saldo_a_favor
        estado_venta = calcular_saldo_venta(cur, pago["venta_id"], emprendimiento_id)
        sobrepago_despues = max(round(estado_venta["total_pagado"] - estado_venta["total"], 2), 0.0)
        delta_favor = round(sobrepago_despues - sobrepago_antes, 2)

        if delta_favor != 0 and pago["cliente_id"]:
            # Verificamos que el saldo a favor generado por este pago no haya sido ya gastado en otra venta
            cur.execute(
                "SELECT saldo_a_favor FROM ventas.clientes WHERE id = %s AND emprendimiento_id = %s",
                (pago["cliente_id"], emprendimiento_id)
            )
            cli_saldo = cur.fetchone()
            saldo_disponible = round(float(cli_saldo["saldo_a_favor"] or 0), 2) if cli_saldo else 0.0

            if round(saldo_disponible + delta_favor, 2) < 0:
                conn.rollback()
                return jsonify({
                    "status": "error",
                    "mensaje": "No se puede anular el pago porque el saldo a favor generado ya fue utilizado en otra venta"
                }), 409

            cur.execute("""
                UPDATE ventas.clientes
                SET saldo_a_favor = ROUND(saldo_a_favor + %s, 2),
                    modificado_por = %s,
                    modificado_en = CURRENT_TIMESTAMP
                WHERE id = %s AND emprendimiento_id = %s
            """, (delta_favor, usuario, pago["cliente_id"], emprendimiento_id))

        cur.execute("SELECT nombre_razon_social FROM ventas.clientes WHERE id = %s", (pago["cliente_id"],))
        cli_row = cur.fetchone()

        conn.commit()

        pago_anulado["venta_sucursal_id"] = pago["venta_sucursal_id"]
        pago_anulado["numero_venta"] = pago["numero_venta"]
        pago_anulado["tipo_venta"] = pago["tipo_venta"]
        pago_anulado["cliente_id"] = pago["cliente_id"]
        pago_anulado["cliente_nombre"] = cli_row["nombre_razon_social"] if cli_row else None
        pago_anulado["medio_pago_nombre"] = pago["medio_pago_nombre"]

        return jsonify({
            "status": "ok",
            "mensaje": "Pago anulado correctamente; el saldo de la venta fue recalculado",
            "pago": serializar_pago(pago_anulado, rol),
            "saldo_venta": estado_venta["saldo"],
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