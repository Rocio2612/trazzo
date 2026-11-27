# Trazzo

Sistema web de gestión comercial para pequeños negocios (productos, ventas, cuenta corriente, proveedores, clientes, gastos y reportes), con roles de Administrador y Cajero.

## Enlace a MER

https://docs.google.com/presentation/d/1MSjKVxiVHAT8Krpd3YB-Q18oubkv0qUQCzP8k3cjqEA/edit?slide=id.h192dc7e9fa1ab097_0_45#slide=id.h192dc7e9fa1ab097_0_45

## Enlace a TRELLO

https://trello.com/invite/b/68f62cbeb2c8e0c4f2f36101/ATTI213fa1254d43aac08c286026b7423d26EE8D56BE/proyecto-trazzo 

## Funcionalidades
 
- **Autenticación y sesión:** registro del negocio, inicio de sesión, recuperación de contraseña por correo, protección contra intentos fallidos y cierre de sesión seguro.
- **Personalización:** datos y categoría impositiva del negocio, personal y roles, categorías y medios de pago.
- **Notificaciones:** alertas de stock mínimo dentro de la plataforma.
- **Productos, bienes de uso e insumos:** reposición de stock, bajas y consumo de insumos.
- **Proveedores y clientes:** fichas con categoría impositiva, que define el tratamiento del IVA.
- **Ventas y cuenta corriente:** ventas de contado y a cuenta corriente, pagos, saldos y anulaciones.
- **Gastos operativos y reportes:** indicadores de ingresos, ganancia y capital invertido.
**Fuera de alcance:** facturación electrónica y tickets, pagos a proveedores, pagos con varios medios, productos con variantes, venta por peso o volumen, descuentos y devoluciones parciales.

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
- **Red**: todo corre en una PC central (PostgreSQL + microservicios); el resto de las PCs accede como cliente vía LAN/Wi-Fi.

## Requisitos previos
 
- Python 3.11 o superior
- PostgreSQL 15 o superior, con pgAdmin 4
- Git
- Node.js 18 o superior (para Vitest y Playwright)
- VS Code con la extensión Live Server (recomendado)

### Base de datos por negocio (Database-per-Tenant)
 
| Base | Contenido |
|---|---|
| `trazzo_master` | Esquema `auth`: `emprendimientos` (con el nombre de la base de cada negocio), `usuarios`, `usuario_sucursales`, `tokens_bloqueados` y `recuperacion_claves` |
| `trazzo_plantilla` | Molde vacío con los esquemas operativos (`comercio`, `productos`, `finanzas`, `notificaciones` y `ventas`) y la sucursal inicial «Casa Central». No guarda datos reales |
| `trazzo_<identificador>` | Una base independiente por negocio, clonada de `trazzo_plantilla` al registrarlo (por ejemplo, `trazzo_panchoria`) |
 
Al iniciar sesión, `auth-service` consulta `trazzo_master`, obtiene el nombre de la base del negocio y lo firma dentro del JWT. Los demás servicios usan ese nombre en cada petición, por lo que **los datos de cada negocio quedan físicamente separados**.
 
La estructura de sucursales (`comercio.sucursales` y `auth.usuario_sucursales`) ya está preparada para una versión futura. Hoy cada negocio opera con una sola sucursal.

## Testing
 
```bash
pytest                    # backend
npm install               # una sola vez
npx playwright install    # una sola vez (descarga los navegadores)
npx vitest                # unitarias del frontend
npx playwright test       # E2E: con todos los servicios y el frontend levantados
```

## Estructura del proyecto

```bash
TRAZZO/
├── database/          # 01_trazzo_master.sql y 02_trazzo_plantilla.sql
├── gateway/           # API Gateway (puerto 5000)
├── services/          # Microservicios Flask independientes
│   ├── auth-service/
│   ├── productos-service/
│   ├── transacciones-service/
│   ├── finanzas-service/
│   ├── reportes-service/
│   └── notificaciones-service/
├── frontend/          # HTML5 + CSS3 + JavaScript vanilla (módulos ES)
├── scripts/           # Scripts de apoyo
├── tests/             # Pruebas automatizadas (pytest, Vitest y Playwright)
├── api_contract.md    # Contrato de endpoints y códigos HTTP
├── INSTRUCTIVO.md     # Guía paso a paso para ejecutar el proyecto
├── package.json
├── playwright.config.js
└── vitest.config.js
```



