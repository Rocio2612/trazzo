-- PROYECTO TRAZZO - ARQUITECTURA DE BASE DE DATOS MODULAR
-- Microservicios: auth (5001), productos (5002), finanzas (5004), notificaciones (5006)
-- Sprint 1 y Sprint 2 Integrados

-- [Envoltura transaccional atómica]
-- Evita que la base se quede a medio ejecutar, hace rollback
BEGIN;

-- 0. CREACIÓN DE ESQUEMAS LÓGICOS POR DOMINIO
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS productos;
CREATE SCHEMA IF NOT EXISTS finanzas;
CREATE SCHEMA IF NOT EXISTS notificaciones;

-- 1. DOMINIO DE AUTENTICACIÓN Y SEGURIDAD (auth-service)
-- Tabla: EMPRENDIMIENTOS
CREATE TABLE IF NOT EXISTS auth.emprendimientos (
    id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    identificador VARCHAR(20) NOT NULL,
    nombre_comercial VARCHAR(100) NOT NULL,
    rubro VARCHAR(50),
    categoria_impositiva VARCHAR(30) DEFAULT 'MONOTRIBUTISTA' NOT NULL,
    fecha_registro TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,

    -- Valida que el identificador del negocio tenga entre 4 y 20 caracteres y solo use letras minúsculas y números (sin espacios ni símbolos para URLs).
    CONSTRAINT uq_emprendimiento_identificador UNIQUE (identificador),
    CONSTRAINT chk_identificador_formato CHECK (
        char_length(identificador) >= 4 AND 
        char_length(identificador) <= 20 AND 
        identificador ~ '^[a-z0-9]+$'
    ),-- Impide que se guarde un nombre comercial compuesto únicamente por espacios en blanco.
    -- Restringe la categoría impositiva únicamente a los tres estados tributarios válidos en Argentina.
    CONSTRAINT chk_emp_categoria_impositiva CHECK (
        categoria_impositiva IN ('RESPONSABLE_INSCRIPTO', 'MONOTRIBUTISTA', 'EXENTO')
    ),
    -- Impide que se guarde un nombre comercial compuesto únicamente por espacios en blanco.
    CONSTRAINT chk_nombre_comercial_no_vacio CHECK (btrim(nombre_comercial) <> '')
);

-- Tabla: USUARIOS
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

-- 2. DOMINIO DE CATÁLOGO E INVENTARIO (productos-service)
-- Tabla: CATEGORIAS 
CREATE TABLE IF NOT EXISTS productos.categorias (
    id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    emprendimiento_id INT NOT NULL,
    nombre VARCHAR(100) NOT NULL,
    activo BOOLEAN DEFAULT TRUE NOT NULL,

    CONSTRAINT fk_categorias_emprendimiento 
        FOREIGN KEY (emprendimiento_id) 
        REFERENCES auth.emprendimientos (id) 
        ON DELETE CASCADE,
    -- Prohíbe categorías con nombres vacíos o puros espacios.
    CONSTRAINT chk_categoria_nombre CHECK (btrim(nombre) <> '')
);

-- Evita nombres de categorías duplicados dentro de un mismo negocio (ignora mayúsculas/minúsculas)
CREATE UNIQUE INDEX IF NOT EXISTS uq_categoria_nombre_tenant 
    ON productos.categorias (emprendimiento_id, lower(nombre));
-- Agiliza la carga del listado desplegable de categorías de un comercio.
CREATE INDEX IF NOT EXISTS idx_categorias_tenant ON productos.categorias (emprendimiento_id);

