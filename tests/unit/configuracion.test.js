import { afterEach, describe, expect, it, vi } from "vitest";
import {
  armarPayloadPersona,
  buscarPersonal,
  contarAdministradoresActivos,
  CORREO_MAXIMO,
  ETIQUETA_ROL,
  MOTIVO_ULTIMO_ADMIN,
  puedeDeshabilitarPersona,
  puedeEditarPersona,
  puedeEliminarPersona,
  puedeHabilitarPersona,
  ROLES,
  validarContrasena,
  validarCorreo,
  validarDni,
  validarNombreLista,
  validarPersona,
  validarUsuario,
} from "../../frontend/js/personalizacion.js";
import { TEXTOS_LISTA } from "../../frontend/js/configuracion-listas.js";
import { listarListaMock, servicioLista } from "../../frontend/js/mocks/personalizacion.js";

// Pruebas de la pantalla "Configuración": personal (reglas, validaciones, búsqueda y servicio simulado)
// y listas de categorías y medios de pago. Se suman a las de personalizacion.test.js.

afterEach(() => {
  vi.unstubAllGlobals();
});

const persona = { usuario: "cajero1", password: "Clave#2026", correo: "a@b.com", nombre: "Ana", apellido: "Pérez", rol: "CAJERO" };

describe("roles", () => {
  it("los roles y cómo se muestran en pantalla (el cajero se llama Empleado)", () => {
    expect(ROLES).toEqual({ PROPIETARIO: "PROPIETARIO", ADMIN: "ADMIN", CAJERO: "CAJERO" });
    expect(ETIQUETA_ROL).toEqual({ PROPIETARIO: "Propietario", ADMIN: "Administrador", CAJERO: "Empleado" });
  });
});

describe("validarUsuario: casos límite", () => {
  it("acepta 4 y 20 caracteres, y solo números", () => {
    expect(validarUsuario("abcd")).toBeNull();
    expect(validarUsuario("a".repeat(20))).toBeNull();
    expect(validarUsuario("1234")).toBeNull();
  });

  it("rechaza 3 y 21 caracteres", () => {
    expect(validarUsuario("abc")).toBe("El usuario debe tener entre 4 y 20 caracteres.");
    expect(validarUsuario("a".repeat(21))).toBe("El usuario debe tener entre 4 y 20 caracteres.");
  });

  it.each([[null], [undefined], [""], ["   "]])("un usuario vacío (%j) pide completarlo", (valor) => {
    expect(validarUsuario(valor)).toBe("Rellene el usuario.");
  });

  it.each([[" juan123"], ["juan123 "], ["Juan123"], ["juan.perez"], ["juan-perez"], ["juán123"]])(
    "rechaza «%s»: solo minúsculas y números, sin espacios ni símbolos",
    (valor) => {
      expect(validarUsuario(valor)).toBe("El usuario solo puede tener letras minúsculas y números, sin símbolos ni espacios.");
    },
  );

  it("el formato se avisa antes que el largo", () => {
    expect(validarUsuario("A")).toMatch(/minúsculas y números/);
  });
});

describe("validarContrasena: casos límite", () => {
  it("acepta 8 y 64 caracteres, rechaza 7 y 65", () => {
    expect(validarContrasena("Ab1#cdef")).toBeNull();
    expect(validarContrasena(`Ab1#${"a".repeat(60)}`)).toBeNull();
    expect(validarContrasena("Ab1#cde")).toBe("La contraseña debe tener entre 8 y 64 caracteres.");
    expect(validarContrasena(`Ab1#${"a".repeat(61)}`)).toBe("La contraseña debe tener entre 8 y 64 caracteres.");
  });

  it.each([[null], [undefined], [""], ["        "]])("una contraseña vacía (%j) pide completarla", (valor) => {
    expect(validarContrasena(valor)).toBe("Rellene la contraseña.");
  });

  it("cada requisito tiene su mensaje exacto", () => {
    expect(validarContrasena("clave#2026")).toBe("La contraseña debe incluir al menos una letra mayúscula.");
    expect(validarContrasena("CLAVE#2026")).toBe("La contraseña debe incluir al menos una letra minúscula.");
    expect(validarContrasena("Clave#abcd")).toBe("La contraseña debe incluir al menos un número.");
    expect(validarContrasena("Clave2026a")).toBe("La contraseña debe incluir al menos un símbolo especial.");
  });

  it.each([["Clave#2026"], ["Zz9!zzzz"], ["Contraseña#1"], ["P@ssw0rd!"], ["Aa1_aaaaaaaa"]])("acepta %s", (clave) => {
    expect(validarContrasena(clave)).toBeNull();
  });

  it("cuando faltan varias cosas avisa primero el largo y después los requisitos en orden", () => {
    expect(validarContrasena("a")).toMatch(/entre 8 y 64/);
    expect(validarContrasena("aaaaaaaa")).toMatch(/mayúscula/);
    expect(validarContrasena("AAAAAAAA")).toMatch(/minúscula/);
    expect(validarContrasena("Aaaaaaaa")).toMatch(/número/);
    expect(validarContrasena("Aaaaaaa1")).toMatch(/símbolo/);
  });
});

