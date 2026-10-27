# Frontend de Trazzo

HTML5 + CSS3 + JavaScript, sin framework. Cada módulo es una página (`productos.html`, `gastos.html`, …) que comparte la barra lateral y el encabezado.

## Cómo verlo

- **Con el gateway** (Flask, puerto 5000): sirve esta carpeta y la API juntas.
- **Solo el frontend**, desde la raíz del repo: `npx http-server frontend -p 4173` y abrir `http://localhost:4173/login.html`. Sin backend, el registro y el login no funcionan.

La URL del backend está en una sola constante, `API_URL` en [js/config.js](js/config.js). No la escribas en otro lado.

## Estructura

| Archivo | Para qué sirve |
|---|---|
| `js/config.js` | `API_URL` |
| `js/api.js` | `fetchAPI(endpoint, método, body)`: agrega el header `Authorization`, maneja el 401 |
| `js/auth.js` | Validaciones y guardado de sesión de las pantallas de login y registro |
| `js/roles.js` | Qué puede ver y hacer cada rol |
| `js/layout.js` | Barra lateral, encabezado, protección de ruta y cierre de sesión |
| `js/formatos.js` | Fechas y dinero (módulo ES) |
| `js/validadores.js` | Validaciones de formularios (módulo ES) |
| `css/base.css` | Colores, fuente y botones |
| `css/layout.css` | Barra lateral y encabezado |
| `css/auth.css` | Pantallas de autenticación |

## Sesión

Los tokens se guardan en `localStorage` como `trazzo_access_token` y `trazzo_refresh_token`. Nunca se guarda la contraseña.
`layout.js` también guarda `trazzo_menu_contraido` (si la barra lateral está contraída). Al cerrar sesión, o si la sesión vence, se borra todo lo que empiece con `trazzo_` (`limpiarSesionLocal()`).

Cada pantalla protegida le pregunta a `/auth/yo` si la sesión sigue vigente al cargar (y al volver con el botón "Atrás"). Si el token está vencido o revocado, se intenta renovar y, si no se puede, se va al login. Un error de conexión no cierra la sesión.

## Llamadas a la API (`fetchAPI`)

Usá siempre `fetchAPI(endpoint, método, body)` de `api.js`:

- Agrega el header `Authorization` (menos en las rutas públicas de `/auth`).
- **401:** renueva el access token con el refresh token y repite el pedido una sola vez (aunque haya varios pedidos a la vez, renueva una sola vez). Si no puede, limpia todo y va al login.
- **403:** avisa con el mensaje del Backend y vuelve al Panel (si ya estás en el Panel, solo avisa).
- **Cualquier otro error:** lanza un `Error` con el mensaje del Backend y estos datos para que tu pantalla decida qué mostrar:

| Propiedad | Qué es |
|---|---|
| `error.status` | el código HTTP |
| `error.errores` | `{ campo: mensaje }`, si el Backend lo manda |
| `error.campo` | el campo con error, si el Backend manda solo uno |
| `error.esperaSegundos` | el tiempo de espera de un 429 (header `Retry-After`) |

En las pantallas de autenticación, `mostrarErrorDeApi(error)` (de `auth.js`) muestra `errores` o `campo` junto a su campo, y `conEnvioBloqueado(formulario, tarea)` deshabilita el botón mientras se envía para evitar pedidos duplicados.

## Cómo armar una pantalla nueva (protegida)

1. Copiá cualquier pantalla "En construcción" (por ejemplo `productos.html`).
2. Poné tu contenido **dentro del `<main>`** (tiene que haber un solo `<main>`). La barra lateral y el encabezado se arman solos alrededor.
3. Dejá los cuatro scripts al final del `<body>`, **en este orden**:

```html
<script src="js/config.js"></script>
<script src="js/api.js"></script>
<script src="js/roles.js"></script>
<script src="js/layout.js"></script>
<script type="module" src="js/mi-modulo.js"></script> <!-- tu lógica, después de layout.js -->
```

4. El menú ya tiene el enlace de tu módulo. Si agregás un módulo nuevo, sumalo en `MENU` de `layout.js` (con `disponible: true`) y agregá su ícono en `ICONOS`, con la misma clave que el nombre del módulo.
5. Si la pantalla muestra datos escritos por usuarios (nombres, conceptos, proveedores), insertalos con `textContent`, **nunca con `innerHTML`**.

Si no hay token, `layout.js` manda al login antes de mostrar nada.

## Permisos por rol (`roles.js`)

**Es solo experiencia de usuario**: ocultar un botón no protege nada. El Backend valida cada acción.

Para ocultar elementos, marcalos en el HTML:

```html
<button data-modulo="productos" data-accion="eliminar">Eliminar</button>
<section data-modulo="reportes">…</section> <!-- sin data-accion se evalúa "ver" -->
```