-- Tabla: PROVEEDORES
CREATE TABLE IF NOT EXISTS productos.proveedores (
    id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    emprendimiento_id INT NOT NULL,
    nombre VARCHAR(150) NOT NULL,
    -- [Soporte para DNI, CUIT o CUIL]
    tipo_documento VARCHAR(10) DEFAULT 'CUIT' NOT NULL,
    numero_documento VARCHAR(20) NOT NULL,
    categoria_impositiva VARCHAR(30) NOT NULL,
    telefono VARCHAR(50),
    correo VARCHAR(120),
    descripcion_compra TEXT,
    activo BOOLEAN DEFAULT TRUE NOT NULL,

    CONSTRAINT fk_proveedores_emprendimiento 
        FOREIGN KEY (emprendimiento_id) 
        REFERENCES auth.emprendimientos (id) 
        ON DELETE CASCADE,
    -- Impide registrar dos veces al mismo proveedor con idéntico tipo y número de documento en el mismo negocio.
    CONSTRAINT uq_proveedor_doc_tenant 
        UNIQUE (emprendimiento_id, tipo_documento, numero_documento),
    -- Limita los tipos de documento a las opciones de identificación legal (DNI, CUIT o CUIL).
    CONSTRAINT chk_prov_tipo_doc CHECK (
        tipo_documento IN ('DNI', 'CUIT', 'CUIL')
    ),
    -- Exige una categoría impositiva válida para resolver correctamente el cálculo del crédito fiscal en reposiciones.
    CONSTRAINT chk_prov_categoria CHECK (
        categoria_impositiva IN ('RESPONSABLE_INSCRIPTO', 'MONOTRIBUTISTA', 'EXENTO')
    ),
    -- Impiden que el nombre o el número de identificación queden en blanco.
    CONSTRAINT chk_prov_nombre CHECK (btrim(nombre) <> ''),
    CONSTRAINT chk_prov_num_doc CHECK (btrim(numero_documento) <> '')
);

-- Optimiza las búsquedas del directorio de proveedores por comercio.
CREATE INDEX IF NOT EXISTS idx_proveedores_tenant ON productos.proveedores (emprendimiento_id);

-- Tabla: PRODUCTOS 
CREATE TABLE IF NOT EXISTS productos.productos (
    id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    emprendimiento_id INT NOT NULL,
    proveedor_id INT NOT NULL,
    categoria_id INT NULL,
    tipo_producto VARCHAR(20) NOT NULL,
    nombre VARCHAR(150) NOT NULL,
    precio_compra NUMERIC(12,2) NOT NULL,
    iva_alicuota NUMERIC(5,2) DEFAULT 21.00 NOT NULL,
    rentabilidad NUMERIC(5,2) DEFAULT 0.00 NOT NULL,
    precio_venta NUMERIC(12,2) DEFAULT 0.00 NOT NULL,
    cantidad NUMERIC(12,2) DEFAULT 0.00 NOT NULL,
    stock_minimo NUMERIC(12,2) DEFAULT 0.00 NOT NULL,
    unidad_medida VARCHAR(20) DEFAULT 'unidades' NOT NULL,
    activo BOOLEAN DEFAULT TRUE NOT NULL,
    creado_por VARCHAR(50) NOT NULL,
    modificado_por VARCHAR(50),
    creado_en TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    modificado_en TIMESTAMPTZ,

    CONSTRAINT fk_productos_emprendimiento 
        FOREIGN KEY (emprendimiento_id) 
        REFERENCES auth.emprendimientos (id) 
        ON DELETE CASCADE,
    CONSTRAINT fk_productos_proveedor 
        FOREIGN KEY (proveedor_id) 
        REFERENCES productos.proveedores (id) 
        ON DELETE NO ACTION,
    CONSTRAINT fk_productos_categoria 
        FOREIGN KEY (categoria_id) 
        REFERENCES productos.categorias (id) 
        ON DELETE SET NULL,
    CONSTRAINT uq_productos_id_tenant 
        UNIQUE (id, emprendimiento_id),
    -- Clasificador indicado por el profesor: Divide el catálogo unificado en bienes de cambio, bienes de uso o gastos.
    CONSTRAINT chk_tipo_producto CHECK (
        tipo_producto IN ('BIEN_DE_CAMBIO', 'BIEN_DE_USO', 'BIEN_DE_GASTO')
    ),
    -- Valida que el IVA corresponda exclusivamente a las alícuotas aprobadas por ARCA (0, 10.5, 21 o 27%).
    CONSTRAINT chk_iva_alicuota CHECK (
        iva_alicuota IN (0.00, 10.50, 21.00, 27.00)
    ),
    -- Exige que el costo unitario de adquisición sea siempre mayor a cero.
    CONSTRAINT chk_precio_compra CHECK (precio_compra > 0),
    -- Regla de inventario: Bloquea stock negativo y umbrales de alerta negativos.
    CONSTRAINT chk_cantidad CHECK (cantidad >= 0),
    CONSTRAINT chk_stock_minimo CHECK (stock_minimo >= 0),
    -- Asegura que el margen porcentual de ganancia sugerido no sea negativo.
    CONSTRAINT chk_rentabilidad CHECK (rentabilidad >= 0),
    CONSTRAINT chk_producto_nombre CHECK (btrim(nombre) <> ''),
    
    -- Exige unidades enteras para mercadería y máquinas, habilitando decimales solo para consumibles/gastos (kg, litros).
    CONSTRAINT chk_cantidad_fraccionaria CHECK (
        (tipo_producto IN ('BIEN_DE_CAMBIO', 'BIEN_DE_USO') AND cantidad = trunc(cantidad) AND stock_minimo = trunc(stock_minimo)) OR
        (tipo_producto = 'BIEN_DE_GASTO')
    ),
    -- Obliga precio de venta mayor a cero para mercadería de reventa; para uso y gastos fija el valor base en cero.
    CONSTRAINT chk_precio_venta_segun_tipo CHECK (
        (tipo_producto = 'BIEN_DE_CAMBIO' AND precio_venta > 0) OR
        (tipo_producto IN ('BIEN_DE_USO', 'BIEN_DE_GASTO') AND precio_venta >= 0)
    ),
    
    -- Todas las unidades son estrictamente 'unidades'
    CONSTRAINT chk_unidad_medida CHECK (unidad_medida = 'unidades'),

    -- Cantidad y stock mínimo deben ser números enteros para los 3 tipos de bienes
    CONSTRAINT chk_cantidades_enteras CHECK (
        cantidad = trunc(cantidad) AND 
        stock_minimo = trunc(stock_minimo)
    )
);

