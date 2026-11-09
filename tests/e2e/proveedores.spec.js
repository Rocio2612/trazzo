const { test, expect } = require("@playwright/test");
const { simularApi, iniciarSesionComo } = require("./helpers");

// Datos simulados (mocks/proveedores.js): 3 visibles (Envases del Sur, Bebidas Don Raúl, Marta Giménez)
// y 2 ocultos (Cooperativa La Esperanza, sin movimientos; Librería Central, con movimientos).

const abrir = async (page, rol = "ADMIN") => {
  await simularApi(page, { "GET /auth/yo": { status: 200, body: {} } });
  await iniciarSesionComo(page, rol);
  await page.goto("/proveedores.html");
};

const filas = (page) => page.getByTestId("proveedores-tabla").locator("tbody tr");

test.describe("Proveedores", () => {
  test("lista los proveedores visibles con su documento y categoría impositiva", async ({ page }) => {
    await abrir(page);
    await expect(filas(page)).toHaveCount(3);
    await expect(page.getByTestId("proveedores-fila-1")).toContainText("CUIT 30-71234567-1");
    await expect(page.getByTestId("proveedores-fila-1")).toContainText("Resp. Inscripto");
    await expect(page.getByTestId("proveedores-fila-3")).toContainText("CUIL 20-12345678-6");
    await expect(page.getByTestId("proveedores-fila-3")).toContainText("Monotributista");
    await expect(page.getByTestId("proveedores-fila-1")).toContainText("admin1"); // Creado por
    await expect(page.getByTestId("proveedores-fila-4")).toHaveCount(0); // oculto
  });

  test("el Empleado no entra a Proveedores", async ({ page }) => {
    await abrir(page, "CAJERO");
    await expect(page).toHaveURL(/dashboard\.html$/);
  });

  test("el alta vacía avisa qué falta y por qué", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("proveedores-nuevo").click();
    await page.getByTestId("modal-guardar").click();
    await expect(page.locator("#error-nombre")).toHaveText("Rellene el nombre o razón social.");
    await expect(page.locator("#error-numero_documento")).toHaveText("Rellene el número de CUIT.");
    await expect(page.locator("#error-categoria_impositiva")).toHaveText("Elija la categoría impositiva.");
    await expect(page.locator("#error-telefono")).toBeHidden(); // opcional
    await expect(page.locator("#error-correo")).toBeHidden(); // opcional
  });

  test("valida el dígito verificador del CUIT", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("proveedores-nuevo").click();
    await page.locator("#numero_documento").fill("30-71234567-2");
    await page.getByTestId("modal-guardar").click();
    await expect(page.locator("#error-numero_documento")).toHaveText("El CUIT no es válido: el dígito verificador no coincide.");
  });

  test("un documento repetido se avisa junto al campo", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("proveedores-nuevo").click();
    await page.locator("#nombre").fill("Otra empresa");
    await page.locator("#numero_documento").fill("30712345671");
    await page.locator("#categoria_impositiva").selectOption("EXENTO");
    await page.getByTestId("modal-guardar").click();
    await expect(page.locator("#error-numero_documento")).toContainText("Ya hay un proveedor con ese CUIT (30-71234567-1)");
  });

  test("da de alta un proveedor con descripción de compra", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("proveedores-nuevo").click();
    await page.locator("#nombre").fill("Distribuidora Norte");
    await page.locator("#numero_documento").fill("20-11111111-2");
    await page.locator("#categoria_impositiva").selectOption("RESPONSABLE_INSCRIPTO");
    await page.locator("#descripcion_compra").fill("Gaseosas y aguas saborizadas");
    await page.getByTestId("modal-guardar").click();
    const fila = page.getByRole("row", { name: /Distribuidora Norte/ });
    await expect(fila).toContainText("CUIT 20-11111111-2");
    await expect(fila).toContainText("Gaseosas y aguas saborizadas");
    await expect(fila).toContainText("usuario1"); // quién lo creó, tomado de la sesión
    await expect(filas(page)).toHaveCount(4);
  });

  test("el buscador filtra por nombre, documento o descripción", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("proveedores-buscador").fill("don raul");
    await expect(filas(page)).toHaveCount(1);
    await page.getByTestId("proveedores-buscador").fill("20-12345678-6");
    await expect(page.getByTestId("proveedores-fila-3")).toBeVisible();
    await page.getByTestId("proveedores-buscador").fill("cartón");
    await expect(page.getByTestId("proveedores-fila-1")).toBeVisible();
    await page.getByTestId("proveedores-buscador").fill("zzz");
    await expect(page.getByTestId("proveedores-vacio")).toHaveText("Sin resultados");
  });

  test("editar muestra la ficha completa y avisa si cambia la categoría impositiva", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("proveedores-editar-1").click();
    await expect(page.locator("#nombre")).toHaveValue("Envases del Sur S.A.");
    await expect(page.locator("#numero_documento")).toHaveValue("30-71234567-1");
    await expect(page.locator("#descripcion_compra")).toHaveValue("Distribuidor de envases y cajas de cartón");
    await expect(page.getByTestId("modal")).not.toContainText("afecta cómo se registra el IVA");
    await page.locator("#categoria_impositiva").selectOption("MONOTRIBUTISTA");
    await expect(page.getByTestId("modal")).toContainText("afecta cómo se registra el IVA de las próximas reposiciones");
    await page.getByTestId("modal-guardar").click();
    await expect(page.getByTestId("proveedores-fila-1")).toContainText("Monotributista");
  });

  test("ocultar saca al proveedor de la lista y se puede restaurar desde Ver ocultos", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("proveedores-ocultar-3").click();
    await page.getByTestId("modal-cancelar").click();
    await expect(page.getByTestId("proveedores-fila-3")).toBeVisible();

    await page.getByTestId("proveedores-ocultar-3").click();
    await page.getByTestId("modal-confirmar").click();
    await expect(page.getByTestId("proveedores-fila-3")).toHaveCount(0);

    await page.getByTestId("proveedores-ver-ocultos").click();
    await expect(page.getByTestId("proveedores-fila-3")).toBeVisible();
    await page.getByTestId("proveedores-ocultar-3").click(); // en la vista de ocultos es "Restaurar"
    await page.getByTestId("proveedores-ver-ocultos").click();
    await expect(page.getByTestId("proveedores-fila-3")).toBeVisible();
  });

  test("con movimientos solo se puede ocultar: Eliminar queda deshabilitado", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("proveedores-ver-ocultos").click();
    await expect(filas(page)).toHaveCount(2);
    const conMovimientos = page.getByTestId("proveedores-eliminar-5");
    await expect(conMovimientos).toBeDisabled();
    await expect(conMovimientos).toHaveAttribute("title", /reposiciones o insumos asociados/);
    await expect(page.getByTestId("proveedores-eliminar-4")).toBeEnabled();
  });

  test("un proveedor oculto y sin movimientos se elimina al confirmar", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("proveedores-ver-ocultos").click();
    await page.getByTestId("proveedores-eliminar-4").click();
    await page.getByTestId("modal-cancelar").click();
    await expect(page.getByTestId("proveedores-fila-4")).toBeVisible();

    await page.getByTestId("proveedores-eliminar-4").click();
    await page.getByTestId("modal-confirmar").click();
    await expect(page.getByTestId("proveedores-fila-4")).toHaveCount(0);
    await expect(filas(page)).toHaveCount(1);
  });

  test("cancelar y la cruz cierran el modal sin preguntar aunque se haya cargado algo", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("proveedores-nuevo").click();
    await page.locator("#nombre").fill("A medias");
    await page.getByTestId("modal-cancelar").click();
    await expect(page.getByTestId("modal")).toHaveCount(0);

    await page.getByTestId("proveedores-nuevo").click();
    await page.locator("#nombre").fill("Otra vez");
    await page.getByTestId("modal").getByRole("button", { name: "Cerrar", exact: true }).click();
    await expect(page.getByTestId("modal")).toHaveCount(0);
    await expect(filas(page)).toHaveCount(3);
  });
});

