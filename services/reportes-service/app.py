"""
MICROSERVICIO DE REPORTES GENERALES (services/reportes-service/app.py) — Puerto 5005
Módulo 11: Reporte General — Responsable: Aldi
Es un servicio agregador puro (sin acceso directo a PostgreSQL):
  1. Valida el token JWT y bloquea con 403 Forbidden cualquier acceso de rol CAJERO.
  2. Traduce el filtro de período del Frontend ('hoy', 'mes', 'anio') o rango manual
     ('desde' y 'hasta') a fechas YYYY-MM-DD en zona horaria Argentina (UTC-3).
  3. Consulta en paralelo/secuencia los resúmenes internos (/internal/...) de:
       - transacciones-service (5003): /internal/pagos/resumen y /internal/ventas/resumen
       - finanzas-service      (5004): /internal/gastos/resumen
       - productos-service     (5002): /internal/productos/resumen
  4. Consolida los 10 indicadores y el desglose de inventario con los nombres exactos
     que consume frontend/js/reportes.js y frontend/js/reportes-pantalla.js.
  5. Si un servicio interno falla o no responde, no devuelve error 500: informa el
     servicio en 'servicios_caidos' y marca en null únicamente los indicadores afectados.
"""

# Importamos os para leer las variables de entorno configuradas en .env
import os
# Importamos json para serializar/deserializar las respuestas HTTP entre microservicios
import json
# Importamos datetime para calcular los rangos de fechas ('hoy', 'mes', 'anio') en hora Argentina
import datetime
# Importamos urllib para hacer peticiones HTTP internas sin depender de librerías externas extra
import urllib.request
import urllib.parse
import urllib.error
# Importamos jwt (PyJWT) para decodificar y verificar la firma del token Bearer
import jwt
# Importamos Flask, request y jsonify para exponer la API REST del servicio
from flask import Flask, request, jsonify
# Importamos load_dotenv para cargar las claves y URLs desde services/reportes-service/.env
from dotenv import load_dotenv

# Cargamos las variables de entorno antes de leerlas
load_dotenv()

app = Flask(__name__)

# Clave secreta compartida con auth-service para validar los JWT (lee JWT_SECRET del .env)
JWT_SECRET_KEY = os.getenv("JWT_SECRET") or os.getenv("JWT_SECRET_KEY", "trazzo_jwt_secret_key_2026_super_segura")

# URLs base de los microservicios internos (configurables desde .env; si faltan, los puertos locales de cada uno)
# [Arreglo en Reportes, Aldana - Jimena]: sin valor por defecto, si faltaban estas variables el reporte salía vacío
# ("No se pudo calcular"). Lo definido en .env o en el entorno sigue teniendo prioridad.
TRANSACCIONES_URL = os.getenv("TRANSACCIONES_SERVICE_URL") or "http://127.0.0.1:5003"
FINANZAS_URL = os.getenv("FINANZAS_SERVICE_URL") or "http://127.0.0.1:5004"
PRODUCTOS_URL = os.getenv("PRODUCTOS_SERVICE_URL") or "http://127.0.0.1:5002"

# Roles autorizados exclusivamente para ver Reportes (Cajero queda excluido por diseño)
ROLES_AUTORIZADOS = ("PROPIETARIO", "ADMIN")

# Zona horaria oficial de Argentina (UTC-3)
ZONA_AR = datetime.timezone(datetime.timedelta(hours=-3))

# FUNCIONES AUXILIARES DE SEGURIDAD, FECHAS Y COMUNICACIÓN INTERNA
def verificar_admin_jwt():
    """
    Extrae y valida el token JWT del encabezado Authorization.
    Retorna (payload, None, None) si es PROPIETARIO o ADMIN,
    o (None, respuesta_json, codigo_http) si falta token, expiró o es CAJERO.
    """
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return None, jsonify({"status": "error", "mensaje": "Token de autenticación requerido"}), 401

    token = auth_header.split(" ", 1)[1].strip()
    try:
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        return None, jsonify({"status": "error", "mensaje": "La sesión ha expirado"}), 401
    except jwt.InvalidTokenError:
        return None, jsonify({"status": "error", "mensaje": "Token inválido"}), 401

    rol = (payload.get("rol") or "").upper()
    if rol not in ROLES_AUTORIZADOS:
        return None, jsonify({
            "status": "error",
            "mensaje": "Acceso denegado (403): no tenés permiso para ver Reportes."
        }), 403

    return payload, None, None