-- Índice compuesto fundamental: Acelera las consultas del frontend que filtran el catálogo por tipo de bien y negocio.
CREATE INDEX IF NOT EXISTS idx_productos_tenant_tipo 
    ON productos.productos (emprendimiento_id, tipo_producto);
-- [Índices explícitos en claves foráneas para rendimiento]
-- Optimizan los JOINs relacionales y aceleran la verificación de borrados protegidos.
CREATE INDEX IF NOT EXISTS idx_productos_proveedor ON productos.productos (proveedor_id);
CREATE INDEX IF NOT EXISTS idx_productos_categoria ON productos.productos (categoria_id);

-- Tabla: REPOSICIONES
CREATE TABLE IF NOT EXISTS productos.reposiciones (
    id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    emprendimiento_id INT NOT NULL,
    producto_id INT NOT NULL,
    proveedor_id INT NOT NULL,
    cantidad NUMERIC(12,2) NOT NULL,
    monto_total NUMERIC(12,2) NOT NULL,
    costo_unitario_real NUMERIC(14,4) NOT NULL,
    fecha_adquisicion DATE NOT NULL,
    estado VARCHAR(20) DEFAULT 'ACTIVA' NOT NULL,
    creado_por VARCHAR(50) NOT NULL,
    creado_en TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    -- [Campos de auditoría formal de anulación]
    anulada_por VARCHAR(50),
    anulada_en TIMESTAMPTZ,

    CONSTRAINT fk_reposiciones_emprendimiento 
        FOREIGN KEY (emprendimiento_id) 
        REFERENCES auth.emprendimientos (id) 
        ON DELETE CASCADE,
    CONSTRAINT fk_reposiciones_producto 
        FOREIGN KEY (producto_id) 
        REFERENCES productos.productos (id) 
        ON DELETE NO ACTION,
    CONSTRAINT fk_reposiciones_proveedor 
        FOREIGN KEY (proveedor_id) 
        REFERENCES productos.proveedores (id) 
        ON DELETE NO ACTION,
    -- Aseguran que cantidades, totales invertidos y costos unitarios reales sean estrictamente positivos.
    CONSTRAINT chk_repo_cantidad CHECK (cantidad > 0),
    CONSTRAINT chk_repo_monto CHECK (monto_total > 0),
    CONSTRAINT chk_repo_costo_real CHECK (costo_unitario_real > 0),
    -- Regla contable: Prohíbe registrar compras o reposiciones con fechas futuras.
    CONSTRAINT chk_repo_fecha_no_futura CHECK (fecha_adquisicion <= CURRENT_DATE),
    -- Define si la compra está activa en el balance o si fue anulada por un administrador.
    CONSTRAINT chk_repo_estado CHECK (estado IN ('ACTIVA', 'ANULADA'))
);

-- Aceleran la consulta del historial de ingresos por artículo y los reportes de volumen de compra por proveedor.
CREATE INDEX IF NOT EXISTS idx_reposiciones_producto ON productos.reposiciones (producto_id);
CREATE INDEX IF NOT EXISTS idx_reposiciones_proveedor ON productos.reposiciones (proveedor_id);

