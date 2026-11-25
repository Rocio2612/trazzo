"""
generar_token.py - Utilidad del Sprint 3 (Trazzo)

Hace tres cosas, sin depender del navegador ni de la pantalla de registro:
  1. Diagnostica: muestra los negocios y usuarios registrados en trazzo_master
     (identificador, usuario, base operativa, rol, activo).
  2. Genera un access_token JWT con la MISMA estructura que devuelve el login
     (negocio_id, db_name, sucursal_id, rol, jti, exp), firmado con el
     JWT_SECRET del auth-service. Sirve para probar los endpoints privados.
  3. Arma el curl listo para pegar del POST /api/ventas, con los IDs reales de
     cliente / producto / medio de pago que haya en la base del negocio.

Uso (desde la raíz del proyecto, con el venv del auth-service):

    services\\auth-service\\venv\\Scripts\\python.exe scripts\\generar_token.py
    services\\auth-service\\venv\\Scripts\\python.exe scripts\\generar_token.py --identificador trazzorocio --usuario rocio123
    ... --password "Rocio123@"     (opcional: verifica que el hash guardado coincida)
    ... --minutos 120              (opcional: vigencia del token, por defecto 60)

Sin argumentos lista todo lo registrado y usa el primer usuario activo.
"""

import argparse
import datetime
import os
import sys
import uuid
from pathlib import Path

import jwt
import psycopg2
from dotenv import load_dotenv
from psycopg2.extras import RealDictCursor

try:  # La consola de Windows a veces arranca en cp1252
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

RAIZ = Path(__file__).resolve().parents[1]
ENV_AUTH = RAIZ / "services" / "auth-service" / ".env"
ENV_TRANSACCIONES = RAIZ / "services" / "transacciones-service" / ".env"

load_dotenv(ENV_AUTH)

SECRET_KEY = os.getenv("JWT_SECRET")
BD_MASTER = os.getenv("DB_NAME", "trazzo_master")


def conectar(bd, usuario=None, password=None):
    """Abre una conexión TCP a PostgreSQL usando credenciales del .env."""
    return psycopg2.connect(
        host=os.getenv("DB_HOST", "127.0.0.1"),
        port=os.getenv("DB_PORT", "5432"),
        database=bd,
        user=usuario or os.getenv("DB_USER", "auth_user"),
        password=password or os.getenv("DB_PASSWORD"),
        connect_timeout=5,
    )


CONSULTA_USUARIOS = """
    SELECT u.id                AS usuario_id,
           u.usuario,
           u.correo,
           u.password_hash,
           u.rol,
           u.activo,
           e.id                AS negocio_id,
           e.identificador,
           e.nombre_bd,
           e.categoria_impositiva,
           COALESCE(
               (SELECT s.sucursal_id
                  FROM auth.usuario_sucursales s
                 WHERE s.usuario_id = u.id AND s.activo = TRUE
                 ORDER BY s.es_predeterminada DESC, s.id ASC
                 LIMIT 1),
               1
           )                   AS sucursal_id
      FROM auth.usuarios u
      JOIN auth.emprendimientos e ON e.id = u.emprendimiento_id
     ORDER BY u.id;
"""


def listar_usuarios():
    """Devuelve todas las filas de auth.usuarios + auth.emprendimientos."""
    conn = conectar(BD_MASTER)
    try:
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute(CONSULTA_USUARIOS)
        return cur.fetchall()
    finally:
        conn.close()


def base_existe(nombre_bd):
    """True si la base operativa del negocio existe físicamente en PostgreSQL."""
    conn = conectar("postgres")
    try:
        cur = conn.cursor()
        cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (nombre_bd,))
        return cur.fetchone() is not None
    finally:
        conn.close()


