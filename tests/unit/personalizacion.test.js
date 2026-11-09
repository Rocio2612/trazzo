import { describe, expect, it } from "vitest";
import {
  armarPayloadNegocio,
  armarPayloadPersona,
  buscarPersonal,
  contarAdministradoresActivos,
  MOTIVO_ULTIMO_ADMIN,
  puedeDeshabilitarPersona,
  puedeEditarPersona,
  puedeEliminarPersona,
  puedeHabilitarPersona,
  validarContrasena,
  validarCorreo,
  validarDni,
  validarNegocio,
  validarNombreLista,
  validarPersona,
  validarUsuario,
} from "../../frontend/js/personalizacion.js";

const persona = { usuario: "cajero1", password: "Clave#2026", correo: "a@b.com", nombre: "Ana", apellido: "Pérez", rol: "CAJERO" };

describe("validarUsuario", () => {
  it.each(["abcd", "cajero1", "a1b2c3d4e5f6g7h8i9j0"])("acepta %s", (valor) => {
    expect(validarUsuario(valor)).toBeNull();
  });

  it("pide el usuario si está vacío", () => {
    expect(validarUsuario("")).toBe("Rellene el usuario.");
    expect(validarUsuario("   ")).toBe("Rellene el usuario.");
  });

  it.each(["Cajero1", "caj ero", "cajero_1", "cajero!", "ñandu1"])("rechaza %s por mayúsculas, espacios o símbolos", (valor) => {
    expect(validarUsuario(valor)).toMatch(/solo puede tener letras minúsculas y números/);
  });

  it("exige entre 4 y 20 caracteres", () => {
    expect(validarUsuario("abc")).toBe("El usuario debe tener entre 4 y 20 caracteres.");
    expect(validarUsuario("a".repeat(21))).toBe("El usuario debe tener entre 4 y 20 caracteres.");
  });
});

describe("validarContrasena", () => {
  it("acepta una contraseña con mayúscula, minúscula, número y símbolo", () => {
    expect(validarContrasena("Clave#2026")).toBeNull();
  });

  it("pide la contraseña si está vacía", () => {
    expect(validarContrasena("")).toBe("Rellene la contraseña.");
  });

  it("exige entre 8 y 64 caracteres", () => {
    expect(validarContrasena("Ab1#")).toBe("La contraseña debe tener entre 8 y 64 caracteres.");
    expect(validarContrasena(`Ab1#${"a".repeat(61)}`)).toBe("La contraseña debe tener entre 8 y 64 caracteres.");
    expect(validarContrasena(`Ab1#${"a".repeat(60)}`)).toBeNull();
  });

  it.each([
    ["clave#2026", "mayúscula"],
    ["CLAVE#2026", "minúscula"],
    ["Clave#abcd", "número"],
    ["Clave2026a", "símbolo"],
  ])("avisa qué falta en %s", (clave, falta) => {
    expect(validarContrasena(clave)).toContain(falta);
  });
});

describe("validarCorreo y validarDni", () => {
  it("el correo es obligatorio y debe ser válido", () => {
    expect(validarCorreo("")).toBe("Rellene el correo.");
    expect(validarCorreo("sin-arroba")).toBe("El correo no es válido.");
    expect(validarCorreo("ana@kiosco.com")).toBeNull();
  });

  it("el DNI es opcional, pero si se carga debe tener 7 u 8 números", () => {
    expect(validarDni("")).toBeNull();
    expect(validarDni(null)).toBeNull();
    expect(validarDni("30123456")).toBeNull();
    expect(validarDni("3012345")).toBeNull();
    expect(validarDni("30.123.456")).toMatch(/7 u 8 números/);
    expect(validarDni("123")).toMatch(/7 u 8 números/);
  });
});

