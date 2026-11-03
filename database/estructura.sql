-- ARQUITECTURA DE BASE DE DATOS MODULAR

-- CREACIÓN DE ESQUEMAS (NAMESPACES POR MICROSERVICIO)
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS productos;
CREATE SCHEMA IF NOT EXISTS finanzas;
CREATE SCHEMA IF NOT EXISTS notificaciones;

-- DOMINIO DE AUTENTICACIÓN Y SEGURIDAD (auth-service: 5001)
-- Tabla: EMPRENDIMIENTOS
-- Raíz de aislamiento del sistema. Todo dato operativo pertenece a un negocio.
CREATE TABLE IF NOT EXISTS auth.emprendimientos (
    id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    identificador VARCHAR(20) NOT NULL,
    nombre_comercial VARCHAR(100),
    rubro VARCHAR(50),
    fecha_registro TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,

    CONSTRAINT uq_emprendimiento_identificador UNIQUE (identificador),
    CONSTRAINT chk_identificador_formato CHECK (
        char_length(identificador) >= 4 AND 
        char_length(identificador) <= 20 AND 
        identificador ~ '^[a-z0-9]+$'
    )
);

-- Tabla: USUARIOS
-- Cuentas de acceso (Propietario, Administradores y Cajeros).
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
    -- Clave única compuesta para blindar el aislamiento en relaciones hijas
    CONSTRAINT uq_usuarios_id_tenant 
        UNIQUE (id, emprendimiento_id),
    CONSTRAINT chk_usuario_formato CHECK (
        char_length(usuario) >= 4 AND 
        char_length(usuario) <= 20 AND 
        usuario ~ '^[a-z0-9]+$'
    ),
    CONSTRAINT chk_usuario_rol CHECK (
        rol IN ('PROPIETARIO', 'ADMIN', 'CAJERO')
    ),
    CONSTRAINT chk_usuario_correo_formato CHECK (
        correo ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_correo_por_emprendimiento 
    ON auth.usuarios (emprendimiento_id, lower(correo));

CREATE UNIQUE INDEX IF NOT EXISTS uq_un_propietario_por_negocio 
    ON auth.usuarios (emprendimiento_id) 
    WHERE rol = 'PROPIETARIO';

-- Tabla: TOKENS_BLOQUEADOS
-- Lista negra de JTIs revocados durante el logout para invalidación segura.
CREATE TABLE IF NOT EXISTS auth.tokens_bloqueados (
    id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    jti VARCHAR(64) NOT NULL,
    usuario_id INT NOT NULL,
    fecha_expiracion TIMESTAMPTZ NOT NULL,
    fecha_bloqueo TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,

    CONSTRAINT uq_token_jti UNIQUE (jti),
    CONSTRAINT fk_tokens_usuario 
        FOREIGN KEY (usuario_id) 
        REFERENCES auth.usuarios (id) 
        ON DELETE CASCADE,
    CONSTRAINT chk_fechas_token CHECK (fecha_expiracion > fecha_bloqueo)
);

-- Tabla: RECUPERACION_CLAVES
-- Enlaces temporales de un solo uso para reestablecer credenciales (vence a los 30 min).
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
    CONSTRAINT chk_fechas_recuperacion CHECK (fecha_expiracion > fecha_creacion)
);