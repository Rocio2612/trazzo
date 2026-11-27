# Instructivo para ejecutar Trazzo en local

Guía paso a paso para levantar el proyecto en una sola computadora. Tiempo estimado: **20 a 30 minutos**.

## Qué se va a levantar

| Componente | Puerto | Para qué sirve |
|---|---|---|
| PostgreSQL | 5432 | Base de datos (una base maestra y una por negocio) |
| gateway | 5000 | Entrada única de la API |
| auth-service | 5001 | Registro, sesión y usuarios |
| productos-service | 5002 | Productos, bienes de uso, insumos, categorías y proveedores |
| transacciones-service | 5003 | Clientes, ventas y pagos |
| finanzas-service | 5004 | Medios de pago y gastos operativos |
| reportes-service | 5005 | Reportes (consulta a los demás servicios) |
| notificaciones-service | 5006 | Alertas de stock |
| Frontend | 5501 | Pantallas web (HTML, CSS y JavaScript) |

## 1. Requisitos

Verifiquen que estén instalados y con estas versiones o superiores:

```bash
python --version      # 3.11 o superior
git --version
node --version        # 18 o superior (solo para las pruebas automáticas)
```

También se necesita **PostgreSQL 15 o superior con pgAdmin 4** (se anota la contraseña del usuario `postgres` que pide la instalación). En Windows, al instalar Python hay que marcar *Add Python to PATH*.

## 2. Obtener el código

```bash
git clone https://github.com/Rocio2612/trazzo.git
cd trazzo
```

## 3. Entorno de Python

```bash
python -m venv venv
venv\Scripts\activate          # Windows (PowerShell)
source venv/bin/activate       # Linux o macOS
pip install -r requirements.txt
```

Este entorno debe estar **activado en cada terminal** donde se levante un servicio.

## 4. Crear las bases de datos

El sistema usa una base por negocio. Hay que crear dos bases previas: la maestra y la plantilla.

**Opción A: pgAdmin 4**

1. Clic derecho en *Databases*, *Create*, *Database…*. Nombre: `trazzo_master` (en minúsculas). Guardar.
2. Clic derecho en `trazzo_master`, *Query Tool*. Pegar y ejecutar (F5) el contenido de `database/01_trazzo_master.sql`.
3. Repetir con una base llamada `trazzo_plantilla` y el script `database/02_trazzo_plantilla.sql`.

**Opción B: línea de comandos** (si `psql` está en el PATH)

```bash
psql -U postgres -c "CREATE DATABASE trazzo_master;"
psql -U postgres -d trazzo_master -f database/01_trazzo_master.sql
psql -U postgres -c "CREATE DATABASE trazzo_plantilla;"
psql -U postgres -d trazzo_plantilla -f database/02_trazzo_plantilla.sql
```

**Verificación**

```sql
-- En trazzo_master: deben aparecer 5 tablas
SELECT table_name FROM information_schema.tables WHERE table_schema = 'auth' ORDER BY table_name;
-- En trazzo_plantilla: debe aparecer 1 fila (id = 1, nombre = 'Casa Central')
SELECT * FROM comercio.sucursales;
```

**Importante:** en pgAdmin, clic derecho sobre `trazzo_plantilla` y *Disconnect* (y cerrar su Query Tool). PostgreSQL no puede clonar una base que tenga conexiones abiertas, y el registro de negocios fallaría.

## 5. Variables de entorno

Cada servicio necesita su archivo `.env` dentro de su carpeta. Estos archivos no se suben a Git, así que hay que crearlos. Reemplacen `<contraseña>` por la contraseña de PostgreSQL y usen **la misma clave `JWT_SECRET` en todos los servicios** (cualquier texto largo sirve).

**`services/auth-service/.env`**

```env
DB_HOST=127.0.0.1
DB_PORT=5432
DB_NAME=trazzo_master
DB_USER=postgres
DB_PASSWORD=<contraseña>
JWT_SECRET=<clave_larga_igual_en_todos>
SERVICE_PORT=5001
```

**`productos-service`, `transacciones-service`, `finanzas-service` y `notificaciones-service`** (un `.env` en cada carpeta, cambiando `SERVICE_PORT` a 5002, 5003, 5004 y 5006). Estos servicios **no llevan `DB_NAME`**: usan la base del negocio que viene firmada en el token de cada usuario.

```env
DB_HOST=127.0.0.1
DB_PORT=5432
# DB_NAME no va fijo: cada petición usa el nombre de base que viene firmado en el JWT
DB_USER=postgres
DB_PASSWORD=<contraseña>
JWT_SECRET=<clave_larga_igual_en_todos>
SERVICE_PORT=5002
```

