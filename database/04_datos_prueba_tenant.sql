-- ============================================================================
-- 04_datos_prueba_tenant.sql
-- Datos mínimos para probar el módulo de Ventas (POST /api/ventas).
--
-- IMPORTANTE: ejecutar en la base DEL NEGOCIO (ej. trazzo_trazzorocio),
-- NO en trazzo_master. Se puede correr varias veces: no duplica nada.
-- ============================================================================
BEGIN;

-- 1. Proveedor (obligatorio: productos.productos.proveedor_id es NOT NULL)
INSERT INTO productos.proveedores
    (emprendimiento_id, nombre, tipo_documento, numero_documento, categoria_impositiva)
SELECT s.emprendimiento_id, 'Proveedor Generico', 'CUIT', '20123456789',
       'RESPONSABLE_INSCRIPTO'
  FROM comercio.sucursales s
 WHERE s.id = 1
   AND NOT EXISTS (
       SELECT 1 FROM productos.proveedores p
        WHERE p.emprendimiento_id = s.emprendimiento_id
          AND p.tipo_documento = 'CUIT'
          AND p.numero_documento = '20123456789'
   );

-- 2. Producto vendible (BIEN_DE_CAMBIO: $100 de costo, $150 de venta, 20 unidades)
INSERT INTO productos.productos
    (emprendimiento_id, sucursal_id, proveedor_id, tipo_producto, nombre,
     precio_compra, iva_alicuota, rentabilidad, precio_venta, cantidad,
     stock_minimo, unidad_medida, creado_por)
SELECT s.emprendimiento_id, 1, p.id, 'BIEN_DE_CAMBIO', 'Producto de Prueba',
       100.00, 21.00, 50.00, 150.00, 20, 2, 'unidades', 'admin'
  FROM comercio.sucursales s
  JOIN productos.proveedores p
    ON p.emprendimiento_id = s.emprendimiento_id
   AND p.tipo_documento = 'CUIT'
   AND p.numero_documento = '20123456789'
 WHERE s.id = 1
   AND NOT EXISTS (
       SELECT 1 FROM productos.productos x
        WHERE x.emprendimiento_id = s.emprendimiento_id
          AND x.nombre = 'Producto de Prueba'
   );

-- 3. Cliente para la venta (el token lo usa como cliente_id)
INSERT INTO ventas.clientes
    (emprendimiento_id, nombre_razon_social, tipo_documento, numero_documento,
     categoria_impositiva, creado_por)
SELECT s.emprendimiento_id, 'Juan Perez', 'DNI', '45715765', 'CONSUMIDOR_FINAL', 'admin'
  FROM comercio.sucursales s
 WHERE s.id = 1
   AND NOT EXISTS (
       SELECT 1 FROM ventas.clientes c
        WHERE c.emprendimiento_id = s.emprendimiento_id
          AND c.numero_documento = '45715765'
   );

-- 4. Medio de pago (obligatorio en ventas de CONTADO; lo usa la Tarea 3)
INSERT INTO finanzas.medios_pago (emprendimiento_id, nombre, es_predeterminado, activo)
SELECT s.emprendimiento_id, 'Efectivo', TRUE, TRUE
  FROM comercio.sucursales s
 WHERE s.id = 1
   AND NOT EXISTS (
       SELECT 1 FROM finanzas.medios_pago m
        WHERE m.emprendimiento_id = s.emprendimiento_id
          AND lower(m.nombre) = 'efectivo'
   );

COMMIT;

-- Verificación rápida: estos son los IDs que espera el JSON del POST
SELECT 'cliente'   AS tipo, id, nombre_razon_social AS detalle FROM ventas.clientes ORDER BY id;
SELECT 'producto'  AS tipo, id, nombre || ' (stock ' || cantidad || ')' AS detalle
  FROM productos.productos ORDER BY id;
SELECT 'medio_pago' AS tipo, id, nombre AS detalle FROM finanzas.medios_pago ORDER BY id;
