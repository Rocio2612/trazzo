"""
MÓDULO 9: CUENTA CORRIENTE COMERCIAL Y PAGOS (routes/pagos.py) — Responsable: Aldi
Gestiona los cobros asociados a ventas a cuenta corriente (tabla ventas.pagos):
registro de pagos, validación de fechas y montos, edición, anulación sin borrado,
cálculo en vivo del saldo pendiente, acumulación de saldo a favor y resumen para Reportes.
"""

# Importamos Blueprint para agrupar las rutas de pagos y registrarlas en app.py
from flask import Blueprint, request, jsonify
# Importamos RealDictCursor para obtener resultados SQL como diccionarios
from psycopg2.extras import RealDictCursor
# Importamos desde helpers.py la conexión dinámica multi-base y la validación de JWT
from helpers import get_db_connection, verificar_token

# Creamos el Blueprint del módulo de cuenta corriente / pagos
pagos_bp = Blueprint('pagos', __name__)