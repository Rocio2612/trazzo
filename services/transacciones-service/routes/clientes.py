"""
MÓDULO 7: GESTIÓN DE CLIENTES (routes/clientes.py) — Responsable: Aldi
Implementa toda la lógica y endpoints del directorio de clientes del comercio
sobre la tabla 'ventas.clientes' (dentro de la base física de cada negocio):
  - validar_cuit(): Función reutilizable de validación fiscal (Módulo 11 AFIP/ARCA).
  - GET  /api/clientes                         -> Listado (Admin completo / Cajero reducido).
  - POST /api/clientes                         -> Alta completa (Admin) o Alta rápida (Cajero).
  - GET  /api/clientes/<id>                    -> Detalle (Admin completo / Cajero reducido).
  - PUT  /api/clientes/<id>                    -> Edición de ficha completa (Solo Admin).
  - PATCH /api/clientes/<id>/visibilidad       -> Ocultar o restaurar cliente (Solo Admin).
  - DELETE /api/clientes/<id>                  -> Borrado físico protegido con 409 (Solo Admin).
  - GET  /internal/clientes/<id>/categoria-impositiva -> Consulta interna para Ventas.

REGLAS CLAVE APLICADAS:
  1. Multi-tenant: Cada consulta abre conexión a 'payload["db_name"]' firmado en el JWT.
  2. Privacidad (Ley N° 25.326): El rol CAJERO nunca recibe datos personales ni saldos.
  3. Integridad histórica: Si un cliente tiene ventas o saldo, no se borra (409); se oculta.
"""

# Importamos re (expresiones regulares) para validar formato de correo y limpiar guiones de CUIT/DNI
import re
# Importamos Blueprint, request y jsonify de Flask para definir rutas y manejar peticiones/respuestas JSON
from flask import Blueprint, request, jsonify
# Importamos psycopg2 y RealDictCursor para capturar errores de unicidad y leer filas como diccionarios
import psycopg2
from psycopg2.extras import RealDictCursor
# Importamos desde helpers.py la conexión dinámica por negocio y el validador de tokens JWT
from helpers import get_db_connection, verificar_token

# Creamos el Blueprint de Clientes que luego se registra en app.py
clientes_bp = Blueprint('clientes', __name__)

# Constantes con los valores permitidos por las restricciones CHECK de la base de datos
TIPOS_DOCUMENTO_VALIDOS = ('DNI', 'CUIT', 'CUIL')
CATEGORIAS_IMPOSITIVAS_VALIDAS = (
    'RESPONSABLE_INSCRIPTO',
    'MONOTRIBUTISTA',
    'EXENTO',
    'CONSUMIDOR_FINAL'
)
ROLES_ADMIN = ['PROPIETARIO', 'ADMIN']
TODOS_LOS_ROLES = ['PROPIETARIO', 'ADMIN', 'CAJERO']

# FUNCIONES AUXILIARES DE VALIDACIÓN Y FORMATEO
def validar_cuit(cuit):
    """
    Valida un número de CUIT o CUIL argentino mediante el algoritmo oficial Módulo 11.
    Acepta formato con guiones ('30-71234567-1') o solo dígitos ('30712345671').
    Retorna True si es válido, False en caso contrario.
    """
    # Si llega vacío o None, no es válido
    if not cuit:
        return False

    # Quitamos espacios extremos y verificamos que tenga formato de 11 dígitos (con o sin guiones)
    cuit_str = str(cuit).strip()
    if not re.fullmatch(r'\d{2}-?\d{8}-?\d', cuit_str):
        return False

    # Dejamos únicamente los 11 dígitos numéricos sin guiones
    digitos = re.sub(r'\D', '', cuit_str)
    if len(digitos) != 11:
        return False

    # Coeficientes oficiales de ponderación para los primeros 10 dígitos
    multiplicadores = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]

    # Sumamos el producto de cada uno de los primeros 10 dígitos por su peso correspondiente
    suma = sum(int(digitos[i]) * multiplicadores[i] for i in range(10))

    # Calculamos el resto de dividir la suma por 11
    resto = suma % 11

    # Determinamos el dígito verificador esperado según las reglas del Módulo 11
    if resto == 0:
        digito_esperado = 0
    elif resto == 1:
        # Un resto igual a 1 daría dígito 10 (inexistente en un solo carácter), por lo que el CUIT es inválido
        return False
    else:
        digito_esperado = 11 - resto

    # Comparamos el dígito calculado contra el último dígito (posición 10) ingresado
    return int(digitos[10]) == digito_esperado


