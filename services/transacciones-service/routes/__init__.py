"""
INICIALIZADOR DEL PAQUETE DE RUTAS (routes/__init__.py)
En Python, la presencia de '__init__.py' le indica al intérprete que la carpeta
'routes/' es un paquete importable (módulo). Gracias a este archivo, 'app.py'
puede importar los Blueprints usando:
    from routes.clientes import clientes_bp
    from routes.pagos import pagos_bp
    from routes.ventas import ventas_bp

No necesita llevar código ejecutable; su sola presencia habilita las importaciones
entre carpetas sin errores.
"""