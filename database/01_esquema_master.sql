-- PROYECTO TRAZZO - BASE DE DATOS MAESTRA (trazzo_master)
-- Dominio: Autenticación, Directorio de Emprendimientos, Usuarios y Sucursales Asignadas
-- Microservicio exclusivo: auth-service (puerto 5001)

-- [Envoltura transaccional atómica]
-- Evita que la base se quede a medio ejecutar, hace rollback
BEGIN;

-- 0. CREACIÓN DE ESQUEMA DE SEGURIDAD
CREATE SCHEMA IF NOT EXISTS auth;

-- 1. DOMINIO DE AUTENTICACIÓN Y SEGURIDAD (auth-service)
-- Tabla: EMPRENDIMIENTOS (Directorio central que mapea cada negocio con su base de datos física)
CREATE TABLE IF NOT EXISTS auth.emprendimientos (
    id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    identificador VARCHAR(20) NOT NULL,
    -- Nombre físico de la base de datos operativa clonada para este negocio (ej. 'trazzo_panchoria')
    nombre_bd VARCHAR(63) NOT NULL,
    nombre_comercial VARCHAR(100) NOT NULL,
    rubro VARCHAR(50),
    categoria_impositiva VARCHAR(30) DEFAULT 'MONOTRIBUTISTA' NOT NULL,
    fecha_registro TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,

    -- Valida que el identificador del negocio tenga entre 4 y 20 caracteres y solo use letras minúsculas y números (sin espacios ni símbolos para URLs).
    CONSTRAINT uq_emprendimiento_identificador UNIQUE (identificador),
    -- Garantiza que dos emprendimientos nunca apunten por error a la misma base de datos física.
    CONSTRAINT uq_emprendimiento_nombre_bd UNIQUE (nombre_bd),
    CONSTRAINT chk_identificador_formato CHECK (
        char_length(identificador) >= 4 AND 
        char_length(identificador) <= 20 AND 
        identificador ~ '^[a-z0-9]+$'
    ),
    -- Valida que el nombre de la base respete el prefijo estándar del sistema.
    CONSTRAINT chk_nombre_bd_formato CHECK (
        nombre_bd ~ '^trazzo_[a-z0-9_]+$'
    ),
    -- Restringe la categoría impositiva únicamente a los tres estados tributarios válidos en Argentina.
    CONSTRAINT chk_emp_categoria_impositiva CHECK (
        categoria_impositiva IN ('RESPONSABLE_INSCRIPTO', 'MONOTRIBUTISTA', 'EXENTO')
    ),
    -- Impide que se guarde un nombre comercial compuesto únicamente por espacios en blanco.
    CONSTRAINT chk_nombre_comercial_no_vacio CHECK (btrim(nombre_comercial) <> '')
);

-- Tabla: USUARIOS (Pertenecen al emprendimiento, permitiendo operar en una o varias sucursales)
CREATE TABLE IF NOT EXISTS auth.usuarios (
    id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    emprendimiento_id INT NOT NULL,
    usuario VARCHAR(20) NOT NULL,
    correo VARCHAR(120) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    nombre VARCHAR(50),
    apellido VARCHAR(50),
    dni VARCHAR(20),
    rol VARCHAR(20) DEFAULT 'CAJERO' NOT NULL,
    activo BOOLEAN DEFAULT TRUE NOT NULL,
    fecha_creacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,

    CONSTRAINT fk_usuarios_emprendimiento 
        FOREIGN KEY (emprendimiento_id) 
        REFERENCES auth.emprendimientos (id) 
        ON DELETE CASCADE,
    CONSTRAINT uq_usuario_por_emprendimiento 
        UNIQUE (emprendimiento_id, usuario),
    CONSTRAINT uq_usuarios_id_tenant 
        UNIQUE (id, emprendimiento_id),
    -- Restringe el username a minúsculas y números de 4 a 20 caracteres para inicio de sesión.
    CONSTRAINT chk_usuario_formato CHECK (
        char_length(usuario) >= 4 AND 
        char_length(usuario) <= 20 AND 
        usuario ~ '^[a-z0-9]+$'
    ),
    -- Limita los permisos exclusivamente a los tres roles del sistema (Propietario, Admin o Cajero).
    CONSTRAINT chk_usuario_rol CHECK (
        rol IN ('PROPIETARIO', 'ADMIN', 'CAJERO')
    ),
    -- Expresión regular que verifica que el email tenga una estructura válida (usuario@dominio.ext).
    CONSTRAINT chk_usuario_correo_formato CHECK (
        correo ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
    )
);