describe("validarCorreo y validarDni: casos límite", () => {
  it.each([[null], [undefined], [""], ["  "]])("un correo vacío (%j) pide completarlo", (valor) => {
    expect(validarCorreo(valor)).toBe("Rellene el correo.");
  });

  it.each([["a@b.co"], ["ana.perez@kiosco.com"], ["ana+tag@sub.dominio.com.ar"], ["  ana@kiosco.com  "]])(
    "acepta el correo %j",
    (correo) => {
      expect(validarCorreo(correo)).toBeNull();
    },
  );

  it.each([["sin-arroba"], ["a@b"], ["a@b.c"], ["a b@c.com"], ["a@@b.com"], ["@b.com"], ["a@"], ["a@ b.com"]])(
    "rechaza el correo %j",
    (correo) => {
      expect(validarCorreo(correo)).toBe("El correo no es válido.");
    },
  );

  it.each([["1234567"], ["12345678"], [" 30123456 "], [null], [undefined], [""], ["   "]])("acepta el DNI %j", (dni) => {
    expect(validarDni(dni)).toBeNull();
  });

  it.each([["123456"], ["123456789"], ["1234567A"], ["30.123.456"], ["30 123 456"], ["-1234567"]])("rechaza el DNI %j", (dni) => {
    expect(validarDni(dni)).toBe("El DNI debe tener 7 u 8 números, sin puntos.");
  });
});

describe("validarPersona: casos límite", () => {
  it("cada campo mal informa solo ese campo", () => {
    expect(Object.keys(validarPersona({ ...persona, usuario: "x" }))).toEqual(["usuario"]);
    expect(Object.keys(validarPersona({ ...persona, password: "x" }))).toEqual(["password"]);
    expect(Object.keys(validarPersona({ ...persona, correo: "x" }))).toEqual(["correo"]);
    expect(Object.keys(validarPersona({ ...persona, nombre: " " }))).toEqual(["nombre"]);
    expect(Object.keys(validarPersona({ ...persona, apellido: "" }))).toEqual(["apellido"]);
    expect(Object.keys(validarPersona({ ...persona, dni: "1" }))).toEqual(["dni"]);
    expect(Object.keys(validarPersona({ ...persona, rol: "" }))).toEqual(["rol"]);
  });

  it("el DNI es opcional en el alta", () => {
    expect(validarPersona({ ...persona, dni: "" })).toEqual({});
    expect(validarPersona({ ...persona, dni: "30123456" })).toEqual({});
  });

  it.each([["ADMIN"], ["CAJERO"]])("acepta el rol %s", (rol) => {
    expect(validarPersona({ ...persona, rol })).toEqual({});
  });

  it.each([[""], ["admin"], ["EMPLEADO"], [null], [undefined]])("rechaza el rol %j", (rol) => {
    expect(validarPersona({ ...persona, rol }).rol).toBe("Elija el rol.");
  });

  it("en una edición, una contraseña de solo espacios cuenta como vacía", () => {
    expect(validarPersona({ ...persona, password: "     " }, { esNuevo: false })).toEqual({});
  });

  it("en una alta, la contraseña es obligatoria aunque venga con espacios", () => {
    expect(validarPersona({ ...persona, password: "     " }).password).toBe("Rellene la contraseña.");
  });

  it("en una edición el resto de los campos siguen siendo obligatorios", () => {
    const errores = validarPersona({ rol: "CAJERO" }, { esNuevo: false });
    expect(Object.keys(errores).sort()).toEqual(["apellido", "correo", "nombre", "usuario"]);
  });

  it("sin datos no revienta", () => {
    expect(() => validarPersona()).not.toThrow();
  });

  it("el Propietario puede editar su propia ficha sin que se le pida elegir un rol", () => {
    // El Propietario no se crea (el rol no se ofrece en el alta), pero sí existe y puede editarse a sí mismo.
    const propietario = { usuario: "propietario1", correo: "ana@kiosco.com", nombre: "Ana", apellido: "Pérez", dni: "30123456", rol: "PROPIETARIO", password: "" };
    expect(validarPersona(propietario, { esNuevo: false })).toEqual({});
  });
});

