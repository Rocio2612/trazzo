const { test, expect } = require("@playwright/test");
const { jwtFalso, simularApi, iniciarSesionComo } = require("./helpers");

// Configuración > pestaña Personal. Datos simulados (mocks/personalizacion.js):
// 1 Ana Pérez (propietario1, Propietario, habilitada) · 2 Luis Gómez (admin2, Administrador, habilitado)
// 3 Sofía Díaz (cajero1, Empleado, habilitada, DNI 40222333) · 4 Marcos Ruiz (cajero2, Empleado, deshabilitado)
//
// Para ver lo que se envía al guardar, o armar casos que el servicio simulado no permite (último administrador,
// lista vacía, un guardado lento), se entrega al navegador una copia modificada de mocks/personalizacion.js con
// `page.route`; el archivo real no se toca. Si ese mock cambia y un reemplazo ya no encaja, el test avisa.

const MOCK = "**/js/mocks/personalizacion.js";
const CREAR = "  crear: async (datos) => {";
const ACTUALIZAR = "  actualizar: async (id, datos) => {";
const REGISTRAR = [
  [CREAR, `${CREAR} (window.__crear ||= []).push(structuredClone(datos));`],
  [ACTUALIZAR, `${ACTUALIZAR} (window.__actualizar ||= []).push({ id, datos: structuredClone(datos) });`],
];
const CREAR_LENTO = [CREAR, `${CREAR} await new Promise((r) => setTimeout(r, 500));`];
const PROPIETARIO_DESHABILITADO = ['rol: "PROPIETARIO", activo: true', 'rol: "PROPIETARIO", activo: false'];
const LISTA_VACIA = ["  listar: async () => personal.map((p) => ({ ...p })),", "  listar: async () => [],"];

const abrir = async (page, { rol = "PROPIETARIO", usuarioId = null, reemplazos = [], ruta = "/configuracion.html" } = {}) => {
  if (reemplazos.length) {
    await page.route(MOCK, async (route) => {
      const original = await route.fetch();
      let cuerpo = await original.text();
      for (const [desde, hasta] of reemplazos) {
        if (!cuerpo.includes(desde)) throw new Error(`El mock cambió: no se encontró «${desde}»`);
        cuerpo = cuerpo.replace(desde, hasta);
      }
      await route.fulfill({ body: cuerpo, contentType: "application/javascript" });
    });
  }
  await simularApi(page, { "GET /auth/yo": { status: 200, body: {} } });
  await iniciarSesionComo(page, rol);
  if (usuarioId) await page.evaluate((t) => localStorage.setItem("trazzo_access_token", t), jwtFalso(rol, { usuario_id: usuarioId }));
  await page.goto(ruta);
};

const registros = (page, clave) => page.evaluate((c) => window[c] || [], clave);
const filas = (page) => page.getByTestId("personal-tabla").locator("tbody tr");
const fila = (page, id) => page.getByTestId(`personal-fila-${id}`);
const celda = (page, id, columna) => fila(page, id).locator("td").nth(columna);
const COL = { nombre: 0, usuario: 1, correo: 2, rol: 3, estado: 4, acciones: 5 };
const toast = (page) => page.locator(".gastos-toast");
const modal = (page) => page.getByTestId("modal");
const guardar = (page) => page.getByTestId("modal-guardar");
const errorDe = (page, campo) => page.locator(`#error-${campo}`);

const NUEVO = { nombre: "Julia", apellido: "Mora", correo: "julia@kioscochicha.com", usuario: "julia123", password: "Clave#2026" };

const llenar = async (page, datos) => {
  for (const [campo, valor] of Object.entries(datos)) {
    if (campo === "rol") await page.locator("#rol").selectOption(valor);
    else await page.locator(`#${campo}`).fill(valor);
  }
};

const crearUsuario = async (page, datos = {}) => {
  await page.getByTestId("personal-nuevo").click();
  await llenar(page, { ...NUEVO, ...datos });
  await guardar(page).click();
  await expect(modal(page)).toHaveCount(0);
};

const intentarCrear = async (page, datos = {}) => {
  await page.getByTestId("personal-nuevo").click();
  await llenar(page, { ...NUEVO, ...datos });
  await guardar(page).click();
};

test.describe("Configuración > Personal: pantalla", () => {
  test("muestra el título, las pestañas, las columnas, el buscador y el botón de alta", async ({ page }) => {
    await abrir(page);
    await expect(page.getByRole("heading", { name: "Configuración", level: 1 })).toBeVisible();
    await expect(page.getByRole("tab")).toHaveText(["Personal", "Categorías", "Medios de pago"]);
    await expect(page.getByTestId("personal-tabla").locator("thead th")).toHaveText(["Nombre", "Usuario", "Correo", "Rol", "Estado", "Acciones"]);
    await expect(page.getByTestId("personal-buscador")).toHaveAttribute("placeholder", "Buscar por nombre, usuario o correo…");
    await expect(page.getByTestId("personal-nuevo")).toHaveText("Nuevo usuario");
  });

  test("cada fila muestra nombre, usuario, correo, rol y estado", async ({ page }) => {
    await abrir(page);
    await expect(filas(page)).toHaveCount(4);
    await expect(celda(page, 2, COL.nombre)).toHaveText("Luis Gómez");
    await expect(celda(page, 2, COL.usuario)).toHaveText("admin2");
    await expect(celda(page, 2, COL.correo)).toHaveText("luis@kioscochicha.com");
    await expect(celda(page, 2, COL.rol)).toHaveText("Administrador");
    await expect(celda(page, 2, COL.estado)).toHaveText("Habilitado");
    await expect(celda(page, 3, COL.rol)).toHaveText("Empleado");
    await expect(celda(page, 4, COL.nombre)).toHaveText("Marcos Ruiz");
    await expect(celda(page, 4, COL.estado)).toHaveText("Deshabilitado");
  });

  test("el Propietario, los habilitados y los deshabilitados se distinguen por su insignia", async ({ page }) => {
    await abrir(page);
    await expect(celda(page, 1, COL.rol).locator(".cfg-insignia")).toHaveClass(/cfg-insignia-propietario/);
    await expect(celda(page, 2, COL.rol).locator(".cfg-insignia")).not.toHaveClass(/cfg-insignia-propietario/);
    await expect(celda(page, 3, COL.estado).locator(".cfg-insignia")).toHaveClass(/cfg-insignia-ok/);
    await expect(celda(page, 4, COL.estado).locator(".cfg-insignia")).toHaveClass(/cfg-insignia-off/);
  });

  test("«(vos)» marca la fila de quien tiene la sesión iniciada", async ({ page }) => {
    await abrir(page, { rol: "ADMIN", usuarioId: 2 });
    await expect(celda(page, 2, COL.nombre)).toContainText("(vos)");
    for (const id of [1, 3, 4]) await expect(celda(page, id, COL.nombre)).not.toContainText("(vos)");
  });

  test("el menú lateral marca Configuración como la pantalla actual", async ({ page }) => {
    await abrir(page);
    await expect(page.getByTestId("menu-personal")).toHaveAttribute("aria-current", "page");
  });

  test("un nombre con HTML se muestra como texto y no se ejecuta", async ({ page }) => {
    await abrir(page);
    await crearUsuario(page, { nombre: '<img src=x onerror="window.__xss=1">', apellido: "<b>Negrita</b>" });
    await expect(celda(page, 5, COL.nombre)).toHaveText('<img src=x onerror="window.__xss=1"> <b>Negrita</b>');
    await expect(celda(page, 5, COL.nombre).locator("img, b")).toHaveCount(0);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  });

  test("sin personal muestra 'Todavía no hay usuarios' y, al buscar, 'Sin resultados'", async ({ page }) => {
    await abrir(page, { reemplazos: [LISTA_VACIA] });
    await expect(page.getByTestId("personal-vacio")).toHaveText("Todavía no hay usuarios");
    await page.getByTestId("personal-buscador").fill("algo");
    await expect(page.getByTestId("personal-vacio")).toHaveText("Sin resultados");
  });
});

