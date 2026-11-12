const { test, expect } = require("@playwright/test");
const { iniciarSesionComo } = require("./helpers");
const { simularBackend, respuestaDeError } = require("./backend-falso");

// Pantalla "Mi negocio" (perfil-negocio.html). Backend falso (backend-falso.js): GET y PUT /auth/negocio, con los datos de
// ejemplo de siempre: identificador "kioscochicha", nombre_comercial "Kiosco Chicha", rubro "Kiosco", categoría Monotributista.
//
// Cada test puede armar su caso con `reemplazos`: objetos { semilla(estado), preparar(backend) } que cambian los datos
// de partida o hacen que el backend falle, demore o responda otra cosa. El backend falso registra todo lo que la pantalla
// le envía: `payloads()` devuelve los cuerpos de los PUT.

const PUT_NEGOCIO = "PUT /auth/negocio";
const REGISTRAR_PAYLOADS = {}; // el backend falso siempre registra lo enviado
const conRubro = (rubro) => ({ semilla: (estado) => (estado.negocio.rubro = rubro) });
const sinCategoria = { semilla: (estado) => (estado.negocio.categoria_impositiva = "") };
const sinFechaDeRegistro = { semilla: (estado) => (estado.negocio.fecha_registro = null) };
const conDemora = { preparar: (backend) => backend.demorar(PUT_NEGOCIO, 600) };
const conErroresDeCampo = (errores, { veces = Infinity } = {}) => ({
  preparar: (backend) => backend.fallar(PUT_NEGOCIO, respuestaDeError(400, Object.values(errores)[0], errores), { veces }),
});
const conErrorDeCampo = (campo, mensaje, opciones) => conErroresDeCampo({ [campo]: mensaje }, opciones);
const conError = (mensaje, status = 500) => ({ preparar: (backend) => backend.fallar(PUT_NEGOCIO, respuestaDeError(status, mensaje)) });
const sinConexion = { preparar: (backend) => backend.fallar(PUT_NEGOCIO, { abortar: true }) };

let backend;
const abrir = async (page, { rol = "PROPIETARIO", reemplazos = [] } = {}) => {
  backend = await simularBackend(page, { rol, semilla: (estado) => reemplazos.forEach((r) => r.semilla?.(estado)) });
  reemplazos.forEach((r) => r.preparar?.(backend));
  await iniciarSesionComo(page, rol);
  await page.goto("/perfil-negocio.html");
};

const payloads = async () => backend.enviados("PUT", "/auth/negocio");
const guardar = (page) => page.getByTestId("negocio-guardar");
const toast = (page) => page.locator(".gastos-toast");
const modal = (page) => page.getByTestId("modal");
const aviso = (page) => page.getByTestId("negocio-aviso-categoria");
const errorDe = (page, campo) => page.locator(`#error-${campo}`);

const AVISO_NEUTRO = "Si cambiás la categoría impositiva, el cambio solo afecta las operaciones futuras, no las ya confirmadas.";
const AVISO_CAMBIO = "Vas a cambiar la categoría impositiva. El cambio solo afecta las operaciones futuras, no las ya confirmadas.";

test.describe("Mi negocio: pantalla", () => {
  test("muestra el título, los campos con sus etiquetas y el botón de guardar", async ({ page }) => {
    await abrir(page);
    await expect(page.getByRole("heading", { name: "Mi negocio", level: 1 })).toBeVisible();
    await expect(page.locator('label[for="identificador"]')).toContainText("Identificador del negocio");
    await expect(page.locator('label[for="nombre_comercial"]')).toHaveText("Nombre o razón social *");
    await expect(page.locator('label[for="rubro"]')).toHaveText("Rubro");
    await expect(page.locator('label[for="categoria_impositiva"]')).toHaveText("Categoría impositiva *");
    await expect(guardar(page)).toHaveText("Guardar cambios");
  });

  test("muestra los datos guardados", async ({ page }) => {
    await abrir(page);
    await expect(page.locator("#identificador")).toHaveValue("kioscochicha");
    await expect(page.locator("#nombre_comercial")).toHaveValue("Kiosco Chicha");
    await expect(page.locator("#rubro")).toHaveValue("Kiosco");
    await expect(page.locator("#categoria_impositiva")).toHaveValue("MONOTRIBUTISTA");
    await expect(page.locator("#rubro_otro")).toBeHidden();
  });

  test("el identificador es de solo lectura, con candado y la ayuda de que no se puede cambiar", async ({ page }) => {
    await abrir(page);
    const campo = page.locator("#identificador");
    await expect(campo).toHaveAttribute("readonly", "");
    await expect(campo).toHaveClass(/cfg-solo-lectura/);
    await expect(page.locator('label[for="identificador"] .cfg-candado svg')).toBeVisible();
    await expect(page.getByText("Es único y no se puede cambiar.")).toBeVisible();
    await campo.click();
    await page.keyboard.type("otro");
    await expect(campo).toHaveValue("kioscochicha");
  });

  test("las opciones de categoría y de rubro son las esperadas", async ({ page }) => {
    await abrir(page);
    await expect(page.locator("#categoria_impositiva option")).toHaveText(["Elegir…", "Responsable Inscripto", "Monotributista", "Exento"]);
    await expect(page.locator("#rubro option")).toHaveText([
      "Sin especificar",
      "Gastronomía",
      "Indumentaria",
      "Tecnología",
      "Kiosco",
      "Almacén",
      "Librería",
      "Otro (escribirlo)",
    ]);
  });

  test("el menú lateral tiene 'Mi negocio'", async ({ page }) => {
    await abrir(page);
    await expect(page.getByTestId("menu-negocio")).toBeVisible();
    await expect(page.getByTestId("menu-negocio")).toContainText("Mi negocio");
  });

  test("el nombre admite 100 caracteres y el rubro propio 50: los campos no dejan escribir más", async ({ page }) => {
    await abrir(page);
    await page.locator("#rubro").selectOption("__otro");
    for (const [id, max] of [["nombre_comercial", 100], ["rubro_otro", 50]]) {
      await expect(page.locator(`#${id}`)).toHaveAttribute("maxlength", String(max));
      await page.locator(`#${id}`).fill("");
      await page.locator(`#${id}`).click();
      await page.keyboard.insertText("a".repeat(max + 40));
      expect((await page.locator(`#${id}`).inputValue()).length).toBe(max);
    }
  });

  test("con el nombre más largo no aparece scroll horizontal", async ({ page }) => {
    await abrir(page);
    await page.locator("#nombre_comercial").fill("N".repeat(100));
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  });
});