describe("armarPayloadPersona: casos límite", () => {
  it("manda exactamente los campos de la persona y nunca el id ni el estado", () => {
    const payload = armarPayloadPersona({ ...persona, id: 9, activo: true });
    expect(Object.keys(payload).sort()).toEqual(["apellido", "correo", "dni", "nombre", "password", "rol", "usuario"]);
  });

  it("recorta nombre, apellido, correo y DNI", () => {
    expect(armarPayloadPersona({ ...persona, nombre: " Ana ", apellido: " Pérez ", correo: " a@b.com ", dni: " 30123456 " })).toMatchObject({
      nombre: "Ana",
      apellido: "Pérez",
      correo: "a@b.com",
      dni: "30123456",
    });
  });

  it.each([[""], ["   "], [null], [undefined]])("un DNI vacío (%j) viaja como null", (dni) => {
    expect(armarPayloadPersona({ ...persona, dni }).dni).toBeNull();
  });

  it("la contraseña viaja tal cual, sin recortar", () => {
    expect(armarPayloadPersona({ ...persona, password: " Clave#2026 " }).password).toBe(" Clave#2026 ");
  });

  it("en una edición la contraseña solo viaja si se escribió una", () => {
    expect(armarPayloadPersona({ ...persona, password: "" }, { esNuevo: false })).not.toHaveProperty("password");
    expect(armarPayloadPersona({ ...persona, password: "   " }, { esNuevo: false })).not.toHaveProperty("password");
    expect(armarPayloadPersona({ ...persona, password: "Nueva#2026" }, { esNuevo: false }).password).toBe("Nueva#2026");
  });

  it("en un alta siempre viaja la contraseña", () => {
    expect(armarPayloadPersona(persona, { esNuevo: true })).toHaveProperty("password", "Clave#2026");
  });

  it("no toca el contenido de los textos (HTML incluido)", () => {
    expect(armarPayloadPersona({ ...persona, nombre: "<b>Ana</b>" }).nombre).toBe("<b>Ana</b>");
  });
});

describe("buscarPersonal: casos límite", () => {
  const lista = [
    { nombre: "Ana", apellido: "Pérez", usuario: "ana1", correo: "ana@x.com" },
    { nombre: "Sofía", apellido: "Díaz", usuario: "sdiaz", correo: "s.d@x.com" },
    { nombre: "Peña", apellido: "Ruiz", usuario: "pruiz", correo: null },
  ];
  const nombres = (texto) => buscarPersonal(lista, texto).map((p) => p.nombre);

  it("busca por parte del texto y ignora espacios de los costados", () => {
    expect(nombres("  an  ")).toEqual(["Ana"]);
    expect(nombres("dia")).toEqual(["Sofía"]);
  });

  it("los símbolos de expresiones regulares se buscan como texto y no rompen", () => {
    expect(() => buscarPersonal(lista, "(")).not.toThrow();
    expect(nombres(".*")).toEqual([]);
    expect(nombres("[a-z]")).toEqual([]);
    expect(nombres("s.d@")).toEqual(["Sofía"]);
  });

  it("un campo vacío o ausente no rompe la búsqueda", () => {
    expect(buscarPersonal([{ nombre: "X" }, { nombre: null, correo: null }], "x")).toHaveLength(1);
  });

  it("null y undefined como texto devuelven todo", () => {
    expect(buscarPersonal(lista, null)).toHaveLength(3);
    expect(buscarPersonal(lista, undefined)).toHaveLength(3);
  });

  it("no modifica la lista original", () => {
    const copia = JSON.stringify(lista);
    buscarPersonal(lista, "ana");
    expect(JSON.stringify(lista)).toBe(copia);
  });

  it("no distingue tildes: «perez» encuentra a Pérez y «sofia» a Sofía", () => {
    expect(nombres("perez")).toEqual(["Ana"]);
    expect(nombres("SOFIA")).toEqual(["Sofía"]);
    expect(nombres("pena")).toEqual(["Peña"]);
    expect(nombres("Pérez")).toEqual(["Ana"]);
  });
});