// ---------------------------------------------------------------------------
// Pruebas ampliadas de la pantalla: estructura, validaciones, alta, edición, ocultar/restaurar,
// eliminar, búsqueda y acceso.
// Datos de ejemplo: 1 Envases del Sur (CUIT 30-71234567-1, Resp. Inscripto, con movimientos)
// 2 Bebidas Don Raúl (CUIT 30-50000173-5) · 3 Marta Giménez (CUIL 20-12345678-6, Monotributista, sin teléfono)
// 4 Cooperativa La Esperanza (oculto, sin movimientos, sin descripción) · 5 Librería Central (oculto, con movimientos)
// ---------------------------------------------------------------------------

const toast = (page) => page.locator(".gastos-toast");
const modal = (page) => page.getByTestId("modal");
const guardar = (page) => page.getByTestId("modal-guardar");
const errorDe = (page, campo) => page.locator(`#error-${campo}`);
const celda = (page, id, columna) => page.getByTestId(`proveedores-fila-${id}`).locator("td").nth(columna);
// Columnas de la tabla
const COL = { nombre: 0, documento: 1, categoria: 2, telefono: 3, descripcion: 4, creadoPor: 5, acciones: 6 };

// Completa el formulario; lo que no se pasa queda como está.
const llenar = async (page, { nombre, tipo, numero, categoria, telefono, correo, descripcion }) => {
  if (nombre !== undefined) await page.locator("#nombre").fill(nombre);
  if (tipo !== undefined) await page.locator("#tipo_documento").selectOption(tipo);
  if (numero !== undefined) await page.locator("#numero_documento").fill(numero);
  if (categoria !== undefined) await page.locator("#categoria_impositiva").selectOption(categoria);
  if (telefono !== undefined) await page.locator("#telefono").fill(telefono);
  if (correo !== undefined) await page.locator("#correo").fill(correo);
  if (descripcion !== undefined) await page.locator("#descripcion_compra").fill(descripcion);
};

// Una ficha válida mínima (CUIT 20-11111111-2 no está en los datos de ejemplo).
const FICHA = { nombre: "Distribuidora Norte", numero: "20-11111111-2", categoria: "EXENTO" };

const crearProveedor = async (page, datos = {}) => {
  await page.getByTestId("proveedores-nuevo").click();
  await llenar(page, { ...FICHA, ...datos });
  await guardar(page).click();
  await expect(modal(page)).toHaveCount(0);
};

const intentarGuardar = async (page, datos = {}) => {
  await page.getByTestId("proveedores-nuevo").click();
  await llenar(page, { ...FICHA, ...datos });
  await guardar(page).click();
};

test.describe("Proveedores: estructura de la pantalla", () => {
  test("muestra el título, las columnas, el buscador y el botón de alta", async ({ page }) => {
    await abrir(page);
    await expect(page.getByRole("heading", { name: "Proveedores", level: 1 })).toBeVisible();
    await expect(page.getByTestId("proveedores-tabla").locator("thead th")).toHaveText([
      "Nombre o razón social",
      "Documento",
      "Categoría impositiva",
      "Teléfono",
      "Descripción de compra",
      "Creado por",
      "Acciones",
    ]);
    await expect(page.getByTestId("proveedores-buscador")).toHaveAttribute("placeholder", /Buscar por nombre, documento, teléfono o descripción/);
    await expect(page.getByTestId("proveedores-nuevo")).toHaveText("Nuevo proveedor");
    await expect(page.getByTestId("proveedores-ver-ocultos")).toHaveText("Ver ocultos");
  });

  test("muestra '—' donde no hay teléfono o descripción", async ({ page }) => {
    await abrir(page);
    await expect(celda(page, 3, COL.telefono)).toHaveText("—");
    await page.getByTestId("proveedores-ver-ocultos").click();
    await expect(celda(page, 4, COL.descripcion)).toHaveText("—");
  });

  test("cada fila visible tiene Editar y Ocultar, y ninguna tiene Eliminar", async ({ page }) => {
    await abrir(page);
    for (const id of [1, 2, 3]) {
      await expect(page.getByTestId(`proveedores-editar-${id}`)).toBeVisible();
      await expect(page.getByTestId(`proveedores-ocultar-${id}`)).toHaveAccessibleName("Ocultar");
      await expect(page.getByTestId(`proveedores-eliminar-${id}`)).toHaveCount(0);
    }
  });

  test("la descripción larga se corta en la tabla pero se ve completa al pasar el mouse", async ({ page }) => {
    await abrir(page);
    const larga = "Distribuidor mayorista de envases, cajas de cartón, bolsas, etiquetas, cintas y todo tipo de embalajes industriales";
    await crearProveedor(page, { descripcion: larga });
    await expect(celda(page, 6, COL.descripcion).locator(".prov-descripcion")).toHaveAttribute("title", larga);
  });

  test("con un nombre de 100 letras seguidas y una descripción de 500 caracteres no aparece scroll horizontal", async ({ page }) => {
    await abrir(page);
    await crearProveedor(page, { nombre: "N".repeat(100), descripcion: "palabra ".repeat(62) });
    const desborda = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(desborda).toBe(false);
  });
});