-- Permite que un mismo correo exista en distintos negocios, pero prohíbe duplicarlo dentro del mismo emprendimiento.
CREATE UNIQUE INDEX IF NOT EXISTS uq_correo_por_emprendimiento 
    ON auth.usuarios (emprendimiento_id, lower(correo));

-- Índice parcial: Garantiza matemáticamente que solo exista UN único usuario con rol PROPIETARIO por negocio.
CREATE UNIQUE INDEX IF NOT EXISTS uq_un_propietario_por_negocio 
    ON auth.usuarios (emprendimiento_id) 
    WHERE rol = 'PROPIETARIO';

-- Optimiza las consultas de autenticación y listados filtrando por el ID de negocio del token JWT.
CREATE INDEX IF NOT EXISTS idx_usuarios_tenant 
    ON auth.usuarios (emprendimiento_id);

-- Tabla intermedia N:M: USUARIO_SUCURSALES (Escalabilidad futura multi-sucursal)
-- Permite asignar un mismo empleado a una o múltiples sucursales dentro de su emprendimiento
-- sin duplicar su cuenta ni perder su historial de operaciones entre sedes.
CREATE TABLE IF NOT EXISTS auth.usuario_sucursales (
    id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    usuario_id INT NOT NULL,
    -- Referencia lógica al ID de la tabla comercio.sucursales dentro de la base operativa del negocio (1 = Casa Central)
    sucursal_id INT DEFAULT 1 NOT NULL,
    es_predeterminada BOOLEAN DEFAULT TRUE NOT NULL,
    activo BOOLEAN DEFAULT TRUE NOT NULL,
    fecha_asignacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,

    CONSTRAINT fk_usuc_usuario 
        FOREIGN KEY (usuario_id) 
        REFERENCES auth.usuarios (id) 
        ON DELETE CASCADE,
    -- Impide asignar dos veces la misma sucursal al mismo usuario.
    CONSTRAINT uq_usuario_sucursal UNIQUE (usuario_id, sucursal_id)
);

CREATE INDEX IF NOT EXISTS idx_usuc_usuario ON auth.usuario_sucursales (usuario_id);

-- Tabla: TOKENS_BLOQUEADOS
CREATE TABLE IF NOT EXISTS auth.tokens_bloqueados (
    id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    jti VARCHAR(64) NOT NULL,
    usuario_id INT NULL,
    fecha_expiracion TIMESTAMPTZ NOT NULL,
    fecha_bloqueo TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,

    CONSTRAINT uq_token_jti UNIQUE (jti),
    CONSTRAINT fk_tokens_usuario 
        FOREIGN KEY (usuario_id) 
        REFERENCES auth.usuarios (id) 
        ON DELETE SET NULL
);

-- Acelera la búsqueda y revocación de tokens vinculados a un usuario específico.
CREATE INDEX IF NOT EXISTS idx_tokens_usuario ON auth.tokens_bloqueados (usuario_id);
-- Permite a tareas en segundo plano depurar periódicamente tokens ya vencidos sin bloquear la tabla.
CREATE INDEX IF NOT EXISTS idx_tokens_expiracion ON auth.tokens_bloqueados (fecha_expiracion);

-- Tabla: RECUPERACION_CLAVES
CREATE TABLE IF NOT EXISTS auth.recuperacion_claves (
    id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    usuario_id INT NOT NULL,
    token_seguridad VARCHAR(128) NOT NULL,
    fecha_creacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    fecha_expiracion TIMESTAMPTZ NOT NULL,
    usado BOOLEAN DEFAULT FALSE NOT NULL,

    CONSTRAINT uq_recuperacion_token UNIQUE (token_seguridad),
    CONSTRAINT fk_recuperacion_usuario 
        FOREIGN KEY (usuario_id) 
        REFERENCES auth.usuarios (id) 
        ON DELETE CASCADE,
    -- Regla de integridad temporal: La fecha de vencimiento del enlace debe ser estrictamente posterior a su creación.
    CONSTRAINT chk_fechas_recuperacion CHECK (fecha_expiracion > fecha_creacion)
);
-- Optimiza la búsqueda de solicitudes de recuperación activas por cuenta de usuario.
CREATE INDEX IF NOT EXISTS idx_recuperacion_usuario ON auth.recuperacion_claves (usuario_id);

-- [Confirmación y cierre de la transacción atómica]
COMMIT;