describe("reglas de permisos: todas las combinaciones", () => {
  const P = { id: 1, rol: "PROPIETARIO", activo: true };
  const A2 = { id: 2, rol: "ADMIN", activo: true };
  const A5 = { id: 5, rol: "ADMIN", activo: true };
  const C3 = { id: 3, rol: "CAJERO", activo: true };
  const C4 = { id: 4, rol: "CAJERO", activo: false };
  const A6 = { id: 6, rol: "ADMIN", activo: false };
  const todos = [P, A2, A5, C3, C4, A6];

  const objetivos = [
    ["Propietario", P],
    ["Admin 2", A2],
    ["Admin 5", A5],
    ["Empleado activo", C3],
    ["Empleado deshabilitado", C4],
    ["Admin deshabilitado", A6],
  ];
  const consultar = (actor, objetivo) => ({
    editar: puedeEditarPersona(actor, objetivo).permitido,
    habilitar: puedeHabilitarPersona(actor, objetivo).permitido,
    deshabilitar: puedeDeshabilitarPersona(actor, objetivo, todos).permitido,
    eliminar: puedeEliminarPersona(actor, objetivo, todos).permitido,
  });

  // [editar, habilitar, deshabilitar, eliminar] por cada objetivo, en el orden de `objetivos`.
  const ESPERADO_PROPIETARIO = [
    [true, false, false, false], // sí mismo: solo editar
    [true, false, true, true],
    [true, false, true, true],
    [true, false, true, true],
    [true, true, false, true],
    [true, true, false, true],
  ];
  const ESPERADO_ADMIN_2 = [
    [false, false, false, false], // el Propietario: nada
    [true, false, false, false], // sí mismo: solo editar
    [false, false, false, false], // otro administrador: nada
    [true, false, true, true],
    [true, true, false, true],
    [false, false, false, false], // otro administrador deshabilitado: nada
  ];

  it.each(objetivos.map(([nombre], i) => [nombre, i]))("el Propietario sobre: %s", (_nombre, i) => {
    const [editar, habilitar, deshabilitar, eliminar] = ESPERADO_PROPIETARIO[i];
    expect(consultar(P, objetivos[i][1])).toEqual({ editar, habilitar, deshabilitar, eliminar });
  });

  it.each(objetivos.map(([nombre], i) => [nombre, i]))("un administrador común (Admin 2) sobre: %s", (_nombre, i) => {
    const [editar, habilitar, deshabilitar, eliminar] = ESPERADO_ADMIN_2[i];
    expect(consultar(A2, objetivos[i][1])).toEqual({ editar, habilitar, deshabilitar, eliminar });
  });

  it("otro administrador (Admin 5) tiene las mismas reglas, cambiando quién es «sí mismo»", () => {
    expect(consultar(A5, A5)).toEqual({ editar: true, habilitar: false, deshabilitar: false, eliminar: false });
    expect(consultar(A5, A2)).toEqual({ editar: false, habilitar: false, deshabilitar: false, eliminar: false });
    expect(consultar(A5, C3)).toEqual({ editar: true, habilitar: false, deshabilitar: true, eliminar: true });
  });

  it("cada «no» trae su motivo", () => {
    expect(puedeEditarPersona(A2, P).motivo).toBe("Solo el Propietario puede editar a otros administradores.");
    expect(puedeDeshabilitarPersona(P, P, todos).motivo).toBe("El Propietario no se puede deshabilitar ni eliminar.");
    expect(puedeEliminarPersona(P, P, todos).motivo).toBe("El Propietario no se puede deshabilitar ni eliminar.");
    expect(puedeDeshabilitarPersona(A2, A2, todos).motivo).toBe("No podés hacerlo sobre tu propia cuenta.");
    expect(puedeEliminarPersona(A2, A2, todos).motivo).toBe("No podés hacerlo sobre tu propia cuenta.");
    expect(puedeDeshabilitarPersona(A2, A5, todos).motivo).toBe("Solo el Propietario puede gestionar a otros administradores.");
    expect(puedeHabilitarPersona(P, C3).motivo).toBe("Ya está habilitado.");
    expect(puedeDeshabilitarPersona(P, C4, todos).motivo).toBe("Ya está deshabilitado.");
  });

  it("cuando se puede, el motivo viene vacío", () => {
    expect(puedeEditarPersona(P, C3)).toEqual({ permitido: true, motivo: "" });
    expect(puedeDeshabilitarPersona(P, C3, todos)).toEqual({ permitido: true, motivo: "" });
  });

  it("cuenta los administradores activos: el Propietario y los administradores habilitados", () => {
    expect(contarAdministradoresActivos(todos)).toBe(3);
    expect(contarAdministradoresActivos([C3, C4])).toBe(0);
    expect(contarAdministradoresActivos([])).toBe(0);
  });

  it("si queda un solo administrador activo no se puede deshabilitar ni eliminar", () => {
    const lista = [{ ...P, activo: false }, A2, C3];
    expect(puedeDeshabilitarPersona(P, A2, lista)).toEqual({ permitido: false, motivo: MOTIVO_ULTIMO_ADMIN });
    expect(puedeEliminarPersona(P, A2, lista)).toEqual({ permitido: false, motivo: MOTIVO_ULTIMO_ADMIN });
  });

  it("con un administrador deshabilitado, eliminarlo siempre se puede aunque sea el único registro de su tipo", () => {
    const lista = [P, A6];
    expect(puedeEliminarPersona(P, A6, lista).permitido).toBe(true);
  });

  it("con dos administradores activos todavía se puede deshabilitar a uno", () => {
    const lista = [{ ...P, activo: false }, A2, A5];
    expect(puedeDeshabilitarPersona(P, A2, lista).permitido).toBe(true);
  });

  it("los empleados nunca activan la regla del último administrador", () => {
    const lista = [{ ...P, activo: false }, A2, C3];
    expect(puedeDeshabilitarPersona(P, C3, lista).permitido).toBe(true);
    expect(puedeEliminarPersona(P, C3, lista).permitido).toBe(true);
  });
});