test.describe("Proveedores: formulario y validaciones", () => {
  test("al abrir 'Nuevo proveedor' el foco está en el nombre y el tipo de documento es CUIT", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("proveedores-nuevo").click();
    await expect(modal(page).getByRole("heading", { name: "Nuevo proveedor" })).toBeVisible();
    await expect(page.locator("#nombre")).toBeFocused();
    await expect(page.locator("#tipo_documento")).toHaveValue("CUIT");
    await expect(page.locator("#categoria_impositiva")).toHaveValue("");
    await expect(page.locator("#categoria_impositiva option").first()).toHaveText("Elegir…");
  });

  test("los obligatorios llevan asterisco y teléfono y correo se marcan como opcionales", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("proveedores-nuevo").click();
    await expect(page.locator('label[for="nombre"]')).toHaveText("Nombre o razón social *");
    await expect(page.locator('label[for="tipo_documento"]')).toHaveText("Tipo de documento *");
    await expect(page.locator('label[for="numero_documento"]')).toHaveText("Número *");
    await expect(page.locator('label[for="categoria_impositiva"]')).toHaveText("Categoría impositiva *");
    await expect(page.locator('label[for="telefono"]')).toHaveText("Teléfono (opcional)");
    await expect(page.locator('label[for="correo"]')).toHaveText("Correo (opcional)");
    await expect(page.locator('label[for="descripcion_compra"]')).toHaveText("Descripción de compra");
  });

  test("los tipos de documento son CUIT, CUIL y DNI, y las categorías no incluyen Consumidor Final", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("proveedores-nuevo").click();
    await expect(page.locator("#tipo_documento option")).toHaveText(["CUIT", "CUIL", "DNI"]);
    await expect(page.locator("#categoria_impositiva option")).toHaveText(["Elegir…", "Responsable Inscripto", "Monotributista", "Exento"]);
  });

  test("guardar vacío marca nombre, número y categoría, enfoca el primero y no guarda nada", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("proveedores-nuevo").click();
    await guardar(page).click();
    await expect(errorDe(page, "nombre")).toHaveText("Rellene el nombre o razón social.");
    await expect(errorDe(page, "numero_documento")).toHaveText("Rellene el número de CUIT.");
    await expect(errorDe(page, "categoria_impositiva")).toHaveText("Elija la categoría impositiva.");
    await expect(errorDe(page, "tipo_documento")).toBeHidden();
    await expect(page.locator("#nombre")).toBeFocused();
    await expect(page.locator("#nombre")).toHaveClass(/con-error/);
    await expect(modal(page)).toHaveCount(1);
    await expect(filas(page)).toHaveCount(3);
  });

  test("el foco va al primer campo con error", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("proveedores-nuevo").click();
    await llenar(page, { nombre: "Algo" });
    await guardar(page).click();
    await expect(page.locator("#numero_documento")).toBeFocused();
    await llenar(page, { numero: "20-11111111-2" });
    await guardar(page).click();
    await expect(page.locator("#categoria_impositiva")).toBeFocused();
  });

  test("el mensaje del número usa el tipo elegido", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("proveedores-nuevo").click();
    await page.locator("#tipo_documento").selectOption("DNI");
    await guardar(page).click();
    await expect(errorDe(page, "numero_documento")).toHaveText("Rellene el número de DNI.");
    await page.locator("#tipo_documento").selectOption("CUIL");
    await guardar(page).click();
    await expect(errorDe(page, "numero_documento")).toHaveText("Rellene el número de CUIL.");
  });

  test("el error de un campo desaparece al escribir en él y los demás se mantienen", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("proveedores-nuevo").click();
    await guardar(page).click();
    await page.locator("#nombre").fill("A");
    await expect(errorDe(page, "nombre")).toBeHidden();
    await expect(page.locator("#nombre")).not.toHaveClass(/con-error/);
    await expect(errorDe(page, "numero_documento")).toBeVisible();
    await page.locator("#categoria_impositiva").selectOption("EXENTO");
    await expect(errorDe(page, "categoria_impositiva")).toBeHidden();
  });

  test("un nombre de solo espacios se rechaza", async ({ page }) => {
    await abrir(page);
    await intentarGuardar(page, { nombre: "     " });
    await expect(errorDe(page, "nombre")).toHaveText("Rellene el nombre o razón social.");
    await expect(filas(page)).toHaveCount(3);
  });

  for (const [tipo, numero, mensaje] of [
    ["CUIT", "30-71234567-2", "El CUIT no es válido: el dígito verificador no coincide."],
    ["CUIT", "3071234567", "El CUIT debe tener 11 números."],
    ["CUIT", "307123456712", "El CUIT debe tener 11 números."],
    ["CUIT", "10-71234567-1", "El CUIT no es válido: el prefijo no existe."],
    ["CUIT", "30-7123456A-1", "Solo se admiten números."],
    ["CUIT", "30/71234567/1", "Solo se admiten números."],
    ["CUIL", "20-12345678-5", "El CUIL no es válido: el dígito verificador no coincide."],
    ["CUIL", "2012345678", "El CUIL debe tener 11 números."],
    ["DNI", "123", "El DNI debe tener 7 u 8 números."],
    ["DNI", "123456789", "El DNI debe tener 7 u 8 números."],
    ["DNI", "1234567A", "Solo se admiten números."],
  ]) {
    test(`el ${tipo} «${numero}» se rechaza`, async ({ page }) => {
      await abrir(page);
      await intentarGuardar(page, { tipo, numero });
      await expect(errorDe(page, "numero_documento")).toHaveText(mensaje);
      await expect(page.locator("#numero_documento")).toBeFocused();
      await expect(modal(page)).toHaveCount(1);
      await expect(filas(page)).toHaveCount(3);
    });
  }

  for (const [campo, valor] of [
    ["telefono", "abc"],
    ["telefono", "12345"],
    ["telefono", "11 4444-5555 int. 23"],
  ]) {
    test(`el teléfono «${valor}» se rechaza`, async ({ page }) => {
      await abrir(page);
      await intentarGuardar(page, { [campo]: valor });
      await expect(errorDe(page, "telefono")).toHaveText("El teléfono debe tener entre 6 y 15 números (puede llevar +, espacios, guiones y paréntesis).");
      await expect(filas(page)).toHaveCount(3);
    });
  }

  for (const correo of ["sin-arroba", "a@b", "a@b.c", "@b.com"]) {
    test(`el correo «${correo}» se rechaza`, async ({ page }) => {
      await abrir(page);
      await intentarGuardar(page, { correo });
      await expect(errorDe(page, "correo")).toHaveText("El correo no es válido.");
      await expect(page.locator("#correo")).toBeFocused();
      await expect(filas(page)).toHaveCount(3);
    });
  }

  test("los campos tienen su largo máximo: nombre 100, número 13, teléfono 25 y descripción 500", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("proveedores-nuevo").click();
    for (const [id, max] of [["nombre", 100], ["numero_documento", 13], ["telefono", 25], ["descripcion_compra", 500]]) {
      await expect(page.locator(`#${id}`)).toHaveAttribute("maxlength", String(max));
      await page.locator(`#${id}`).click();
      await page.keyboard.insertText("1".repeat(max + 50));
      expect((await page.locator(`#${id}`).inputValue()).length).toBe(max);
    }
  });

  test("el campo de teléfono es de tipo tel y el de correo de tipo email", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("proveedores-nuevo").click();
    await expect(page.locator("#telefono")).toHaveAttribute("type", "tel");
    await expect(page.locator("#correo")).toHaveAttribute("type", "email");
  });

  test("teléfono, correo y descripción vacíos son válidos", async ({ page }) => {
    await abrir(page);
    await crearProveedor(page);
    await expect(filas(page)).toHaveCount(4);
  });

  test("Escape y un clic en el fondo cierran el formulario sin guardar, y el siguiente abre vacío", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("proveedores-nuevo").click();
    await llenar(page, FICHA);
    await page.keyboard.press("Escape");
    await expect(modal(page)).toHaveCount(0);

    await page.getByTestId("proveedores-nuevo").click();
    await modal(page).click({ position: { x: 5, y: 5 } });
    await expect(modal(page)).toHaveCount(0);

    await page.getByTestId("proveedores-nuevo").click();
    await expect(page.locator("#nombre")).toHaveValue(""); // el formulario vuelve a abrir vacío
    await expect(page.getByRole("dialog", { name: "Nuevo proveedor" })).toBeVisible();
    await expect(filas(page)).toHaveCount(3);
  });
});

