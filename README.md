# Trazzo

Sistema web de gestión comercial para pequeños negocios (productos, ventas, cuenta corriente, proveedores, clientes, gastos y reportes), con roles de Administrador y Cajero.

## Enlace a MER

https://docs.google.com/presentation/d/1MSjKVxiVHAT8Krpd3YB-Q18oubkv0qUQCzP8k3cjqEA/edit?slide=id.h192dc7e9fa1ab097_0_45#slide=id.h192dc7e9fa1ab097_0_45

## Enlace a TRELLO

https://trello.com/invite/b/68f62cbeb2c8e0c4f2f36101/ATTI213fa1254d43aac08c286026b7423d26EE8D56BE/proyecto-trazzo 

## Tecnologías

| Área | Tecnología |
|---|---|
| Frontend | HTML5, CSS3, JavaScript Vanilla |
| Backend | Python + Flask (microservicios) |
| Base de datos | PostgreSQL |
| Acceso a datos | psycopg2 |
| Autenticación | JWT + hash de contraseñas (werkzeug.security) |
| Testing | pytest (backend), Vitest (frontend), Playwright (E2E) |

## Arquitectura

- **Microservicios Flask**: Autenticación, Productos, Transacciones, Finanzas, Notificaciones, Reportes.
- **Base de datos**: patrón *Database-per-Tenant* — una base maestra (`trazzo_master`) con el directorio de negocios, y una base operativa por negocio (clonada de `trazzo_plantilla`).
- **Red**: todo corre en una PC central (PostgreSQL + microservicios); el resto de las PCs accede como cliente vía LAN/Wi-Fi.

## Requisitos previos

- Python 3.11+
- PostgreSQL 15+, con pgAdmin
- Git

## Instalación y ejecución local

```bash
# 1. Clonar el repositorio
git clone <url-del-repo>
cd trazzo

# 2. Crear entorno virtual e instalar dependencias
python -m venv venv
venv\Scripts\activate        # Windows
pip install -r requirements.txt

# 3. Crear la base de datos vacía en PostgreSQL (vía pgAdmin o psql)
CREATE DATABASE trazzo_db;

# 4. Ejecutar la estructura
# Abrir estructura.sql en VS Code, copiar el contenido, pegarlo en el
# Query Tool de pgAdmin (conectado a trazzo_db) y ejecutarlo (▶).

# 5. Configurar variables de entorno
# Crear un archivo .env en la raíz (no se sube a Git) con:
DATABASE_URL=postgresql://postgres:<tu_contraseña>@localhost:5432/trazzo_db
JWT_SECRET_KEY=<una_clave_secreta>

# 6. Ejecutar cada microservicio
python auth_service/app.py
python productos_service/app.py
# (repetir para cada servicio, cada uno en su propio puerto)

# 7. Abrir el frontend
# Abrir los archivos .html (ej. login.html) directamente en el navegador,
# o servirlos con una extensión tipo Live Server.
```

## Testing

```bash
pytest                   # pruebas de backend
npx vitest                # pruebas unitarias de frontend
npx playwright test       # pruebas end-to-end
```

## Estructura del proyecto

```
trazzo/
├── estructura.sql        # Definición única de la base de datos
├── auth_service/
├── productos_service/
├── transacciones_service/
├── finanzas_service/
├── notificaciones_service/
├── reportes_service/
├── frontend/
└── tests/
```
