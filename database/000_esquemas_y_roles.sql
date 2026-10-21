-- Crear esquemas para cada microservicio
CREATE SCHEMA auth;
CREATE SCHEMA productos;
CREATE SCHEMA transacciones;
CREATE SCHEMA finanzas;
CREATE SCHEMA reportes;
CREATE SCHEMA notificaciones;

-- Crear usuarios para cada microservicio
-- (Ojo: Podés cambiar 'trazzo2026' por la contraseña que quieras para estos usuarios)
CREATE USER auth_user WITH PASSWORD 'trazzo2026';
CREATE USER productos_user WITH PASSWORD 'trazzo2026';
CREATE USER transacciones_user WITH PASSWORD 'trazzo2026';
CREATE USER finanzas_user WITH PASSWORD 'trazzo2026';
CREATE USER reportes_user WITH PASSWORD 'trazzo2026';
CREATE USER notificaciones_user WITH PASSWORD 'trazzo2026';

-- Dar permisos a cada usuario SOLO sobre su esquema
GRANT USAGE, CREATE ON SCHEMA auth TO auth_user;
ALTER ROLE auth_user SET search_path = auth;

GRANT USAGE, CREATE ON SCHEMA productos TO productos_user;
ALTER ROLE productos_user SET search_path = productos;

GRANT USAGE, CREATE ON SCHEMA transacciones TO transacciones_user;
ALTER ROLE transacciones_user SET search_path = transacciones;

GRANT USAGE, CREATE ON SCHEMA finanzas TO finanzas_user;
ALTER ROLE finanzas_user SET search_path = finanzas;

GRANT USAGE, CREATE ON SCHEMA reportes TO reportes_user;
ALTER ROLE reportes_user SET search_path = reportes;

GRANT USAGE, CREATE ON SCHEMA notificaciones TO notificaciones_user;
ALTER ROLE notificaciones_user SET search_path = notificaciones;