test.describe("Configuración > Personal: qué botones ve cada uno", () => {
  // [editar, habilitar, deshabilitar, eliminar] por fila (1 Propietario, 2 Admin, 3 Empleado, 4 Empleado deshabilitado)
  const ACCIONES = ["editar", "habilitar", "deshabilitar", "eliminar"];
  const MATRIZ = {
    PROPIETARIO: { 1: [1, 0, 0, 0], 2: [1, 0, 1, 1], 3: [1, 0, 1, 1], 4: [1, 1, 0, 1] },
    ADMIN: { 1: [0, 0, 0, 0], 2: [1, 0, 0, 0], 3: [1, 0, 1, 1], 4: [1, 1, 0, 1] },
  };

  for (const [rol, usuarioId] of [["PROPIETARIO", 1], ["ADMIN", 2]]) {
    test(`el ${rol} ve exactamente los botones que le corresponden en cada fila`, async ({ page }) => {
      await abrir(page, { rol, usuarioId });
      for (const [id, esperados] of Object.entries(MATRIZ[rol])) {
        for (const [i, accion] of ACCIONES.entries()) {
          await expect(page.getByTestId(`personal-${accion}-${id}`), `${rol} · fila ${id} · ${accion}`).toHaveCount(esperados[i]);
        }
      }
    });
  }

  test("los botones tienen nombre accesible", async ({ page }) => {
    await abrir(page);
    await expect(page.getByTestId("personal-editar-3")).toHaveAccessibleName("Editar");
    await expect(page.getByTestId("personal-deshabilitar-3")).toHaveAccessibleName("Deshabilitar");
    await expect(page.getByTestId("personal-eliminar-3")).toHaveAccessibleName("Eliminar");
    await expect(page.getByTestId("personal-habilitar-4")).toHaveAccessibleName("Habilitar");
  });

  test("si es el único administrador activo, deshabilitar y eliminar quedan bloqueados y explican por qué", async ({ page }) => {
    await abrir(page, { reemplazos: [PROPIETARIO_DESHABILITADO] });
    const motivo = "Siempre debe quedar al menos un administrador activo.";
    for (const [accion, nombre] of [["deshabilitar", "Deshabilitar"], ["eliminar", "Eliminar"]]) {
      const boton = page.getByTestId(`personal-${accion}-2`);
      await expect(boton).toBeDisabled();
      await expect(boton).toHaveAttribute("title", `${nombre}: ${motivo}`);
      await boton.click({ force: true });
      await expect(modal(page)).toHaveCount(0);
    }
    await expect(page.getByTestId("personal-editar-2")).toBeEnabled();
  });
});