def validar_email(correo):
    """Verifica que el correo electrónico tenga una estructura válida (usuario@dominio.ext)."""
    if not correo:
        return False
    return bool(re.fullmatch(r'^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$', str(correo).strip()))


def normalizar_documento(tipo_doc, num_doc):
    """Limpia guiones/puntos del número de documento y valida longitud básica para DNI."""
    solo_digitos = re.sub(r'\D', '', str(num_doc).strip())
    if tipo_doc == 'DNI':
        # Un DNI argentino válido tiene entre 7 y 8 dígitos numéricos
        if len(solo_digitos) not in (7, 8):
            return None
    return solo_digitos


def serializar_cliente(row, rol):
    """
    Adapta los campos devueltos según el rol del usuario autenticado:
      - CAJERO: Devuelve únicamente {id, nombre} (Ley N° 25.326 de Protección de Datos).
      - ADMIN / PROPIETARIO: Devuelve la ficha completa y convierte valores Decimal a float.
    """
    if rol == 'CAJERO':
        return {
            "id": row["id"],
            "nombre": row["nombre_razon_social"]
        }

    # Para Admin/Propietario devolvemos todos los datos de gestión y saldos
    return {
        "id": row["id"],
        "emprendimiento_id": row["emprendimiento_id"],
        "nombre_razon_social": row["nombre_razon_social"],
        "nombre": row["nombre_razon_social"],  # Alias útil para componentes reutilizables del Front
        "tipo_documento": row["tipo_documento"],
        "numero_documento": row["numero_documento"],
        "telefono": row["telefono"],
        "correo": row["correo"],
        "domicilio": row["domicilio"],
        "categoria_impositiva": row["categoria_impositiva"],
        "saldo_a_favor": float(row["saldo_a_favor"] or 0),
        "deuda_total": float(row.get("deuda_total", 0) or 0),
        "activo": row["activo"],
        "creado_por": row["creado_por"],
        "modificado_por": row["modificado_por"],
        "creado_en": row["creado_en"].isoformat() if row.get("creado_en") else None,
        "modificado_en": row["modificado_en"].isoformat() if row.get("modificado_en") else None
    }