test.describe("Proveedores: alta", () => {
  test("la ficha mínima se registra y la fila muestra '—' en lo opcional", async ({ page }) => {
    await abrir(page);
    await crearProveedor(page);
    await expect(filas(page)).toHaveCount(4);
    await expect(celda(page, 6, COL.nombre)).toHaveText("Distribuidora Norte");
    await expect(celda(page, 6, COL.documento)).toHaveText(/CUIT\s+20-11111111-2/);
    await expect(celda(page, 6, COL.categoria)).toHaveText("Exento");
    await expect(celda(page, 6, COL.telefono)).toHaveText("—");
    await expect(celda(page, 6, COL.descripcion)).toHaveText("—");
    await expect(celda(page, 6, COL.creadoPor)).toHaveText("usuario1");
    await expect(toast(page)).toHaveText("Proveedor registrado");
  });

  test("recorta los espacios del nombre y guarda teléfono y correo (se ven al editar)", async ({ page }) => {
    await abrir(page);
    await crearProveedor(page, { nombre: "   Con espacios   ", telefono: " +54 9 11 4444-5555 ", correo: " contacto@empresa.com.ar " });
    await expect(celda(page, 6, COL.nombre)).toHaveText("Con espacios");
    await expect(celda(page, 6, COL.telefono)).toHaveText("+54 9 11 4444-5555");
    await page.getByTestId("proveedores-editar-6").click();
    await expect(page.locator("#correo")).toHaveValue("contacto@empresa.com.ar");
    await expect(page.locator("#telefono")).toHaveValue("+54 9 11 4444-5555");
  });

  test("da de alta un CUIL con la categoría Monotributista", async ({ page }) => {
    await abrir(page);
    await crearProveedor(page, { tipo: "CUIL", numero: "27-20123456-0", categoria: "MONOTRIBUTISTA" });
    await expect(celda(page, 6, COL.documento)).toHaveText(/CUIL\s+27-20123456-0/);
    await expect(celda(page, 6, COL.categoria)).toHaveText("Monotributista");
  });

  test("da de alta un DNI y lo muestra con puntos", async ({ page }) => {
    await abrir(page);
    await crearProveedor(page, { tipo: "DNI", numero: "30123456" });
    await expect(celda(page, 6, COL.documento)).toHaveText(/DNI\s+30\.123\.456/);
    await crearProveedor(page, { nombre: "DNI corto", tipo: "DNI", numero: "1234567" });
    await expect(celda(page, 7, COL.documento)).toHaveText(/DNI\s+1\.234\.567/);
  });

  test("el CUIT puede escribirse con espacios y se muestra con guiones", async ({ page }) => {
    await abrir(page);
    await crearProveedor(page, { numero: "20 11111111 2" });
    await expect(celda(page, 6, COL.documento)).toHaveText(/CUIT\s+20-11111111-2/);
  });

  test("un documento repetido avisa junto al campo, no cierra el formulario y se puede corregir", async ({ page }) => {
    await abrir(page);
    await intentarGuardar(page, { numero: "30-71234567-1" });
    await expect(errorDe(page, "numero_documento")).toHaveText("Ya hay un proveedor con ese CUIT (30-71234567-1).");
    await expect(modal(page)).toHaveCount(1);
    await expect(guardar(page)).toBeEnabled();
    await expect(guardar(page)).toHaveText("Guardar");
    await expect(filas(page)).toHaveCount(3);

    await llenar(page, { numero: "20-11111111-2" });
    await guardar(page).click();
    await expect(modal(page)).toHaveCount(0);
    await expect(filas(page)).toHaveCount(4);
  });

  test("también se detecta el repetido escrito con otro formato (sin guiones, con espacios)", async ({ page }) => {
    await abrir(page);
    await intentarGuardar(page, { numero: "30712345671" });
    await expect(errorDe(page, "numero_documento")).toContainText("Ya hay un proveedor con ese CUIT");
    await llenar(page, { numero: "30 71234567 1" });
    await guardar(page).click();
    await expect(errorDe(page, "numero_documento")).toContainText("Ya hay un proveedor con ese CUIT");
  });

  test("el documento de un proveedor oculto también cuenta como repetido", async ({ page }) => {
    await abrir(page);
    await intentarGuardar(page, { numero: "33-71234567-0" }); // Cooperativa La Esperanza (oculta)
    await expect(errorDe(page, "numero_documento")).toHaveText("Ya hay un proveedor con ese CUIT (33-71234567-0).");
  });

  test("el mismo número con otro tipo de documento no se considera repetido", async ({ page }) => {
    await abrir(page);
    await crearProveedor(page, { tipo: "CUIT", numero: "20-12345678-6" }); // es el CUIL de Marta Giménez
    await expect(filas(page)).toHaveCount(4);
  });

  test("un doble clic rápido en Guardar no duplica el proveedor", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("proveedores-nuevo").click();
    await llenar(page, FICHA);
    await page.evaluate(() => {
      const boton = document.querySelector('[data-testid="modal-guardar"]');
      boton.click();
      boton.click();
    });
    await expect(modal(page)).toHaveCount(0);
    await page.waitForTimeout(500);
    await expect(page.getByRole("row", { name: /Distribuidora Norte/ })).toHaveCount(1);
    await expect(filas(page)).toHaveCount(4);
  });

  test("un nombre con HTML se muestra como texto y no se ejecuta", async ({ page }) => {
    await abrir(page);
    const peligroso = '<img src=x onerror="window.__xss=1"><b>negrita</b>';
    await crearProveedor(page, { nombre: peligroso, descripcion: "<script>window.__xss=2</script>" });
    await expect(celda(page, 6, COL.nombre)).toHaveText(peligroso);
    await expect(celda(page, 6, COL.nombre).locator("b, img")).toHaveCount(0);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();

    await page.getByTestId("proveedores-ocultar-6").click();
    await expect(modal(page)).toContainText(peligroso);
    await expect(modal(page).locator("img, b")).toHaveCount(0);
  });

  test("después de guardar, un alta nueva abre vacía", async ({ page }) => {
    await abrir(page);
    await crearProveedor(page, { telefono: "11 4444-5555", descripcion: "algo" });
    await page.getByTestId("proveedores-nuevo").click();
    for (const id of ["nombre", "numero_documento", "telefono", "correo", "descripcion_compra"]) {
      await expect(page.locator(`#${id}`)).toHaveValue("");
    }
    await expect(page.locator("#tipo_documento")).toHaveValue("CUIT");
    await expect(page.locator("#categoria_impositiva")).toHaveValue("");
    await expect(modal(page).locator(".gastos-banner")).toHaveCount(0);
  });
});