test.describe("Mi negocio: rubro", () => {
  test("'Otro (escribirlo)' muestra el campo para escribir el rubro y al elegir otro lo oculta", async ({ page }) => {
    await abrir(page);
    await expect(page.locator("#rubro_otro")).toBeHidden();
    await page.locator("#rubro").selectOption("__otro");
    await expect(page.locator("#rubro_otro")).toBeVisible();
    await expect(page.locator('label[for="rubro_otro"]')).toHaveText("Escribí tu rubro");
    await page.locator("#rubro").selectOption("Almacén");
    await expect(page.locator("#rubro_otro")).toBeHidden();
  });

  test("un rubro que no está en la lista se carga en 'Otro' con su texto", async ({ page }) => {
    await abrir(page, { reemplazos: [conRubro("Pesquería")] });
    await expect(page.locator("#rubro")).toHaveValue("__otro");
    await expect(page.locator("#rubro_otro")).toBeVisible();
    await expect(page.locator("#rubro_otro")).toHaveValue("Pesquería");
  });

  test("un negocio sin rubro carga 'Sin especificar'", async ({ page }) => {
    await abrir(page, { reemplazos: [conRubro(null)] });
    await expect(page.locator("#rubro")).toHaveValue("");
    await expect(page.locator("#rubro_otro")).toBeHidden();
  });

  test("se puede elegir cualquier rubro de la lista y se envía tal cual", async ({ page }) => {
    await abrir(page, { reemplazos: [REGISTRAR_PAYLOADS] });
    for (const rubro of ["Gastronomía", "Indumentaria", "Tecnología", "Almacén", "Librería"]) {
      await page.locator("#rubro").selectOption(rubro);
      await guardar(page).click();
      await expect(toast(page)).toHaveText("Datos del negocio actualizados");
    }
    expect((await payloads()).map((p) => p.rubro)).toEqual(["Gastronomía", "Indumentaria", "Tecnología", "Almacén", "Librería"]);
  });

  test("'Sin especificar' envía el rubro como texto vacío (el Backend ignora un null) y queda sin rubro", async ({ page }) => {
    await abrir(page, { reemplazos: [REGISTRAR_PAYLOADS] });
    await page.locator("#rubro").selectOption("");
    await guardar(page).click();
    await expect(toast(page)).toHaveText("Datos del negocio actualizados");
    expect((await payloads())[0].rubro).toBe("");
    await expect(page.locator("#rubro")).toHaveValue("");
    expect(backend.estado.negocio.rubro).toBe("");
  });

  test("un rubro propio se envía recortado", async ({ page }) => {
    await abrir(page, { reemplazos: [REGISTRAR_PAYLOADS] });
    await page.locator("#rubro").selectOption("__otro");
    await page.locator("#rubro_otro").fill("   Pesquería   ");
    await guardar(page).click();
    await expect(toast(page)).toHaveText("Datos del negocio actualizados");
    expect((await payloads())[0].rubro).toBe("Pesquería");
  });

  test("al volver de 'Otro' a un rubro de la lista se envía el de la lista, no el texto escrito", async ({ page }) => {
    await abrir(page, { reemplazos: [REGISTRAR_PAYLOADS] });
    await page.locator("#rubro").selectOption("__otro");
    await page.locator("#rubro_otro").fill("Pesquería");
    await page.locator("#rubro").selectOption("Librería");
    await guardar(page).click();
    await expect(toast(page)).toHaveText("Datos del negocio actualizados");
    expect((await payloads())[0].rubro).toBe("Librería");
  });

  test("un rubro propio ya guardado se mantiene al guardar sin tocarlo", async ({ page }) => {
    await abrir(page, { reemplazos: [conRubro("Pesquería"), REGISTRAR_PAYLOADS] });
    await guardar(page).click();
    await expect(toast(page)).toHaveText("Datos del negocio actualizados");
    expect((await payloads())[0].rubro).toBe("Pesquería");
  });
});

