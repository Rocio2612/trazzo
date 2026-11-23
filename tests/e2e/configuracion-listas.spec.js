const { test, expect } = require("@playwright/test");
const { iniciarSesionComo } = require("./helpers");
const { simularBackend, respuestaDeError } = require("./backend-falso");

// Configuración > pestañas Personal / Categorías / Medios de pago, y las listas de Categorías y Medios de pago.
// Backend falso (backend-falso.js), para las dos listas:
//   Categorías: Pantalones (2) y Remeras (1), en ese orden porque el Backend las devuelve ordenadas por nombre.
//   Medios de pago: Efectivo (1, por defecto) y Transferencia (2).
//
// `abrir` recibe `semilla(estado)` y `preparar(backend)` para cambiar los datos del Backend falso o hacerlo fallar o
// demorar.

// Ruta de cada lista en el Backend.
const RUTA_API = { categorias: "/categorias", medios_pago: "/medios-pago" };
// Opciones de `abrir` para que crear tarde medio segundo, en la lista que sea.
const lento = (l) => ({ preparar: (b) => b.demorar(`POST ${RUTA_API[l.tipo]}`, 500) });

let backend;
const abrir = async (page, ruta = "/configuracion.html", { rol = "PROPIETARIO", semilla, preparar } = {}) => {
  backend = await simularBackend(page, { rol, semilla });
  preparar?.(backend);
  await iniciarSesionComo(page, rol);
  await page.goto(ruta);
};

const toast = (page) => page.locator(".gastos-toast");
const modal = (page) => page.getByTestId("modal");
const guardar = (page) => page.getByTestId("modal-guardar");
const items = (page, tipo) => page.getByTestId(`${tipo}-lista`).getByRole("listitem");
const item = (page, tipo, nombre) => items(page, tipo).filter({ hasText: nombre });

const LISTAS = [
  {
    tipo: "categorias",
    maximo: 50,
    pestania: "categorias",
    hash: "#categorias",
    singular: "categoría",
    etiquetaEntrada: "Nombre de la categoría",
    iniciales: ["Pantalones", "Remeras"],
    placeholder: "Ej.: remeras, pantalones",
    aviso: "Estas categorías aparecen como opción (opcional) al crear un producto.",
    repetido: "Ya existe una categoría con ese nombre.",
    tituloEditar: "Editar categoría",
    tituloEliminar: "Eliminar categoría",
    textoEliminar: "Si la categoría tiene productos asociados, sigue apareciendo en lo histórico pero ya no se ofrece para productos nuevos.",
    toastCreado: "Categoría creada",
    eliminable: "Remeras",
    otro: "Pantalones",
  },
  {
    tipo: "medios_pago",
    maximo: 50,
    pestania: "medios-pago",
    hash: "#medios-pago",
    singular: "medio de pago",
    etiquetaEntrada: "Nombre del medio de pago",
    iniciales: ["Efectivo", "Transferencia"],
    placeholder: "Ej.: transferencia, tarjeta de débito",
    aviso: "Estos medios de pago se pueden elegir (opcional) al registrar ventas, pagos y gastos operativos.",
    repetido: "Ya existe un medio de pago con ese nombre.",
    tituloEditar: "Editar medio de pago",
    tituloEliminar: "Eliminar medio de pago",
    textoEliminar: "Si el medio de pago ya se usó en ventas, pagos o gastos, sigue apareciendo en lo histórico pero ya no se ofrece para registros nuevos.",
    toastCreado: "Medio de pago creado",
    eliminable: "Transferencia",
    otro: "Efectivo",
  },
];