-- Tabla: MOVIMIENTOS_STOCK (Kardex Centralizado)
CREATE TABLE IF NOT EXISTS productos.movimientos_stock (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    emprendimiento_id INT NOT NULL,
    producto_id INT NOT NULL,
    reposicion_id INT NULL,
    tipo VARCHAR(30) NOT NULL,
    cantidad_movimiento NUMERIC(12,2) NOT NULL,
    stock_resultante NUMERIC(12,2) NOT NULL,
    motivo VARCHAR(255),
    usuario VARCHAR(50) NOT NULL,
    fecha TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,

    CONSTRAINT fk_movimientos_emprendimiento 
        FOREIGN KEY (emprendimiento_id) 
        REFERENCES auth.emprendimientos (id) 
        ON DELETE CASCADE,
    CONSTRAINT fk_movimientos_producto 
        FOREIGN KEY (producto_id) 
        REFERENCES productos.productos (id) 
        ON DELETE NO ACTION,
    CONSTRAINT fk_movimientos_reposicion 
        FOREIGN KEY (reposicion_id) 
        REFERENCES productos.reposiciones (id) 
        ON DELETE SET NULL,
    -- Impide asentar movimientos nulos que no alteren las existencias.
    CONSTRAINT chk_mov_cantidad_no_cero CHECK (cantidad_movimiento <> 0),
    -- Integridad del Kardex: La fotografía del saldo tras la operación nunca puede ser negativa.
    CONSTRAINT chk_mov_stock_resultante CHECK (stock_resultante >= 0),
    -- Limita los tipos de movimiento a los permitidos (compras, ventas, consumos, bajas, ajustes o anulaciones).
    CONSTRAINT chk_mov_tipo CHECK (
        tipo IN ('REPOSICION', 'VENTA', 'CONSUMO', 'BAJA', 'AJUSTE_MANUAL', 'ANULACION_REPOSICION')
    )
);

-- Clave de auditoría: Permite recuperar la cronología exacta de movimientos de un producto de forma descendente.
CREATE INDEX IF NOT EXISTS idx_movimientos_producto_fecha 
    ON productos.movimientos_stock (producto_id, fecha DESC);
-- Permite ubicar rápidamente el movimiento de stock asociado a una reposición cuando se la anula
CREATE INDEX IF NOT EXISTS idx_movimientos_reposicion ON productos.movimientos_stock (reposicion_id);

-- 3. DOMINIO DE FINANZAS Y EGRESOS OPERATIVOS (finanzas-service)
-- Tabla: MEDIOS_PAGO 
CREATE TABLE IF NOT EXISTS finanzas.medios_pago (
    id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    emprendimiento_id INT NOT NULL,
    nombre VARCHAR(50) NOT NULL,
    -- [Marca del medio de pago base no eliminable (Efectivo)]
    es_predeterminado BOOLEAN DEFAULT FALSE NOT NULL,
    activo BOOLEAN DEFAULT TRUE NOT NULL,

    CONSTRAINT fk_medios_pago_emprendimiento 
        FOREIGN KEY (emprendimiento_id) 
        REFERENCES auth.emprendimientos (id) 
        ON DELETE CASCADE,
    -- Prohíbe medios de pago con nombres vacíos.
    CONSTRAINT chk_medio_pago_nombre CHECK (btrim(nombre) <> '')
);

-- Unicidad de medios de pago por negocio (ignora mayúsculas/minúsculas)
CREATE UNIQUE INDEX IF NOT EXISTS uq_medio_pago_nombre_tenant 
    ON finanzas.medios_pago (emprendimiento_id, lower(nombre));
-- Agiliza la carga del desplegable de formas de cobro y pago.
CREATE INDEX IF NOT EXISTS idx_medios_pago_tenant ON finanzas.medios_pago (emprendimiento_id);

-- Tabla: GASTOS_OPERATIVOS
CREATE TABLE IF NOT EXISTS finanzas.gastos_operativos (
    id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    emprendimiento_id INT NOT NULL,
    medio_pago_id INT NULL,
    fecha DATE NOT NULL,
    concepto TEXT NOT NULL,
    monto NUMERIC(12,2) NOT NULL,
    activo BOOLEAN DEFAULT TRUE NOT NULL,
    creado_por VARCHAR(50) NOT NULL,
    modificado_por VARCHAR(50),
    creado_en TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    modificado_en TIMESTAMPTZ,

    CONSTRAINT fk_gastos_emprendimiento 
        FOREIGN KEY (emprendimiento_id) 
        REFERENCES auth.emprendimientos (id) 
        ON DELETE CASCADE,
    CONSTRAINT fk_gastos_medio_pago 
        FOREIGN KEY (medio_pago_id) 
        REFERENCES finanzas.medios_pago (id) 
        ON DELETE SET NULL,
    -- Exige un concepto descriptivo no vacío y un desembolso financiero estrictamente positivo.
    CONSTRAINT chk_gasto_concepto CHECK (btrim(concepto) <> ''),
    CONSTRAINT chk_gasto_monto CHECK (monto > 0),
    -- Prohíbe registrar egresos operativos con fecha posterior a la actual.
    CONSTRAINT chk_gasto_fecha_no_futura CHECK (fecha <= CURRENT_DATE)
);