test.describe("Mi negocio: validaciones", () => {
  test("un nombre vacío se rechaza, no pide confirmación y no guarda", async ({ page }) => {
    await abrir(page, { reemplazos: [REGISTRAR_PAYLOADS] });
    await page.locator("#nombre_comercial").fill("");
    await guardar(page).click();
    await expect(errorDe(page, "nombre_comercial")).toHaveText("Rellene el nombre o razón social.");
    await expect(page.locator("#nombre_comercial")).toHaveClass(/con-error/);
    await expect(modal(page)).toHaveCount(0);
    await expect(toast(page)).toHaveCount(0);
    expect(await payloads()).toEqual([]);
  });

  test("un nombre de solo espacios se rechaza", async ({ page }) => {
    await abrir(page);
    await page.locator("#nombre_comercial").fill("      ");
    await guardar(page).click();
    await expect(errorDe(page, "nombre_comercial")).toHaveText("Rellene el nombre o razón social.");
  });

  test("el error del nombre desaparece al escribir y después se puede guardar", async ({ page }) => {
    await abrir(page);
    await page.locator("#nombre_comercial").fill("");
    await guardar(page).click();
    await expect(errorDe(page, "nombre_comercial")).toBeVisible();
    await page.locator("#nombre_comercial").fill("K");
    await expect(errorDe(page, "nombre_comercial")).toBeHidden();
    await expect(page.locator("#nombre_comercial")).not.toHaveClass(/con-error/);
    await guardar(page).click();
    await expect(toast(page)).toHaveText("Datos del negocio actualizados");
  });

  test("sin categoría guardada, guardar sin elegir una pide la categoría impositiva", async ({ page }) => {
    await abrir(page, { reemplazos: [sinCategoria] });
    await expect(page.locator("#categoria_impositiva")).toHaveValue("");
    await guardar(page).click();
    await expect(errorDe(page, "categoria_impositiva")).toHaveText("Elija la categoría impositiva.");
    await expect(toast(page)).toHaveCount(0);
    await page.locator("#categoria_impositiva").selectOption("EXENTO");
    await expect(errorDe(page, "categoria_impositiva")).toBeHidden();
  });

  test("con el nombre vacío y la categoría cambiada, se avisa del error antes de pedir confirmación", async ({ page }) => {
    await abrir(page);
    await page.locator("#nombre_comercial").fill("");
    await page.locator("#categoria_impositiva").selectOption("RESPONSABLE_INSCRIPTO");
    await guardar(page).click();
    await expect(errorDe(page, "nombre_comercial")).toHaveText("Rellene el nombre o razón social.");
    await expect(modal(page)).toHaveCount(0); // no tiene sentido confirmar un cambio que no se puede guardar
  });

  test("un nombre de 100 caracteres se guarda", async ({ page }) => {
    await abrir(page);
    await page.locator("#nombre_comercial").fill("a".repeat(100));
    await guardar(page).click();
    await expect(toast(page)).toHaveText("Datos del negocio actualizados");
  });
});

test.describe("Mi negocio: guardar", () => {
  test("guardar sin cambios avisa y no pide confirmación", async ({ page }) => {
    await abrir(page, { reemplazos: [REGISTRAR_PAYLOADS] });
    await guardar(page).click();
    await expect(toast(page)).toHaveText("Datos del negocio actualizados");
    await expect(modal(page)).toHaveCount(0);
    expect(await payloads()).toEqual([{ nombre_comercial: "Kiosco Chicha", rubro: "Kiosco", categoria_impositiva: "MONOTRIBUTISTA" }]);
  });

  test("solo se envían nombre, rubro y categoría (nunca el identificador) y el nombre va recortado", async ({ page }) => {
    await abrir(page, { reemplazos: [REGISTRAR_PAYLOADS] });
    await page.locator("#nombre_comercial").fill("   Kiosco Nuevo   ");
    await guardar(page).click();
    await expect(toast(page)).toHaveText("Datos del negocio actualizados");
    const [payload] = await payloads();
    expect(Object.keys(payload).sort()).toEqual(["categoria_impositiva", "nombre_comercial", "rubro"]);
    expect(payload.nombre_comercial).toBe("Kiosco Nuevo");
  });

  test("después de guardar los campos conservan lo escrito y se puede guardar de nuevo", async ({ page }) => {
    await abrir(page, { reemplazos: [REGISTRAR_PAYLOADS] });
    await page.locator("#nombre_comercial").fill("Primero");
    await guardar(page).click();
    await expect(toast(page)).toHaveText("Datos del negocio actualizados");
    await expect(page.locator("#nombre_comercial")).toHaveValue("Primero");
    await page.locator("#nombre_comercial").fill("Segundo");
    await guardar(page).click();
    await expect.poll(async () => (await payloads()).length).toBe(2);
    expect((await payloads()).map((p) => p.nombre_comercial)).toEqual(["Primero", "Segundo"]);
  });

  test("mientras guarda el botón dice 'Guardando…' y queda deshabilitado; después vuelve a la normalidad", async ({ page }) => {
    await abrir(page, { reemplazos: [conDemora] });
    await guardar(page).click();
    await expect(guardar(page)).toBeDisabled();
    await expect(guardar(page)).toHaveText("Guardando…");
    await expect(toast(page)).toHaveText("Datos del negocio actualizados");
    await expect(guardar(page)).toBeEnabled();
    await expect(guardar(page)).toHaveText("Guardar cambios");
  });

  test("un doble clic rápido en Guardar envía los datos una sola vez", async ({ page }) => {
    await abrir(page, { reemplazos: [conDemora] });
    await page.evaluate(() => {
      const boton = document.querySelector('[data-testid="negocio-guardar"]');
      boton.click();
      boton.click();
    });
    await expect(toast(page)).toHaveText("Datos del negocio actualizados");
    await page.waitForTimeout(800);
    expect(await payloads()).toHaveLength(1);
  });

  test("un nombre con HTML se guarda como texto y no se ejecuta", async ({ page }) => {
    await abrir(page, { reemplazos: [REGISTRAR_PAYLOADS] });
    const peligroso = '<img src=x onerror="window.__xss=1">';
    await page.locator("#nombre_comercial").fill(peligroso);
    await guardar(page).click();
    await expect(toast(page)).toHaveText("Datos del negocio actualizados");
    expect((await payloads())[0].nombre_comercial).toBe(peligroso);
    await expect(page.locator("img")).toHaveCount(0);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  });
});