# ENDPOINTS PÚBLICOS (CONSUMIDOS POR EL FRONTEND A TRAVÉS DEL GATEWAY)
# 1. LISTAR CLIENTES (GET /api/clientes)
@clientes_bp.route('/api/clientes', methods=['GET'])
def listar_clientes():
    # Verificamos el JWT y permitimos acceso tanto a Admin/Propietario como a Cajero
    payload, error_resp, code = verificar_token(TODOS_LOS_ROLES)
    if error_resp:
        return error_resp, code

    rol = payload.get("rol")
    emprendimiento_id = payload.get("negocio_id")
    db_name = payload.get("db_name")

    # Parámetros opcionales de consulta (?solo_activos=true para selector de Ventas, ?q=texto para buscar)
    solo_activos = request.args.get('solo_activos', 'false').lower() == 'true'
    busqueda = (request.args.get('q') or '').strip()

    conn = None
    cur = None
    try:
        conn = get_db_connection(db_name)
        cur = conn.cursor(cursor_factory=RealDictCursor)

        # Construimos la consulta base calculando la deuda pendiente en vivo desde ventas confirmadas
        query = """
            SELECT
                c.*,
                COALESCE((
                    SELECT SUM(
                        GREATEST(
                            v.total - COALESCE((
                                SELECT SUM(p.monto)
                                FROM ventas.pagos p
                                WHERE p.venta_id = v.id AND p.estado = 'ACTIVO'
                            ), 0),
                            0
                        )
                    )
                    FROM ventas.ventas v
                    WHERE v.cliente_id = c.id
                      AND v.estado = 'CONFIRMADA'
                      AND v.tipo_venta = 'CUENTA_CORRIENTE'
                ), 0) AS deuda_total
            FROM ventas.clientes c
            WHERE c.emprendimiento_id = %s
        """
        params = [emprendimiento_id]

        # Si consulta un Cajero o se pide para el selector de Ventas, excluimos clientes ocultos
        if rol == 'CAJERO' or solo_activos:
            query += " AND c.activo = TRUE"

        # Filtro de búsqueda por texto
        if busqueda:
            if rol == 'CAJERO':
                # Por privacidad, el Cajero solo puede filtrar por nombre o razón social
                query += " AND c.nombre_razon_social ILIKE %s"
                params.append(f"%{busqueda}%")
            else:
                # El Admin puede buscar tanto por nombre como por número de documento
                query += " AND (c.nombre_razon_social ILIKE %s OR c.numero_documento ILIKE %s)"
                params.extend([f"%{busqueda}%", f"%{busqueda}%"])

        # Ordenamos alfabéticamente para facilitar la lectura en tablas y desplegables
        query += " ORDER BY c.nombre_razon_social ASC"

        cur.execute(query, tuple(params))
        filas = cur.fetchall()

        # Serializamos cada fila respetando el nivel de visibilidad del rol
        items = [serializar_cliente(fila, rol) for fila in filas]

        return jsonify({"status": "ok", "items": items}), 200

    except Exception as e:
        return jsonify({"status": "error", "mensaje": f"Error al listar clientes: {str(e)}"}), 500
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()


