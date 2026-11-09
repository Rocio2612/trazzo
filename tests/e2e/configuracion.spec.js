const { test, expect } = require("@playwright/test");
const { jwtFalso, simularApi, iniciarSesionComo } = require("./helpers");

// Datos simulados (mocks/personalizacion.js): 4 personas (Propietario id 1, Admin id 2, Empleados 3 y 4),
// 2 categorías (Remeras, Pantalones) y 2 medios de pago (Efectivo por defecto, Transferencia).

const abrir = async (page, ruta, rol = "PROPIETARIO", extraToken = null) => {
  await simularApi(page, { "GET /auth/yo": { status: 200, body: {} } });
  await iniciarSesionComo(page, rol);
  if (extraToken) {
    await page.evaluate((t) => localStorage.setItem("trazzo_access_token", t), jwtFalso(rol, extraToken));
  }
  await page.goto(ruta);
};

const completarUsuario = async (page, datos) => {
  for (const [campo, valor] of Object.entries(datos)) await page.locator(`#${campo}`).fill(valor);
};

const NUEVO = {
  nombre: "Julia",
  apellido: "Mora",
  correo: "julia@kioscochicha.com",
  usuario: "julia123",
  password: "Clave#2026",
};

test.describe("Configuración: Personal", () => {
  test("muestra el personal con su rol y estado, y el menú de Administración", async ({ page }) => {
    await abrir(page, "/configuracion.html");
    await expect(page.getByTestId("personal-tabla").locator("tbody tr")).toHaveCount(4);
    await expect(page.getByTestId("personal-fila-1")).toContainText("Propietario");
    await expect(page.getByTestId("personal-fila-3")).toContainText("Empleado");
    await expect(page.getByTestId("personal-fila-4")).toContainText("Deshabilitado");
    await expect(page.getByTestId("menu-negocio")).toBeVisible();
    await expect(page.getByTestId("menu-personal")).toBeVisible();
  });

  test("el Propietario no tiene deshabilitar ni eliminar, y tampoco sobre sí mismo", async ({ page }) => {
    await abrir(page, "/configuracion.html");
    await expect(page.getByTestId("personal-editar-1")).toBeVisible();
    for (const accion of ["deshabilitar", "habilitar", "eliminar"]) {
      await expect(page.getByTestId(`personal-${accion}-1`)).toHaveCount(0);
    }
    await expect(page.getByTestId("personal-fila-1")).toContainText("(vos)");
  });

  test("un administrador común no gestiona al Propietario pero sí a los empleados", async ({ page }) => {
    await abrir(page, "/configuracion.html", "ADMIN", { usuario_id: 2 });
    await expect(page.getByTestId("personal-editar-1")).toHaveCount(0);
    await expect(page.getByTestId("personal-deshabilitar-1")).toHaveCount(0);
    await expect(page.getByTestId("personal-deshabilitar-3")).toBeVisible();
    await expect(page.getByTestId("personal-habilitar-4")).toBeVisible();
    await expect(page.getByTestId("personal-deshabilitar-2")).toHaveCount(0); // sí mismo
  });

  test("crear → deshabilitar → habilitar → deshabilitar", async ({ page }) => {
    await abrir(page, "/configuracion.html");
    await page.getByTestId("personal-nuevo").click();
    await completarUsuario(page, NUEVO);
    await page.getByTestId("modal-guardar").click();
    const fila = page.getByRole("row", { name: /Julia Mora/ });
    await expect(fila).toContainText("Habilitado");

    await fila.getByRole("button", { name: "Deshabilitar" }).click();
    await page.getByTestId("modal-confirmar").click();
    await expect(fila).toContainText("Deshabilitado");

    await fila.getByRole("button", { name: "Habilitar" }).click();
    await page.getByTestId("modal-confirmar").click();
    await expect(fila).toContainText("Habilitado");

    await fila.getByRole("button", { name: "Deshabilitar" }).click();
    await page.getByTestId("modal-confirmar").click();
    await expect(fila).toContainText("Deshabilitado");
  });

  test("el alta vacía avisa qué falta y por qué", async ({ page }) => {
    await abrir(page, "/configuracion.html");
    await page.getByTestId("personal-nuevo").click();
    await page.getByTestId("modal-guardar").click();
    await expect(page.locator("#error-usuario")).toHaveText("Rellene el usuario.");
    await expect(page.locator("#error-password")).toHaveText("Rellene la contraseña.");
    await expect(page.locator("#error-correo")).toHaveText("Rellene el correo.");
    await expect(page.locator("#error-nombre")).toHaveText("Rellene el nombre.");
    await expect(page.locator("#error-apellido")).toHaveText("Rellene el apellido.");
    await expect(page.locator("#error-dni")).toBeHidden(); // el DNI es opcional
  });

  test("valida el formato del usuario y de la contraseña", async ({ page }) => {
    await abrir(page, "/configuracion.html");
    await page.getByTestId("personal-nuevo").click();
    await completarUsuario(page, { ...NUEVO, usuario: "Julia!", password: "clave" });
    await page.getByTestId("modal-guardar").click();
    await expect(page.locator("#error-usuario")).toContainText("minúsculas y números");
    await expect(page.locator("#error-password")).toContainText("entre 8 y 64");
  });

  test("un usuario repetido en el negocio se avisa junto al campo", async ({ page }) => {
    await abrir(page, "/configuracion.html");
    await page.getByTestId("personal-nuevo").click();
    await completarUsuario(page, { ...NUEVO, usuario: "cajero1" });
    await page.getByTestId("modal-guardar").click();
    await expect(page.locator("#error-usuario")).toHaveText("Ese usuario ya existe en este negocio.");
  });

  test("editar deja la contraseña vacía sin cambiarla", async ({ page }) => {
    await abrir(page, "/configuracion.html");
    await page.getByTestId("personal-editar-3").click();
    await page.locator("#apellido").fill("Díaz Luna");
    await page.getByTestId("modal-guardar").click();
    await expect(page.getByTestId("personal-fila-3")).toContainText("Sofía Díaz Luna");
  });

  test("eliminar pide confirmación y aclara qué pasa", async ({ page }) => {
    await abrir(page, "/configuracion.html");
    await page.getByTestId("personal-eliminar-3").click();
    await expect(page.getByTestId("modal")).toContainText("Su nombre se conserva en el historial");
    await page.getByTestId("modal-cancelar").click();
    await expect(page.getByTestId("personal-fila-3")).toBeVisible();

    await page.getByTestId("personal-eliminar-3").click();
    await page.getByTestId("modal-confirmar").click();
    await expect(page.getByTestId("personal-fila-3")).toHaveCount(0);
  });

  test("el buscador filtra por nombre, usuario o correo", async ({ page }) => {
    await abrir(page, "/configuracion.html");
    await page.getByTestId("personal-buscador").fill("marcos");
    await expect(page.getByTestId("personal-tabla").locator("tbody tr")).toHaveCount(1);
    await page.getByTestId("personal-buscador").fill("zzz");
    await expect(page.getByTestId("personal-vacio")).toHaveText("Sin resultados");
  });

  test("cancelar cierra el modal sin preguntar aunque se haya cargado algo", async ({ page }) => {
    await abrir(page, "/configuracion.html");
    await page.getByTestId("personal-nuevo").click();
    await page.locator("#nombre").fill("A medias");
    await page.getByTestId("modal-cancelar").click();
    await expect(page.getByTestId("modal")).toHaveCount(0);
  });

  test("el Empleado no entra a Configuración", async ({ page }) => {
    await abrir(page, "/configuracion.html", "CAJERO");
    await expect(page).toHaveURL(/dashboard\.html$/);
  });
});