test.describe("Proveedores: edición", () => {
  test("abre con todos los datos del proveedor (CUIL, sin teléfono, con correo)", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("proveedores-editar-3").click();
    await expect(modal(page).getByRole("heading", { name: "Editar proveedor" })).toBeVisible();
    await expect(page.locator("#nombre")).toHaveValue("Marta Giménez");
    await expect(page.locator("#tipo_documento")).toHaveValue("CUIL");
    await expect(page.locator("#numero_documento")).toHaveValue("20-12345678-6");
    await expect(page.locator("#categoria_impositiva")).toHaveValue("MONOTRIBUTISTA");
    await expect(page.locator("#telefono")).toHaveValue("");
    await expect(page.locator("#correo")).toHaveValue("marta@correo.com");
    await expect(page.locator("#descripcion_compra")).toHaveValue("Verduras y frutas de estación");
  });

  test("guardar sin cambios deja todo igual y no marca el documento propio como repetido", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("proveedores-editar-1").click();
    await guardar(page).click();
    await expect(toast(page)).toHaveText("Proveedor actualizado");
    await expect(filas(page)).toHaveCount(3);
    await expect(celda(page, 1, COL.documento)).toHaveText(/CUIT\s+30-71234567-1/);
    await expect(celda(page, 1, COL.creadoPor)).toHaveText("admin1");
  });

  test("el aviso por cambiar la categoría aparece al cambiarla y desaparece al volver a la original", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("proveedores-editar-1").click();
    await expect(modal(page).locator(".gastos-banner")).toHaveCount(0);
    await page.locator("#categoria_impositiva").selectOption("EXENTO");
    await expect(modal(page).locator(".gastos-banner")).toHaveText(
      "Cambiar la categoría impositiva afecta cómo se registra el IVA de las próximas reposiciones. Las ya cargadas no cambian.",
    );
    await page.locator("#categoria_impositiva").selectOption("RESPONSABLE_INSCRIPTO");
    await expect(modal(page).locator(".gastos-banner")).toHaveCount(0);
  });

  test("el aviso no aparece si lo que se cambia es otra cosa", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("proveedores-editar-1").click();
    await llenar(page, { nombre: "Otro nombre", telefono: "11 0000-0000" });
    await expect(modal(page).locator(".gastos-banner")).toHaveCount(0);
  });

  test("editar nombre, categoría, teléfono y descripción actualiza la fila y conserva quién lo creó", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("proveedores-editar-2").click();
    await llenar(page, { nombre: "Bebidas Don Raúl SRL", categoria: "MONOTRIBUTISTA", telefono: "11 9999-8888", descripcion: "Bebidas y gaseosas" });
    await guardar(page).click();
    await expect(celda(page, 2, COL.nombre)).toHaveText("Bebidas Don Raúl SRL");
    await expect(celda(page, 2, COL.categoria)).toHaveText("Monotributista");
    await expect(celda(page, 2, COL.telefono)).toHaveText("11 9999-8888");
    await expect(celda(page, 2, COL.descripcion)).toHaveText("Bebidas y gaseosas");
    await expect(celda(page, 2, COL.creadoPor)).toHaveText("admin1");
    await expect(filas(page)).toHaveCount(3);
  });

  test("vaciar el teléfono y la descripción los deja en '—'", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("proveedores-editar-1").click();
    await llenar(page, { telefono: "", descripcion: "" });
    await guardar(page).click();
    await expect(celda(page, 1, COL.telefono)).toHaveText("—");
    await expect(celda(page, 1, COL.descripcion)).toHaveText("—");
  });

  test("agregar un teléfono a quien no lo tenía", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("proveedores-editar-3").click();
    await llenar(page, { telefono: "11 2222-3333" });
    await guardar(page).click();
    await expect(celda(page, 3, COL.telefono)).toHaveText("11 2222-3333");
  });

  test("cambiar el documento a uno de otro proveedor avisa y no modifica nada", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("proveedores-editar-2").click();
    await llenar(page, { numero: "30-71234567-1" });
    await guardar(page).click();
    await expect(errorDe(page, "numero_documento")).toHaveText("Ya hay un proveedor con ese CUIT (30-71234567-1).");
    await expect(modal(page)).toHaveCount(1);
    await expect(guardar(page)).toBeEnabled();
    await page.getByTestId("modal-cancelar").click();
    await expect(celda(page, 2, COL.documento)).toHaveText(/30-50000173-5/);
  });

  test("cambiar el tipo a DNI vuelve a validar el número", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("proveedores-editar-1").click();
    await page.locator("#tipo_documento").selectOption("DNI");
    await guardar(page).click();
    await expect(errorDe(page, "numero_documento")).toHaveText("El DNI debe tener 7 u 8 números.");
  });

  test("editar con datos inválidos muestra los errores y no modifica", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("proveedores-editar-1").click();
    await llenar(page, { nombre: "", numero: "123", categoria: "" });
    await guardar(page).click();
    await expect(errorDe(page, "nombre")).toHaveText("Rellene el nombre o razón social.");
    await expect(errorDe(page, "numero_documento")).toBeVisible();
    await expect(errorDe(page, "categoria_impositiva")).toHaveText("Elija la categoría impositiva.");
    await page.getByTestId("modal-cancelar").click();
    await expect(celda(page, 1, COL.nombre)).toHaveText("Envases del Sur S.A.");
  });

  test("cancelar la edición no guarda los cambios", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("proveedores-editar-1").click();
    await llenar(page, { nombre: "Cambiado" });
    await page.getByTestId("modal-cancelar").click();
    await expect(celda(page, 1, COL.nombre)).toHaveText("Envases del Sur S.A.");
  });

  test("editar un proveedor recién creado funciona igual", async ({ page }) => {
    await abrir(page);
    await crearProveedor(page);
    await page.getByTestId("proveedores-editar-6").click();
    await expect(page.locator("#nombre")).toHaveValue("Distribuidora Norte");
    await llenar(page, { nombre: "Distribuidora Sur" });
    await guardar(page).click();
    await expect(celda(page, 6, COL.nombre)).toHaveText("Distribuidora Sur");
  });
});