// --- Listas: categorías y medios de pago ---

describe("validarNombreLista: casos límite", () => {
  it.each([[null], [undefined], [""], ["   "], ["\t"]])("un nombre vacío (%j) pide completarlo", (valor) => {
    expect(validarNombreLista(valor)).toBe("Rellene el nombre.");
  });

  it("acepta 50 caracteres y rechaza 51", () => {
    expect(validarNombreLista("a".repeat(50))).toBeNull();
    expect(validarNombreLista("a".repeat(51))).toBe("El nombre no puede superar los 50 caracteres.");
  });

  it("los espacios de los costados no cuentan para el largo", () => {
    expect(validarNombreLista(` ${"a".repeat(50)} `)).toBeNull();
  });

  it("detecta el repetido sin distinguir mayúsculas ni espacios de los costados", () => {
    expect(validarNombreLista("remeras", ["Remeras"], "una categoría")).toBe("Ya existe una categoría con ese nombre.");
    expect(validarNombreLista("  REMERAS  ", ["Remeras"], "una categoría")).toBe("Ya existe una categoría con ese nombre.");
    expect(validarNombreLista("Remeras", ["  remeras "], "una categoría")).toBe("Ya existe una categoría con ese nombre.");
  });

  it("el artículo completa el mensaje de repetido", () => {
    expect(validarNombreLista("Efectivo", ["Efectivo"], "un medio de pago")).toBe("Ya existe un medio de pago con ese nombre.");
    expect(validarNombreLista("X", ["X"])).toBe("Ya existe un elemento con ese nombre.");
  });

  it("un nombre distinto o sin existentes es válido", () => {
    expect(validarNombreLista("Camperas", ["Remeras", "Pantalones"])).toBeNull();
    expect(validarNombreLista("Camperas")).toBeNull();
    expect(validarNombreLista("Camperas", [])).toBeNull();
  });

  it("las palabras que se parecen no son repetidas (el mensaje solo vale para el nombre igual)", () => {
    expect(validarNombreLista("Remera", ["Remeras"])).toBeNull();
    expect(validarNombreLista("Remeras 2", ["Remeras"])).toBeNull();
  });

  it("el largo se avisa antes que el repetido", () => {
    const largo = "a".repeat(51);
    expect(validarNombreLista(largo, [largo])).toBe("El nombre no puede superar los 50 caracteres.");
  });

  it("tolera existentes que no son texto", () => {
    expect(validarNombreLista("a", [null, undefined, 5])).toBeNull();
  });
});

describe("textos de las pestañas de lista", () => {
  it("categorías y medios de pago tienen todos sus textos", () => {
    for (const tipo of ["categorias", "medios_pago"]) {
      expect(Object.keys(TEXTOS_LISTA[tipo]).sort()).toEqual(["articulo", "aviso", "creado", "eliminar", "etiquetaEntrada", "placeholder", "singular"]);
      Object.values(TEXTOS_LISTA[tipo]).forEach((texto) => expect(texto.length).toBeGreaterThan(3));
    }
  });

  it("el artículo se arma con el singular (para el mensaje de repetido)", () => {
    expect(TEXTOS_LISTA.categorias.articulo).toBe("una categoría");
    expect(TEXTOS_LISTA.medios_pago.articulo).toBe("un medio de pago");
  });

  it("el aviso de creado y la etiqueta del campo concuerdan en género con cada lista", () => {
    expect(TEXTOS_LISTA.categorias.creado).toBe("Categoría creada");
    expect(TEXTOS_LISTA.categorias.etiquetaEntrada).toBe("Nombre de la categoría");
    expect(TEXTOS_LISTA.medios_pago.creado).toBe("Medio de pago creado");
    expect(TEXTOS_LISTA.medios_pago.etiquetaEntrada).toBe("Nombre del medio de pago");
  });
});

// Las listas se guardan en localStorage: se simula con un almacenamiento en memoria.
const simularAlmacenamiento = (inicial = {}) => {
  const datos = new Map(Object.entries(inicial));
  vi.stubGlobal("localStorage", {
    getItem: (clave) => (datos.has(clave) ? datos.get(clave) : null),
    setItem: (clave, valor) => datos.set(clave, String(valor)),
  });
  return datos;
};
const CLAVE = "trazzo_mock_listas";