# 2. CREAR CLIENTE — ALTA COMPLETA (ADMIN) O ALTA RÁPIDA (CAJERO) (POST /api/clientes)
@clientes_bp.route('/api/clientes', methods=['POST'])
def crear_cliente():
    # Permitimos el ingreso a Admin, Propietario y Cajero (cada rol tendrá sus propias reglas)
    payload, error_resp, code = verificar_token(TODOS_LOS_ROLES)
    if error_resp:
        return error_resp, code

    rol = payload.get("rol")
    emprendimiento_id = payload.get("negocio_id")
    usuario = payload.get("nombre") or payload.get("usuario") or "sistema"
    db_name = payload.get("db_name")

    datos = request.get_json(silent=True) or {}
    # Aceptamos 'nombre_razon_social' o 'nombre' para compatibilidad con ambos formularios del Front
    nombre = (datos.get('nombre_razon_social') or datos.get('nombre') or '').strip()

    if not nombre:
        return jsonify({"status": "error", "mensaje": "El nombre o razón social es obligatorio"}), 400

    conn = None
    cur = None
    try:
        conn = get_db_connection(db_name)
        cur = conn.cursor(cursor_factory=RealDictCursor)

        # CASO A: ALTA RÁPIDA POR CAJERO (Solo nombre; descarta campos extra)
        if rol == 'CAJERO':
            # Ignoramos cualquier otro dato enviado en el JSON y guardamos únicamente el nombre
            cur.execute("""
                INSERT INTO ventas.clientes (
                    emprendimiento_id, nombre_razon_social, categoria_impositiva, creado_por
                )
                VALUES (%s, %s, 'CONSUMIDOR_FINAL', %s)
                RETURNING *
            """, (emprendimiento_id, nombre, usuario))

            nuevo_cliente = cur.fetchone()
            conn.commit()

            return jsonify({
                "status": "ok",
                "mensaje": "Cliente registrado mediante alta rápida",
                "cliente": serializar_cliente(nuevo_cliente, rol)
            }), 201

        # CASO B: ALTA COMPLETA POR ADMINISTRADOR / PROPIETARIO
        tipo_doc = (datos.get('tipo_documento') or '').strip().upper()
        num_doc_raw = (datos.get('numero_documento') or '').strip()
        telefono = (datos.get('telefono') or '').strip()
        correo = (datos.get('correo') or '').strip()
        domicilio = (datos.get('domicilio') or '').strip()
        categoria_imp = (datos.get('categoria_impositiva') or '').strip().upper()

        # Verificamos que todos los campos obligatorios del alta completa estén presentes
        if not all([tipo_doc, num_doc_raw, telefono, correo, domicilio, categoria_imp]):
            return jsonify({
                "status": "error",
                "mensaje": "Todos los campos son obligatorios para el alta completa (nombre, documento, teléfono, correo, domicilio y categoría impositiva)"
            }), 400

        # Validamos tipo de documento permitido
        if tipo_doc not in TIPOS_DOCUMENTO_VALIDOS:
            return jsonify({
                "status": "error",
                "mensaje": "Tipo de documento inválido. Debe ser DNI, CUIT o CUIL"
            }), 400

        # Validamos categoría impositiva permitida
        if categoria_imp not in CATEGORIAS_IMPOSITIVAS_VALIDAS:
            return jsonify({
                "status": "error",
                "mensaje": "Categoría impositiva inválida"
            }), 400

        # Validamos formato de correo electrónico
        if not validar_email(correo):
            return jsonify({
                "status": "error",
                "mensaje": "El formato del correo electrónico no es válido"
            }), 400

        # Validamos el número de documento según su tipo (Módulo 11 para CUIT/CUIL)
        if tipo_doc in ('CUIT', 'CUIL'):
            if not validar_cuit(num_doc_raw):
                return jsonify({
                    "status": "error",
                    "mensaje": f"El {tipo_doc} ingresado no es válido (dígito verificador incorrecto)"
                }), 400
            num_doc = re.sub(r'\D', '', num_doc_raw)
        else:
            num_doc = normalizar_documento('DNI', num_doc_raw)
            if not num_doc:
                return jsonify({
                    "status": "error",
                    "mensaje": "El DNI debe contener 7 u 8 dígitos numéricos"
                }), 400

        # Insertamos el cliente completo en la base del emprendimiento
        cur.execute("""
            INSERT INTO ventas.clientes (
                emprendimiento_id, nombre_razon_social, tipo_documento, numero_documento,
                telefono, correo, domicilio, categoria_impositiva, creado_por
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING *
        """, (
            emprendimiento_id, nombre, tipo_doc, num_doc,
            telefono, correo, domicilio, categoria_imp, usuario
        ))

        nuevo_cliente = cur.fetchone()
        conn.commit()

        return jsonify({
            "status": "ok",
            "mensaje": "Cliente registrado correctamente",
            "cliente": serializar_cliente(nuevo_cliente, rol)
        }), 201

    except psycopg2.errors.UniqueViolation:
        # Si PostgreSQL dispara el índice único uq_cliente_doc_tenant, devolvemos 409 Conflict
        if conn:
            conn.rollback()
        return jsonify({
            "status": "error",
            "mensaje": "Ya existe un cliente registrado con ese tipo y número de documento"
        }), 409
    except Exception as e:
        if conn:
            conn.rollback()
        return jsonify({"status": "error", "mensaje": f"Error al crear cliente: {str(e)}"}), 500
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()