test.describe("Mi negocio: cambio de categoría impositiva", () => {
  test("el aviso cambia al elegir otra categoría y vuelve al original al restaurarla", async ({ page }) => {
    await abrir(page);
    await expect(aviso(page)).toHaveText(AVISO_NEUTRO);
    await page.locator("#categoria_impositiva").selectOption("EXENTO");
    await expect(aviso(page)).toHaveText(AVISO_CAMBIO);
    await page.locator("#categoria_impositiva").selectOption("MONOTRIBUTISTA");
    await expect(aviso(page)).toHaveText(AVISO_NEUTRO);
  });

  test("cambiar otra cosa (nombre o rubro) no activa el aviso de cambio", async ({ page }) => {
    await abrir(page);
    await page.locator("#nombre_comercial").fill("Otro");
    await page.locator("#rubro").selectOption("Almacén");
    await expect(aviso(page)).toHaveText(AVISO_NEUTRO);
  });

  test("al guardar con otra categoría pide confirmar, nombrando de cuál a cuál pasa", async ({ page }) => {
    await abrir(page);
    await page.locator("#categoria_impositiva").selectOption("EXENTO");
    await guardar(page).click();
    await expect(modal(page).getByRole("heading", { name: "Cambiar la categoría impositiva" })).toBeVisible();
    await expect(modal(page)).toContainText("Pasás de Monotributista a Exento.");
    await expect(modal(page)).toContainText("El cambio solo afecta las operaciones futuras, no las ya confirmadas.");
    await expect(page.getByTestId("modal-confirmar")).toHaveText("Confirmar cambio");
    await expect(page.getByTestId("modal-cancelar")).toHaveText("Cancelar");
  });

  test("cancelar no guarda nada y conserva lo escrito y el aviso", async ({ page }) => {
    await abrir(page, { reemplazos: [REGISTRAR_PAYLOADS] });
    await page.locator("#nombre_comercial").fill("Con cambios");
    await page.locator("#categoria_impositiva").selectOption("EXENTO");
    await guardar(page).click();
    await page.getByTestId("modal-cancelar").click();
    await expect(modal(page)).toHaveCount(0);
    await expect(toast(page)).toHaveCount(0);
    expect(await payloads()).toEqual([]);
    await expect(page.locator("#nombre_comercial")).toHaveValue("Con cambios");
    await expect(page.locator("#categoria_impositiva")).toHaveValue("EXENTO");
    await expect(aviso(page)).toHaveText(AVISO_CAMBIO);
  });

  test("Escape y la cruz también cancelan", async ({ page }) => {
    await abrir(page, { reemplazos: [REGISTRAR_PAYLOADS] });
    await page.locator("#categoria_impositiva").selectOption("EXENTO");
    await guardar(page).click();
    await page.keyboard.press("Escape");
    await expect(modal(page)).toHaveCount(0);
    await guardar(page).click();
    await modal(page).getByRole("button", { name: "Cerrar", exact: true }).click();
    await expect(modal(page)).toHaveCount(0);
    expect(await payloads()).toEqual([]);
  });

  test("confirmar guarda todo junto, avisa y deja el aviso en neutro", async ({ page }) => {
    await abrir(page, { reemplazos: [REGISTRAR_PAYLOADS] });
    await page.locator("#nombre_comercial").fill("Kiosco Exento");
    await page.locator("#categoria_impositiva").selectOption("EXENTO");
    await guardar(page).click();
    await page.getByTestId("modal-confirmar").click();
    await expect(toast(page)).toHaveText("Datos del negocio actualizados");
    expect(await payloads()).toEqual([{ nombre_comercial: "Kiosco Exento", rubro: "Kiosco", categoria_impositiva: "EXENTO" }]);
    await expect(aviso(page)).toHaveText(AVISO_NEUTRO);
  });

  test("después de confirmar, guardar de nuevo ya no pide confirmación", async ({ page }) => {
    await abrir(page);
    await page.locator("#categoria_impositiva").selectOption("EXENTO");
    await guardar(page).click();
    await page.getByTestId("modal-confirmar").click();
    await expect(toast(page)).toHaveText("Datos del negocio actualizados");
    await guardar(page).click();
    await expect(modal(page)).toHaveCount(0);
  });

  test("volver a cambiar la categoría pide confirmar otra vez, desde la nueva", async ({ page }) => {
    await abrir(page);
    await page.locator("#categoria_impositiva").selectOption("RESPONSABLE_INSCRIPTO");
    await guardar(page).click();
    await page.getByTestId("modal-confirmar").click();
    await expect(toast(page)).toHaveText("Datos del negocio actualizados");

    await page.locator("#categoria_impositiva").selectOption("MONOTRIBUTISTA");
    await guardar(page).click();
    await expect(modal(page)).toContainText("Pasás de Responsable Inscripto a Monotributista.");
  });

  test("Enter en el diálogo confirma el cambio (el botón Confirmar tiene el foco)", async ({ page }) => {
    await abrir(page);
    await page.locator("#categoria_impositiva").selectOption("EXENTO");
    await guardar(page).click();
    await page.keyboard.press("Enter");
    await expect(toast(page)).toHaveText("Datos del negocio actualizados");
  });

  for (const [de, a, textoDe, textoA] of [
    ["MONOTRIBUTISTA", "RESPONSABLE_INSCRIPTO", "Monotributista", "Responsable Inscripto"],
    ["MONOTRIBUTISTA", "EXENTO", "Monotributista", "Exento"],
  ]) {
    test(`el diálogo dice «Pasás de ${textoDe} a ${textoA}»`, async ({ page }) => {
      await abrir(page);
      await page.locator("#categoria_impositiva").selectOption(a);
      await guardar(page).click();
      await expect(modal(page)).toContainText(`Pasás de ${textoDe} a ${textoA}.`);
    });
  }
});