def datos_para_probar(db_name, negocio_id):
    """
    Busca IDs reales dentro de la base del negocio para armar el curl.
    Usa las credenciales de transacciones-service a propósito: si esta conexión
    falla por permisos, es exactamente el mismo error que va a dar la API.
    Devuelve (cliente, producto, medio, error).
    """
    load_dotenv(ENV_TRANSACCIONES, override=True)
    usuario = os.getenv("DB_USER", "transacciones_user")
    password = os.getenv("DB_PASSWORD")
    try:
        conn = conectar(db_name, usuario, password)
    except Exception as e:
        load_dotenv(ENV_AUTH, override=True)
        return None, None, None, str(e)

    try:
        cur = conn.cursor(cursor_factory=RealDictCursor)
        try:
            cur.execute(
                "SELECT id, nombre_razon_social FROM ventas.clientes "
                "WHERE emprendimiento_id = %s AND activo = TRUE ORDER BY id LIMIT 1",
                (negocio_id,),
            )
            cliente = cur.fetchone()
            cur.execute(
                "SELECT id, nombre, cantidad FROM productos.productos "
                "WHERE emprendimiento_id = %s AND activo = TRUE "
                "AND tipo_producto = 'BIEN_DE_CAMBIO' ORDER BY id LIMIT 1",
                (negocio_id,),
            )
            producto = cur.fetchone()
            cur.execute(
                "SELECT id, nombre FROM finanzas.medios_pago "
                "WHERE emprendimiento_id = %s AND activo = TRUE ORDER BY id LIMIT 1",
                (negocio_id,),
            )
            medio = cur.fetchone()
        except Exception as e:
            return None, None, None, str(e)
        return cliente, producto, medio, None
    finally:
        conn.close()
        load_dotenv(ENV_AUTH, override=True)