# 3. OBTENER DETALLE DE UN CLIENTE (GET /api/clientes/<id>)
@clientes_bp.route('/api/clientes/<int:id>', methods=['GET'])
def obtener_cliente(id):
    payload, error_resp, code = verificar_token(TODOS_LOS_ROLES)
    if error_resp:
        return error_resp, code

    rol = payload.get("rol")
    emprendimiento_id = payload.get("negocio_id")
    db_name = payload.get("db_name")

    conn = None
    cur = None
    try:
        conn = get_db_connection(db_name)
        cur = conn.cursor(cursor_factory=RealDictCursor)

        cur.execute("""
            SELECT
                c.*,
                COALESCE((
                    SELECT SUM(
                        GREATEST(
                            v.total - COALESCE((
                                SELECT SUM(p.monto)
                                FROM ventas.pagos p
                                WHERE p.venta_id = v.id AND p.estado = 'ACTIVO'
                            ), 0),
                            0
                        )
                    )
                    FROM ventas.ventas v
                    WHERE v.cliente_id = c.id
                      AND v.estado = 'CONFIRMADA'
                      AND v.tipo_venta = 'CUENTA_CORRIENTE'
                ), 0) AS deuda_total
            FROM ventas.clientes c
            WHERE c.id = %s AND c.emprendimiento_id = %s
        """, (id, emprendimiento_id))

        cliente = cur.fetchone()
        if not cliente:
            return jsonify({"status": "error", "mensaje": "Cliente no encontrado"}), 404

        return jsonify({
            "status": "ok",
            "cliente": serializar_cliente(cliente, rol)
        }), 200

    except Exception as e:
        return jsonify({"status": "error", "mensaje": f"Error al consultar cliente: {str(e)}"}), 500
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()


# 4. EDITAR FICHA COMPLETA DE CLIENTE — SOLO ADMIN (PUT /api/clientes/<id>)
@clientes_bp.route('/api/clientes/<int:id>', methods=['PUT'])
def editar_cliente(id):
    # Restringimos la edición exclusivamente a Propietario y Administrador
    payload, error_resp, code = verificar_token(ROLES_ADMIN)
    if error_resp:
        return error_resp, code

    rol = payload.get("rol")
    emprendimiento_id = payload.get("negocio_id")
    usuario = payload.get("nombre") or payload.get("usuario") or "admin"
    db_name = payload.get("db_name")

    datos = request.get_json(silent=True) or {}
    nombre = (datos.get('nombre_razon_social') or datos.get('nombre') or '').strip()
    tipo_doc = (datos.get('tipo_documento') or '').strip().upper()
    num_doc_raw = (datos.get('numero_documento') or '').strip()
    telefono = (datos.get('telefono') or '').strip()
    correo = (datos.get('correo') or '').strip()
    domicilio = (datos.get('domicilio') or '').strip()
    categoria_imp = (datos.get('categoria_impositiva') or '').strip().upper()

    if not all([nombre, tipo_doc, num_doc_raw, telefono, correo, domicilio, categoria_imp]):
        return jsonify({
            "status": "error",
            "mensaje": "Todos los campos son obligatorios para actualizar la ficha del cliente"
        }), 400

    if tipo_doc not in TIPOS_DOCUMENTO_VALIDOS:
        return jsonify({"status": "error", "mensaje": "Tipo de documento inválido (DNI, CUIT o CUIL)"}), 400

    if categoria_imp not in CATEGORIAS_IMPOSITIVAS_VALIDAS:
        return jsonify({"status": "error", "mensaje": "Categoría impositiva inválida"}), 400

    if not validar_email(correo):
        return jsonify({"status": "error", "mensaje": "El formato del correo electrónico no es válido"}), 400

    if tipo_doc in ('CUIT', 'CUIL'):
        if not validar_cuit(num_doc_raw):
            return jsonify({
                "status": "error",
                "mensaje": f"El {tipo_doc} ingresado no es válido (dígito verificador incorrecto)"
            }), 400
        num_doc = re.sub(r'\D', '', num_doc_raw)
    else:
        num_doc = normalizar_documento('DNI', num_doc_raw)
        if not num_doc:
            return jsonify({"status": "error", "mensaje": "El DNI debe contener 7 u 8 dígitos numéricos"}), 400

    conn = None
    cur = None
    try:
        conn = get_db_connection(db_name)
        cur = conn.cursor(cursor_factory=RealDictCursor)

        # Actualizamos la ficha (el cambio de categoria_impositiva aplica solo a ventas futuras)
        cur.execute("""
            UPDATE ventas.clientes
            SET nombre_razon_social = %s,
                tipo_documento = %s,
                numero_documento = %s,
                telefono = %s,
                correo = %s,
                domicilio = %s,
                categoria_impositiva = %s,
                modificado_por = %s,
                modificado_en = CURRENT_TIMESTAMP
            WHERE id = %s AND emprendimiento_id = %s
            RETURNING *
        """, (
            nombre, tipo_doc, num_doc, telefono, correo,
            domicilio, categoria_imp, usuario, id, emprendimiento_id
        ))

        cliente_actualizado = cur.fetchone()
        if not cliente_actualizado:
            conn.rollback()
            return jsonify({"status": "error", "mensaje": "Cliente no encontrado"}), 404

        conn.commit()

        return jsonify({
            "status": "ok",
            "mensaje": "Cliente actualizado correctamente",
            "cliente": serializar_cliente(cliente_actualizado, rol)
        }), 200

    except psycopg2.errors.UniqueViolation:
        if conn:
            conn.rollback()
        return jsonify({
            "status": "error",
            "mensaje": "Ya existe otro cliente registrado con ese tipo y número de documento"
        }), 409
    except Exception as e:
        if conn:
            conn.rollback()
        return jsonify({"status": "error", "mensaje": f"Error al actualizar cliente: {str(e)}"}), 500
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()