Se aplica al cargar la página y también a lo que se agregue después (filas de una tabla, modales). Desde JavaScript:

```js
puedeHacer("productos", "ocultar"); // true o false
obtenerRol();                       // "admin", "cajero" o null
```

Un rol desconocido, o la falta de token, no tiene ningún permiso.

El rol sale del campo `rol` del token. Los nombres están en `ROL_ADMIN` y `ROL_CAJERO`, arriba de `roles.js`: hoy el Backend usa `PROPIETARIO` y `ADMIN` para el administrador. Si cambian, se modifican solo ahí.

### Qué puede hacer el Cajero

Todo lo demás es solo del administrador. La matriz completa (módulo × acción) está en `PERMISOS` de `roles.js`.

| Módulo | Cajero |
|---|---|
| Notificaciones | ver y descartar (la acción se llama `eliminar`: la alerta se saca de la vista) |
| Productos | ver, crear, editar y reponer. En la reposición solo elige proveedores existentes (`proveedor_nuevo` es del administrador). No oculta ni elimina |
| Clientes | solo `seleccionar` uno al hacer una venta. Ve únicamente el nombre |
| Ventas | ver, crear, editar y generar el ticket (`ticket`). No oculta, elimina ni anula |
| Cuenta Corriente | ver, crear y editar pagos. No ve los datos completos del cliente (`ver_datos_completos`) |
| Bienes de Uso, Insumos, Gastos, Proveedores, Reportes | sin acceso |
| Negocio, Personal, Categorías, Medios de pago | sin acceso |

## Fechas, dinero y validaciones

Son módulos ES: se usan desde un `<script type="module">`.

```js
import { fechaParaMostrar, fechaParaEnviar, formatearDinero } from "./js/formatos.js";
import { validarNumeroPositivo, validarFechaNoFutura } from "./js/validadores.js";

fechaParaMostrar("2026-03-05"); // "05-03-2026"   (del Backend a la pantalla)
fechaParaEnviar("05-03-2026");  // "2026-03-05"   (de la pantalla al Backend); null si no es válida
formatearDinero("1234.5");      // "$ 1.234,50"   ("" si no es un número)

validarNumeroPositivo(valor, "El costo"); // null si está bien, o el mensaje: "El costo debe ser mayor a 0."
```

| Validador | Cuándo usarlo |
|---|---|
| `validarObligatorio` | cualquier campo requerido |
| `validarNumeroPositivo` | costo, precio, monto (mayor a 0) |
| `validarNumeroNoNegativo` | 0 o mayor |
| `validarEnteroNoNegativo` | stock actual y mínimo |
| `validarEnteroPositivo` | cantidades |
| `validarFecha` | fecha en `aaaa-mm-dd` (lo que devuelve un `<input type="date">`) |
| `validarFechaNoFutura` | fecha que no puede ser posterior a hoy |
| `precioMenorAlCosto` | aviso (no error) del modal de productos |

Cada validador devuelve `null` si el valor es válido, o el mensaje para mostrar **junto al campo**. El Backend repite todas las validaciones.

## `data-testid` (para los tests)

Formato `<modulo>-<elemento>`. Los campos de formulario usan como `id` el nombre del campo del contrato.

`productos-tabla`, `productos-buscador`, `productos-nuevo`, `productos-editar-<id>`, `productos-reponer-<id>`, `productos-ocultar-<id>`, `productos-eliminar-<id>`, `modal-guardar`, `modal-cancelar`, `campana`, `campana-contador`, `alerta-descartar-<id>`, `menu-<modulo>`, `btn-cerrar-sesion`.

## Tests

Desde la raíz del repo. La primera vez, en cada computadora:

```
npm install
npx playwright install chromium
```

| Comando | Qué hace |
|---|---|
| `npm test` | corre todo |
| `npm run test:unit` | Vitest: formatos y validadores (`tests/unit/`) |
| `npm run test:e2e` | Playwright: pantallas en el navegador (`tests/e2e/`) |
| `npm run test:ui` | Playwright en modo visual, para depurar |

**Los tests E2E no necesitan el backend.** Levantan esta carpeta con un servidor estático y simulan la API con `simularApi` (en `tests/e2e/helpers.js`), con el mismo formato del contrato. Otros ayudantes de ese archivo:

- `jwtFalso("CAJERO")`: un token con el rol que quieras.
- `iniciarSesionComo(page, "ADMIN")`: deja la sesión iniciada.
- `tokensGuardados(page)`: lee los tokens guardados.

Si cambiás un nombre de campo del contrato, o un texto o `data-testid` que usan los tests, se van a romper: eso es lo esperado, actualizalos.

Los tests marcados con `test.fixme` son huecos conocidos que todavía no están resueltos (por ejemplo, detectar un token revocado al cargar el dashboard).