test.describe("Configuración > Personal: formulario de alta", () => {
  test("abre con título, etiquetas, ayudas, el rol Empleado elegido y el foco en el nombre", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("personal-nuevo").click();
    await expect(modal(page).getByRole("heading", { name: "Nuevo usuario" })).toBeVisible();
    for (const [campo, etiqueta] of [
      ["nombre", "Nombre *"],
      ["apellido", "Apellido *"],
      ["correo", "Correo *"],
      ["dni", "DNI (opcional)"],
      ["usuario", "Usuario *"],
      ["password", "Contraseña *"],
      ["rol", "Rol *"],
    ]) {
      await expect(page.locator(`label[for="${campo}"]`)).toHaveText(etiqueta);
    }
    await expect(page.getByText("Se usa para recuperar la contraseña.")).toBeVisible();
    await expect(page.getByText("4 a 20 caracteres: minúsculas y números.")).toBeVisible();
    await expect(page.getByText("8 a 64 caracteres, con mayúscula, minúscula, número y símbolo.")).toBeVisible();
    await expect(page.locator("#rol")).toHaveValue("CAJERO");
    await expect(page.locator("#rol option")).toHaveText(["Empleado", "Administrador"]);
    await expect(page.locator("#nombre")).toBeFocused();
  });

  test("los campos tienen su tipo y su largo máximo", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("personal-nuevo").click();
    await expect(page.locator("#correo")).toHaveAttribute("type", "email");
    await expect(page.locator("#password")).toHaveAttribute("type", "password");
    for (const [id, max] of [["nombre", 50], ["apellido", 50], ["dni", 8], ["usuario", 20], ["password", 64]]) {
      await expect(page.locator(`#${id}`)).toHaveAttribute("maxlength", String(max));
      await page.locator(`#${id}`).click();
      await page.keyboard.insertText("a".repeat(max + 30));
      expect((await page.locator(`#${id}`).inputValue()).length).toBe(max);
    }
  });

  test("el rol Propietario no se ofrece al crear", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("personal-nuevo").click();
    await expect(page.locator('#rol option[value="PROPIETARIO"]')).toHaveCount(0);
  });

  test("guardar vacío marca los obligatorios, enfoca el primero y no guarda nada", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("personal-nuevo").click();
    await guardar(page).click();
    await expect(errorDe(page, "nombre")).toHaveText("Rellene el nombre.");
    await expect(errorDe(page, "apellido")).toHaveText("Rellene el apellido.");
    await expect(errorDe(page, "correo")).toHaveText("Rellene el correo.");
    await expect(errorDe(page, "usuario")).toHaveText("Rellene el usuario.");
    await expect(errorDe(page, "password")).toHaveText("Rellene la contraseña.");
    await expect(errorDe(page, "dni")).toBeHidden();
    await expect(errorDe(page, "rol")).toBeHidden();
    await expect(page.locator("#nombre")).toBeFocused();
    await expect(modal(page)).toHaveCount(1);
    await expect(filas(page)).toHaveCount(4);
  });

  for (const [campo, valor, mensaje] of [
    ["usuario", "Julia!", "El usuario solo puede tener letras minúsculas y números, sin símbolos ni espacios."],
    ["usuario", "JULIA123", "El usuario solo puede tener letras minúsculas y números, sin símbolos ni espacios."],
    ["usuario", "jul", "El usuario debe tener entre 4 y 20 caracteres."],
    ["password", "Ab1#", "La contraseña debe tener entre 8 y 64 caracteres."],
    ["password", "clave#2026", "La contraseña debe incluir al menos una letra mayúscula."],
    ["password", "CLAVE#2026", "La contraseña debe incluir al menos una letra minúscula."],
    ["password", "Clave#abcd", "La contraseña debe incluir al menos un número."],
    ["password", "Clave2026a", "La contraseña debe incluir al menos un símbolo especial."],
    ["correo", "sin-arroba", "El correo no es válido."],
    ["correo", "a@b", "El correo no es válido."],
    ["dni", "123", "El DNI debe tener 7 u 8 números, sin puntos."],
    ["dni", "1234567A", "El DNI debe tener 7 u 8 números, sin puntos."],
    ["dni", "30.123.4", "El DNI debe tener 7 u 8 números, sin puntos."],
  ]) {
    test(`${campo} «${valor}» se rechaza`, async ({ page }) => {
      await abrir(page);
      await intentarCrear(page, { [campo]: valor });
      await expect(errorDe(page, campo)).toHaveText(mensaje);
      await expect(page.locator(`#${campo}`)).toBeFocused();
      await expect(modal(page)).toHaveCount(1);
      await expect(filas(page)).toHaveCount(4);
    });
  }

  test("un nombre o apellido de solo espacios se rechaza", async ({ page }) => {
    await abrir(page);
    await intentarCrear(page, { nombre: "   ", apellido: "   " });
    await expect(errorDe(page, "nombre")).toHaveText("Rellene el nombre.");
    await expect(errorDe(page, "apellido")).toHaveText("Rellene el apellido.");
  });

  test("el foco va al primer campo con error en el orden del formulario", async ({ page }) => {
    await abrir(page);
    await intentarCrear(page, { usuario: "x", password: "x" });
    await expect(page.locator("#usuario")).toBeFocused();
    await llenar(page, { usuario: "julia123" });
    await guardar(page).click();
    await expect(page.locator("#password")).toBeFocused();
  });

  test("el error de un campo desaparece al escribir en él y los demás se mantienen", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("personal-nuevo").click();
    await guardar(page).click();
    await page.locator("#nombre").fill("J");
    await expect(errorDe(page, "nombre")).toBeHidden();
    await expect(page.locator("#nombre")).not.toHaveClass(/con-error/);
    await expect(errorDe(page, "apellido")).toBeVisible();
    await page.locator("#rol").selectOption("ADMIN");
    await expect(errorDe(page, "apellido")).toBeVisible();
  });

  test("Escape y un clic en el fondo cierran el formulario sin guardar, y el siguiente abre vacío", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("personal-nuevo").click();
    await llenar(page, NUEVO);
    await page.keyboard.press("Escape");
    await expect(modal(page)).toHaveCount(0);
    await page.getByTestId("personal-nuevo").click();
    await modal(page).click({ position: { x: 5, y: 5 } });
    await expect(modal(page)).toHaveCount(0);
    await page.getByTestId("personal-nuevo").click();
    for (const id of ["nombre", "apellido", "correo", "dni", "usuario", "password"]) await expect(page.locator(`#${id}`)).toHaveValue("");
    await expect(page.locator("#rol")).toHaveValue("CAJERO");
    await expect(filas(page)).toHaveCount(4);
  });
});