# 5. OCULTAMIENTO REVERSIBLE — SOLO ADMIN (PATCH /api/clientes/<id>/visibilidad)
@clientes_bp.route('/api/clientes/<int:id>/visibilidad', methods=['PATCH'])
@clientes_bp.route('/api/clientes/<int:id>/ocultar', methods=['PATCH'])
def cambiar_visibilidad_cliente(id):
    # Solo el Administrador puede ocultar o restaurar clientes
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

        # Buscamos el estado actual del cliente
        cur.execute("""
            SELECT id, activo FROM ventas.clientes
            WHERE id = %s AND emprendimiento_id = %s
        """, (id, emprendimiento_id))
        cliente = cur.fetchone()

        if not cliente:
            return jsonify({"status": "error", "mensaje": "Cliente no encontrado"}), 404

        # Si el body envía explícitamente {"activo": true/false}, usamos ese valor;
        # si viene vacío, invertimos su estado actual (toggle)
        if "activo" in datos and isinstance(datos["activo"], bool):
            nuevo_estado = datos["activo"]
        else:
            nuevo_estado = not cliente["activo"]

        cur.execute("""
            UPDATE ventas.clientes
            SET activo = %s,
                modificado_por = %s,
                modificado_en = CURRENT_TIMESTAMP
            WHERE id = %s AND emprendimiento_id = %s
            RETURNING id, nombre_razon_social, activo
        """, (nuevo_estado, usuario, id, emprendimiento_id))

        actualizado = cur.fetchone()
        conn.commit()

        accion_texto = "restaurado" if nuevo_estado else "ocultado"
        return jsonify({
            "status": "ok",
            "mensaje": f"Cliente {accion_texto} correctamente",
            "cliente": actualizado
        }), 200

    except Exception as e:
        if conn:
            conn.rollback()
        return jsonify({"status": "error", "mensaje": f"Error al cambiar visibilidad: {str(e)}"}), 500
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()


