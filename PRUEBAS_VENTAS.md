# Pruebas del módulo de Ventas (Módulo 8) — Paso a paso

Guía para corroborar el `POST /api/ventas` de punta a punta y saber **qué check tachar**.
Todo se hace con la terminal de VS Code + pgAdmin, sin depender del frontend.

- Base de datos: **`trazzo_trazzorocio`** (nunca `trazzo_master`)
- Microservicio: **transacciones-service** en `http://127.0.0.1:5003`

---

## 0. Antes de arrancar

1. **Servidor encendido** (y reiniciado cada vez que se toca `routes/ventas.py`):

   ```bash
   cd services/transacciones-service
   venv/Scripts/activate
   python app.py
   ```
   Tiene que decir `Running on http://127.0.0.1:5003`.

2. **Token nuevo** (vence a los 60 min):

   ```bash
   cd "C:/Users/corre/Desktop/trazzo"
   services/auth-service/venv/Scripts/python.exe scripts/generar_token.py --identificador trazzorocio --usuario rocio123
   ```

   El script imprime **dos comandos**:
   - `Curl del POST /api/ventas (...)` ← **este es el que se usa**
   - `Para el GET (Tarea 1)` ← solo lista ventas, no crea nada

3. **El curl del POST** tiene esta forma. Solo se cambian los números que están marcados:

   ```bash
   curl -X POST http://127.0.0.1:5003/api/ventas -H "Content-Type: application/json" -H "Authorization: Bearer PEGA_TU_TOKEN" -d "{\"tipo_venta\":\"CONTADO\",\"cliente_id\":1,\"medio_pago_id\":1,\"items\":[{\"producto_id\":2,\"cantidad\":2}]}"
   ```

   | Campo | Qué significa | Valores para probar |
   |---|---|---|
   | `tipo_venta` | modalidad | `CONTADO` / `CUENTA_CORRIENTE` |
   | `cliente_id` | cliente de la venta | `1` (Juan Perez) |
   | `medio_pago_id` | solo en contado | `1` (Efectivo) |
   | `producto_id` | producto vendido | `1` (Producto Maestro, stock 1) / `2` (Producto de Prueba, stock 20) |
   | `cantidad` | unidades | `2` normal / `5` o `999` para forzar falta de stock |

4. **Consulta de control** (pegala en el Query Tool de `trazzo_trazzorocio` y corré con F5):

   ```sql
   SELECT
       (SELECT cantidad FROM productos.productos WHERE id = 1)       AS stock_p1,
       (SELECT cantidad FROM productos.productos WHERE id = 2)       AS stock_p2,
       (SELECT COUNT(*) FROM ventas.ventas)                          AS ventas,
       (SELECT COALESCE(MAX(numero_venta), '-') FROM ventas.ventas)  AS ultima_venta,
       (SELECT COUNT(*) FROM ventas.pagos)                           AS pagos,
       (SELECT COUNT(*) FROM ventas.venta_detalle)                   AS renglones,
       (SELECT COUNT(*) FROM productos.movimientos_stock)            AS movimientos;
   ```

   **Anotá estos 7 valores antes de cada prueba.** Es la "foto" contra la que se compara.

---

## 1. Venta de contado correcta

**Curl:** `tipo_venta: CONTADO`, `producto_id: 2`, `cantidad: 2`, `medio_pago_id: 1`.

**Respuesta esperada (201):**

```json
{
  "status": "ok",
  "mensaje": "Venta creada",
  "venta_id": 3,
  "numero_venta": "00000003",
  "total": 300.0,
  "pago_id": 1,
  "items": [{"producto_id": 2, "cantidad": 2, "stock_restante": 18.0}]
}
```

**Consulta de control después:** respecto de la foto inicial

| Columna | Cambio esperado |
|---|---|
| `stock_p2` | −2 (20 → 18) |
| `stock_p1` | sin cambios |
| `ventas` | +1 |
| `ultima_venta` | el número siguiente (8 dígitos) |
| `pagos` | +1 |
| `renglones` | +1 |
| `movimientos` | +1 (tipo `VENTA`) |

**Verificación puntual:**

```sql
SELECT * FROM ventas.pagos ORDER BY id DESC LIMIT 1;             -- monto = total, estado ACTIVO
SELECT * FROM ventas.venta_detalle ORDER BY id DESC LIMIT 1;     -- precio 150, costo 100, subtotal 300
SELECT * FROM productos.movimientos_stock ORDER BY id DESC LIMIT 1; -- tipo VENTA, cantidad -2, stock_resultante 18
```