test.describe("Proveedores: ocultar, restaurar y eliminar", () => {
  test("el diálogo de ocultar nombra al proveedor y explica qué pasa", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("proveedores-ocultar-3").click();
    await expect(modal(page)).toContainText('¿Ocultar a "Marta Giménez"?');
    await expect(modal(page)).toContainText("Deja de verse en el listado y no se ofrece en las reposiciones nuevas. Sus datos y su historial se conservan.");
  });

  test("Escape no oculta", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("proveedores-ocultar-3").click();
    await page.keyboard.press("Escape");
    await expect(modal(page)).toHaveCount(0);
    await expect(page.getByTestId("proveedores-fila-3")).toBeVisible();
  });

  test("ocultar avisa, saca al proveedor de la lista y lo pasa a 'Ver ocultos'", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("proveedores-ocultar-3").click();
    await page.getByTestId("modal-confirmar").click();
    await expect(toast(page)).toHaveText('"Marta Giménez" ahora está oculto');
    await expect(filas(page)).toHaveCount(2);
    await page.getByTestId("proveedores-ver-ocultos").click();
    await expect(filas(page)).toHaveCount(3);
    await expect(page.getByTestId("proveedores-fila-3")).toBeVisible();
  });

  test("el botón 'Ver ocultos' se marca como activo y alterna entre las dos listas", async ({ page }) => {
    await abrir(page);
    const chip = page.getByTestId("proveedores-ver-ocultos");
    await expect(chip).not.toHaveClass(/activo/);
    await chip.click();
    await expect(chip).toHaveClass(/activo/);
    await expect(filas(page)).toHaveCount(2);
    await expect(page.getByTestId("proveedores-fila-1")).toHaveCount(0);
    await chip.click();
    await expect(chip).not.toHaveClass(/activo/);
    await expect(filas(page)).toHaveCount(3);
  });

  test("en 'Ver ocultos' las filas tienen Restaurar y Eliminar, y no Editar", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("proveedores-ver-ocultos").click();
    for (const id of [4, 5]) {
      await expect(page.getByTestId(`proveedores-ocultar-${id}`)).toHaveAccessibleName("Restaurar");
      await expect(page.getByTestId(`proveedores-editar-${id}`)).toHaveCount(0);
    }
  });

  test("restaurar avisa y devuelve al proveedor a la lista principal", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("proveedores-ver-ocultos").click();
    await page.getByTestId("proveedores-ocultar-4").click(); // Restaurar
    await expect(toast(page)).toHaveText('"Cooperativa La Esperanza" se restauró');
    await expect(page.getByTestId("proveedores-fila-4")).toHaveCount(0);
    await page.getByTestId("proveedores-ver-ocultos").click();
    await expect(filas(page)).toHaveCount(4);
    await expect(page.getByTestId("proveedores-editar-4")).toBeVisible();
  });

  test("ocultar y restaurar conserva los datos del proveedor", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("proveedores-ocultar-1").click();
    await page.getByTestId("modal-confirmar").click();
    await page.getByTestId("proveedores-ver-ocultos").click();
    await page.getByTestId("proveedores-ocultar-1").click(); // Restaurar
    await page.getByTestId("proveedores-ver-ocultos").click();
    await expect(celda(page, 1, COL.nombre)).toHaveText("Envases del Sur S.A.");
    await expect(celda(page, 1, COL.documento)).toHaveText(/30-71234567-1/);
    await expect(celda(page, 1, COL.creadoPor)).toHaveText("admin1");
  });

  test("si se ocultan todos, la lista dice que todavía no hay proveedores", async ({ page }) => {
    await abrir(page);
    for (const id of [1, 2, 3]) {
      await page.getByTestId(`proveedores-ocultar-${id}`).click();
      await page.getByTestId("modal-confirmar").click();
      await expect(page.getByTestId(`proveedores-fila-${id}`)).toHaveCount(0);
    }
    await expect(page.getByTestId("proveedores-vacio")).toHaveText("Todavía no hay proveedores");
    await page.getByTestId("proveedores-ver-ocultos").click();
    await expect(filas(page)).toHaveCount(5);
  });

  test("si no hay ocultos, 'Ver ocultos' dice que no hay proveedores ocultos", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("proveedores-ver-ocultos").click();
    for (const id of [4, 5]) await page.getByTestId(`proveedores-ocultar-${id}`).click();
    await expect(page.getByTestId("proveedores-vacio")).toHaveText("No hay proveedores ocultos");
  });

  test("con movimientos, Eliminar queda deshabilitado, explica por qué y no abre nada", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("proveedores-ver-ocultos").click();
    const boton = page.getByTestId("proveedores-eliminar-5");
    await expect(boton).toBeDisabled();
    await expect(boton).toHaveAttribute("title", "Eliminar: Tiene reposiciones o insumos asociados: solo se puede ocultar.");
    await boton.click({ force: true });
    await expect(modal(page)).toHaveCount(0);
    await expect(filas(page)).toHaveCount(2);
  });

  test("el diálogo de eliminar nombra al proveedor y avisa que no se puede deshacer", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("proveedores-ver-ocultos").click();
    await page.getByTestId("proveedores-eliminar-4").click();
    await expect(modal(page)).toContainText('¿Eliminar a "Cooperativa La Esperanza" definitivamente?');
    await expect(modal(page)).toContainText("Se borra del sistema. No tiene reposiciones ni insumos asociados.");
    await expect(modal(page)).toContainText("Esta acción no se puede deshacer.");
  });

  test("Escape y la cruz no eliminan", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("proveedores-ver-ocultos").click();
    await page.getByTestId("proveedores-eliminar-4").click();
    await page.keyboard.press("Escape");
    await expect(modal(page)).toHaveCount(0);
    await page.getByTestId("proveedores-eliminar-4").click();
    await modal(page).getByRole("button", { name: "Cerrar", exact: true }).click();
    await expect(page.getByTestId("proveedores-fila-4")).toBeVisible();
  });

  test("eliminar avisa, borra la fila y libera el documento para volver a usarlo", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("proveedores-ver-ocultos").click();
    await page.getByTestId("proveedores-eliminar-4").click();
    await page.getByTestId("modal-confirmar").click();
    await expect(toast(page)).toHaveText('"Cooperativa La Esperanza" se eliminó');
    await expect(page.getByTestId("proveedores-fila-4")).toHaveCount(0);

    await page.getByTestId("proveedores-ver-ocultos").click();
    await crearProveedor(page, { numero: "33-71234567-0" }); // el documento del eliminado ya no está repetido
    await expect(filas(page)).toHaveCount(4);
  });

  test("un proveedor nuevo se puede ocultar y después eliminar (no tiene movimientos)", async ({ page }) => {
    await abrir(page);
    await crearProveedor(page);
    await page.getByTestId("proveedores-ocultar-6").click();
    await page.getByTestId("modal-confirmar").click();
    await page.getByTestId("proveedores-ver-ocultos").click();
    await expect(page.getByTestId("proveedores-eliminar-6")).toBeEnabled();
    await page.getByTestId("proveedores-eliminar-6").click();
    await page.getByTestId("modal-confirmar").click();
    await expect(page.getByTestId("proveedores-fila-6")).toHaveCount(0);
    await expect(filas(page)).toHaveCount(2);
  });
});