describe("servicio simulado de las listas", () => {
  it("parte de las categorías y los medios de pago iniciales", async () => {
    simularAlmacenamiento();
    expect((await servicioLista("categorias").listar()).map((c) => c.nombre)).toEqual(["Remeras", "Pantalones"]);
    const medios = await servicioLista("medios_pago").listar();
    expect(medios.map((m) => m.nombre)).toEqual(["Efectivo", "Transferencia"]);
    expect(medios.find((m) => m.nombre === "Efectivo").por_defecto).toBe(true);
  });

  it("crear agrega al final, con un id nuevo, sin ser por defecto, y queda guardado", async () => {
    const datos = simularAlmacenamiento();
    const creado = await servicioLista("categorias").crear("Camperas");
    expect(creado).toMatchObject({ nombre: "Camperas", por_defecto: false });
    expect(creado.id).toBeGreaterThanOrEqual(10);
    expect((await servicioLista("categorias").listar()).map((c) => c.nombre)).toEqual(["Remeras", "Pantalones", "Camperas"]);
    expect(JSON.parse(datos.get(CLAVE)).categorias).toHaveLength(3);
  });

  it("los ids no se repiten ni entre categorías ni entre medios de pago", async () => {
    simularAlmacenamiento();
    const a = await servicioLista("categorias").crear("A");
    const b = await servicioLista("medios_pago").crear("B");
    const c = await servicioLista("categorias").crear("C");
    expect(new Set([a.id, b.id, c.id]).size).toBe(3);
    expect(c.id).toBeGreaterThan(b.id);
  });

  it("las dos listas son independientes: el mismo nombre puede estar en ambas", async () => {
    simularAlmacenamiento();
    await servicioLista("categorias").crear("Efectivo");
    expect((await servicioLista("medios_pago").listar()).filter((m) => m.nombre === "Efectivo")).toHaveLength(1);
  });

  it("actualizar cambia el nombre y lo guarda", async () => {
    simularAlmacenamiento();
    const editado = await servicioLista("categorias").actualizar(1, "Remeras nuevas");
    expect(editado).toMatchObject({ id: 1, nombre: "Remeras nuevas" });
    expect((await servicioLista("categorias").listar())[0].nombre).toBe("Remeras nuevas");
  });

  it("eliminar saca el elemento y lo guarda", async () => {
    simularAlmacenamiento();
    await servicioLista("categorias").eliminar(2);
    expect((await servicioLista("categorias").listar()).map((c) => c.id)).toEqual([1]);
  });

  it("el medio de pago por defecto no se puede eliminar, ni siquiera renombrado", async () => {
    simularAlmacenamiento();
    await expect(servicioLista("medios_pago").eliminar(1)).rejects.toThrow(/por defecto/);
    await servicioLista("medios_pago").actualizar(1, "Caja");
    await expect(servicioLista("medios_pago").eliminar(1)).rejects.toThrow(/por defecto/);
    expect((await servicioLista("medios_pago").listar()).map((m) => m.nombre)).toEqual(["Caja", "Transferencia"]);
  });

  it("devuelve copias: modificar lo que devuelve no cambia lo guardado", async () => {
    simularAlmacenamiento();
    (await servicioLista("categorias").listar())[0].nombre = "ALTERADO";
    expect(listarListaMock("categorias")[0].nombre).toBe("Remeras");
  });

  it("si lo guardado está dañado o incompleto, parte de las listas iniciales", async () => {
    simularAlmacenamiento({ [CLAVE]: "{esto no es json" });
    expect((await servicioLista("categorias").listar()).map((c) => c.nombre)).toEqual(["Remeras", "Pantalones"]);
    simularAlmacenamiento({ [CLAVE]: JSON.stringify({ categorias: [] }) });
    expect((await servicioLista("medios_pago").listar()).map((m) => m.nombre)).toEqual(["Efectivo", "Transferencia"]);
  });

  it("respeta lo guardado aunque una lista esté vacía", async () => {
    simularAlmacenamiento({ [CLAVE]: JSON.stringify({ categorias: [], medios_pago: [{ id: 1, nombre: "Efectivo", por_defecto: true }] }) });
    expect(await servicioLista("categorias").listar()).toEqual([]);
  });

  it("sin almacenamiento disponible funciona igual, sin guardar", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("bloqueado");
      },
      setItem: () => {
        throw new Error("bloqueado");
      },
    });
    const creado = await servicioLista("categorias").crear("Camperas");
    expect(creado.nombre).toBe("Camperas");
    expect((await servicioLista("categorias").listar()).map((c) => c.nombre)).toEqual(["Remeras", "Pantalones"]);
  });
});