test.describe("Configuración > Personal: alta", () => {
  test("registra al usuario, lo muestra habilitado con su rol y envía los datos limpios", async ({ page }) => {
    await abrir(page, { reemplazos: REGISTRAR });
    await crearUsuario(page, { nombre: "  Julia  ", apellido: "  Mora ", correo: "  julia@kioscochicha.com  ", dni: "30123999" });
    await expect(filas(page)).toHaveCount(5);
    await expect(celda(page, 5, COL.nombre)).toHaveText("Julia Mora");
    await expect(celda(page, 5, COL.usuario)).toHaveText("julia123");
    await expect(celda(page, 5, COL.correo)).toHaveText("julia@kioscochicha.com");
    await expect(celda(page, 5, COL.rol)).toHaveText("Empleado");
    await expect(celda(page, 5, COL.estado)).toHaveText("Habilitado");
    await expect(toast(page)).toHaveText("Usuario creado");
    expect(await registros(page, "__crear")).toEqual([
      { nombre: "Julia", apellido: "Mora", correo: "julia@kioscochicha.com", dni: "30123999", usuario: "julia123", rol: "CAJERO", password: "Clave#2026" },
    ]);
  });

  test("sin DNI se envía vacío (null)", async ({ page }) => {
    await abrir(page, { reemplazos: REGISTRAR });
    await crearUsuario(page);
    expect((await registros(page, "__crear"))[0].dni).toBeNull();
  });

  test("se puede crear un administrador", async ({ page }) => {
    await abrir(page, { reemplazos: REGISTRAR });
    await crearUsuario(page, { rol: "ADMIN" });
    await expect(celda(page, 5, COL.rol)).toHaveText("Administrador");
    expect((await registros(page, "__crear"))[0].rol).toBe("ADMIN");
  });

  test("el usuario nuevo tiene sus botones según la regla (el Propietario puede editarlo, deshabilitarlo y eliminarlo)", async ({ page }) => {
    await abrir(page);
    await crearUsuario(page);
    for (const accion of ["editar", "deshabilitar", "eliminar"]) await expect(page.getByTestId(`personal-${accion}-5`)).toBeVisible();
    await expect(page.getByTestId("personal-habilitar-5")).toHaveCount(0);
  });

  test("un usuario repetido avisa junto al campo, no cierra el formulario y se puede corregir", async ({ page }) => {
    await abrir(page);
    await intentarCrear(page, { usuario: "cajero1" });
    await expect(errorDe(page, "usuario")).toHaveText("Ese usuario ya existe en este negocio.");
    await expect(modal(page)).toHaveCount(1);
    await expect(guardar(page)).toBeEnabled();
    await expect(guardar(page)).toHaveText("Guardar");
    await llenar(page, { usuario: "julia123" });
    await guardar(page).click();
    await expect(modal(page)).toHaveCount(0);
    await expect(filas(page)).toHaveCount(5);
  });

  test("un correo repetido avisa junto al campo, sin distinguir mayúsculas", async ({ page }) => {
    await abrir(page);
    await intentarCrear(page, { correo: "SOFIA@kioscochicha.com" });
    await expect(errorDe(page, "correo")).toHaveText("Ese correo ya está registrado en este negocio.");
    await expect(filas(page)).toHaveCount(4);
  });

  test("si se repiten usuario y correo, avisa primero el usuario", async ({ page }) => {
    await abrir(page);
    await intentarCrear(page, { usuario: "cajero1", correo: "sofia@kioscochicha.com" });
    await expect(errorDe(page, "usuario")).toBeVisible();
    await expect(errorDe(page, "correo")).toBeHidden();
  });

  test("un doble clic rápido en Guardar no duplica al usuario", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("personal-nuevo").click();
    await llenar(page, NUEVO);
    await page.evaluate(() => {
      const boton = document.querySelector('[data-testid="modal-guardar"]');
      boton.click();
      boton.click();
    });
    await expect(modal(page)).toHaveCount(0);
    await page.waitForTimeout(500);
    await expect(page.getByRole("row", { name: /Julia Mora/ })).toHaveCount(1);
  });

  test("mientras guarda el botón dice 'Guardando…' y queda deshabilitado", async ({ page }) => {
    await abrir(page, { reemplazos: [CREAR_LENTO] });
    await page.getByTestId("personal-nuevo").click();
    await llenar(page, NUEVO);
    await guardar(page).click();
    await expect(guardar(page)).toBeDisabled();
    await expect(guardar(page)).toHaveText("Guardando…");
    await expect(modal(page)).toHaveCount(0);
    await expect(filas(page)).toHaveCount(5);
  });

  for (const campo of ["nombre", "apellido", "correo", "dni", "usuario", "password"]) {
    test(`Enter en el campo ${campo} guarda el alta`, async ({ page }) => {
      await abrir(page);
      await page.getByTestId("personal-nuevo").click();
      await llenar(page, NUEVO);
      await page.locator(`#${campo}`).press("Enter");
      await expect(modal(page)).toHaveCount(0);
      await expect(filas(page)).toHaveCount(5);
      await expect(toast(page)).toHaveText("Usuario creado");
    });
  }

  test("Enter con datos inválidos muestra los errores y no guarda", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("personal-nuevo").click();
    await page.locator("#nombre").press("Enter");
    await expect(errorDe(page, "nombre")).toBeVisible();
    await expect(modal(page)).toHaveCount(1);
    await expect(filas(page)).toHaveCount(4);
  });

  test("Enter en el desplegable de rol no guarda", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("personal-nuevo").click();
    await llenar(page, NUEVO);
    await page.locator("#rol").focus();
    await page.keyboard.press("Enter");
    await expect(filas(page)).toHaveCount(4);
  });
});