test.describe("Configuración: Categorías y Medios de pago", () => {
  test("la dirección con # abre directo la pestaña", async ({ page }) => {
    await abrir(page, "/configuracion.html#categorias");
    await expect(page.getByTestId("categorias-lista")).toBeVisible();
    await page.getByTestId("pestania-medios-pago").click();
    await expect(page).toHaveURL(/#medios-pago$/);
    await expect(page.getByTestId("medios_pago-lista")).toBeVisible();
  });

  test("agregar, editar y eliminar una categoría", async ({ page }) => {
    await abrir(page, "/configuracion.html#categorias");
    await page.getByTestId("categorias-nombre").fill("Camperas");
    await page.getByTestId("categorias-agregar").click();
    await expect(page.getByTestId("categorias-lista")).toContainText("Camperas");

    await page.getByTestId("categorias-lista").getByRole("listitem").filter({ hasText: "Camperas" }).getByRole("button", { name: "Editar" }).click();
    await page.locator("#nombre").fill("Camperas de abrigo");
    await page.getByTestId("modal-guardar").click();
    await expect(page.getByTestId("categorias-lista")).toContainText("Camperas de abrigo");

    await page.getByTestId("categorias-lista").getByRole("listitem").filter({ hasText: "Camperas de abrigo" }).getByRole("button", { name: "Eliminar" }).click();
    await expect(page.getByTestId("modal")).toContainText("sigue apareciendo en lo histórico");
    await page.getByTestId("modal-confirmar").click();
    await expect(page.getByTestId("categorias-lista")).not.toContainText("Camperas de abrigo");
  });

  test("no deja agregar vacío ni repetido", async ({ page }) => {
    await abrir(page, "/configuracion.html#categorias");
    await page.getByTestId("categorias-agregar").click();
    await expect(page.getByTestId("categorias-error")).toHaveText("Rellene el nombre.");
    await page.getByTestId("categorias-nombre").fill("remeras");
    await page.getByTestId("categorias-agregar").click();
    await expect(page.getByTestId("categorias-error")).toHaveText("Ya existe una categoría con ese nombre.");
  });

  test("sin categorías muestra el mensaje reutilizable", async ({ page }) => {
    await abrir(page, "/configuracion.html#categorias");
    for (const nombre of ["Remeras", "Pantalones"]) {
      await page.getByTestId("categorias-lista").getByRole("listitem").filter({ hasText: nombre }).getByRole("button", { name: "Eliminar" }).click();
      await page.getByTestId("modal-confirmar").click();
    }
    await expect(page.getByTestId("sin-opciones-categorias")).toContainText("Sin categorías");
  });

  test("Efectivo es el medio de pago por defecto y no se puede eliminar", async ({ page }) => {
    await abrir(page, "/configuracion.html#medios-pago");
    const efectivo = page.getByTestId("medios_pago-lista").getByRole("listitem").filter({ hasText: "Efectivo" });
    await expect(efectivo).toContainText("Por defecto");
    await expect(efectivo.getByRole("button", { name: "Editar" })).toBeVisible();
    await expect(efectivo.getByRole("button", { name: "Eliminar" })).toHaveCount(0);

    const transferencia = page.getByTestId("medios_pago-lista").getByRole("listitem").filter({ hasText: "Transferencia" });
    await expect(transferencia.getByRole("button", { name: "Eliminar" })).toBeVisible();
  });
});

test.describe("Mi negocio", () => {
  test("muestra los datos con el identificador solo lectura", async ({ page }) => {
    await abrir(page, "/perfil-negocio.html");
    await expect(page.locator("#identificador")).toHaveValue("kioscochicha");
    await expect(page.locator("#identificador")).toHaveAttribute("readonly", "");
    await expect(page.locator("#nombre_comercial")).toHaveValue("Kiosco Chicha");
    await expect(page.locator("#categoria_impositiva")).toHaveValue("MONOTRIBUTISTA");
    await expect(page.getByTestId("negocio-aviso-categoria")).toContainText("solo afecta las operaciones futuras");
  });

  test("el nombre es obligatorio", async ({ page }) => {
    await abrir(page, "/perfil-negocio.html");
    await page.locator("#nombre_comercial").fill("");
    await page.getByTestId("negocio-guardar").click();
    await expect(page.locator("#error-nombre_comercial")).toHaveText("Rellene el nombre o razón social.");
  });

  test("cambiar la categoría impositiva pide confirmar y avisa que solo afecta lo futuro", async ({ page }) => {
    await abrir(page, "/perfil-negocio.html");
    await page.locator("#categoria_impositiva").selectOption("RESPONSABLE_INSCRIPTO");
    await expect(page.getByTestId("negocio-aviso-categoria")).toContainText("Vas a cambiar la categoría impositiva");
    await page.getByTestId("negocio-guardar").click();
    await expect(page.getByTestId("modal")).toContainText("Monotributista a Responsable Inscripto");
    await expect(page.getByTestId("modal")).toContainText("solo afecta las operaciones futuras");
    await page.getByTestId("modal-confirmar").click();
    await expect(page.locator(".gastos-toast")).toHaveText("Datos del negocio actualizados");
  });

  test("el rubro admite escribir uno propio", async ({ page }) => {
    await abrir(page, "/perfil-negocio.html");
    await expect(page.locator("#rubro_otro")).toBeHidden();
    await page.locator("#rubro").selectOption("__otro");
    await expect(page.locator("#rubro_otro")).toBeVisible();
  });

  test("el Empleado no entra a Mi negocio", async ({ page }) => {
    await abrir(page, "/perfil-negocio.html", "CAJERO");
    await expect(page).toHaveURL(/dashboard\.html$/);
  });
});