// --- Servicio simulado del personal: se carga de cero en cada prueba ---

const cargarPersonal = async () => {
  vi.resetModules();
  simularAlmacenamiento();
  return (await import("../../frontend/js/mocks/personalizacion.js")).servicioPersonal;
};

const nuevoUsuario = { usuario: "julia123", correo: "julia@kiosco.com", nombre: "Julia", apellido: "Mora", dni: null, rol: "CAJERO", password: "Clave#2026" };

describe("servicio simulado del personal", () => {
  it("lista las cuatro personas de ejemplo, con un propietario", async () => {
    const servicio = await cargarPersonal();
    const personal = await servicio.listar();
    expect(personal.map((p) => p.rol)).toEqual(["PROPIETARIO", "ADMIN", "CAJERO", "CAJERO"]);
    expect(personal.map((p) => p.activo)).toEqual([true, true, true, false]);
  });

  it("devuelve copias: modificar lo que devuelve no cambia lo guardado", async () => {
    const servicio = await cargarPersonal();
    (await servicio.listar())[0].nombre = "ALTERADO";
    expect((await servicio.listar())[0].nombre).toBe("Ana");
  });

  it("crear asigna el id siguiente, queda habilitado y nunca guarda ni devuelve la contraseña", async () => {
    const servicio = await cargarPersonal();
    const creado = await servicio.crear(nuevoUsuario);
    expect(creado).toMatchObject({ id: 5, activo: true, usuario: "julia123", rol: "CAJERO" });
    expect(creado).not.toHaveProperty("password");
    expect((await servicio.listar()).at(-1)).not.toHaveProperty("password");
  });

  it("los ids no se reutilizan después de eliminar", async () => {
    const servicio = await cargarPersonal();
    const primero = await servicio.crear(nuevoUsuario);
    await servicio.eliminar(primero.id);
    const segundo = await servicio.crear({ ...nuevoUsuario, usuario: "julia456", correo: "otra@kiosco.com" });
    expect(segundo.id).toBe(primero.id + 1);
  });

  it("un usuario repetido avisa en el campo usuario", async () => {
    const servicio = await cargarPersonal();
    await expect(servicio.crear({ ...nuevoUsuario, usuario: "cajero1" })).rejects.toMatchObject({
      errores: { usuario: "Ese usuario ya existe en este negocio." },
    });
  });

  it("un correo repetido avisa en el campo correo, sin distinguir mayúsculas", async () => {
    const servicio = await cargarPersonal();
    await expect(servicio.crear({ ...nuevoUsuario, correo: "SOFIA@kioscochicha.com" })).rejects.toMatchObject({
      errores: { correo: "Ese correo ya está registrado en este negocio." },
    });
  });

  it("si se repiten usuario y correo avisa primero el usuario", async () => {
    const servicio = await cargarPersonal();
    const error = await servicio.crear({ ...nuevoUsuario, usuario: "cajero1", correo: "sofia@kioscochicha.com" }).catch((e) => e);
    expect(Object.keys(error.errores)).toEqual(["usuario"]);
  });

  it("un alta repetida no deja un usuario a medias", async () => {
    const servicio = await cargarPersonal();
    await servicio.crear({ ...nuevoUsuario, usuario: "cajero1" }).catch(() => {});
    expect(await servicio.listar()).toHaveLength(4);
  });

  it("actualizar cambia los datos, conserva el estado y no guarda la contraseña", async () => {
    const servicio = await cargarPersonal();
    const editado = await servicio.actualizar(3, { ...nuevoUsuario, usuario: "cajero1", correo: "sofia@kioscochicha.com", apellido: "Díaz Luna" });
    expect(editado).toMatchObject({ id: 3, apellido: "Díaz Luna", activo: true });
    expect(editado).not.toHaveProperty("password");
  });

  it("al actualizar, el propio usuario y correo no cuentan como repetidos, pero los de otro sí", async () => {
    const servicio = await cargarPersonal();
    const propios = { ...nuevoUsuario, usuario: "cajero1", correo: "sofia@kioscochicha.com" };
    await expect(servicio.actualizar(3, propios)).resolves.toBeDefined();
    await expect(servicio.actualizar(3, { ...propios, usuario: "cajero2" })).rejects.toMatchObject({ errores: { usuario: expect.any(String) } });
    await expect(servicio.actualizar(3, { ...propios, correo: "marcos@kioscochicha.com" })).rejects.toMatchObject({ errores: { correo: expect.any(String) } });
  });

  it("habilitar y deshabilitar cambian el estado", async () => {
    const servicio = await cargarPersonal();
    expect((await servicio.deshabilitar(3)).activo).toBe(false);
    expect((await servicio.habilitar(3)).activo).toBe(true);
    expect((await servicio.habilitar(4)).activo).toBe(true);
    expect((await servicio.listar()).map((p) => p.activo)).toEqual([true, true, true, true]);
  });

  it("eliminar saca a la persona de la lista", async () => {
    const servicio = await cargarPersonal();
    await servicio.eliminar(3);
    expect((await servicio.listar()).map((p) => p.id)).toEqual([1, 2, 4]);
  });
});