✅ Tacha: carrito, tipo de venta, medio de pago, precios congelados, descuento de stock, kardex, pago automático, atomicidad.

---

## 2. Rollback por falta de stock

**Curl:** `producto_id: 1` (stock 1), `cantidad: 5` (o `999`).

**Respuesta esperada (409):**

```json
{"status": "error", "mensaje": "Stock insuficiente para 'Producto Maestro'"}
```

**Consulta de control después:** los **7 valores tienen que ser idénticos** a la foto anterior. Si el stock bajó, o apareció una venta, o un pago, o un movimiento → el rollback está roto.

✅ Tacha: el stock nunca queda negativo / rollback total.

---

## 3. Venta a cuenta corriente (no genera pago)

**Curl:** `tipo_venta: CUENTA_CORRIENTE`, `cliente_id: 1`, `producto_id: 2`, `cantidad: 1`. Se puede omitir `medio_pago_id`.

**Respuesta esperada (201)** con `"pago_id": null`.

**Consulta de control después:** `pagos` **sin cambios**, `ventas` +1, `stock_p2` −1, `renglones` +1, `movimientos` +1.

✅ Tacha: recibe `CUENTA_CORRIENTE` y exige cliente.

---

## 4. Errores 400 que pide el checklist

Cada uno debe devolver **400** y **no** modificar la consulta de control.

| Prueba | Cómo se fuerza |
|---|---|
| Carrito vacío | `\"items\":[]` |
| Contado sin medio de pago | `tipo_venta: CONTADO` y sin `medio_pago_id` |
| Cuenta corriente sin cliente | `tipo_venta: CUENTA_CORRIENTE` y sin `cliente_id` (borrá `\"cliente_id\":1,`) |

Ejemplo (carrito vacío):

```bash
curl -X POST http://127.0.0.1:5003/api/ventas -H "Content-Type: application/json" -H "Authorization: Bearer PEGA_TU_TOKEN" -d "{\"tipo_venta\":\"CONTADO\",\"cliente_id\":1,\"medio_pago_id\":1,\"items\":[]}"
```

---

## 5. Checks para marcar

**POST /api/ventas (Tarea 2)**

- [x] Recibir carrito con productos y cantidades
- [x] Recibir tipo de venta: `CONTADO` o `CUENTA_CORRIENTE`
- [x] Exigir cliente en ventas a cuenta corriente
- [x] Exigir un único medio de pago en ventas de contado
- [x] Devolver 400 si el carrito está vacío
- [x] Devolver 400 si una venta de contado no tiene medio de pago
- [x] Devolver 400 si una venta a cuenta corriente no tiene cliente
- [x] Copiar el precio de venta y el costo actuales de cada producto al detalle histórico

**Stock, pago y atomicidad (Tarea 3)**

- [x] Descuento de stock atómico (`UPDATE ... WHERE cantidad >= X`)
- [x] El stock nunca queda negativo (409 si no alcanza)
- [x] Registrar el movimiento en el Kardex (`productos.movimientos_stock`)
- [x] Pago automático en ventas de contado con un único medio de pago
- [x] Atomicidad: venta + detalle + stock + pago ocurren juntos (si falla uno, no queda nada)

---

## 6. Si algo falla

| Síntoma | Causa probable | Solución |
|---|---|---|
| `Token inválido` / `Sesión expirada` | token vencido o mal copiado | correr `generar_token.py` y copiar el curl que imprime |
| `permission denied for schema ventas` | faltan permisos | `database/03_permisos_tenant.sql` en la base del negocio |
| `Medio de pago no encontrado` | falta la semilla | `database/04_datos_prueba_tenant.sql` |
| `duplicate key ... uq_venta_numero_tenant` | secuencia atrasada | `SELECT setval('ventas.seq_numero_venta', GREATEST((SELECT COALESCE(MAX(numero_venta::int),0) FROM ventas.ventas), 1));` |
| La venta se crea pero no descuenta stock ni crea pago | el servidor corre el código viejo | `Ctrl + C` y `python app.py` de nuevo |
| 500 con `rollback` y mensaje de FK | producto/cliente/medio de pago inexistente | revisar los IDs con `04_datos_prueba_tenant.sql` |

---

## 7. Pendiente del Módulo 8

- Cálculo de IVA (`modo_iva`, `monto_iva`, `leyenda_iva` según categorías del negocio y del cliente)
- Correlativo con bloqueo explícito (`SELECT ... FOR UPDATE` / tabla de contadores)
- Anulación `PATCH /api/ventas/{id}/anular` (repone stock, anula pagos, conserva el número)
- Ticket `GET /api/ventas/{id}/ticket`