def calcular_rango_fechas(periodo, desde_raw=None, hasta_raw=None):
    """
    Calcula (fecha_desde, fecha_hasta) en formato 'YYYY-MM-DD' según el período:
      - 'hoy':  desde hoy hasta hoy.
      - 'mes':  desde el día 1 del mes actual hasta hoy.
      - 'anio': desde el 1 de enero del año actual hasta hoy.
    Si se envían 'desde' y 'hasta' explícitos, valida su formato ISO y los usa.
    """
    hoy_ar = datetime.datetime.now(ZONA_AR).date()

    # Si vienen fechas explícitas por query param (?desde=YYYY-MM-DD&hasta=YYYY-MM-DD)
    if desde_raw or hasta_raw:
        try:
            f_desde = datetime.date.fromisoformat(desde_raw) if desde_raw else hoy_ar.replace(day=1)
            f_hasta = datetime.date.fromisoformat(hasta_raw) if hasta_raw else hoy_ar
            if f_desde > f_hasta:
                return None, None, "La fecha 'desde' no puede ser posterior a 'hasta'"
            return f_desde.isoformat(), f_hasta.isoformat(), None
        except ValueError:
            return None, None, "Formato de fecha inválido. Use YYYY-MM-DD"

    periodo_norm = (periodo or "mes").strip().lower()
    if periodo_norm == "hoy":
        f_desde = hoy_ar
    elif periodo_norm == "anio":
        f_desde = hoy_ar.replace(month=1, day=1)
    elif periodo_norm == "mes":
        f_desde = hoy_ar.replace(day=1)
    else:
        return None, None, "Período inválido. Valores permitidos: hoy, mes, anio"

    return f_desde.isoformat(), hoy_ar.isoformat(), None

def consultar_interno(base_url, ruta, params):
    """
    Realiza una petición GET interna hacia otro microservicio pasando los filtros
    multi-tenant y de fechas por query string.
    Retorna (dict_json, True) si respondió 200 OK, o (None, False) si falló o no está disponible.
    """
    query_string = urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
    url_completa = f"{base_url}{ruta}?{query_string}"

    try:
        req = urllib.request.Request(url_completa, method="GET")
        with urllib.request.urlopen(req, timeout=3) as resp:
            if resp.status != 200:
                return None, False
            cuerpo = resp.read().decode("utf-8")
            return json.loads(cuerpo), True
    except Exception:
        return None, False

def redondear_o_none(valor):
    """Convierte a float redondeado a 2 decimales si existe; preserva None si el dato no llegó."""
    if valor is None:
        return None
    return round(float(valor), 2)

# ENDPOINTS DEL MICROSERVICIO
# 1. HEALTH CHECK (GET /api/reportes/health)
@app.route('/api/reportes/health', methods=['GET'])
def health():
    return jsonify({"status": "ok", "service": "reportes-service"}), 200