test.describe("Configuración: pestañas", () => {
  test("hay tres pestañas y por defecto está activa la de Personal", async ({ page }) => {
    await abrir(page);
    await expect(page.getByRole("tablist", { name: "Secciones de configuración" })).toBeVisible();
    await expect(page.getByRole("tab")).toHaveText(["Personal", "Categorías", "Medios de pago"]);
    await expect(page.getByRole("tab", { name: "Personal" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tab", { name: "Categorías" })).toHaveAttribute("aria-selected", "false");
    await expect(page.getByRole("tab", { name: "Medios de pago" })).toHaveAttribute("aria-selected", "false");
    await expect(page.locator("#panel-personal")).toBeVisible();
    expect(new URL(page.url()).hash).toBe("");
  });

  test("hacer clic en una pestaña la activa, muestra su panel y lo anota en la dirección", async ({ page }) => {
    await abrir(page);
    await page.getByTestId("pestania-categorias").click();
    await expect(page.getByTestId("pestania-categorias")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("pestania-categorias")).toHaveClass(/activa/);
    await expect(page.getByTestId("pestania-personal")).toHaveAttribute("aria-selected", "false");
    await expect(page.locator("#panel-categorias")).toBeVisible();
    await expect(page.locator("#panel-personal")).toHaveCount(0);
    await expect(page).toHaveURL(/#categorias$/);

    await page.getByTestId("pestania-medios-pago").click();
    await expect(page.locator("#panel-medios_pago")).toBeVisible();
    await expect(page.locator("#panel-categorias")).toHaveCount(0);
    await expect(page).toHaveURL(/#medios-pago$/);

    await page.getByTestId("pestania-personal").click();
    await expect(page.locator("#panel-personal")).toBeVisible();
    await expect(page).toHaveURL(/#personal$/);
  });

  for (const [hash, panel] of [["#personal", "#panel-personal"], ["#categorias", "#panel-categorias"], ["#medios-pago", "#panel-medios_pago"]]) {
    test(`la dirección con ${hash} abre directo esa pestaña`, async ({ page }) => {
      await abrir(page, `/configuracion.html${hash}`);
      await expect(page.locator(panel)).toBeVisible();
    });
  }

  test("una dirección con una pestaña que no existe abre Personal", async ({ page }) => {
    await abrir(page, "/configuracion.html#no-existe");
    await expect(page.locator("#panel-personal")).toBeVisible();
    await expect(page.getByRole("tab", { name: "Personal" })).toHaveAttribute("aria-selected", "true");
  });

  test("cambiar la dirección a mano cambia de pestaña", async ({ page }) => {
    await abrir(page);
    await page.evaluate(() => {
      location.hash = "#categorias";
    });
    await expect(page.locator("#panel-categorias")).toBeVisible();
    await page.evaluate(() => {
      location.hash = "#medios-pago";
    });
    await expect(page.locator("#panel-medios_pago")).toBeVisible();
    await expect(page.getByRole("tab", { name: "Medios de pago" })).toHaveAttribute("aria-selected", "true");
  });

  test("al volver a una pestaña conserva lo que se estaba escribiendo", async ({ page }) => {
    await abrir(page, "/configuracion.html#categorias");
    await page.getByTestId("categorias-nombre").fill("borrador");
    await page.getByTestId("pestania-medios-pago").click();
    await page.getByTestId("pestania-categorias").click();
    await expect(page.getByTestId("categorias-nombre")).toHaveValue("borrador");

    await page.getByTestId("pestania-personal").click();
    await page.getByTestId("personal-buscador").fill("luis");
    await page.getByTestId("pestania-categorias").click();
    await page.getByTestId("pestania-personal").click();
    await expect(page.getByTestId("personal-buscador")).toHaveValue("luis");
  });

  test("cada pestaña muestra su explicación", async ({ page }) => {
    await abrir(page);
    for (const l of LISTAS) {
      await page.getByTestId(`pestania-${l.pestania}`).click();
      await expect(page.locator(`#panel-${l.tipo} .cfg-descripcion`)).toHaveText(l.aviso);
    }
  });

  test("cambiar de pestaña varias veces no produce errores de JavaScript", async ({ page }) => {
    const errores = [];
    page.on("pageerror", (e) => errores.push(e.message));
    await abrir(page);
    for (let i = 0; i < 4; i++) {
      for (const id of ["categorias", "medios-pago", "personal"]) await page.getByTestId(`pestania-${id}`).click();
    }
    await expect(page.locator("#panel-personal")).toBeVisible();
    expect(errores).toEqual([]);
  });
});

for (const l of LISTAS) {
  test.describe(`Configuración > ${l.singular}: pantalla`, () => {
    const ruta = `/configuracion.html${l.hash}`;

    test("muestra los elementos iniciales con la cabecera Nombre / Acciones", async ({ page }) => {
      await abrir(page, ruta);
      await expect(items(page, l.tipo)).toHaveText(l.iniciales.map((nombre) => new RegExp(`^${nombre}`)));
      await expect(page.locator(`#panel-${l.tipo} .cfg-lista-cabecera`)).toHaveText(/Nombre\s*Acciones/);
      // Efectivo (medio por defecto) no tiene botón Editar.
      for (const nombre of l.iniciales) await expect(item(page, l.tipo, nombre).getByRole("button", { name: "Editar" })).toHaveCount(nombre === "Efectivo" ? 0 : 1);
    });

    test("el campo para agregar tiene su ejemplo y el largo máximo del Backend (50)", async ({ page }) => {
      await abrir(page, ruta);
      await expect(page.getByTestId(`${l.tipo}-nombre`)).toHaveAttribute("placeholder", l.placeholder);
      await expect(page.getByTestId(`${l.tipo}-nombre`)).toHaveAttribute("maxlength", String(l.maximo));
      await page.getByTestId(`${l.tipo}-nombre`).click();
      await page.keyboard.insertText("a".repeat(l.maximo + 30));
      expect((await page.getByTestId(`${l.tipo}-nombre`).inputValue()).length).toBe(l.maximo);
    });

    test("un nombre del largo máximo se guarda", async ({ page }) => {
      await abrir(page, ruta);
      const nombre = "n".repeat(l.maximo);
      await page.getByTestId(`${l.tipo}-nombre`).fill(nombre);
      await page.getByTestId(`${l.tipo}-agregar`).click();
      await expect(item(page, l.tipo, nombre)).toHaveCount(1);
      await expect(page.getByTestId(`${l.tipo}-error`)).toBeHidden();
    });

    test("el campo para agregar tiene un nombre accesible con el género correcto", async ({ page }) => {
      await abrir(page, ruta);
      await expect(page.getByTestId(`${l.tipo}-nombre`)).toHaveAttribute("aria-label", l.etiquetaEntrada);
    });
  });

  test.describe(`Configuración > ${l.singular}: agregar`, () => {
    const ruta = `/configuracion.html${l.hash}`;

    test("agregar con el botón suma el elemento, limpia el campo y avisa", async ({ page }) => {
      await abrir(page, ruta);
      await page.getByTestId(`${l.tipo}-nombre`).fill("Nuevo elemento");
      await page.getByTestId(`${l.tipo}-agregar`).click();
      await expect(items(page, l.tipo)).toHaveCount(3);
      await expect(item(page, l.tipo, "Nuevo elemento")).toHaveCount(1);
      await expect(page.getByTestId(`${l.tipo}-nombre`)).toHaveValue("");
      await expect(toast(page)).toBeVisible();
    });

    test("el aviso al crear concuerda en género con lo que se creó", async ({ page }) => {
      await abrir(page, ruta);
      await page.getByTestId(`${l.tipo}-nombre`).fill("Nuevo elemento");
      await page.getByTestId(`${l.tipo}-agregar`).click();
      await expect(toast(page)).toHaveText(l.toastCreado);
    });

    test("Enter en el campo también agrega", async ({ page }) => {
      await abrir(page, ruta);
      await page.getByTestId(`${l.tipo}-nombre`).fill("Con Enter");
      await page.getByTestId(`${l.tipo}-nombre`).press("Enter");
      await expect(item(page, l.tipo, "Con Enter")).toHaveCount(1);
    });

    test("recorta los espacios del nombre", async ({ page }) => {
      await abrir(page, ruta);
      await page.getByTestId(`${l.tipo}-nombre`).fill("   Con espacios   ");
      await page.getByTestId(`${l.tipo}-agregar`).click();
      await expect(item(page, l.tipo, "Con espacios").locator(".cfg-fila-nombre")).toHaveText("Con espacios");
    });

    test("vacío o de solo espacios se rechaza y el foco vuelve al campo", async ({ page }) => {
      await abrir(page, ruta);
      await page.getByTestId(`${l.tipo}-agregar`).click();
      await expect(page.getByTestId(`${l.tipo}-error`)).toHaveText("Rellene el nombre.");
      await expect(page.getByTestId(`${l.tipo}-nombre`)).toBeFocused();
      await expect(page.getByTestId(`${l.tipo}-nombre`)).toHaveClass(/con-error/);
      await page.getByTestId(`${l.tipo}-nombre`).fill("     ");
      await page.getByTestId(`${l.tipo}-agregar`).click();
      await expect(page.getByTestId(`${l.tipo}-error`)).toHaveText("Rellene el nombre.");
      await expect(items(page, l.tipo)).toHaveCount(2);
    });

    test("un nombre repetido se rechaza sin distinguir mayúsculas ni espacios de los costados", async ({ page }) => {
      await abrir(page, ruta);
      for (const texto of [l.iniciales[0].toLowerCase(), `  ${l.iniciales[1].toUpperCase()}  `]) {
        await page.getByTestId(`${l.tipo}-nombre`).fill(texto);
        await page.getByTestId(`${l.tipo}-agregar`).click();
        await expect(page.getByTestId(`${l.tipo}-error`)).toHaveText(l.repetido);
      }
      await expect(items(page, l.tipo)).toHaveCount(2);
    });

    test("el error desaparece al escribir y después se puede agregar", async ({ page }) => {
      await abrir(page, ruta);
      await page.getByTestId(`${l.tipo}-agregar`).click();
      await expect(page.getByTestId(`${l.tipo}-error`)).toBeVisible();
      await page.getByTestId(`${l.tipo}-nombre`).fill("Algo");
      await expect(page.getByTestId(`${l.tipo}-error`)).toBeHidden();
      await expect(page.getByTestId(`${l.tipo}-nombre`)).not.toHaveClass(/con-error/);
      await page.getByTestId(`${l.tipo}-agregar`).click();
      await expect(items(page, l.tipo)).toHaveCount(3);
    });

    test("mientras guarda el botón se deshabilita y un doble Enter agrega una sola vez", async ({ page }) => {
      await abrir(page, ruta, lento(l));
      await page.getByTestId(`${l.tipo}-nombre`).fill("Una sola vez");
      await page.evaluate((tipo) => {
        const campo = document.querySelector(`[data-testid="${tipo}-nombre"]`);
        for (let i = 0; i < 3; i++) campo.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      }, l.tipo);
      await expect(page.getByTestId(`${l.tipo}-agregar`)).toBeDisabled();
      await expect(item(page, l.tipo, "Una sola vez")).toHaveCount(1);
      await expect(page.getByTestId(`${l.tipo}-agregar`)).toBeEnabled();
      await page.waitForTimeout(700);
      await expect(item(page, l.tipo, "Una sola vez")).toHaveCount(1);
    });

    test("un nombre con HTML se muestra como texto y no se ejecuta", async ({ page }) => {
      await abrir(page, ruta);
      const peligroso = '<img src=x onerror="window.__xss=1"><b>x</b>';
      await page.getByTestId(`${l.tipo}-nombre`).fill(peligroso);
      await page.getByTestId(`${l.tipo}-agregar`).click();
      await expect(item(page, l.tipo, "onerror").locator(".cfg-fila-nombre")).toHaveText(peligroso);
      await expect(item(page, l.tipo, "onerror").locator("img, b")).toHaveCount(0);
      expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    });

    test("el mismo nombre puede estar en la otra lista (son independientes)", async ({ page }) => {
      await abrir(page, ruta);
      const nombreDeLaOtra = l.tipo === "categorias" ? "Efectivo" : "Remeras";
      await page.getByTestId(`${l.tipo}-nombre`).fill(nombreDeLaOtra);
      await page.getByTestId(`${l.tipo}-agregar`).click();
      await expect(item(page, l.tipo, nombreDeLaOtra)).toHaveCount(1);
    });
  });

  test.describe(`Configuración > ${l.singular}: editar`, () => {
    const ruta = `/configuracion.html${l.hash}`;
    const editar = (page, nombre) => item(page, l.tipo, nombre).getByRole("button", { name: "Editar" }).click();

    test("abre con el nombre actual y el foco en el campo", async ({ page }) => {
      await abrir(page, ruta);
      await editar(page, l.eliminable);
      await expect(modal(page).getByRole("heading", { name: l.tituloEditar })).toBeVisible();
      await expect(page.locator("#nombre")).toHaveValue(l.eliminable);
      await expect(page.locator("#nombre")).toBeFocused();
      await expect(page.locator("#nombre")).toHaveAttribute("maxlength", String(l.maximo));
      await expect(page.locator('label[for="nombre"]')).toHaveText("Nombre *");
    });

    test("guardar sin cambios avisa y no marca su propio nombre como repetido", async ({ page }) => {
      await abrir(page, ruta);
      await editar(page, l.eliminable);
      await guardar(page).click();
      await expect(toast(page)).toHaveText("Cambios guardados");
      await expect(items(page, l.tipo)).toHaveCount(2);
    });

    test("cambiar el nombre actualiza la lista; cambiar solo mayúsculas también", async ({ page }) => {
      await abrir(page, ruta);
      await editar(page, l.eliminable);
      await page.locator("#nombre").fill("  Renombrado  ");
      await guardar(page).click();
      await expect(item(page, l.tipo, "Renombrado").locator(".cfg-fila-nombre")).toHaveText("Renombrado");
      await editar(page, "Renombrado");
      await page.locator("#nombre").fill("RENOMBRADO");
      await guardar(page).click();
      await expect(item(page, l.tipo, "RENOMBRADO")).toHaveCount(1);
    });

    test("vacío o repetido se rechaza dentro del formulario", async ({ page }) => {
      await abrir(page, ruta);
      await editar(page, l.eliminable);
      await page.locator("#nombre").fill("");
      await guardar(page).click();
      await expect(page.locator("#error-nombre")).toHaveText("Rellene el nombre.");
      await expect(page.locator("#nombre")).toBeFocused();
      await page.locator("#nombre").fill(l.otro.toLowerCase());
      await guardar(page).click();
      await expect(page.locator("#error-nombre")).toHaveText(l.repetido);
      await expect(modal(page)).toHaveCount(1);
      await expect(guardar(page)).toBeEnabled();
    });

    test("cancelar, Escape y la cruz no guardan los cambios", async ({ page }) => {
      await abrir(page, ruta);
      await editar(page, l.eliminable);
      await page.locator("#nombre").fill("Cambiado");
      await page.getByTestId("modal-cancelar").click();
      await editar(page, l.eliminable);
      await page.keyboard.press("Escape");
      await editar(page, l.eliminable);
      await modal(page).getByRole("button", { name: "Cerrar", exact: true }).click();
      await expect(item(page, l.tipo, "Cambiado")).toHaveCount(0);
      await expect(item(page, l.tipo, l.eliminable)).toHaveCount(1);
    });

    test("Enter guarda la edición", async ({ page }) => {
      await abrir(page, ruta);
      await editar(page, l.eliminable);
      await page.locator("#nombre").fill("Con Enter");
      await page.locator("#nombre").press("Enter");
      await expect(item(page, l.tipo, "Con Enter")).toHaveCount(1);
    });
  });

  test.describe(`Configuración > ${l.singular}: eliminar`, () => {
    const ruta = `/configuracion.html${l.hash}`;
    const eliminar = (page, nombre) => item(page, l.tipo, nombre).getByRole("button", { name: "Eliminar" }).click();

    test("el diálogo nombra el elemento y explica qué pasa con lo histórico", async ({ page }) => {
      await abrir(page, ruta);
      await eliminar(page, l.eliminable);
      await expect(modal(page).getByRole("heading", { name: l.tituloEliminar })).toBeVisible();
      await expect(modal(page)).toContainText(`¿Eliminar "${l.eliminable}"?`);
      await expect(modal(page)).toContainText(l.textoEliminar);
      await expect(modal(page)).toContainText("Esta acción no se puede deshacer.");
      await expect(page.getByTestId("modal-confirmar")).toHaveText("Eliminar");
    });

    test("confirmar elimina el elemento y avisa", async ({ page }) => {
      await abrir(page, ruta);
      await eliminar(page, l.eliminable);
      await page.getByTestId("modal-confirmar").click();
      await expect(toast(page)).toHaveText(`"${l.eliminable}" se eliminó`);
      await expect(item(page, l.tipo, l.eliminable)).toHaveCount(0);
      await expect(items(page, l.tipo)).toHaveCount(1);
    });

    test("Cancelar, Escape y la cruz no eliminan", async ({ page }) => {
      await abrir(page, ruta);
      await eliminar(page, l.eliminable);
      await page.getByTestId("modal-cancelar").click();
      await eliminar(page, l.eliminable);
      await page.keyboard.press("Escape");
      await eliminar(page, l.eliminable);
      await modal(page).getByRole("button", { name: "Cerrar", exact: true }).click();
      await expect(modal(page)).toHaveCount(0);
      await expect(items(page, l.tipo)).toHaveCount(2);
    });

    test("un elemento recién agregado se puede editar y eliminar", async ({ page }) => {
      await abrir(page, ruta);
      await page.getByTestId(`${l.tipo}-nombre`).fill("Temporal");
      await page.getByTestId(`${l.tipo}-agregar`).click();
      await expect(item(page, l.tipo, "Temporal")).toHaveCount(1);
      await eliminar(page, "Temporal");
      await page.getByTestId("modal-confirmar").click();
      await expect(item(page, l.tipo, "Temporal")).toHaveCount(0);
    });
  });

  test.describe(`Configuración > ${l.singular}: persistencia`, () => {
    const ruta = `/configuracion.html${l.hash}`;

    test("lo agregado, editado y eliminado se mantiene al recargar", async ({ page }) => {
      await abrir(page, ruta);
      await page.getByTestId(`${l.tipo}-nombre`).fill("Persistente");
      await page.getByTestId(`${l.tipo}-agregar`).click();
      await item(page, l.tipo, l.eliminable).getByRole("button", { name: "Eliminar" }).click();
      await page.getByTestId("modal-confirmar").click();
      await expect(item(page, l.tipo, l.eliminable)).toHaveCount(0);
      await page.reload();
      await expect(item(page, l.tipo, "Persistente")).toHaveCount(1);
      await expect(item(page, l.tipo, l.eliminable)).toHaveCount(0);
    });
  });
}

test.describe("Configuración > Categorías: lista vacía", () => {
  const ruta = "/configuracion.html#categorias";
  const eliminarTodas = async (page) => {
    for (const nombre of ["Remeras", "Pantalones"]) {
      await item(page, "categorias", nombre).getByRole("button", { name: "Eliminar" }).click();
      await page.getByTestId("modal-confirmar").click();
    }
  };

  test("sin categorías muestra el mensaje, sin enlace para crear (ya estás en Configuración)", async ({ page }) => {
    await abrir(page, ruta);
    await eliminarTodas(page);
    const mensaje = page.getByTestId("sin-opciones-categorias");
    await expect(mensaje).toContainText("Sin categorías");
    await expect(mensaje).toContainText("Todavía no hay categorías cargadas.");
    await expect(mensaje.getByRole("link")).toHaveCount(0);
    await expect(page.getByTestId("categorias-lista")).toHaveCount(0);
  });

  test("desde la lista vacía se puede volver a agregar", async ({ page }) => {
    await abrir(page, ruta);
    await eliminarTodas(page);
    await page.getByTestId("categorias-nombre").fill("Primera");
    await page.getByTestId("categorias-agregar").click();
    await expect(items(page, "categorias")).toHaveCount(1);
    await expect(page.getByTestId("sin-opciones-categorias")).toHaveCount(0);
  });

  test("la lista vacía se mantiene al recargar", async ({ page }) => {
    await abrir(page, ruta);
    await eliminarTodas(page);
    await page.reload();
    await expect(page.getByTestId("sin-opciones-categorias")).toBeVisible();
  });
});

test.describe("Configuración > Medios de pago: el medio por defecto", () => {
  const ruta = "/configuracion.html#medios-pago";

  test("Efectivo muestra «Por defecto» y no se puede editar ni eliminar", async ({ page }) => {
    await abrir(page, ruta);
    const efectivo = item(page, "medios_pago", "Efectivo");
    await expect(efectivo.locator(".cfg-insignia")).toHaveText("Por defecto");
    await expect(efectivo.getByRole("button", { name: "Editar" })).toHaveCount(0);
    await expect(efectivo.getByRole("button", { name: "Eliminar" })).toHaveCount(0);
    const transferencia = item(page, "medios_pago", "Transferencia");
    await expect(transferencia.locator(".cfg-insignia")).toHaveCount(0);
    await expect(transferencia.getByRole("button", { name: "Editar" })).toBeVisible();
    await expect(transferencia.getByRole("button", { name: "Eliminar" })).toBeVisible();
  });

  test("los medios de pago nuevos no son por defecto y se pueden eliminar", async ({ page }) => {
    await abrir(page, ruta);
    await page.getByTestId("medios_pago-nombre").fill("Débito");
    await page.getByTestId("medios_pago-agregar").click();
    const debito = item(page, "medios_pago", "Débito");
    await expect(debito.locator(".cfg-insignia")).toHaveCount(0);
    await expect(debito.getByRole("button", { name: "Eliminar" })).toBeVisible();
  });
});

test.describe("Configuración: lo que se carga acá lo usan otras pantallas", () => {
  test("los medios de pago de Configuración son los del desplegable de Gastos", async ({ page }) => {
    await abrir(page, "/configuracion.html#medios-pago");
    await page.getByTestId("medios_pago-nombre").fill("Débito");
    await page.getByTestId("medios_pago-agregar").click();
    await item(page, "medios_pago", "Transferencia").getByRole("button", { name: "Eliminar" }).click();
    await page.getByTestId("modal-confirmar").click();
    await item(page, "medios_pago", "Débito").getByRole("button", { name: "Editar" }).click();
    await page.locator("#nombre").fill("Tarjeta");
    await guardar(page).click();
    await expect(item(page, "medios_pago", "Tarjeta")).toHaveCount(1);

    await page.goto("/gastos.html");
    await page.getByTestId("gastos-nuevo").click();
    await expect(page.locator("#medio_pago_id option")).toHaveText(["Sin especificar", "Efectivo", "Tarjeta"]);
  });

  test("sin medios de pago extra, Gastos ofrece solo el que queda", async ({ page }) => {
    await abrir(page, "/configuracion.html#medios-pago");
    await item(page, "medios_pago", "Transferencia").getByRole("button", { name: "Eliminar" }).click();
    await page.getByTestId("modal-confirmar").click();
    await page.goto("/gastos.html");
    await page.getByTestId("gastos-nuevo").click();
    await expect(page.locator("#medio_pago_id option")).toHaveText(["Sin especificar", "Efectivo"]);
  });
});

test.describe("Configuración > Categorías y Medios de pago: acceso", () => {
  for (const rol of ["PROPIETARIO", "ADMIN"]) {
    test(`el rol ${rol} entra directo a cada pestaña`, async ({ page }) => {
      await abrir(page, "/configuracion.html#categorias", { rol });
      await expect(page.locator("#panel-categorias")).toBeVisible();
      await page.getByTestId("pestania-medios-pago").click();
      await expect(page.locator("#panel-medios_pago")).toBeVisible();
    });
  }

  test("el Empleado, aunque entre por la dirección de una pestaña, vuelve al panel", async ({ page }) => {
    await abrir(page, "/configuracion.html#categorias", { rol: "CAJERO" });
    await expect(page).toHaveURL(/dashboard\.html$/);
  });

  test("usar las listas de punta a punta no produce errores de JavaScript", async ({ page }) => {
    const errores = [];
    page.on("pageerror", (e) => errores.push(e.message));
    await abrir(page, "/configuracion.html#categorias");
    await page.getByTestId("categorias-nombre").fill("Camperas");
    await page.getByTestId("categorias-agregar").click();
    await item(page, "categorias", "Camperas").getByRole("button", { name: "Editar" }).click();
    await guardar(page).click();
    await item(page, "categorias", "Camperas").getByRole("button", { name: "Eliminar" }).click();
    await page.getByTestId("modal-confirmar").click();
    await page.getByTestId("pestania-medios-pago").click();
    await page.getByTestId("medios_pago-nombre").fill("Débito");
    await page.getByTestId("medios_pago-nombre").press("Enter");
    expect(errores).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// El servidor rechaza un nombre o falla: el backend falso responde con ese error.
// ---------------------------------------------------------------------------

const BACKEND_ACCION = { crear: "POST", actualizar: "PUT", eliminar: "DELETE" };

// Devuelve las opciones de `abrir` para que la acción de la lista falle una vez con ese error.
const falla = (l, accion, { status = 500, mensaje, errores }) => {
  const ruta = RUTA_API[l.tipo] + (accion === "crear" ? "" : "/:id");
  return { preparar: (b) => b.fallar(`${BACKEND_ACCION[accion]} ${ruta}`, respuestaDeError(status, mensaje, errores), { veces: 1 }) };
};

for (const l of LISTAS) {
  test.describe(`Configuración > ${l.singular}: el servidor rechaza un nombre`, () => {
    const ruta = `/configuracion.html${l.hash}`;
    const rechazo = `Ya existe ${l.tipo === "categorias" ? "una categoría" : "un medio de pago"} con ese nombre.`;
    const rechazoNombre = { status: 409, mensaje: rechazo, errores: { nombre: rechazo } };

    test("al agregar, el mensaje del servidor sale junto al campo y no se pierde lo escrito", async ({ page }) => {
      await abrir(page, ruta, falla(l, "crear", rechazoNombre));
      await page.getByTestId(`${l.tipo}-nombre`).fill("Nombre eliminado antes");
      await page.getByTestId(`${l.tipo}-agregar`).click();
      await expect(page.getByTestId(`${l.tipo}-error`)).toHaveText(rechazo);
      await expect(page.getByTestId(`${l.tipo}-nombre`)).toHaveClass(/con-error/);
      await expect(page.getByTestId(`${l.tipo}-nombre`)).toHaveValue("Nombre eliminado antes");
      await expect(items(page, l.tipo)).toHaveCount(2);
      await expect(toast(page)).toHaveCount(0);
      await expect(page.getByTestId(`${l.tipo}-agregar`)).toBeEnabled();
    });

    test("el error del servidor desaparece al escribir otro nombre", async ({ page }) => {
      await abrir(page, ruta, falla(l, "crear", rechazoNombre));
      await page.getByTestId(`${l.tipo}-nombre`).fill("Repetido");
      await page.getByTestId(`${l.tipo}-agregar`).click();
      await expect(page.getByTestId(`${l.tipo}-error`)).toBeVisible();
      await page.getByTestId(`${l.tipo}-nombre`).fill("Repetido 2");
      await expect(page.getByTestId(`${l.tipo}-error`)).toBeHidden();
    });

    test("un error sin detalle de campo también se muestra junto al campo", async ({ page }) => {
      await abrir(page, ruta, falla(l, "crear", { mensaje: "El servidor no responde." }));
      await page.getByTestId(`${l.tipo}-nombre`).fill("Algo");
      await page.getByTestId(`${l.tipo}-agregar`).click();
      await expect(page.getByTestId(`${l.tipo}-error`)).toHaveText("El servidor no responde.");
      await expect(page.getByTestId(`${l.tipo}-agregar`)).toBeEnabled();
    });

    test("al editar, el mensaje del servidor sale en el formulario, que sigue abierto", async ({ page }) => {
      await abrir(page, ruta, falla(l, "actualizar", rechazoNombre));
      await item(page, l.tipo, l.eliminable).getByRole("button", { name: "Editar" }).click();
      await page.locator("#nombre").fill("Nombre eliminado antes");
      await guardar(page).click();
      await expect(page.locator("#error-nombre")).toHaveText(rechazo);
      await expect(modal(page)).toHaveCount(1);
      await expect(guardar(page)).toBeEnabled();
      await expect(guardar(page)).toHaveText("Guardar");
      await page.getByTestId("modal-cancelar").click();
      await expect(item(page, l.tipo, l.eliminable)).toHaveCount(1);
    });

    test("al editar, un error general se avisa y la lista no cambia", async ({ page }) => {
      await abrir(page, ruta, falla(l, "actualizar", { mensaje: "No se pudo guardar." }));
      await item(page, l.tipo, l.eliminable).getByRole("button", { name: "Editar" }).click();
      await page.locator("#nombre").fill("Otro nombre");
      await guardar(page).click();
      await expect(toast(page)).toHaveText("No se pudo guardar.");
      await page.getByTestId("modal-cancelar").click();
      await expect(item(page, l.tipo, l.eliminable)).toHaveCount(1);
    });

    test("si el servidor no puede eliminar, lo avisa y el elemento sigue en la lista", async ({ page }) => {
      await abrir(page, ruta, falla(l, "eliminar", { mensaje: "No se pudo eliminar." }));
      await item(page, l.tipo, l.eliminable).getByRole("button", { name: "Eliminar" }).click();
      await page.getByTestId("modal-confirmar").click();
      await expect(toast(page)).toHaveText("No se pudo eliminar.");
      await expect(item(page, l.tipo, l.eliminable)).toHaveCount(1);
    });
  });
}

test.describe("Configuración > Medios de pago: conexión con el Backend", () => {
  const ruta = "/configuracion.html#medios-pago";

  test("al abrir pide la lista a GET /medios-pago con el token de la sesión", async ({ page }) => {
    await abrir(page, ruta);
    await expect(items(page, "medios_pago")).toHaveCount(2);
    const [pedido] = backend.peticiones("GET", "/medios-pago");
    expect(pedido.headers.authorization).toMatch(/^Bearer .+/);
  });

  test("se muestran en el orden del Backend: primero el predeterminado y después por nombre", async ({ page }) => {
    await abrir(page, ruta, { semilla: (e) => e.medios.push({ id: 9, nombre: "Billetera", es_predeterminado: false, activo: true }) });
    await expect(items(page, "medios_pago")).toHaveText([/^Efectivo/, /^Billetera/, /^Transferencia/]);
  });

  test("agregar envía solo el nombre a POST /medios-pago", async ({ page }) => {
    await abrir(page, ruta);
    await page.getByTestId("medios_pago-nombre").fill("  Débito  ");
    await page.getByTestId("medios_pago-agregar").click();
    await expect(item(page, "medios_pago", "Débito")).toHaveCount(1);
    expect(backend.enviados("POST", "/medios-pago")).toEqual([{ nombre: "Débito" }]);
  });

  test("editar va a PUT /medios-pago/<id> y eliminar a DELETE /medios-pago/<id>", async ({ page }) => {
    await abrir(page, ruta);
    await item(page, "medios_pago", "Transferencia").getByRole("button", { name: "Editar" }).click();
    await page.locator("#nombre").fill("Transfer");
    await guardar(page).click();
    await expect(item(page, "medios_pago", "Transfer")).toHaveCount(1);
    await item(page, "medios_pago", "Transfer").getByRole("button", { name: "Eliminar" }).click();
    await page.getByTestId("modal-confirmar").click();
    await expect(item(page, "medios_pago", "Transfer")).toHaveCount(0);
    expect(backend.enviados("PUT", "/medios-pago/:id")).toEqual([{ nombre: "Transfer" }]);
    expect(backend.peticiones("PUT", "/medios-pago/:id").map((p) => p.ruta)).toEqual(["/medios-pago/2"]);
    expect(backend.peticiones("DELETE", "/medios-pago/:id").map((p) => p.ruta)).toEqual(["/medios-pago/2"]);
  });

  test("si la lista no carga, la pestaña lo dice en vez de mostrar «Sin medios de pago»", async ({ page }) => {
    await abrir(page, ruta, { preparar: (b) => b.fallar("GET /medios-pago", respuestaDeError(500, "Error al listar los medios de pago")) });
    await expect(page.getByTestId("medios_pago-error-carga")).toHaveText("Error al listar los medios de pago");
    await expect(page.getByTestId("sin-opciones-medios_pago")).toHaveCount(0);
  });

  test("sin conexión, la pestaña lo avisa en español", async ({ page }) => {
    await abrir(page, ruta, { preparar: (b) => b.fallar("GET /medios-pago", { abortar: true }) });
    await expect(page.getByTestId("medios_pago-error-carga")).toHaveText("No se pudo conectar con el servidor.");
  });

  test("el Backend rechaza eliminar el medio por defecto (400) y el aviso lo explica", async ({ page }) => {
    await abrir(page, ruta, { preparar: (b) => b.fallar("DELETE /medios-pago/:id", respuestaDeError(400, "El medio de pago Efectivo no puede eliminarse"), { veces: 1 }) });
    await item(page, "medios_pago", "Transferencia").getByRole("button", { name: "Eliminar" }).click();
    await page.getByTestId("modal-confirmar").click();
    await expect(toast(page)).toHaveText("El medio de pago Efectivo no puede eliminarse");
  });
});

// ---------------------------------------------------------------------------
// Medios de pago: es_predeterminado (el medio por defecto) viene del Backend. Las categorías no tienen ese dato.
// ---------------------------------------------------------------------------

test.describe("Configuración > Medios de pago: «es_predeterminado»", () => {
  test("las categorías nunca muestran «Por defecto»", async ({ page }) => {
    await abrir(page, "/configuracion.html#categorias");
    await expect(item(page, "categorias", "Remeras").locator(".cfg-insignia")).toHaveCount(0);
    await expect(item(page, "categorias", "Remeras").getByRole("button", { name: "Eliminar" })).toBeVisible();
  });

  test("un medio de pago nuevo no es el predeterminado y se mantiene así al recargar", async ({ page }) => {
    await abrir(page, "/configuracion.html#medios-pago");
    await page.getByTestId("medios_pago-nombre").fill("Débito");
    await page.getByTestId("medios_pago-agregar").click();
    await page.reload();
    await expect(item(page, "medios_pago", "Débito").locator(".cfg-insignia")).toHaveCount(0);
    await expect(item(page, "medios_pago", "Débito").getByRole("button", { name: "Eliminar" })).toBeVisible();
    await expect(item(page, "medios_pago", "Efectivo").locator(".cfg-insignia")).toHaveText("Por defecto");
  });
});

// ---------------------------------------------------------------------------
// «Eliminar». Si nunca se usó se borra de verdad y su nombre queda libre; si ya se usó (categoría con productos, medio
// de pago con gastos) se desactiva y no se lista, y al crearlo de nuevo con el mismo nombre se reactiva.
// ---------------------------------------------------------------------------

for (const l of LISTAS) {
  test.describe(`Configuración > ${l.singular}: eliminar y recargar`, () => {
    const ruta = `/configuracion.html${l.hash}`;
    const eliminar = async (page, nombre) => {
      await item(page, l.tipo, nombre).getByRole("button", { name: "Eliminar" }).click();
      await page.getByTestId("modal-confirmar").click();
      await expect(item(page, l.tipo, nombre)).toHaveCount(0);
    };

    test("lo eliminado no se lista, ni se recupera al recargar", async ({ page }) => {
      await abrir(page, ruta);
      await eliminar(page, l.eliminable);
      await page.reload();
      await expect(item(page, l.tipo, l.eliminable)).toHaveCount(0);
      await expect(items(page, l.tipo)).toHaveCount(1);
    });

    test("al editar, conservar el propio nombre sigue funcionando después de eliminar a otro", async ({ page }) => {
      // En medios de pago el otro es Efectivo (por defecto, sin botón Editar): se agrega uno editable.
      const otroEditable = l.tipo === "medios_pago" ? "Billetera" : l.otro;
      await abrir(page, ruta, l.tipo === "medios_pago" ? { semilla: (e) => e.medios.push({ id: 9, nombre: "Billetera", es_predeterminado: false, activo: true }) } : {});
      await eliminar(page, l.eliminable);
      await item(page, l.tipo, otroEditable).getByRole("button", { name: "Editar" }).click();
      await guardar(page).click();
      await expect(toast(page)).toHaveText("Cambios guardados");
    });

    test("eliminar no se puede deshacer desde la pantalla: no hay forma de verlo ni de restaurarlo", async ({ page }) => {
      await abrir(page, ruta);
      await eliminar(page, l.eliminable);
      await expect(page.getByText(l.eliminable)).toHaveCount(0);
      await expect(page.getByRole("button", { name: /Restaurar|Recuperar/ })).toHaveCount(0);
    });
  });
}

test.describe("Configuración > categoría: eliminar según si ya se usó", () => {
  const ruta = "/configuracion.html#categorias";
  const eliminar = async (page, nombre) => {
    await item(page, "categorias", nombre).getByRole("button", { name: "Eliminar" }).click();
    await page.getByTestId("modal-confirmar").click();
    await expect(item(page, "categorias", nombre)).toHaveCount(0);
  };
  const conProductosEnRemeras = { semilla: (e) => (e.categorias.find((c) => c.nombre === "Remeras").en_uso = true) };

  test("una que nunca se usó se borra de verdad y su nombre queda libre para volver a crearla", async ({ page }) => {
    await abrir(page, ruta);
    await eliminar(page, "Remeras");
    expect(backend.estado.categorias.some((c) => c.nombre === "Remeras")).toBe(false);
    await page.getByTestId("categorias-nombre").fill("Remeras");
    await page.getByTestId("categorias-agregar").click();
    await expect(item(page, "categorias", "Remeras")).toHaveCount(1);
  });

  test("una con productos no se lista pero sigue guardada como inactiva", async ({ page }) => {
    await abrir(page, ruta, conProductosEnRemeras);
    await eliminar(page, "Remeras");
    expect(backend.estado.categorias.find((c) => c.nombre === "Remeras").activo).toBe(false);
    await page.reload();
    await expect(item(page, "categorias", "Remeras")).toHaveCount(0);
    await expect(items(page, "categorias")).toHaveCount(1);
  });

  test("una con productos y eliminada se reactiva al crear otra con el mismo nombre", async ({ page }) => {
    await abrir(page, ruta, conProductosEnRemeras);
    await eliminar(page, "Remeras");
    await page.getByTestId("categorias-nombre").fill("remeras");
    await page.getByTestId("categorias-agregar").click();
    await expect(item(page, "categorias", "remeras")).toHaveCount(1);
    await expect(toast(page)).toHaveText("Categoría creada");
  });

  test("al editar, el nombre de una categoría eliminada (inactiva) está ocupado y el servidor lo explica", async ({ page }) => {
    await abrir(page, ruta, conProductosEnRemeras);
    await eliminar(page, "Remeras");
    await item(page, "categorias", "Pantalones").getByRole("button", { name: "Editar" }).click();
    await page.locator("#nombre").fill("Remeras");
    await guardar(page).click();
    await expect(page.locator("#error-nombre")).toHaveText("Ese nombre pertenece a una categoría eliminada anteriormente. Creala como nueva para volver a habilitarla.");
    await expect(modal(page)).toHaveCount(1);
    await expect(guardar(page)).toBeEnabled();
  });
});

test.describe("Configuración > medio de pago: eliminar según si ya se usó", () => {
  const ruta = "/configuracion.html#medios-pago";
  const eliminar = async (page, nombre) => {
    await item(page, "medios_pago", nombre).getByRole("button", { name: "Eliminar" }).click();
    await page.getByTestId("modal-confirmar").click();
    await expect(item(page, "medios_pago", nombre)).toHaveCount(0);
  };
  const conGastosConTransferencia = { semilla: (e) => e.gastos.forEach((g) => (g.medio_pago_id = 2)) };

  test("uno que nunca se usó se borra de verdad y su nombre queda libre para volver a crearlo", async ({ page }) => {
    await abrir(page, ruta, { semilla: (e) => e.gastos.forEach((g) => (g.medio_pago_id = 1)) });
    await eliminar(page, "Transferencia");
    expect(backend.estado.medios.some((m) => m.nombre === "Transferencia")).toBe(false);
    await page.getByTestId("medios_pago-nombre").fill("Transferencia");
    await page.getByTestId("medios_pago-agregar").click();
    await expect(item(page, "medios_pago", "Transferencia")).toHaveCount(1);
  });

  test("uno ya usado en gastos no se lista pero sigue guardado como inactivo", async ({ page }) => {
    await abrir(page, ruta, conGastosConTransferencia);
    await eliminar(page, "Transferencia");
    expect(backend.estado.medios.find((m) => m.nombre === "Transferencia").activo).toBe(false);
    await page.reload();
    await expect(item(page, "medios_pago", "Transferencia")).toHaveCount(0);
  });

  test("uno ya usado y eliminado se reactiva al crear otro con el mismo nombre", async ({ page }) => {
    await abrir(page, ruta, conGastosConTransferencia);
    await eliminar(page, "Transferencia");
    await page.getByTestId("medios_pago-nombre").fill("transferencia");
    await page.getByTestId("medios_pago-agregar").click();
    await expect(item(page, "medios_pago", "transferencia")).toHaveCount(1);
    await expect(toast(page)).toHaveText("Medio de pago creado");
  });
});

test.describe("Configuración > Categorías: las inactivas no se ven", () => {
  test("una categoría inactiva no se lista", async ({ page }) => {
    await abrir(page, "/configuracion.html#categorias", { semilla: (e) => e.categorias.push({ id: 9, nombre: "Eliminada", activo: false, en_uso: true }) });
    await expect(items(page, "categorias")).toHaveCount(2);
    await expect(item(page, "categorias", "Eliminada")).toHaveCount(0);
  });

  test("si todas las categorías están inactivas se ve el mensaje de lista vacía", async ({ page }) => {
    await abrir(page, "/configuracion.html#categorias", { semilla: (e) => e.categorias.forEach((c) => (c.activo = false)) });
    await expect(page.getByTestId("sin-opciones-categorias")).toBeVisible();
  });
});

test.describe("Configuración > Medios de pago: lo eliminado no se ofrece en Gastos", () => {
  test("un medio de pago eliminado ya no aparece en el desplegable, aunque se recargue", async ({ page }) => {
    await abrir(page, "/configuracion.html#medios-pago");
    await item(page, "medios_pago", "Transferencia").getByRole("button", { name: "Eliminar" }).click();
    await page.getByTestId("modal-confirmar").click();
    await page.goto("/gastos.html");
    await page.getByTestId("gastos-nuevo").click();
    await expect(page.locator("#medio_pago_id option")).toHaveText(["Sin especificar", "Efectivo"]);
    await page.reload();
    await page.getByTestId("gastos-nuevo").click();
    await expect(page.locator("#medio_pago_id option")).toHaveText(["Sin especificar", "Efectivo"]);
  });

  test("un medio de pago nuevo sí aparece, y uno eliminado después desaparece", async ({ page }) => {
    await abrir(page, "/configuracion.html#medios-pago");
    await page.getByTestId("medios_pago-nombre").fill("Débito");
    await page.getByTestId("medios_pago-agregar").click();
    await page.goto("/gastos.html");
    await page.getByTestId("gastos-nuevo").click();
    await expect(page.locator("#medio_pago_id option")).toHaveText(["Sin especificar", "Efectivo", "Débito", "Transferencia"]);
    await page.goto("/configuracion.html#medios-pago");
    await item(page, "medios_pago", "Débito").getByRole("button", { name: "Eliminar" }).click();
    await page.getByTestId("modal-confirmar").click();
    await page.goto("/gastos.html");
    await page.getByTestId("gastos-nuevo").click();
    await expect(page.locator("#medio_pago_id option")).toHaveText(["Sin especificar", "Efectivo", "Transferencia"]);
  });
});

// ---------------------------------------------------------------------------
// Errores del Backend al cargar y sin permiso (casos que faltaban)
// ---------------------------------------------------------------------------

test.describe("Configuración > Categorías: errores al cargar la lista", () => {
  const ruta = "/configuracion.html#categorias";

  test("si la lista no carga, la pestaña lo dice en vez de mostrar «Sin categorías»", async ({ page }) => {
    await abrir(page, ruta, { preparar: (b) => b.fallar("GET /categorias", respuestaDeError(500, "Error al listar las categorías")) });
    await expect(page.getByTestId("categorias-error-carga")).toHaveText("Error al listar las categorías");
    await expect(page.getByTestId("sin-opciones-categorias")).toHaveCount(0);
  });

  test("sin conexión, la pestaña lo avisa en español", async ({ page }) => {
    await abrir(page, ruta, { preparar: (b) => b.fallar("GET /categorias", { abortar: true }) });
    await expect(page.getByTestId("categorias-error-carga")).toHaveText("No se pudo conectar con el servidor.");
  });

  test("un error sin mensaje usa el texto por defecto de la lista", async ({ page }) => {
    await abrir(page, ruta, { preparar: (b) => b.fallar("GET /categorias", { status: 500, body: {} }) });
    await expect(page.getByTestId("categorias-error-carga")).toHaveText("No se pudo cargar la lista de categorías.");
  });

  test("los campos para agregar siguen disponibles aunque la lista no haya cargado", async ({ page }) => {
    await abrir(page, ruta, { preparar: (b) => b.fallar("GET /categorias", respuestaDeError(500, "Error al listar las categorías"), { veces: 1 }) });
    await expect(page.getByTestId("categorias-error-carga")).toBeVisible();
    await page.getByTestId("categorias-nombre").fill("Camperas");
    await page.getByTestId("categorias-agregar").click();
    await expect(toast(page)).toHaveText("Categoría creada");
    await expect(page.getByTestId("categorias-error-carga")).toHaveCount(0);
    await expect(items(page, "categorias").filter({ hasText: "Camperas" })).toHaveCount(1);
  });
});

for (const l of LISTAS) {
  test.describe(`Configuración > ${l.singular}: sin permiso en el Backend (403)`, () => {
    const ruta = `/configuracion.html${l.hash}`;
    const mensajeDeAcceso = "Acceso denegado: solo el administrador puede gestionar esta lista";

    const registrarAvisos = (page) => {
      const mensajes = [];
      page.on("dialog", async (dialogo) => {
        mensajes.push(dialogo.message());
        await dialogo.accept();
      });
      return mensajes;
    };

    test("un 403 al abrir la lista avisa y vuelve al Panel", async ({ page }) => {
      const mensajes = registrarAvisos(page);
      await abrir(page, ruta, { preparar: (b) => b.fallar(`GET ${RUTA_API[l.tipo]}`, respuestaDeError(403, mensajeDeAcceso)) });
      await expect(page).toHaveURL(/dashboard\.html$/);
      expect(mensajes).toEqual([mensajeDeAcceso]);
    });

    test("un 403 al agregar avisa y vuelve al Panel sin cerrar la sesión", async ({ page }) => {
      const mensajes = registrarAvisos(page);
      await abrir(page, ruta, { preparar: (b) => b.fallar(`POST ${RUTA_API[l.tipo]}`, respuestaDeError(403, mensajeDeAcceso)) });
      await page.getByTestId(`${l.tipo}-nombre`).fill("Nombre nuevo");
      await page.getByTestId(`${l.tipo}-agregar`).click();
      await expect(page).toHaveURL(/dashboard\.html$/);
      expect(mensajes).toEqual([mensajeDeAcceso]);
      expect(await page.evaluate(() => localStorage.getItem("trazzo_access_token"))).not.toBeNull();
    });
  });
}