test.describe("Configuración > Personal: edición", () => {
  test("abre con los datos de la persona y la contraseña vacía (se puede dejar así)", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("personal-editar-3").click();
    await expect(modal(page).getByRole("heading", { name: "Editar usuario" })).toBeVisible();
    await expect(page.locator("#nombre")).toHaveValue("Sofía");
    await expect(page.locator("#apellido")).toHaveValue("Díaz");
    await expect(page.locator("#correo")).toHaveValue("sofia@kioscochicha.com");
    await expect(page.locator("#dni")).toHaveValue("40222333");
    await expect(page.locator("#usuario")).toHaveValue("cajero1");
    await expect(page.locator("#password")).toHaveValue("");
    await expect(page.locator("#rol")).toHaveValue("CAJERO");
    await expect(page.locator('label[for="password"]')).toHaveText("Contraseña");
    await expect(page.getByText("Dejala vacía para no cambiarla.")).toBeVisible();
  });

  test("una persona sin DNI abre con el campo vacío y un administrador con su rol", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("personal-editar-2").click();
    await expect(page.locator("#dni")).toHaveValue("");
    await expect(page.locator("#rol")).toHaveValue("ADMIN");
  });

  test("guardar sin cambiar nada avisa y no marca al propio usuario ni correo como repetidos", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("personal-editar-3").click();
    await guardar(page).click();
    await expect(toast(page)).toHaveText("Usuario actualizado");
    await expect(filas(page)).toHaveCount(4);
    await expect(celda(page, 3, COL.nombre)).toHaveText("Sofía Díaz");
  });

  test("sin escribir contraseña, la edición no la envía", async ({ page }) => {
    await abrir(page, { reemplazos: REGISTRAR });
    await page.getByTestId("personal-editar-3").click();
    await llenar(page, { apellido: "Díaz Luna" });
    await guardar(page).click();
    await expect(celda(page, 3, COL.nombre)).toHaveText("Sofía Díaz Luna");
    const [envio] = await registros(page, "__actualizar");
    expect(envio.id).toBe(3);
    expect(envio.datos).toEqual({ usuario: "cajero1", correo: "sofia@kioscochicha.com", nombre: "Sofía", apellido: "Díaz Luna", dni: "40222333", rol: "CAJERO" });
    expect(envio.datos).not.toHaveProperty("password");
  });

  test("una contraseña de solo espacios se ignora", async ({ page }) => {
    await abrir(page, { reemplazos: REGISTRAR });
    await page.getByTestId("personal-editar-3").click();
    await llenar(page, { password: "     " });
    await guardar(page).click();
    await expect(toast(page)).toHaveText("Usuario actualizado");
    expect((await registros(page, "__actualizar"))[0].datos).not.toHaveProperty("password");
  });

  test("con una contraseña nueva válida la edición la envía", async ({ page }) => {
    await abrir(page, { reemplazos: REGISTRAR });
    await page.getByTestId("personal-editar-3").click();
    await llenar(page, { password: "Nueva#2026" });
    await guardar(page).click();
    await expect(toast(page)).toHaveText("Usuario actualizado");
    expect((await registros(page, "__actualizar"))[0].datos.password).toBe("Nueva#2026");
  });

  test("una contraseña nueva inválida se rechaza y no guarda nada", async ({ page }) => {
    await abrir(page, { reemplazos: REGISTRAR });
    await page.getByTestId("personal-editar-3").click();
    await llenar(page, { password: "corta" });
    await guardar(page).click();
    await expect(errorDe(page, "password")).toHaveText("La contraseña debe tener entre 8 y 64 caracteres.");
    await expect(page.locator("#password")).toBeFocused();
    expect(await registros(page, "__actualizar")).toEqual([]);
  });

  test("quitar el DNI lo envía vacío (null)", async ({ page }) => {
    await abrir(page, { reemplazos: REGISTRAR });
    await page.getByTestId("personal-editar-3").click();
    await llenar(page, { dni: "" });
    await guardar(page).click();
    await expect(toast(page)).toHaveText("Usuario actualizado");
    expect((await registros(page, "__actualizar"))[0].datos.dni).toBeNull();
  });

  test("cambiar el rol a Administrador actualiza la fila y los botones que se ven", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("personal-editar-3").click();
    await llenar(page, { rol: "ADMIN" });
    await guardar(page).click();
    await expect(celda(page, 3, COL.rol)).toHaveText("Administrador");
    await expect(page.getByTestId("personal-deshabilitar-3")).toBeVisible(); // el Propietario sí gestiona administradores
  });

  test("cambiar el usuario o el correo por los de otra persona avisa y no modifica nada", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("personal-editar-3").click();
    await llenar(page, { usuario: "cajero2" });
    await guardar(page).click();
    await expect(errorDe(page, "usuario")).toHaveText("Ese usuario ya existe en este negocio.");
    await llenar(page, { usuario: "cajero1", correo: "luis@kioscochicha.com" });
    await guardar(page).click();
    await expect(errorDe(page, "correo")).toHaveText("Ese correo ya está registrado en este negocio.");
    await expect(guardar(page)).toBeEnabled();
    await page.getByTestId("modal-cancelar").click();
    await expect(celda(page, 3, COL.correo)).toHaveText("sofia@kioscochicha.com");
  });

  test("editar con datos inválidos muestra los errores y no modifica", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("personal-editar-3").click();
    await llenar(page, { nombre: "", correo: "x", dni: "1" });
    await guardar(page).click();
    await expect(errorDe(page, "nombre")).toHaveText("Rellene el nombre.");
    await expect(errorDe(page, "correo")).toHaveText("El correo no es válido.");
    await expect(errorDe(page, "dni")).toBeVisible();
    await page.getByTestId("modal-cancelar").click();
    await expect(celda(page, 3, COL.nombre)).toHaveText("Sofía Díaz");
  });

  test("cancelar la edición no guarda los cambios", async ({ page }) => {
    await abrir(page, { reemplazos: REGISTRAR });
    await page.getByTestId("personal-editar-3").click();
    await llenar(page, { nombre: "Cambiado" });
    await page.getByTestId("modal-cancelar").click();
    await expect(celda(page, 3, COL.nombre)).toHaveText("Sofía Díaz");
    expect(await registros(page, "__actualizar")).toEqual([]);
  });

  test("Enter también guarda al editar", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("personal-editar-3").click();
    await llenar(page, { apellido: "Con Enter" });
    await page.locator("#apellido").press("Enter");
    await expect(celda(page, 3, COL.nombre)).toHaveText("Sofía Con Enter");
  });

  test("un administrador edita su propia ficha", async ({ page }) => {
    await abrir(page, { rol: "ADMIN", usuarioId: 2 });
    await page.getByTestId("personal-editar-2").click();
    await llenar(page, { apellido: "Gómez Ruiz" });
    await guardar(page).click();
    await expect(toast(page)).toHaveText("Usuario actualizado");
    await expect(celda(page, 2, COL.nombre)).toContainText("Luis Gómez Ruiz");
  });

  test("un administrador edita a un empleado", async ({ page }) => {
    await abrir(page, { rol: "ADMIN", usuarioId: 2 });
    await page.getByTestId("personal-editar-3").click();
    await llenar(page, { apellido: "Editada por admin" });
    await guardar(page).click();
    await expect(celda(page, 3, COL.nombre)).toHaveText("Sofía Editada por admin");
  });

  test("el Propietario edita su propia ficha: el rol Propietario no bloquea el guardado", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("personal-editar-1").click();
    await llenar(page, { apellido: "Pérez Nuevo" });
    await guardar(page).click();
    await expect(errorDe(page, "rol")).toBeHidden();
    await expect(toast(page)).toHaveText("Usuario actualizado");
    await expect(celda(page, 1, COL.nombre)).toContainText("Ana Pérez Nuevo");
  });

  test("al editar al Propietario, el rol se muestra como Propietario y no queda en blanco", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("personal-editar-1").click();
    await expect(page.locator("#rol")).not.toHaveValue("");
  });
});