-- Crítico para reportes: Acelera las sumatorias periódicas (SUM(monto)) por rango de fechas.
CREATE INDEX IF NOT EXISTS idx_gastos_tenant_fecha 
    ON finanzas.gastos_operativos (emprendimiento_id, fecha);
-- Optimiza los reportes que desglosan egresos según la forma de pago utilizada.
CREATE INDEX IF NOT EXISTS idx_gastos_medio_pago ON finanzas.gastos_operativos (medio_pago_id);

-- 4. DOMINIO DE NOTIFICACIONES (notificaciones-service)
-- Tabla: ALERTAS_STOCK
CREATE TABLE IF NOT EXISTS notificaciones.alertas_stock (
    id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    emprendimiento_id INT NOT NULL,
    producto_id INT NOT NULL,
    producto_nombre VARCHAR(150) NOT NULL,
    stock_actual NUMERIC(12,2) NOT NULL,
    stock_minimo NUMERIC(12,2) NOT NULL,
    mensaje TEXT NOT NULL,
    estado VARCHAR(20) DEFAULT 'ACTIVA' NOT NULL,
    creado_en TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    actualizado_en TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,

    CONSTRAINT fk_alertas_emprendimiento 
        FOREIGN KEY (emprendimiento_id) 
        REFERENCES auth.emprendimientos (id) 
        ON DELETE CASCADE,
    CONSTRAINT fk_alertas_producto 
        FOREIGN KEY (producto_id) 
        REFERENCES productos.productos (id) 
        ON DELETE CASCADE,
    CONSTRAINT uq_alertas_id_tenant 
        UNIQUE (id, emprendimiento_id),
    -- Valida que los valores de stock alertados no contengan cantidades negativas.
    CONSTRAINT chk_alerta_stocks CHECK (stock_actual >= 0 AND stock_minimo >= 0),
    -- Restringe el ciclo de vida de la notificación a ACTIVA (en stock crítico) o RESUELTA (repuesto).
    CONSTRAINT chk_alerta_estado CHECK (estado IN ('ACTIVA', 'RESUELTA'))
);

-- Índice único parcial: Asegura como máximo una alerta ACTIVA por producto y habilita UPSERT atómico.
CREATE UNIQUE INDEX IF NOT EXISTS uq_alerta_activa_por_producto 
    ON notificaciones.alertas_stock (emprendimiento_id, producto_id) 
    WHERE estado = 'ACTIVA';

-- Acelera la eliminación en cascada de alertas cuando un producto sin movimientos se borra físicamente.
CREATE INDEX IF NOT EXISTS idx_alertas_producto_fk 
    ON notificaciones.alertas_stock (producto_id);

-- Tabla: ALERTAS_DESCARTES
CREATE TABLE IF NOT EXISTS notificaciones.alertas_descartes (
    id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    alerta_id INT NOT NULL,
    usuario_id INT NOT NULL,
    emprendimiento_id INT NOT NULL,
    fecha TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,

    CONSTRAINT fk_descartes_alerta_tenant 
        FOREIGN KEY (alerta_id, emprendimiento_id) 
        REFERENCES notificaciones.alertas_stock (id, emprendimiento_id) 
        ON DELETE CASCADE,
    CONSTRAINT fk_descartes_usuario_tenant 
        FOREIGN KEY (usuario_id, emprendimiento_id) 
        REFERENCES auth.usuarios (id, emprendimiento_id) 
        ON DELETE CASCADE,
    -- Impide que el mismo usuario registre más de un descarte sobre una misma alerta.
    CONSTRAINT uq_descarte_por_usuario UNIQUE (alerta_id, usuario_id)
);

-- Agiliza la exclusión de alertas descartadas al cargar la campana de notificaciones de cada usuario.
CREATE INDEX IF NOT EXISTS idx_descartes_usuario 
    ON notificaciones.alertas_descartes (usuario_id);

-- [Confirmación y cierre de la transacción atómica]
COMMIT;