describe("validarPersona", () => {
  it("acepta una alta completa", () => {
    expect(validarPersona(persona)).toEqual({});
  });

  it("marca como faltantes los obligatorios, con su razón", () => {
    expect(validarPersona({})).toEqual({
      usuario: "Rellene el usuario.",
      password: "Rellene la contraseña.",
      correo: "Rellene el correo.",
      nombre: "Rellene el nombre.",
      apellido: "Rellene el apellido.",
      rol: "Elija el rol.",
    });
  });

  it("en una edición la contraseña vacía significa no cambiarla", () => {
    expect(validarPersona({ ...persona, password: "" }, { esNuevo: false })).toEqual({});
  });

  it("en una edición, si se escribe una contraseña debe cumplir las reglas", () => {
    expect(validarPersona({ ...persona, password: "corta" }, { esNuevo: false }).password).toBeDefined();
  });

  it("el rol solo puede ser administrador o empleado (el propietario no se crea)", () => {
    expect(validarPersona({ ...persona, rol: "PROPIETARIO" }).rol).toBe("Elija el rol.");
    expect(validarPersona({ ...persona, rol: "ADMIN" })).toEqual({});
  });
});

describe("armarPayloadPersona", () => {
  it("limpia espacios y manda el DNI vacío como null", () => {
    expect(armarPayloadPersona({ ...persona, usuario: " cajero1 ", dni: "" })).toEqual({
      usuario: "cajero1",
      correo: "a@b.com",
      nombre: "Ana",
      apellido: "Pérez",
      dni: null,
      rol: "CAJERO",
      password: "Clave#2026",
    });
  });

  it("en una edición sin contraseña no manda el campo", () => {
    expect(armarPayloadPersona({ ...persona, password: "" }, { esNuevo: false })).not.toHaveProperty("password");
  });
});

describe("buscarPersonal", () => {
  const lista = [
    { nombre: "Ana", apellido: "Pérez", usuario: "ana1", correo: "ana@x.com" },
    { nombre: "Luis", apellido: "Gómez", usuario: "luis2", correo: "luis@x.com" },
  ];

  it("busca por nombre, apellido, usuario o correo sin distinguir mayúsculas", () => {
    expect(buscarPersonal(lista, "GÓMEZ")).toHaveLength(1);
    expect(buscarPersonal(lista, "ana1")).toHaveLength(1);
    expect(buscarPersonal(lista, "@x.com")).toHaveLength(2);
    expect(buscarPersonal(lista, "zzz")).toEqual([]);
  });

  it("sin texto devuelve todo", () => {
    expect(buscarPersonal(lista, "  ")).toHaveLength(2);
  });
});