**`services/reportes-service/.env`**

```env
JWT_SECRET=<clave_larga_igual_en_todos>
SERVICE_PORT=5005
TRANSACCIONES_SERVICE_URL=http://127.0.0.1:5003
FINANZAS_SERVICE_URL=http://127.0.0.1:5004
PRODUCTOS_SERVICE_URL=http://127.0.0.1:5002
```

## 6. Levantar los servicios

Abran **una terminal por servicio**, en la carpeta raíz del proyecto y con el entorno virtual activado:

```bash
python gateway/app.py
python services/auth-service/app.py
python services/productos-service/app.py
python services/transacciones-service/app.py
python services/finanzas-service/app.py
python services/notificaciones-service/app.py
python services/reportes-service/app.py
```

Cada terminal debe quedar corriendo y mostrar el puerto en el que escucha. Reportes necesita que los demás servicios estén activos.

## 7. Abrir el frontend

Hay que **servir** los archivos del frontend, no abrirlos con doble clic.

- **Con VS Code:** abrir la carpeta del proyecto, clic derecho sobre `registro.html` (en `frontend`) y *Open with Live Server*. Debe abrir en el puerto **5501**.
- **Sin VS Code:**

```bash
python -m http.server 5501 --directory frontend
```

Luego entrar a `http://127.0.0.1:5501/registro.html`.

## 8. Recorrido de prueba

1. **Registrar un negocio.** Ejemplo de datos válidos:

   | Campo | Valor de ejemplo |
   |---|---|
   | Identificador | `tiendademo` |
   | Usuario | `admin01` |
   | Contraseña | `Demo#2026` |
   | Correo | `profe@example.com` |
   | Categoría impositiva | Responsable Inscripto |

   El sistema inicia sesión automáticamente como Administrador Propietario.
2. **Ver la base creada.** En pgAdmin, clic derecho en *Databases* y *Refresh*: aparece `trazzo_tiendademo`, creada al registrar el negocio.
3. **Cerrar sesión** con el botón «Cerrar sesión» y volver a **iniciar sesión** con el identificador, el usuario y la contraseña.
4. **Crear un cajero** desde Personalización, e iniciar sesión con él en otra ventana privada. El cajero no ve Reportes ni Personalización.
5. **Comprobar el aislamiento.** Cerrar sesión y registrar un segundo negocio (por ejemplo, `kioscodos`): su base nace completamente vacía y no ve nada de `tiendademo`.
6. **Probar los módulos** disponibles: proveedores, productos, reposición, clientes, ventas, cuenta corriente y reportes.

## 9. Pruebas automáticas (opcional)

```bash
pytest                    # backend
npm install               # una sola vez
npx playwright install    # una sola vez
npx vitest                # frontend (unitarias)
npx playwright test       # E2E: con todos los servicios y el frontend levantados
```

## 10. Solución de problemas

| Síntoma | Causa probable y solución |
|---|---|
| `password authentication failed for user "postgres"` | La contraseña del `.env` no coincide con la de PostgreSQL. Corregir `DB_PASSWORD` |
| Al registrar un negocio da error o no se crea `trazzo_<id>` | `trazzo_plantilla` está abierta en pgAdmin: hacer *Disconnect* y reintentar. Revisar también la consola de `auth-service` |
| `Failed to fetch` o errores de CORS | El gateway (5000) no está corriendo, o el frontend se abrió sin servidor o en otro puerto. Servirlo en el 5501 |
| `ModuleNotFoundError` | El entorno virtual no está activado en esa terminal, o faltan dependencias: `pip install -r requirements.txt` |
| Error 401 después de iniciar sesión | `JWT_SECRET` distinto entre servicios. Debe ser idéntico en todos los `.env` |
| `Address already in use` | El puerto está ocupado. Cerrar el proceso anterior o cambiar `SERVICE_PORT` |
| Reportes muestra indicadores sin calcular | Alguno de los servicios consultados (productos, transacciones o finanzas) no está activo, o la URL del `.env` es incorrecta |
| Error de importación al iniciar un servicio | Probar ejecutarlo desde su carpeta: `cd services/auth-service` y `python app.py` |
| Una base aparece con una cruz roja en pgAdmin | Solo indica que pgAdmin no está conectado a ella. No afecta al sistema |

## 11. Empezar de cero

1. Detener todos los servicios (Ctrl+C en cada terminal).
2. En pgAdmin, eliminar todas las bases `trazzo_*` de prueba (clic derecho, *Delete* o *Drop (Force)*).
3. Repetir el paso 4 (crear `trazzo_master` y `trazzo_plantilla`) y volver a levantar los servicios.