test.describe("Proveedores: búsqueda", () => {
  test("busca por nombre sin distinguir mayúsculas, tildes ni espacios de los costados", async ({ page }) => {
    await abrir(page);
    const buscador = page.getByTestId("proveedores-buscador");
    await buscador.fill("  ENVASES  ");
    await expect(filas(page)).toHaveCount(1);
    await buscador.fill("raul");
    await expect(page.getByTestId("proveedores-fila-2")).toBeVisible();
    await buscador.fill("GIMENEZ");
    await expect(page.getByTestId("proveedores-fila-3")).toBeVisible();
    await buscador.fill("Giménez");
    await expect(page.getByTestId("proveedores-fila-3")).toBeVisible();
  });

  test("busca por documento con guiones, sin guiones y parcial", async ({ page }) => {
    await abrir(page);
    const buscador = page.getByTestId("proveedores-buscador");
    await buscador.fill("30712345671");
    await expect(filas(page)).toHaveCount(1);
    await buscador.fill("30-71234567-1");
    await expect(page.getByTestId("proveedores-fila-1")).toBeVisible();
    await buscador.fill("5000017");
    await expect(page.getByTestId("proveedores-fila-2")).toBeVisible();
  });

  test("busca por teléfono, correo y descripción", async ({ page }) => {
    await abrir(page);
    const buscador = page.getByTestId("proveedores-buscador");
    await buscador.fill("4444-5555");
    await expect(page.getByTestId("proveedores-fila-1")).toBeVisible();
    await expect(filas(page)).toHaveCount(1);
    await buscador.fill("marta@correo");
    await expect(page.getByTestId("proveedores-fila-3")).toBeVisible();
    await buscador.fill("verduras");
    await expect(page.getByTestId("proveedores-fila-3")).toBeVisible();
  });

  test("sin coincidencias dice 'Sin resultados' y al borrar el texto vuelve la lista", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("proveedores-buscador").fill("zzz");
    await expect(page.getByTestId("proveedores-vacio")).toHaveText("Sin resultados");
    await page.getByTestId("proveedores-buscador").fill("");
    await expect(filas(page)).toHaveCount(3);
  });

  test("un texto con letras y un número no trae resultados por culpa del número", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("proveedores-buscador").fill("zzz1");
    await expect(page.getByTestId("proveedores-vacio")).toHaveText("Sin resultados");
  });

  test("los símbolos raros no rompen la pantalla", async ({ page }) => {
    await abrir(page);
    const errores = [];
    page.on("pageerror", (e) => errores.push(e.message));
    for (const texto of ["(", "[", "*", ".*", "\\", "<script>", "%", "'"]) {
      await page.getByTestId("proveedores-buscador").fill(texto);
      await expect(page.getByTestId("proveedores-vacio")).toHaveText("Sin resultados");
    }
    await page.getByTestId("proveedores-buscador").fill("");
    await expect(filas(page)).toHaveCount(3);
    expect(errores).toEqual([]);
  });

  test("la búsqueda respeta la vista: los visibles y los ocultos se buscan por separado", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("proveedores-buscador").fill("librería");
    await expect(page.getByTestId("proveedores-vacio")).toHaveText("Sin resultados"); // está oculta
    await page.getByTestId("proveedores-ver-ocultos").click();
    await expect(filas(page)).toHaveCount(1);
    await expect(page.getByTestId("proveedores-fila-5")).toBeVisible();
    await page.getByTestId("proveedores-ver-ocultos").click();
    await expect(page.getByTestId("proveedores-vacio")).toHaveText("Sin resultados");
  });

  test("la lista se actualiza sola cuando se crea un proveedor que coincide con la búsqueda", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("proveedores-buscador").fill("distribuidora");
    await expect(page.getByTestId("proveedores-vacio")).toHaveText("Sin resultados");
    await crearProveedor(page);
    await expect(filas(page)).toHaveCount(1);
    await expect(page.getByRole("row", { name: /Distribuidora Norte/ })).toBeVisible();
  });
});