test.describe("Configuración > Personal: habilitar, deshabilitar y eliminar", () => {
  test("el diálogo de habilitar nombra a la persona y explica qué pasa", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("personal-habilitar-4").click();
    await expect(modal(page).getByRole("heading", { name: "Habilitar usuario" })).toBeVisible();
    await expect(modal(page)).toContainText("¿Habilitar a Marcos Ruiz? Podrá iniciar sesión con sus credenciales.");
    await expect(page.getByTestId("modal-confirmar")).toHaveText("Habilitar");
  });

  test("habilitar avisa, cambia el estado y cambia los botones", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("personal-habilitar-4").click();
    await page.getByTestId("modal-confirmar").click();
    await expect(toast(page)).toHaveText("Marcos Ruiz fue habilitado");
    await expect(celda(page, 4, COL.estado)).toHaveText("Habilitado");
    await expect(page.getByTestId("personal-habilitar-4")).toHaveCount(0);
    await expect(page.getByTestId("personal-deshabilitar-4")).toBeVisible();
  });

  test("el diálogo de deshabilitar avisa que no podrá iniciar sesión", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("personal-deshabilitar-3").click();
    await expect(modal(page).getByRole("heading", { name: "Deshabilitar usuario" })).toBeVisible();
    await expect(modal(page)).toContainText("¿Deshabilitar a Sofía Díaz?");
    await expect(modal(page)).toContainText("Se sigue viendo en la lista, pero no podrá iniciar sesión y se cierran sus sesiones activas.");
  });

  test("deshabilitar avisa, cambia el estado y deja a la persona en la lista", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("personal-deshabilitar-3").click();
    await page.getByTestId("modal-confirmar").click();
    await expect(toast(page)).toHaveText("Sofía Díaz fue deshabilitado");
    await expect(celda(page, 3, COL.estado)).toHaveText("Deshabilitado");
    await expect(filas(page)).toHaveCount(4);
    await expect(page.getByTestId("personal-habilitar-3")).toBeVisible();
    await expect(page.getByTestId("personal-deshabilitar-3")).toHaveCount(0);
  });

  test("el diálogo de eliminar nombra a la persona y aclara qué se borra y qué se conserva", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("personal-eliminar-3").click();
    await expect(modal(page).getByRole("heading", { name: "Eliminar usuario" })).toBeVisible();
    await expect(modal(page)).toContainText("¿Eliminar a Sofía Díaz definitivamente?");
    await expect(modal(page)).toContainText("Se borran su usuario y su contraseña: no podrá volver a iniciar sesión y se cierran sus sesiones activas. Su nombre se conserva en el historial.");
    await expect(modal(page)).toContainText("Esta acción no se puede deshacer.");
    await expect(page.getByTestId("modal-confirmar")).toHaveText("Eliminar");
  });

  test("eliminar avisa y borra la fila", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("personal-eliminar-3").click();
    await page.getByTestId("modal-confirmar").click();
    await expect(toast(page)).toHaveText("Sofía Díaz fue eliminado");
    await expect(fila(page, 3)).toHaveCount(0);
    await expect(filas(page)).toHaveCount(3);
  });

  test("Cancelar, Escape y la cruz no cambian nada en ninguno de los tres diálogos", async ({ page }) => {
    await abrir(page);
    for (const abrirDialogo of [
      () => page.getByTestId("personal-deshabilitar-3").click(),
      () => page.getByTestId("personal-habilitar-4").click(),
      () => page.getByTestId("personal-eliminar-3").click(),
    ]) {
      await abrirDialogo();
      await page.getByTestId("modal-cancelar").click();
      await expect(modal(page)).toHaveCount(0);
      await abrirDialogo();
      await page.keyboard.press("Escape");
      await expect(modal(page)).toHaveCount(0);
      await abrirDialogo();
      await modal(page).getByRole("button", { name: "Cerrar", exact: true }).click();
      await expect(modal(page)).toHaveCount(0);
    }
    await expect(filas(page)).toHaveCount(4);
    await expect(celda(page, 3, COL.estado)).toHaveText("Habilitado");
    await expect(celda(page, 4, COL.estado)).toHaveText("Deshabilitado");
  });

  test("un Administrador deshabilita y elimina a empleados, pero no toca al Propietario ni al otro administrador", async ({ page }) => {
    await abrir(page, { rol: "ADMIN", usuarioId: 2 });
    await page.getByTestId("personal-deshabilitar-3").click();
    await page.getByTestId("modal-confirmar").click();
    await expect(celda(page, 3, COL.estado)).toHaveText("Deshabilitado");
    await page.getByTestId("personal-eliminar-4").click();
    await page.getByTestId("modal-confirmar").click();
    await expect(fila(page, 4)).toHaveCount(0);
    await expect(page.getByTestId("personal-eliminar-1")).toHaveCount(0);
  });

  test("al eliminar a todos los que se pueden, queda solo el Propietario", async ({ page }) => {
    await abrir(page);
    for (const id of [2, 3, 4]) {
      await page.getByTestId(`personal-eliminar-${id}`).click();
      await page.getByTestId("modal-confirmar").click();
      await expect(fila(page, id)).toHaveCount(0);
    }
    await expect(filas(page)).toHaveCount(1);
    await expect(page.getByTestId("personal-eliminar-1")).toHaveCount(0);
  });

  test("aunque el Propietario figure deshabilitado, no tiene botón para habilitarlo", async ({ page }) => {
    await abrir(page, { reemplazos: [PROPIETARIO_DESHABILITADO] });
    await expect(celda(page, 1, COL.estado)).toHaveText("Deshabilitado");
    await expect(page.getByTestId("personal-habilitar-1")).toHaveCount(0);
  });

  test("el filtro del buscador se mantiene después de deshabilitar", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("personal-buscador").fill("cajero");
    await expect(filas(page)).toHaveCount(2);
    await page.getByTestId("personal-deshabilitar-3").click();
    await page.getByTestId("modal-confirmar").click();
    await expect(celda(page, 3, COL.estado)).toHaveText("Deshabilitado");
    await expect(filas(page)).toHaveCount(2);
  });
});