# 2. REPORTE GENERAL CONSOLIDADO (GET /api/reportes)
@app.route('/api/reportes', methods=['GET'])
def obtener_reporte_general():
    # Paso 1: Validar JWT y asegurar que solo ingrese PROPIETARIO o ADMIN
    payload, error_resp, code = verificar_admin_jwt()
    if error_resp:
        return error_resp, code

    db_name = payload.get("db_name")
    emprendimiento_id = payload.get("negocio_id")
    sucursal_id = payload.get("sucursal_id", 1)

    if not db_name:
        return jsonify({"status": "error", "mensaje": "El token no contiene la base de datos del negocio"}), 400

    # Paso 2: Resolver el rango de fechas solicitado (?periodo=hoy|mes|anio o ?desde=&hasta=)
    periodo = (request.args.get("periodo") or "mes").strip().lower()
    desde_raw = (request.args.get("desde") or "").strip()
    hasta_raw = (request.args.get("hasta") or "").strip()

    fecha_desde, fecha_hasta, error_fecha = calcular_rango_fechas(periodo, desde_raw, hasta_raw)
    if error_fecha:
        return jsonify({"status": "error", "mensaje": error_fecha}), 400

    # Parámetros comunes que se envían a todos los microservicios internos
    params_comunes = {
        "db_name": db_name,
        "emprendimiento_id": emprendimiento_id,
        "sucursal_id": sucursal_id,
        "fecha_desde": fecha_desde,
        "fecha_hasta": fecha_hasta
    }

    servicios_caidos = []

    # Paso 3: Consultar transacciones-service (5003) -> Pagos y Ventas ----------------------------------------------------
    # Muestra en Reporte: Ingresos, Total vendido y saldado (+ faltan saldar),
    # CMV, Ganancia bruta y Por cobrar.
    data_pagos, ok_pagos = consultar_interno(TRANSACCIONES_URL, "/internal/pagos/resumen", params_comunes)
    data_ventas, ok_ventas = consultar_interno(TRANSACCIONES_URL, "/internal/ventas/resumen", params_comunes)

    # Si ninguno de los dos endpoints de transacciones respondió, marcamos el servicio completo caído
    if not ok_pagos and not ok_ventas:
        servicios_caidos.append("transacciones")

    ingresos = redondear_o_none(data_pagos.get("ingresos_totales_cobrados")) if ok_pagos else None
    por_cobrar = redondear_o_none(data_pagos.get("cuentas_por_cobrar_total")) if ok_pagos else None

    vendido_saldado = redondear_o_none(data_ventas.get("vendido_saldado")) if ok_ventas else None
    ventas_por_saldar = int(data_ventas.get("ventas_por_saldar") or 0) if ok_ventas else None
    cmv = redondear_o_none(data_ventas.get("cmv")) if ok_ventas else None
    ganancia_bruta = redondear_o_none(data_ventas.get("ganancia_bruta")) if ok_ventas else None

    # Paso 4: Consultar finanzas-service (5004) -> Gastos, Bienes de Uso e Insumos ---------------------------------------
    # Muestra en Reporte: Total de gastos operativos, Inversión realizada en
    # bienes de uso y resta Insumos consumidos en Ganancia neta.
    data_finanzas, ok_finanzas = consultar_interno(FINANZAS_URL, "/internal/finanzas/resumen", params_comunes)
    if not ok_finanzas:
        servicios_caidos.append("finanzas")

    gastos_operativos = redondear_o_none(data_finanzas.get("gastos_operativos")) if ok_finanzas else None
    bienes_de_uso = redondear_o_none(data_finanzas.get("bienes_de_uso")) if ok_finanzas else None
    insumos_consumidos = redondear_o_none(data_finanzas.get("insumos_consumidos")) if ok_finanzas else None

    # Paso 5: Consultar productos-service (5002) -> Inventario actual y Desglose -----------------------------------------
    # Muestra en Reporte: Inversión actual en inventario y tabla Desglose por producto.
    data_productos, ok_productos = consultar_interno(PRODUCTOS_URL, "/internal/productos/resumen", params_comunes)
    if not ok_productos:
        servicios_caidos.append("productos")

    inventario_actual = redondear_o_none(data_productos.get("inventario_actual")) if ok_productos else None

    # Normalizamos cada fila del desglose al formato exacto que dibuja reportes-pantalla.js
    desglose_inversion = None
    if ok_productos and isinstance(data_productos.get("desglose_inversion"), list):
        desglose_inversion = [
            {
                "producto": item.get("producto") or item.get("nombre") or "Producto",
                "unidades": int(item.get("unidades") or item.get("cantidad") or 0),
                "costo_unitario": round(float(item.get("costo_unitario") or item.get("precio_compra") or 0), 2),
                "inversion": round(float(item.get("inversion") or 0), 2)
            }
            for item in data_productos["desglose_inversion"]
        ]

    # Paso 6: Calcular Ganancia Neta Operativa Estimada
    # Fórmula: Ganancia Bruta - Gastos Operativos - Insumos Consumidos
    # Muestra en Reporte: Ganancia neta operativa estimada.
    if ganancia_bruta is not None and gastos_operativos is not None:
        ganancia_neta = round(ganancia_bruta - gastos_operativos - (insumos_consumidos or 0.0), 2)
    else:
        ganancia_neta = None

    # Paso 7: Devolver el JSON consolidado alineado con frontend/js/reportes.js
    return jsonify({
        "status": "ok",
        "periodo": periodo,
        "fecha_desde": fecha_desde,
        "fecha_hasta": fecha_hasta,
        "ingresos": ingresos,
        "vendido_saldado": vendido_saldado,
        "ventas_por_saldar": ventas_por_saldar,
        "cmv": cmv,
        "ganancia_bruta": ganancia_bruta,
        "gastos_operativos": gastos_operativos,
        "bienes_de_uso": bienes_de_uso,
        "ganancia_neta": ganancia_neta,
        "inventario_actual": inventario_actual,
        "por_cobrar": por_cobrar,
        "desglose_inversion": desglose_inversion,
        "servicios_caidos": servicios_caidos
    }), 200


if __name__ == '__main__':
    port = int(os.getenv("SERVICE_PORT", 5005))
    app.run(host='127.0.0.1', port=port, debug=True)