test.describe("Proveedores: acceso", () => {
  test("el Propietario también entra y ve el link en el menú lateral", async ({ page }) => {
    await abrir(page, "PROPIETARIO");
    await expect(filas(page)).toHaveCount(3);
    await expect(page.locator('a[href="proveedores.html"]').first()).toBeVisible();
  });

  test("sin sesión iniciada manda al login", async ({ page }) => {
    await page.goto("/proveedores.html");
    await expect(page).toHaveURL(/login\.html$/);
  });

  test("un rol desconocido no entra", async ({ page }) => {
    await abrir(page, "VISITANTE");
    await expect(page).not.toHaveURL(/proveedores\.html/);
  });

  test("el formulario es un diálogo con nombre accesible", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("proveedores-editar-1").click();
    await expect(page.getByRole("dialog", { name: "Editar proveedor" })).toBeVisible();
  });

  test("usar la pantalla de punta a punta no produce errores de JavaScript", async ({ page }) => {
    const errores = [];
    page.on("pageerror", (e) => errores.push(e.message));
    await abrir(page);
    await crearProveedor(page);
    await page.getByTestId("proveedores-editar-6").click();
    await guardar(page).click();
    await page.getByTestId("proveedores-ocultar-6").click();
    await page.getByTestId("modal-confirmar").click();
    await page.getByTestId("proveedores-ver-ocultos").click();
    await page.getByTestId("proveedores-eliminar-6").click();
    await page.getByTestId("modal-confirmar").click();
    await page.getByTestId("proveedores-buscador").fill("envases");
    expect(errores).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Mejoras: CUIL solo con prefijos de persona, correo más estricto y con largo máximo,
// búsqueda de teléfono sin separadores y Enter para guardar.
// ---------------------------------------------------------------------------

test.describe("Proveedores: documento y correo más estrictos", () => {
  for (const prefijo of ["30", "33", "34"]) {
    test(`un CUIL con prefijo de empresa (${prefijo}) se rechaza`, async ({ page }) => {
      await abrir(page);
      await intentarGuardar(page, { tipo: "CUIL", numero: `${prefijo}-71234567-1` });
      await expect(errorDe(page, "numero_documento")).toHaveText("El CUIL no es válido: el prefijo debe ser 20, 23, 24 o 27.");
      await expect(filas(page)).toHaveCount(3);
    });
  }

  test("el prefijo 30 sí vale como CUIT", async ({ page }) => {
    await abrir(page);
    await crearProveedor(page, { tipo: "CUIT", numero: "30-70000002-4" });
    await expect(filas(page)).toHaveCount(4);
    await expect(celda(page, 6, COL.documento)).toHaveText(/CUIT\s+30-70000002-4/);
  });

  for (const correo of ["a@b..com", "a..b@c.com", ".a@b.com", "a.@b.com", "a@.b.com", "a@b.com."]) {
    test(`el correo «${correo}» se rechaza`, async ({ page }) => {
      await abrir(page);
      await intentarGuardar(page, { correo });
      await expect(errorDe(page, "correo")).toHaveText("El correo no es válido.");
      await expect(filas(page)).toHaveCount(3);
    });
  }

  test("el correo admite hasta 120 caracteres: el campo no deja escribir más", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("proveedores-nuevo").click();
    await expect(page.locator("#correo")).toHaveAttribute("maxlength", "120");
    await page.locator("#correo").click();
    await page.keyboard.insertText("a".repeat(170));
    expect((await page.locator("#correo").inputValue()).length).toBe(120);
  });

  test("un correo con puntos en el medio sigue siendo válido", async ({ page }) => {
    await abrir(page);
    await crearProveedor(page, { correo: "nombre.apellido@mail.empresa.com.ar" });
    await expect(filas(page)).toHaveCount(4);
  });
});

test.describe("Proveedores: búsqueda de teléfono", () => {
  test("encuentra el teléfono escrito sin espacios ni guiones", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("proveedores-buscador").fill("114444");
    await expect(filas(page)).toHaveCount(1);
    await expect(page.getByTestId("proveedores-fila-1")).toBeVisible();
    await page.getByTestId("proveedores-buscador").fill("1155556666");
    await expect(page.getByTestId("proveedores-fila-2")).toBeVisible();
    await page.getByTestId("proveedores-buscador").fill("(11) 5555-6666");
    await expect(page.getByTestId("proveedores-fila-2")).toBeVisible();
  });

  test("buscar un documento con guiones sigue funcionando", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("proveedores-buscador").fill("20-12345678-6");
    await expect(filas(page)).toHaveCount(1);
    await expect(page.getByTestId("proveedores-fila-3")).toBeVisible();
  });
});

test.describe("Proveedores: Enter guarda el formulario", () => {
  for (const campo of ["nombre", "numero_documento", "telefono", "correo"]) {
    test(`Enter en el campo ${campo} guarda el proveedor`, async ({ page }) => {
      await abrir(page);
      await page.getByTestId("proveedores-nuevo").click();
      await llenar(page, FICHA);
      await page.locator(`#${campo}`).press("Enter");
      await expect(modal(page)).toHaveCount(0);
      await expect(filas(page)).toHaveCount(4);
      await expect(toast(page)).toHaveText("Proveedor registrado");
    });
  }

  test("Enter en la descripción (texto largo) hace un salto de línea y no guarda", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("proveedores-nuevo").click();
    await llenar(page, { ...FICHA, descripcion: "línea 1" });
    await page.locator("#descripcion_compra").press("Enter");
    await page.keyboard.type("línea 2");
    await expect(modal(page)).toHaveCount(1);
    await expect(page.locator("#descripcion_compra")).toHaveValue("línea 1\nlínea 2");
    await expect(filas(page)).toHaveCount(3);
  });

  test("Enter con datos inválidos muestra los errores y no guarda", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("proveedores-nuevo").click();
    await page.locator("#nombre").press("Enter");
    await expect(errorDe(page, "nombre")).toHaveText("Rellene el nombre o razón social.");
    await expect(errorDe(page, "numero_documento")).toBeVisible();
    await expect(modal(page)).toHaveCount(1);
    await expect(filas(page)).toHaveCount(3);
  });

  test("Enter repetido no duplica el proveedor", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("proveedores-nuevo").click();
    await llenar(page, FICHA);
    await page.evaluate(() => {
      const campo = document.querySelector("#nombre");
      for (let i = 0; i < 2; i++) campo.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });
    await expect(modal(page)).toHaveCount(0);
    await page.waitForTimeout(500);
    await expect(page.getByRole("row", { name: /Distribuidora Norte/ })).toHaveCount(1);
  });

  test("Enter también guarda al editar", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("proveedores-editar-2").click();
    await llenar(page, { nombre: "Bebidas con Enter" });
    await page.locator("#nombre").press("Enter");
    await expect(celda(page, 2, COL.nombre)).toHaveText("Bebidas con Enter");
    await expect(toast(page)).toHaveText("Proveedor actualizado");
  });

  test("Enter con un documento repetido muestra el error y deja el formulario abierto", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("proveedores-nuevo").click();
    await llenar(page, { ...FICHA, numero: "30-71234567-1" });
    await page.locator("#nombre").press("Enter");
    await expect(errorDe(page, "numero_documento")).toContainText("Ya hay un proveedor con ese CUIT");
    await expect(modal(page)).toHaveCount(1);
  });
});