test.describe("Mi negocio: errores del servidor", () => {
  test("un error del nombre se muestra junto al campo y el botón vuelve a estar disponible", async ({ page }) => {
    await abrir(page, { reemplazos: [conErrorDeCampo("nombre_comercial", "Ese nombre ya está en uso.")] });
    await guardar(page).click();
    await expect(errorDe(page, "nombre_comercial")).toHaveText("Ese nombre ya está en uso.");
    await expect(toast(page)).toHaveCount(0);
    await expect(guardar(page)).toBeEnabled();
    await expect(guardar(page)).toHaveText("Guardar cambios");
  });

  test("un error de la categoría se muestra junto al campo", async ({ page }) => {
    await abrir(page, { reemplazos: [conErrorDeCampo("categoria_impositiva", "Categoría no permitida.")] });
    await guardar(page).click();
    await expect(errorDe(page, "categoria_impositiva")).toHaveText("Categoría no permitida.");
  });

  test("un error general se avisa con el mensaje que llega", async ({ page }) => {
    await abrir(page, { reemplazos: [conError("El servidor no responde.")] });
    await guardar(page).click();
    await expect(toast(page)).toHaveText("El servidor no responde.");
    await expect(guardar(page)).toBeEnabled();
  });

  test("un error sin mensaje avisa que no se pudo guardar", async ({ page }) => {
    await abrir(page, { reemplazos: [conError(undefined)] });
    await guardar(page).click();
    await expect(toast(page)).toHaveText("No se pudo guardar. Intentá de nuevo.");
  });

  test("si no hay conexión con el servidor lo avisa en español", async ({ page }) => {
    await abrir(page, { reemplazos: [sinConexion] });
    await guardar(page).click();
    await expect(toast(page)).toHaveText("No se pudo conectar con el servidor.");
    await expect(guardar(page)).toBeEnabled();
  });

  test("después de un error se puede corregir y volver a guardar", async ({ page }) => {
    await abrir(page, {
      reemplazos: [conErrorDeCampo("nombre_comercial", "Ese nombre ya está en uso.", { veces: 1 })],
    });
    await guardar(page).click();
    await expect(errorDe(page, "nombre_comercial")).toBeVisible();
    await page.locator("#nombre_comercial").fill("Un nombre distinto");
    await expect(errorDe(page, "nombre_comercial")).toBeHidden();
    await guardar(page).click();
    await expect(toast(page)).toHaveText("Datos del negocio actualizados");
  });

  test("un error al confirmar el cambio de categoría se muestra y no deja nada a medias", async ({ page }) => {
    await abrir(page, { reemplazos: [conError("No se pudo cambiar.")] });
    await page.locator("#categoria_impositiva").selectOption("EXENTO");
    await guardar(page).click();
    await page.getByTestId("modal-confirmar").click();
    await expect(toast(page)).toHaveText("No se pudo cambiar.");
    await expect(aviso(page)).toHaveText(AVISO_CAMBIO); // sigue siendo un cambio pendiente
    await expect(guardar(page)).toBeEnabled();
  });

  test("un error del servidor sobre el rubro se muestra en pantalla", async ({ page }) => {
    await abrir(page, { reemplazos: [conErrorDeCampo("rubro", "Rubro inválido.")] });
    await guardar(page).click();
    await expect(page.locator("#error-rubro, #error-rubro_otro, .gastos-toast").filter({ hasText: "Rubro inválido." })).toBeVisible();
  });
});