test.describe("Configuración > Personal: búsqueda", () => {
  test("busca por nombre, apellido, usuario y correo, sin distinguir mayúsculas ni espacios de los costados", async ({ page }) => {
    await abrir(page);
    const buscador = page.getByTestId("personal-buscador");
    await buscador.fill("  LUIS  ");
    await expect(filas(page)).toHaveCount(1);
    await buscador.fill("gómez");
    await expect(fila(page, 2)).toBeVisible();
    await buscador.fill("cajero2");
    await expect(fila(page, 4)).toBeVisible();
    await buscador.fill("marcos@");
    await expect(fila(page, 4)).toBeVisible();
    await buscador.fill("kioscochicha");
    await expect(filas(page)).toHaveCount(4);
  });

  test("busca por parte del texto", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("personal-buscador").fill("cajer");
    await expect(filas(page)).toHaveCount(2);
  });

  test("sin coincidencias dice 'Sin resultados' y al borrar el texto vuelve la lista", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("personal-buscador").fill("zzz");
    await expect(page.getByTestId("personal-vacio")).toHaveText("Sin resultados");
    await page.getByTestId("personal-buscador").fill("");
    await expect(filas(page)).toHaveCount(4);
  });

  test("los símbolos raros no rompen la pantalla", async ({ page }) => {
    await abrir(page);
    const errores = [];
    page.on("pageerror", (e) => errores.push(e.message));
    for (const texto of ["(", "[", "*", ".*", "\\", "<script>", "%", "'"]) {
      await page.getByTestId("personal-buscador").fill(texto);
      await expect(page.getByTestId("personal-vacio")).toHaveText("Sin resultados");
    }
    await page.getByTestId("personal-buscador").fill("");
    await expect(filas(page)).toHaveCount(4);
    expect(errores).toEqual([]);
  });

  test("la búsqueda se actualiza sola cuando se crea una persona que coincide", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("personal-buscador").fill("julia");
    await expect(page.getByTestId("personal-vacio")).toHaveText("Sin resultados");
    await crearUsuario(page);
    await expect(filas(page)).toHaveCount(1);
    await expect(page.getByRole("row", { name: /Julia Mora/ })).toBeVisible();
  });

  test("no distingue tildes: «perez» encuentra a Pérez y «diaz» a Díaz", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("personal-buscador").fill("perez");
    await expect(fila(page, 1)).toBeVisible();
    await page.getByTestId("personal-buscador").fill("DIAZ");
    await expect(fila(page, 3)).toBeVisible();
    await page.getByTestId("personal-buscador").fill("gomez");
    await expect(fila(page, 2)).toBeVisible();
  });
});

test.describe("Configuración > Personal: acceso", () => {
  for (const [rol, usuarioId] of [["PROPIETARIO", 1], ["ADMIN", 2]]) {
    test(`el rol ${rol} entra a Configuración`, async ({ page }) => {
      await abrir(page, { rol, usuarioId });
      await expect(page).toHaveURL(/configuracion\.html$/);
      await expect(filas(page)).toHaveCount(4);
    });
  }

  test("el Empleado no entra y vuelve al panel", async ({ page }) => {
    await abrir(page, { rol: "CAJERO" });
    await expect(page).toHaveURL(/dashboard\.html$/);
  });

  test("un rol desconocido no entra", async ({ page }) => {
    await abrir(page, { rol: "VISITANTE" });
    await expect(page).not.toHaveURL(/configuracion\.html/);
  });

  test("sin sesión iniciada manda al login", async ({ page }) => {
    await page.goto("/configuracion.html");
    await expect(page).toHaveURL(/login\.html$/);
  });

  test("usar la pestaña Personal de punta a punta no produce errores de JavaScript", async ({ page }) => {
    const errores = [];
    page.on("pageerror", (e) => errores.push(e.message));
    await abrir(page);
    await crearUsuario(page);
    await page.getByTestId("personal-editar-5").click();
    await guardar(page).click();
    await page.getByTestId("personal-deshabilitar-5").click();
    await page.getByTestId("modal-confirmar").click();
    await page.getByTestId("personal-habilitar-5").click();
    await page.getByTestId("modal-confirmar").click();
    await page.getByTestId("personal-eliminar-5").click();
    await page.getByTestId("modal-confirmar").click();
    await page.getByTestId("personal-buscador").fill("luis");
    expect(errores).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Mejoras: el Propietario se edita con su rol visible, correo más estricto y con largo máximo,
// y el espacio no cuenta como símbolo especial de la contraseña.
// ---------------------------------------------------------------------------

test.describe("Configuración > Personal: edición del Propietario", () => {
  test("su rol aparece como Propietario, bloqueado, con la aclaración de que no se puede cambiar", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("personal-editar-1").click();
    await expect(page.locator("#rol")).toHaveValue("PROPIETARIO");
    await expect(page.locator("#rol option")).toHaveText(["Propietario"]);
    await expect(page.locator("#rol")).toBeDisabled();
    await expect(page.getByText("El rol del Propietario no se puede cambiar.")).toBeVisible();
  });

  test("al guardar, su rol viaja como Propietario y el resto de los datos se actualizan", async ({ page }) => {
    await abrir(page, { reemplazos: REGISTRAR });
    await page.getByTestId("personal-editar-1").click();
    await llenar(page, { nombre: "Ana María", dni: "" });
    await guardar(page).click();
    await expect(toast(page)).toHaveText("Usuario actualizado");
    const [envio] = await registros(page, "__actualizar");
    expect(envio.id).toBe(1);
    expect(envio.datos).toMatchObject({ rol: "PROPIETARIO", nombre: "Ana María", dni: null, usuario: "propietario1" });
    expect(envio.datos).not.toHaveProperty("password");
    await expect(celda(page, 1, COL.nombre)).toContainText("Ana María Pérez");
    await expect(celda(page, 1, COL.rol)).toHaveText("Propietario");
  });

  test("el Propietario puede cambiar su propia contraseña", async ({ page }) => {
    await abrir(page, { reemplazos: REGISTRAR });
    await page.getByTestId("personal-editar-1").click();
    await llenar(page, { password: "Nueva#2026" });
    await guardar(page).click();
    await expect(toast(page)).toHaveText("Usuario actualizado");
    expect((await registros(page, "__actualizar"))[0].datos.password).toBe("Nueva#2026");
  });

  test("las demás validaciones del Propietario siguen funcionando", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("personal-editar-1").click();
    await llenar(page, { nombre: "", correo: "x" });
    await guardar(page).click();
    await expect(errorDe(page, "nombre")).toHaveText("Rellene el nombre.");
    await expect(errorDe(page, "correo")).toHaveText("El correo no es válido.");
    await expect(errorDe(page, "rol")).toBeHidden();
  });

  test("Enter también guarda la ficha del Propietario", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("personal-editar-1").click();
    await llenar(page, { apellido: "Con Enter" });
    await page.locator("#apellido").press("Enter");
    await expect(celda(page, 1, COL.nombre)).toContainText("Ana Con Enter");
  });

  test("el rol de los demás sigue pudiéndose cambiar", async ({ page }) => {
    await abrir(page);
    for (const id of [2, 3, 4]) {
      await page.getByTestId(`personal-editar-${id}`).click();
      await expect(page.locator("#rol")).toBeEnabled();
      await expect(page.locator("#rol option")).toHaveText(["Empleado", "Administrador"]);
      await page.getByTestId("modal-cancelar").click();
    }
  });

  test("al crear un usuario nuevo el rol se elige libremente (y no hay Propietario)", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("personal-nuevo").click();
    await expect(page.locator("#rol")).toBeEnabled();
    await expect(page.getByText("El rol del Propietario no se puede cambiar.")).toHaveCount(0);
  });
});