describe("reglas de habilitar, deshabilitar y eliminar", () => {
  const propietario = { id: 1, rol: "PROPIETARIO", activo: true };
  const admin = { id: 2, rol: "ADMIN", activo: true };
  const cajero = { id: 3, rol: "CAJERO", activo: true };
  const cajeroOff = { id: 4, rol: "CAJERO", activo: false };
  const todos = [propietario, admin, cajero, cajeroOff];

  it("nadie puede deshabilitar ni eliminar al Propietario", () => {
    expect(puedeDeshabilitarPersona(admin, propietario, todos).permitido).toBe(false);
    expect(puedeEliminarPersona(admin, propietario, todos).permitido).toBe(false);
    expect(puedeDeshabilitarPersona(propietario, propietario, todos).permitido).toBe(false);
    expect(puedeEliminarPersona(propietario, propietario, todos).permitido).toBe(false);
  });

  it("nadie se deshabilita ni se elimina a sí mismo", () => {
    expect(puedeDeshabilitarPersona(admin, admin, todos).permitido).toBe(false);
    expect(puedeEliminarPersona(cajero, cajero, todos).permitido).toBe(false);
  });

  it("el Propietario gestiona administradores y empleados", () => {
    expect(puedeDeshabilitarPersona(propietario, admin, todos).permitido).toBe(true);
    expect(puedeEliminarPersona(propietario, admin, todos).permitido).toBe(true);
    expect(puedeDeshabilitarPersona(propietario, cajero, todos).permitido).toBe(true);
    expect(puedeHabilitarPersona(propietario, cajeroOff).permitido).toBe(true);
  });

  it("un administrador común gestiona empleados pero no a otros administradores", () => {
    const otroAdmin = { id: 5, rol: "ADMIN", activo: true };
    expect(puedeDeshabilitarPersona(admin, cajero, todos).permitido).toBe(true);
    expect(puedeEliminarPersona(admin, cajero, todos).permitido).toBe(true);
    expect(puedeDeshabilitarPersona(admin, otroAdmin, [...todos, otroAdmin]).permitido).toBe(false);
    expect(puedeEliminarPersona(admin, otroAdmin, [...todos, otroAdmin]).permitido).toBe(false);
  });

  it("solo se habilita al que está deshabilitado y solo se deshabilita al habilitado", () => {
    expect(puedeHabilitarPersona(propietario, cajero).permitido).toBe(false);
    expect(puedeDeshabilitarPersona(propietario, cajeroOff, todos).permitido).toBe(false);
  });

  it("siempre debe quedar un administrador activo", () => {
    const soloUnAdmin = [{ id: 9, rol: "ADMIN", activo: true }, { ...propietario, activo: false }];
    expect(contarAdministradoresActivos(soloUnAdmin)).toBe(1);
    const regla = puedeDeshabilitarPersona({ id: 1, rol: "PROPIETARIO" }, soloUnAdmin[0], soloUnAdmin);
    expect(regla).toEqual({ permitido: false, motivo: MOTIVO_ULTIMO_ADMIN });
    expect(puedeEliminarPersona({ id: 1, rol: "PROPIETARIO" }, soloUnAdmin[0], soloUnAdmin).motivo).toBe(MOTIVO_ULTIMO_ADMIN);
  });

  it("editar: el Propietario edita a todos; un administrador, a empleados y a sí mismo", () => {
    expect(puedeEditarPersona(propietario, admin).permitido).toBe(true);
    expect(puedeEditarPersona(admin, cajero).permitido).toBe(true);
    expect(puedeEditarPersona(admin, admin).permitido).toBe(true);
    expect(puedeEditarPersona(admin, propietario).permitido).toBe(false);
  });
});

describe("validarNegocio", () => {
  const valido = { nombre_comercial: "Kiosco Chicha", rubro: "Kiosco", categoria_impositiva: "MONOTRIBUTISTA" };

  it("acepta los datos completos; el rubro es opcional", () => {
    expect(validarNegocio(valido)).toEqual({});
    expect(validarNegocio({ ...valido, rubro: "" })).toEqual({});
  });

  it("pide nombre y categoría impositiva", () => {
    expect(validarNegocio({})).toEqual({
      nombre_comercial: "Rellene el nombre o razón social.",
      categoria_impositiva: "Elija la categoría impositiva.",
    });
  });

  it("rechaza una categoría impositiva desconocida", () => {
    expect(validarNegocio({ ...valido, categoria_impositiva: "CONSUMIDOR_FINAL" }).categoria_impositiva).toBeDefined();
  });

  it("el payload limpia espacios y manda el rubro vacío como null", () => {
    expect(armarPayloadNegocio({ ...valido, nombre_comercial: "  Kiosco  ", rubro: " " })).toEqual({
      nombre_comercial: "Kiosco",
      rubro: null,
      categoria_impositiva: "MONOTRIBUTISTA",
    });
  });
});

describe("validarNombreLista", () => {
  it("pide el nombre", () => {
    expect(validarNombreLista("  ")).toBe("Rellene el nombre.");
  });

  it("no permite repetidos, sin distinguir mayúsculas", () => {
    expect(validarNombreLista("remeras", ["Remeras", "Pantalones"], "una categoría")).toBe("Ya existe una categoría con ese nombre.");
    expect(validarNombreLista("Camperas", ["Remeras"], "una categoría")).toBeNull();
  });

  it("limita el largo a 50 caracteres", () => {
    expect(validarNombreLista("a".repeat(51))).toMatch(/50 caracteres/);
  });
});