def main():
    ap = argparse.ArgumentParser(description="Genera un access_token de Trazzo para pruebas.")
    ap.add_argument("--identificador", help="Identificador del negocio (ej. trazzorocio)")
    ap.add_argument("--usuario", help="Nombre de usuario (ej. rocio123)")
    ap.add_argument("--password", help="Opcional: verifica que coincida con el hash guardado")
    ap.add_argument("--minutos", type=int, default=60, help="Vigencia del token (por defecto 60)")
    args = ap.parse_args()

    if not SECRET_KEY:
        print("ERROR: falta JWT_SECRET en services/auth-service/.env")
        return 1

    try:
        filas = listar_usuarios()
    except Exception as e:
        print(f"ERROR al conectar con {BD_MASTER}: {e}")
        print("Revisá DB_HOST / DB_USER / DB_PASSWORD en services/auth-service/.env")
        return 1

    if not filas:
        print(f"No hay ningún usuario registrado en {BD_MASTER}.auth.usuarios.")
        print("Registrate desde http://127.0.0.1:5000/registro.html y volvé a correr esto.")
        return 1

    print(f"Usuarios registrados en {BD_MASTER}:")
    print(f"  {'id':>3}  {'negocio':<18} {'usuario':<14} {'bd operativa':<26} {'rol':<12} activo")
    for f in filas:
        print(f"  {f['usuario_id']:>3}  {f['identificador']:<18} {f['usuario']:<14} "
              f"{f['nombre_bd']:<26} {f['rol']:<12} {f['activo']}")
    print()

    candidatos = filas
    if args.identificador:
        candidatos = [f for f in candidatos
                      if f["identificador"].lower() == args.identificador.lower().strip()]
    if args.usuario:
        candidatos = [f for f in candidatos
                      if f["usuario"].lower() == args.usuario.lower().strip()]

    if not candidatos:
        print("No encontré ese negocio/usuario. Fijate en la tabla de arriba.")
        print("Ojo: 'identificador' no es lo mismo que 'usuario'.")
        return 1

    elegido = next((f for f in candidatos if f["activo"]), None)
    if not elegido:
        print("El usuario existe pero está INACTIVO (activo = FALSE): el login lo rechaza.")
        return 1

    print(f"Usuario elegido: {elegido['usuario']}  (negocio: {elegido['identificador']}, "
          f"base: {elegido['nombre_bd']})")

    if args.password:
        try:
            from werkzeug.security import check_password_hash
            coincide = check_password_hash(elegido["password_hash"], args.password)
            print("Contraseña: " + ("coincide con el hash guardado" if coincide
                                    else "NO coincide con el hash guardado"))
        except Exception as e:
            print(f"(No se pudo verificar la contraseña: {e})")

    if not base_existe(elegido["nombre_bd"]):
        print()
        print(f"ATENCIÓN: la base '{elegido['nombre_bd']}' NO existe en PostgreSQL.")
        print("El login va a funcionar, pero cualquier endpoint de datos va a fallar.")
        print("Creala en pgAdmin conectada a 'postgres':")
        print(f'   CREATE DATABASE "{elegido["nombre_bd"]}" TEMPLATE trazzo_plantilla;')
        print("y después corré database/03_permisos_tenant.sql dentro de ella.")
        return 1

    ahora = datetime.datetime.now(datetime.timezone.utc)
    payload = {
        "usuario_id": elegido["usuario_id"],
        "usuario": elegido["usuario"],
        "negocio_id": elegido["negocio_id"],
        "categoria_impositiva": elegido["categoria_impositiva"],
        "db_name": elegido["nombre_bd"],
        "sucursal_id": elegido["sucursal_id"],
        "rol": elegido["rol"],
        "jti": f"manual-{uuid.uuid4()}",
        "exp": ahora + datetime.timedelta(minutes=args.minutos),
    }
    token = jwt.encode(payload, SECRET_KEY, algorithm="HS256")
    vence_local = (ahora + datetime.timedelta(minutes=args.minutos)).astimezone()

    print(f"Token válido hasta: {vence_local:%Y-%m-%d %H:%M:%S} (hora local)")
    print()
    print("ACCESS TOKEN:")
    print(token)
    print()

    cliente, producto, medio, error = datos_para_probar(elegido["nombre_bd"], elegido["negocio_id"])
    if error:
        print(f"[PERMISOS/DATOS] No pude leer la base del negocio: {error}")
        print("Si dice 'permission denied', corré database/03_permisos_tenant.sql como postgres.")
        print()

    faltantes = []
    if cliente is None and not error:
        faltantes.append("cliente (ventas.clientes)")
    if producto is None and not error:
        faltantes.append("producto BIEN_DE_CAMBIO (productos.productos)")
    if medio is None and not error:
        faltantes.append("medio de pago (finanzas.medios_pago)")

    if faltantes:
        print("Faltan datos de prueba en esta base: " + ", ".join(faltantes))
        print("Corré database/04_datos_prueba_tenant.sql conectada a la base del negocio.")
        print()

    cliente_id = cliente["id"] if cliente else 1
    producto_id = producto["id"] if producto else 1
    medio_id = medio["id"] if medio else 1

    if cliente:
        print(f"Cliente de prueba:  id={cliente_id}  {cliente['nombre_razon_social']}")
    if producto:
        print(f"Producto de prueba: id={producto_id}  {producto['nombre']}  (stock: {producto['cantidad']})")
    if medio:
        print(f"Medio de pago:      id={medio_id}  {medio['nombre']}")
    print()

    cuerpo = (f'{{\\"tipo_venta\\":\\"CONTADO\\",'
              f'\\"cliente_id\\":{cliente_id},'
              f'\\"medio_pago_id\\":{medio_id},'
              f'\\"items\\":[{{\\"producto_id\\":{producto_id},\\"cantidad\\":2}}]}}')
    print("Curl del POST /api/ventas (copiá y pegá tal cual):")
    print(f'curl -X POST http://127.0.0.1:5003/api/ventas '
          f'-H "Content-Type: application/json" '
          f'-H "Authorization: Bearer {token}" '
          f'-d "{cuerpo}"')
    print()
    print("Para el GET (Tarea 1):")
    print(f'curl http://127.0.0.1:5003/api/ventas -H "Authorization: Bearer {token}"')
    return 0


if __name__ == "__main__":
    sys.exit(main())
