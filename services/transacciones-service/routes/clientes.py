"""
MÓDULO 7: GESTIÓN DE CLIENTES (routes/clientes.py) — Responsable: Aldi
Administra la agenda de compradores del comercio (tabla ventas.clientes):
alta completa con validación de CUIT (módulo 11), alta rápida para Cajero,
edición, ocultamiento reversible, eliminación protegida y privacidad de datos
personales según Ley N° 25.326.
"""

# Importamos Blueprint para agrupar las rutas de este módulo y conectarlas en app.py
from flask import Blueprint, request, jsonify
# Importamos RealDictCursor para que PostgreSQL devuelva cada fila como diccionario {columna: valor}
from psycopg2.extras import RealDictCursor
# Importamos desde helpers.py la conexión dinámica multi-base y la validación de JWT
from helpers import get_db_connection, verificar_token

# Creamos el Blueprint del módulo de clientes que luego registra app.py
clientes_bp = Blueprint('clientes', __name__)