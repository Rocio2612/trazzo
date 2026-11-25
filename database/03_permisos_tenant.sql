-- ============================================================================
-- 03_permisos_tenant.sql
-- Permisos de las bases operativas (una por emprendimiento).
--
-- PROBLEMA QUE RESUELVE:
-- La plantilla crea las tablas como 'postgres', así que los usuarios de los
-- microservicios (auth_user, transacciones_user, etc.) no pueden leerlas ni
-- escribir en ellas. Sin esto, el microservicio responde
-- "permission denied for schema ventas" / "for table ventas".
--
-- CÓMO SE EJECUTA (como 'postgres', desde pgAdmin -> Query Tool):
--   1) UNA VEZ en la base plantilla:   trazzo_plantilla
--      (así toda base nueva clonada hereda los permisos)
--   2) Y en cada base operativa que ya exista: trazzo_trazzorocio, etc.
-- ============================================================================
BEGIN;

-- ---------------------------------------------------------------- auth -------
-- Ojo: las bases operativas (clonadas de trazzo_plantilla) NO tienen esquema auth.
-- Por eso se otorga solo si existe; si no, se saltea sin cortar el script.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'auth') THEN
        EXECUTE 'GRANT USAGE, CREATE ON SCHEMA auth TO auth_user';
        EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA auth TO auth_user';
        EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA auth TO auth_user';
    END IF;
END
$$;

-- ----------------------------------------------------------- productos ------
GRANT USAGE ON SCHEMA productos TO productos_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA productos TO productos_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA productos TO productos_user;

-- ------------------------------------------------------------ finanzas ------
GRANT USAGE ON SCHEMA finanzas TO finanzas_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA finanzas TO finanzas_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA finanzas TO finanzas_user;

-- ------------------------------------------------------ notificaciones ------
GRANT USAGE ON SCHEMA notificaciones TO notificaciones_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA notificaciones TO notificaciones_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA notificaciones TO notificaciones_user;

-- --------------------------------------------- transacciones (M7, M8, M9) ---
-- Necesita escribir en ventas (clientes, ventas, venta_detalle, pagos) y,
-- a partir de la Tarea 3, descontar stock y registrar el Kardex en productos.
GRANT USAGE ON SCHEMA comercio, productos, finanzas, ventas TO transacciones_user;

GRANT SELECT ON ALL TABLES IN SCHEMA comercio TO transacciones_user;
GRANT SELECT ON ALL TABLES IN SCHEMA finanzas TO transacciones_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ventas TO transacciones_user;

GRANT SELECT, UPDATE ON productos.productos TO transacciones_user;
GRANT SELECT, INSERT ON productos.movimientos_stock TO transacciones_user;
GRANT SELECT ON productos.proveedores, productos.categorias TO transacciones_user;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ventas TO transacciones_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA productos TO transacciones_user;

-- ------------------------------------------------------------ reportes ------
-- Reportes solo lee: no puede modificar nada de la operación.
GRANT USAGE ON SCHEMA comercio, productos, finanzas, ventas TO reportes_user;
GRANT SELECT ON ALL TABLES IN SCHEMA comercio, productos, finanzas, ventas TO reportes_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA comercio, productos, finanzas, ventas TO reportes_user;

-- ---------------------- permisos por defecto para tablas futuras -----------
-- Si mañana se agrega una tabla nueva con el script como 'postgres', estos
-- usuarios ya quedan habilitados sin volver a correr este archivo.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA productos
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO productos_user;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA finanzas
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO finanzas_user;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA notificaciones
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO notificaciones_user;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA ventas
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO transacciones_user;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA comercio
    GRANT SELECT ON TABLES TO transacciones_user, reportes_user;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA productos
    GRANT SELECT ON TABLES TO transacciones_user, reportes_user;

COMMIT;