# 6. ELIMINACIÓN DEFINITIVA PROTEGIDA — SOLO ADMIN (DELETE /api/clientes/<id>)
@clientes_bp.route('/api/clientes/<int:id>', methods=['DELETE'])
def eliminar_cliente(id):
    # Solo el Administrador puede eliminar clientes
    payload, error_resp, code = verificar_token(ROLES_ADMIN)
    if error_resp:
        return error_resp, code

    emprendimiento_id = payload.get("negocio_id")
    db_name = payload.get("db_name")

    conn = None
    cur = None
    try:
        conn = get_db_connection(db_name)
        cur = conn.cursor(cursor_factory=RealDictCursor)

        # 1. Verificamos que el cliente exista y revisamos si tiene saldo a favor
        cur.execute("""
            SELECT id, nombre_razon_social, saldo_a_favor
            FROM ventas.clientes
            WHERE id = %s AND emprendimiento_id = %s
        """, (id, emprendimiento_id))
        cliente = cur.fetchone()

        if not cliente:
            return jsonify({"status": "error", "mensaje": "Cliente no encontrado"}), 404

        if float(cliente["saldo_a_favor"] or 0) > 0:
            return jsonify({
                "status": "error",
                "mensaje": "No se puede eliminar el cliente porque posee saldo a favor disponible. Podés ocultarlo desde la opción de visibilidad."
            }), 409

        # 2. Verificamos si tiene ventas registradas (confirmadas o anuladas)
        cur.execute("""
            SELECT id FROM ventas.ventas
            WHERE cliente_id = %s AND emprendimiento_id = %s
            LIMIT 1
        """, (id, emprendimiento_id))

        if cur.fetchone():
            return jsonify({
                "status": "error",
                "mensaje": "No se puede eliminar el cliente porque tiene ventas asociadas en el historial. Podés ocultarlo para quitarlo de nuevas ventas sin perder el historial."
            }), 409

        # 3. Si no tiene ventas ni saldo, procedemos con el borrado físico definitivo
        cur.execute("""
            DELETE FROM ventas.clientes
            WHERE id = %s AND emprendimiento_id = %s
        """, (id, emprendimiento_id))
        conn.commit()

        return jsonify({
            "status": "ok",
            "mensaje": "Cliente eliminado definitivamente"
        }), 200

    except Exception as e:
        if conn:
            conn.rollback()
        return jsonify({"status": "error", "mensaje": f"Error al eliminar cliente: {str(e)}"}), 500
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()

# ENDPOINT INTERNO (PARA CONSUMO DESDE VENTAS / MICROSERVICIOS)
# 7. CONSULTAR CATEGORÍA IMPOSITIVA Y SALDO A FAVOR (GET /internal/clientes/<id>/categoria-impositiva)
@clientes_bp.route('/internal/clientes/<int:id>/categoria-impositiva', methods=['GET'])
def obtener_categoria_impositiva_interna(id):
    # Los endpoints internos reciben el nombre de la base del comercio por query param (?db_name=...)
    db_name = request.args.get('db_name') or request.headers.get('X-DB-Name')
    if not db_name:
        return jsonify({"status": "error", "mensaje": "Falta el parámetro obligatorio db_name"}), 400

    conn = None
    cur = None
    try:
        conn = get_db_connection(db_name)
        cur = conn.cursor(cursor_factory=RealDictCursor)

        cur.execute("""
            SELECT id, nombre_razon_social, categoria_impositiva, saldo_a_favor, activo
            FROM ventas.clientes
            WHERE id = %s
        """, (id,))
        cliente = cur.fetchone()

        if not cliente:
            return jsonify({"status": "error", "mensaje": "Cliente no encontrado"}), 404

        return jsonify({
            "status": "ok",
            "cliente_id": cliente["id"],
            "nombre_razon_social": cliente["nombre_razon_social"],
            "categoria_impositiva": cliente["categoria_impositiva"],
            "saldo_a_favor": float(cliente["saldo_a_favor"] or 0),
            "activo": cliente["activo"]
        }), 200

    except Exception as e:
        return jsonify({"status": "error", "mensaje": f"Error interno al consultar cliente: {str(e)}"}), 500
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()