test.describe("Mi negocio: acceso", () => {
  for (const rol of ["PROPIETARIO", "ADMIN"]) {
    test(`el rol ${rol} entra a Mi negocio`, async ({ page }) => {
      await abrir(page, { rol });
      await expect(page).toHaveURL(/perfil-negocio\.html$/);
      await expect(page.locator("#nombre_comercial")).toHaveValue("Kiosco Chicha");
    });
  }

  test("el Empleado no entra", async ({ page }) => {
    await abrir(page, { rol: "CAJERO" });
    await expect(page).toHaveURL(/dashboard\.html$/);
  });

  test("sin sesión iniciada manda al login", async ({ page }) => {
    await page.goto("/perfil-negocio.html");
    await expect(page).toHaveURL(/login\.html$/);
  });

  test("un rol desconocido no entra", async ({ page }) => {
    await abrir(page, { rol: "VISITANTE" });
    await expect(page).not.toHaveURL(/perfil-negocio\.html/);
  });

  test("usar la pantalla de punta a punta no produce errores de JavaScript", async ({ page }) => {
    const errores = [];
    page.on("pageerror", (e) => errores.push(e.message));
    await abrir(page);
    await page.locator("#nombre_comercial").fill("");
    await guardar(page).click();
    await page.locator("#nombre_comercial").fill("Kiosco");
    await page.locator("#rubro").selectOption("__otro");
    await page.locator("#rubro_otro").fill("Pesquería");
    await page.locator("#categoria_impositiva").selectOption("EXENTO");
    await guardar(page).click();
    await page.getByTestId("modal-confirmar").click();
    await expect(toast(page)).toHaveText("Datos del negocio actualizados");
    expect(errores).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Mejoras: validar antes de confirmar, errores del servidor en cualquier campo, Enter para guardar,
// foco en el primer error, "Otro" obligatorio y campos que muestran lo realmente guardado.
// ---------------------------------------------------------------------------

test.describe("Mi negocio: validar antes de confirmar", () => {
  test("con el rubro 'Otro' vacío y la categoría cambiada, no se pide confirmación", async ({ page }) => {
    await abrir(page);
    await page.locator("#rubro").selectOption("__otro");
    await page.locator("#categoria_impositiva").selectOption("EXENTO");
    await guardar(page).click();
    await expect(errorDe(page, "rubro_otro")).toBeVisible();
    await expect(modal(page)).toHaveCount(0);
  });

  test("corregido el error, recién ahí pide confirmar el cambio de categoría", async ({ page }) => {
    await abrir(page, { reemplazos: [REGISTRAR_PAYLOADS] });
    await page.locator("#nombre_comercial").fill("");
    await page.locator("#categoria_impositiva").selectOption("EXENTO");
    await guardar(page).click();
    await expect(modal(page)).toHaveCount(0);
    await page.locator("#nombre_comercial").fill("Kiosco corregido");
    await guardar(page).click();
    await expect(modal(page)).toContainText("Pasás de Monotributista a Exento.");
    await page.getByTestId("modal-confirmar").click();
    await expect(toast(page)).toHaveText("Datos del negocio actualizados");
    expect((await payloads())[0]).toMatchObject({ nombre_comercial: "Kiosco corregido", categoria_impositiva: "EXENTO" });
  });
});

test.describe("Mi negocio: rubro 'Otro' obligatorio", () => {
  test("'Otro (escribirlo)' sin escribir nada se rechaza y no guarda", async ({ page }) => {
    await abrir(page, { reemplazos: [REGISTRAR_PAYLOADS] });
    await page.locator("#rubro").selectOption("__otro");
    await guardar(page).click();
    await expect(errorDe(page, "rubro_otro")).toHaveText("Escribí el rubro o elegí uno de la lista.");
    await expect(page.locator("#rubro_otro")).toHaveClass(/con-error/);
    await expect(toast(page)).toHaveCount(0);
    expect(await payloads()).toEqual([]);
  });

  test("con solo espacios también se rechaza", async ({ page }) => {
    await abrir(page);
    await page.locator("#rubro").selectOption("__otro");
    await page.locator("#rubro_otro").fill("     ");
    await guardar(page).click();
    await expect(errorDe(page, "rubro_otro")).toHaveText("Escribí el rubro o elegí uno de la lista.");
  });

  test("el error desaparece al escribir el rubro y entonces se guarda", async ({ page }) => {
    await abrir(page, { reemplazos: [REGISTRAR_PAYLOADS] });
    await page.locator("#rubro").selectOption("__otro");
    await guardar(page).click();
    await expect(errorDe(page, "rubro_otro")).toBeVisible();
    await page.locator("#rubro_otro").fill("Pesquería");
    await expect(errorDe(page, "rubro_otro")).toBeHidden();
    await guardar(page).click();
    await expect(toast(page)).toHaveText("Datos del negocio actualizados");
    expect((await payloads())[0].rubro).toBe("Pesquería");
  });

  test("si se elige otro rubro de la lista el error viejo no queda esperando al volver a 'Otro'", async ({ page }) => {
    await abrir(page);
    await page.locator("#rubro").selectOption("__otro");
    await guardar(page).click();
    await expect(errorDe(page, "rubro_otro")).toBeVisible();
    await page.locator("#rubro").selectOption("Almacén");
    await page.locator("#rubro").selectOption("__otro");
    await expect(errorDe(page, "rubro_otro")).toBeHidden();
  });

  test("elegir 'Sin especificar' sigue siendo válido y no pide escribir nada", async ({ page }) => {
    await abrir(page);
    await page.locator("#rubro").selectOption("");
    await guardar(page).click();
    await expect(toast(page)).toHaveText("Datos del negocio actualizados");
  });

  test("un rubro propio ya guardado, si se borra el texto, se rechaza en vez de perderse", async ({ page }) => {
    await abrir(page, { reemplazos: [conRubro("Pesquería")] });
    await page.locator("#rubro_otro").fill("");
    await guardar(page).click();
    await expect(errorDe(page, "rubro_otro")).toBeVisible();
  });
});

test.describe("Mi negocio: foco en el primer error", () => {
  test("nombre vacío: el foco va al nombre", async ({ page }) => {
    await abrir(page);
    await page.locator("#nombre_comercial").fill("");
    await guardar(page).click();
    await expect(page.locator("#nombre_comercial")).toBeFocused();
  });

  test("rubro 'Otro' vacío: el foco va a 'Escribí tu rubro'", async ({ page }) => {
    await abrir(page);
    await page.locator("#rubro").selectOption("__otro");
    await guardar(page).click();
    await expect(page.locator("#rubro_otro")).toBeFocused();
  });

  test("sin categoría: el foco va a la categoría", async ({ page }) => {
    await abrir(page, { reemplazos: [sinCategoria] });
    await guardar(page).click();
    await expect(page.locator("#categoria_impositiva")).toBeFocused();
  });

  test("con varios errores el foco va al que está más arriba", async ({ page }) => {
    await abrir(page, { reemplazos: [sinCategoria] });
    await page.locator("#rubro").selectOption("__otro");
    await guardar(page).click();
    await expect(errorDe(page, "rubro_otro")).toBeVisible();
    await expect(errorDe(page, "categoria_impositiva")).toBeVisible();
    await expect(page.locator("#rubro_otro")).toBeFocused();
    await page.locator("#nombre_comercial").fill("");
    await guardar(page).click();
    await expect(page.locator("#nombre_comercial")).toBeFocused();
  });
});

test.describe("Mi negocio: Enter guarda", () => {
  test("Enter en el nombre guarda", async ({ page }) => {
    await abrir(page, { reemplazos: [REGISTRAR_PAYLOADS] });
    await page.locator("#nombre_comercial").fill("Con Enter");
    await page.locator("#nombre_comercial").press("Enter");
    await expect(toast(page)).toHaveText("Datos del negocio actualizados");
    expect((await payloads())[0].nombre_comercial).toBe("Con Enter");
  });

  test("Enter en 'Escribí tu rubro' guarda", async ({ page }) => {
    await abrir(page, { reemplazos: [REGISTRAR_PAYLOADS] });
    await page.locator("#rubro").selectOption("__otro");
    await page.locator("#rubro_otro").fill("Pesquería");
    await page.locator("#rubro_otro").press("Enter");
    await expect(toast(page)).toHaveText("Datos del negocio actualizados");
    expect((await payloads())[0].rubro).toBe("Pesquería");
  });

  test("Enter con datos inválidos muestra el error y no guarda", async ({ page }) => {
    await abrir(page, { reemplazos: [REGISTRAR_PAYLOADS] });
    await page.locator("#nombre_comercial").fill("");
    await page.locator("#nombre_comercial").press("Enter");
    await expect(errorDe(page, "nombre_comercial")).toHaveText("Rellene el nombre o razón social.");
    expect(await payloads()).toEqual([]);
  });

  test("Enter con la categoría cambiada pide la confirmación", async ({ page }) => {
    await abrir(page, { reemplazos: [REGISTRAR_PAYLOADS] });
    await page.locator("#categoria_impositiva").selectOption("EXENTO");
    await page.locator("#nombre_comercial").press("Enter");
    await expect(modal(page)).toContainText("Pasás de Monotributista a Exento.");
    expect(await payloads()).toEqual([]);
  });

  test("Enter repetido mientras guarda envía los datos una sola vez", async ({ page }) => {
    await abrir(page, { reemplazos: [conDemora] });
    await page.evaluate(() => {
      const campo = document.querySelector("#nombre_comercial");
      for (let i = 0; i < 3; i++) campo.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });
    await expect(toast(page)).toHaveText("Datos del negocio actualizados");
    await page.waitForTimeout(800);
    expect(await payloads()).toHaveLength(1);
  });
});

test.describe("Mi negocio: los campos muestran lo que quedó guardado", () => {
  test("el nombre se muestra sin los espacios de los costados", async ({ page }) => {
    await abrir(page);
    await page.locator("#nombre_comercial").fill("   Kiosco Nuevo   ");
    await guardar(page).click();
    await expect(toast(page)).toHaveText("Datos del negocio actualizados");
    await expect(page.locator("#nombre_comercial")).toHaveValue("Kiosco Nuevo");
  });

  test("el rubro propio se muestra sin los espacios de los costados", async ({ page }) => {
    await abrir(page);
    await page.locator("#rubro").selectOption("__otro");
    await page.locator("#rubro_otro").fill("   Pesquería   ");
    await guardar(page).click();
    await expect(toast(page)).toHaveText("Datos del negocio actualizados");
    await expect(page.locator("#rubro_otro")).toHaveValue("Pesquería");
  });

  test("si el servidor falla, los campos quedan como el usuario los escribió", async ({ page }) => {
    await abrir(page, { reemplazos: [conError("No se pudo guardar.")] });
    await page.locator("#nombre_comercial").fill("  Sin guardar  ");
    await guardar(page).click();
    await expect(toast(page)).toHaveText("No se pudo guardar.");
    await expect(page.locator("#nombre_comercial")).toHaveValue("  Sin guardar  ");
  });
});

test.describe("Mi negocio: errores del servidor en cualquier campo", () => {
  test("un error del rubro de la lista se muestra junto al desplegable", async ({ page }) => {
    await abrir(page, { reemplazos: [conErrorDeCampo("rubro", "Rubro inválido.")] });
    await guardar(page).click();
    await expect(errorDe(page, "rubro")).toHaveText("Rubro inválido.");
    await expect(toast(page)).toHaveCount(0);
  });

  test("un error del rubro propio se muestra junto al campo de texto", async ({ page }) => {
    await abrir(page, { reemplazos: [conErrorDeCampo("rubro", "Rubro no permitido.")] });
    await page.locator("#rubro").selectOption("__otro");
    await page.locator("#rubro_otro").fill("Algo");
    await guardar(page).click();
    await expect(errorDe(page, "rubro_otro")).toHaveText("Rubro no permitido.");
    await expect(errorDe(page, "rubro")).toBeHidden();
  });

  test("un error de un campo que no está en pantalla (como el identificador) se avisa", async ({ page }) => {
    await abrir(page, { reemplazos: [conErrorDeCampo("identificador", "El identificador no se puede cambiar.")] });
    await guardar(page).click();
    await expect(toast(page)).toHaveText("El identificador no se puede cambiar.");
    await expect(guardar(page)).toBeEnabled();
  });

  test("varios errores a la vez se muestran cada uno en su campo", async ({ page }) => {
    await abrir(page, {
      reemplazos: [conErroresDeCampo({ nombre_comercial: "Nombre repetido.", categoria_impositiva: "Categoría no permitida." })],
    });
    await guardar(page).click();
    await expect(errorDe(page, "nombre_comercial")).toHaveText("Nombre repetido.");
    await expect(errorDe(page, "categoria_impositiva")).toHaveText("Categoría no permitida.");
  });
});

// ---------------------------------------------------------------------------
// fecha_registro de la base: Mi negocio muestra cuándo se registró el negocio (solo lectura).
// ---------------------------------------------------------------------------

test.describe("Mi negocio: fecha de registro", () => {
  test.use({ timezoneId: "America/Argentina/Buenos_Aires" });

  test("muestra cuándo se registró el negocio, debajo del identificador, solo lectura", async ({ page }) => {
    await abrir(page);
    await expect(page.locator('label[for="fecha_registro"]')).toHaveText("Fecha de registro");
    await expect(page.locator("#fecha_registro")).toHaveValue("15-01-2026");
    await expect(page.locator("#fecha_registro")).toHaveAttribute("readonly", "");
    await expect(page.locator("#fecha_registro")).toHaveClass(/cfg-solo-lectura/);
    await expect(page.getByText("Se completa sola al registrar el negocio.")).toBeVisible();
    const campos = await page.locator(".cfg-tarjeta label").allTextContents();
    expect(campos.map((t) => t.trim()).slice(0, 3)).toEqual(["Identificador del negocio", "Fecha de registro", "Nombre o razón social *"]);
  });

  test("al pasar el mouse muestra también la hora", async ({ page }) => {
    await abrir(page);
    await expect(page.locator("#fecha_registro")).toHaveAttribute("title", "Registrado el 15-01-2026 11:00");
  });

  test("no se puede escribir en ese campo", async ({ page }) => {
    await abrir(page);
    await page.locator("#fecha_registro").click();
    await page.keyboard.type("otra cosa");
    await expect(page.locator("#fecha_registro")).toHaveValue("15-01-2026");
  });

  test("al guardar los datos del negocio no se envía y no cambia", async ({ page }) => {
    await abrir(page, { reemplazos: [REGISTRAR_PAYLOADS] });
    await page.locator("#nombre_comercial").fill("Otro nombre");
    await guardar(page).click();
    await expect(toast(page)).toHaveText("Datos del negocio actualizados");
    expect(Object.keys((await payloads())[0]).sort()).toEqual(["categoria_impositiva", "nombre_comercial", "rubro"]);
    await expect(page.locator("#fecha_registro")).toHaveValue("15-01-2026");
  });

  test("si el negocio no trae fecha de registro, el campo no se muestra", async ({ page }) => {
    await abrir(page, { reemplazos: [sinFechaDeRegistro] });
    await expect(page.locator("#fecha_registro")).toHaveCount(0);
    await expect(page.locator("#identificador")).toBeVisible();
  });

  test("el resto de los campos y el guardado siguen funcionando", async ({ page }) => {
    await abrir(page);
    await page.locator("#nombre_comercial").fill("Con fecha de registro");
    await guardar(page).click();
    await expect(toast(page)).toHaveText("Datos del negocio actualizados");
  });
});

test.describe("Mi negocio: conexión con el Backend", () => {
  test("al abrir pide los datos del negocio con el token de la sesión", async ({ page }) => {
    await abrir(page);
    await expect(page.locator("#nombre_comercial")).toHaveValue("Kiosco Chicha");
    const [pedido] = backend.peticiones("GET", "/auth/negocio");
    expect(pedido.headers.authorization).toMatch(/^Bearer .+/);
    expect(backend.peticiones("GET", "/auth/negocio")).toHaveLength(1);
  });

  test("guardar envía solo nombre_comercial, rubro y categoria_impositiva a PUT /auth/negocio", async ({ page }) => {
    await abrir(page);
    await page.locator("#nombre_comercial").fill("Nuevo nombre");
    await guardar(page).click();
    await expect(toast(page)).toHaveText("Datos del negocio actualizados");
    const [pedido] = backend.peticiones("PUT", "/auth/negocio");
    expect(pedido.body).toEqual({ nombre_comercial: "Nuevo nombre", rubro: "Kiosco", categoria_impositiva: "MONOTRIBUTISTA" });
    expect(pedido.headers.authorization).toMatch(/^Bearer .+/);
    expect(pedido.headers["content-type"]).toContain("application/json");
  });

  test("lo guardado se ve al recargar la pantalla", async ({ page }) => {
    await abrir(page);
    await page.locator("#nombre_comercial").fill("Después de recargar");
    await page.locator("#rubro").selectOption("Librería");
    await page.locator("#categoria_impositiva").selectOption("EXENTO");
    await guardar(page).click();
    await page.getByTestId("modal-confirmar").click();
    await expect(toast(page)).toHaveText("Datos del negocio actualizados");
    await page.reload();
    await expect(page.locator("#nombre_comercial")).toHaveValue("Después de recargar");
    await expect(page.locator("#rubro")).toHaveValue("Librería");
    await expect(page.locator("#categoria_impositiva")).toHaveValue("EXENTO");
  });

  test("un rubro propio se guarda, y 'Sin especificar' lo deja vacío también después de recargar", async ({ page }) => {
    await abrir(page);
    await page.locator("#rubro").selectOption("__otro");
    await page.locator("#rubro_otro").fill("Pesquería");
    await guardar(page).click();
    await expect(toast(page)).toHaveText("Datos del negocio actualizados");
    await page.reload();
    await expect(page.locator("#rubro")).toHaveValue("__otro");
    await expect(page.locator("#rubro_otro")).toHaveValue("Pesquería");
    await page.locator("#rubro").selectOption("");
    await guardar(page).click();
    await expect(toast(page)).toHaveText("Datos del negocio actualizados");
    await page.reload();
    await expect(page.locator("#rubro")).toHaveValue("");
  });

  test("la respuesta del PUT no trae la fecha de registro y la pantalla la conserva", async ({ page }) => {
    await abrir(page);
    await guardar(page).click();
    await expect(toast(page)).toHaveText("Datos del negocio actualizados");
    await expect(page.locator("#fecha_registro")).toHaveValue("15-01-2026");
  });

  test("si no hay conexión al abrir, la pantalla lo dice en vez de quedar vacía", async ({ page }) => {
    await simularBackendConFalla(page);
    await expect(page.getByTestId("negocio-error-carga")).toHaveText("No se pudo conectar con el servidor.");
    await expect(page.locator("#nombre_comercial")).toHaveCount(0);
  });

  test("si el Backend responde con un error sin detalle al abrir, se avisa que no se pudieron cargar los datos", async ({ page }) => {
    await simularBackendConFalla(page, respuestaDeError(500));
    await expect(page.getByTestId("negocio-error-carga")).toHaveText("No se pudieron cargar los datos del negocio.");
  });

  test("si el Backend responde con un mensaje de error al abrir, se muestra ese mensaje", async ({ page }) => {
    await simularBackendConFalla(page, respuestaDeError(404, "Emprendimiento no encontrado"));
    await expect(page.getByTestId("negocio-error-carga")).toHaveText("Emprendimiento no encontrado");
  });

  test("un 400 solo con mensaje (sin el campo) se avisa como cartel", async ({ page }) => {
    await abrir(page, { reemplazos: [conError("Categoría impositiva inválida. Debe ser RESPONSABLE_INSCRIPTO, MONOTRIBUTISTA o EXENTO", 400)] });
    await guardar(page).click();
    await expect(toast(page)).toHaveText("Categoría impositiva inválida. Debe ser RESPONSABLE_INSCRIPTO, MONOTRIBUTISTA o EXENTO");
  });
});

// Abre la pantalla con un Backend que falla al cargar los datos del negocio.
const simularBackendConFalla = async (page, respuesta = { abortar: true }) => {
  backend = await simularBackend(page, {});
  backend.fallar("GET /auth/negocio", respuesta);
  await iniciarSesionComo(page, "PROPIETARIO");
  await page.goto("/perfil-negocio.html");
};
