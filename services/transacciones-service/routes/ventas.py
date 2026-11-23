"""
MÓDULO 8: VENTAS Y FACTURACIÓN INTERNA (routes/ventas.py) — Responsable: Rocío
Gestiona las operaciones comerciales (tablas ventas.ventas y ventas.venta_detalle):
confirmación atómica de ventas de contado y cuenta corriente, numeración correlativa
de 8 dígitos, cálculo de IVA (5 reglas fiscales), descuento de stock en productos-service,
descuento de saldo a favor, anulaciones y resumen interno para Reportes.
"""

# Importamos Blueprint para agrupar las rutas de ventas y registrarlas en app.py
from flask import Blueprint, request, jsonify
# Importamos RealDictCursor para obtener resultados SQL como diccionarios
from psycopg2.extras import RealDictCursor
# Importamos desde helpers.py la conexión dinámica multi-base y la validación de JWT
from helpers import get_db_connection, verificar_token

# Creamos el Blueprint del módulo de ventas
ventas_bp = Blueprint('ventas', __name__)