// ---------------------------------------------------------------------------
// Mejoras: correo más estricto y con largo máximo, el espacio no es un símbolo especial,
// y el Propietario conserva su rol al editarse.
// ---------------------------------------------------------------------------

describe("correo del personal: reglas más estrictas y largo máximo", () => {
  it.each([["a@b..com"], ["a..b@c.com"], [".a@b.com"], ["a.@b.com"], ["a@.b.com"], ["a@b.com."], ["a@b@c.com"], ["a@b .com"]])(
    "rechaza el correo %j",
    (correo) => {
      expect(validarCorreo(correo)).toBe("El correo no es válido.");
    },
  );

  it.each([["a.b@c.com"], ["a.b.c@d.e.com"], ["a-b_c@x-y.com"], ["nombre.apellido+tag@mail.empresa.com.ar"], ["ñandu@correo.com"]])(
    "acepta el correo %j",
    (correo) => {
      expect(validarCorreo(correo)).toBeNull();
    },
  );

  it("el largo máximo es 120", () => {
    expect(CORREO_MAXIMO).toBe(120);
  });

  it("acepta un correo de exactamente 120 caracteres y rechaza uno de 121", () => {
    const de120 = `${"a".repeat(114)}@b.com`;
    expect(de120).toHaveLength(120);
    expect(validarCorreo(de120)).toBeNull();
    expect(validarCorreo(`a${de120}`)).toBe("El correo no puede superar los 120 caracteres.");
  });

  it("los espacios de los costados no cuentan para el largo", () => {
    expect(validarCorreo(`  ${"a".repeat(114)}@b.com  `)).toBeNull();
  });

  it("en la ficha completa, un correo demasiado largo se informa en el campo correo", () => {
    expect(validarPersona({ ...persona, correo: `${"a".repeat(130)}@b.com` }).correo).toBe("El correo no puede superar los 120 caracteres.");
  });
});

describe("contraseña: el espacio no es un símbolo especial", () => {
  it.each([["Clave 2026"], ["Clave 2026 abc"], ["Una frase larga 123"]])("%j no tiene símbolo especial", (clave) => {
    expect(validarContrasena(clave)).toBe("La contraseña debe incluir al menos un símbolo especial.");
  });

  it.each([["Clave 2026#"], ["Una frase larga 123!"], ["Clave#2026"]])("%j es válida (puede llevar espacios si tiene un símbolo)", (clave) => {
    expect(validarContrasena(clave)).toBeNull();
  });

  it("los símbolos de siempre siguen valiendo", () => {
    for (const simbolo of ["#", "!", "@", "$", "%", "&", "*", "_", "-", "+", "."]) {
      expect(validarContrasena(`Clave2026${simbolo}`), simbolo).toBeNull();
    }
  });
});

describe("el Propietario conserva su rol al editarse", () => {
  const propietario = { usuario: "propietario1", correo: "ana@kiosco.com", nombre: "Ana", apellido: "Pérez", dni: "30123456", rol: "PROPIETARIO", password: "" };

  it("al editarlo, el rol Propietario es válido", () => {
    expect(validarPersona(propietario, { esNuevo: false })).toEqual({});
  });

  it("al crear, el rol Propietario sigue sin poder elegirse", () => {
    expect(validarPersona({ ...persona, rol: "PROPIETARIO" }, { esNuevo: true }).rol).toBe("Elija el rol.");
  });

  it("al editar a cualquiera, un rol que no existe se rechaza", () => {
    expect(validarPersona({ ...persona, rol: "SUPERUSUARIO" }, { esNuevo: false }).rol).toBe("Elija el rol.");
    expect(validarPersona({ ...persona, rol: "" }, { esNuevo: false }).rol).toBe("Elija el rol.");
  });

  it("el resto de los campos del Propietario se siguen validando", () => {
    const errores = validarPersona({ ...propietario, nombre: "", correo: "x" }, { esNuevo: false });
    expect(Object.keys(errores).sort()).toEqual(["correo", "nombre"]);
  });

  it("al editarlo, su rol viaja en el payload sin cambios", () => {
    expect(armarPayloadPersona(propietario, { esNuevo: false }).rol).toBe("PROPIETARIO");
  });
});