test.describe("Configuración > Personal: correo y contraseña más estrictos", () => {
  test("el campo de correo no deja escribir más de 120 caracteres", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("personal-nuevo").click();
    await expect(page.locator("#correo")).toHaveAttribute("maxlength", "120");
    await page.locator("#correo").click();
    await page.keyboard.insertText("a".repeat(170));
    expect((await page.locator("#correo").inputValue()).length).toBe(120);
  });

  for (const correo of ["a@b..com", "a..b@c.com", ".a@b.com", "a.@b.com", "a@.b.com", "a@b.com."]) {
    test(`el correo «${correo}» se rechaza`, async ({ page }) => {
      await abrir(page);
      await intentarCrear(page, { correo });
      await expect(errorDe(page, "correo")).toHaveText("El correo no es válido.");
      await expect(filas(page)).toHaveCount(4);
    });
  }

  test("un correo con puntos en el medio sigue siendo válido", async ({ page }) => {
    await abrir(page);
    await crearUsuario(page, { correo: "julia.mora@mail.empresa.com.ar" });
    await expect(filas(page)).toHaveCount(5);
  });

  test("una contraseña con espacios pero sin símbolo se rechaza", async ({ page }) => {
    await abrir(page);
    await intentarCrear(page, { password: "Clave 2026" });
    await expect(errorDe(page, "password")).toHaveText("La contraseña debe incluir al menos un símbolo especial.");
    await expect(page.locator("#password")).toBeFocused();
  });

  test("una contraseña con espacios y un símbolo se acepta", async ({ page }) => {
    await abrir(page);
    await crearUsuario(page, { password: "Clave 2026#" });
    await expect(filas(page)).toHaveCount(5);
  });

  test("al editar, una contraseña nueva con espacios y sin símbolo también se rechaza", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("personal-editar-3").click();
    await llenar(page, { password: "Clave 2026" });
    await guardar(page).click();
    await expect(errorDe(page, "password")).toHaveText("La contraseña debe incluir al menos un símbolo especial.");
  });
});

// ---------------------------------------------------------------------------
// El correo del personal sigue la regla de la base (chk_usuario_correo_formato): solo ASCII y un final de
// dominio de solo letras.
// ---------------------------------------------------------------------------

test.describe("Configuración > Personal: el correo que acepta la base", () => {
  // (Un dominio con tilde, como «exámple.com», no se prueba acá: el navegador lo convierte solo a su forma ASCII
  // `xn--…` en el campo de correo, y esa forma sí la acepta la base. El texto crudo se prueba en los unitarios.)
  for (const correo of ["ñandu@correo.com", "josé@correo.com", "ana@correo.c0m", "ana@correo.com1", "ana!@correo.com", "ana@cor_reo.com"]) {
    test(`el correo «${correo}» se rechaza al crear`, async ({ page }) => {
      await abrir(page);
      await intentarCrear(page, { correo });
      await expect(errorDe(page, "correo")).toHaveText("El correo no es válido.");
      await expect(modal(page)).toHaveCount(1);
      await expect(filas(page)).toHaveCount(4);
    });
  }

  test("al editar, un correo con tilde también se rechaza y no modifica a la persona", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("personal-editar-3").click();
    await llenar(page, { correo: "sofía@kioscochicha.com" });
    await guardar(page).click();
    await expect(errorDe(page, "correo")).toHaveText("El correo no es válido.");
    await page.getByTestId("modal-cancelar").click();
    await expect(celda(page, 3, COL.correo)).toHaveText("sofia@kioscochicha.com");
  });

  test("correos con mayúsculas, números, guiones y símbolos permitidos se aceptan", async ({ page }) => {
    await abrir(page);
    await crearUsuario(page, { correo: "Julia.Mora-99+tienda%1@Mail-Empresa2.com.ar" });
    await expect(filas(page)).toHaveCount(5);
  });

  test("Enter con un correo que la base no acepta muestra el error y no guarda", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("personal-nuevo").click();
    await llenar(page, { ...NUEVO, correo: "ñandu@correo.com" });
    await page.locator("#correo").press("Enter");
    await expect(errorDe(page, "correo")).toBeVisible();
    await expect(filas(page)).toHaveCount(4);
  });
});
