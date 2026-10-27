const { test, expect } = require("@playwright/test");
const { simularApi, iniciarSesionComo, tokensGuardados } = require("./helpers");

const MODULOS = [
  "ventas",
  "productos",
  "notificaciones",
  "clientes",
  "proveedores",
  "insumos",
  "bienes_uso",
  "gastos",
  "cuentas_corrientes",
  "personal",
  "reportes",
];
const MODULOS_CAJERO = ["ventas", "productos", "notificaciones", "cuentas_corrientes"];

const logoutOk = {
  "POST /auth/logout": {
    status: 200,
    body: { status: "ok", mensaje: "Sesión cerrada correctamente" },
  },
};

// Los textos de módulos del cuerpo del dashboard (no los de la barra lateral).
const modulo = (page, nombre) => page.locator(`.menu-modulos [data-modulo="${nombre}"]`);

test.describe("Protección de rutas", () => {
  test("sin token el dashboard redirige al login", async ({ page }) => {
    await page.goto("/dashboard.html");
    await expect(page).toHaveURL(/login\.html$/);
  });

  test("con token se puede ver el dashboard", async ({ page }) => {
    await iniciarSesionComo(page, "ADMIN");
    await page.goto("/dashboard.html");
    await expect(page).toHaveURL(/dashboard\.html$/);
    await expect(page.getByRole("heading", { name: /Bienvenido/ })).toBeVisible();
  });

  // El dashboard solo mira que exista un token, no le pregunta al backend si sigue vigente.
  test.fixme("con un token revocado o vencido en el servidor redirige al login", async ({ page }) => {
    await simularApi(page, {
      "GET /auth/yo": { status: 401, body: { status: "error", mensaje: "Token inválido" } },
    });
    await iniciarSesionComo(page, "ADMIN");
    await page.goto("/dashboard.html");
    await expect(page).toHaveURL(/login\.html$/);
  });
});

test.describe("Módulos según el rol", () => {
  for (const rol of ["ADMIN", "PROPIETARIO"]) {
    test(`${rol} ve todos los módulos`, async ({ page }) => {
      await iniciarSesionComo(page, rol);
      await page.goto("/dashboard.html");
      for (const nombre of MODULOS) {
        await expect(modulo(page, nombre)).toBeVisible();
      }
    });
  }

  test("CAJERO ve solo ventas, productos, notificaciones y cuenta corriente", async ({ page }) => {
    await iniciarSesionComo(page, "CAJERO");
    await page.goto("/dashboard.html");
    for (const nombre of MODULOS) {
      if (MODULOS_CAJERO.includes(nombre)) {
        await expect(modulo(page, nombre)).toBeVisible();
      } else {
        await expect(modulo(page, nombre)).toBeHidden();
      }
    }
  });

  test("un rol desconocido no ve ningún módulo", async ({ page }) => {
    await iniciarSesionComo(page, "OTRO_ROL");
    await page.goto("/dashboard.html");
    for (const nombre of MODULOS) {
      await expect(modulo(page, nombre)).toBeHidden();
    }
  });

  test("el CAJERO no ve botones de ocultar ni borrar, pero sí los de crear y editar", async ({ page }) => {
    await iniciarSesionComo(page, "CAJERO");
    await page.goto("/dashboard.html");
    // Simula contenido que un módulo renderiza más tarde.
    await page.evaluate(() => {
      document.querySelector("main").insertAdjacentHTML(
        "beforeend",
        `<div id="acciones">
           <button data-modulo="productos" data-accion="editar">Editar</button>
           <button data-modulo="productos" data-accion="reponer">Reponer</button>
           <button data-modulo="productos" data-accion="ocultar">Ocultar</button>
           <button data-modulo="productos" data-accion="eliminar">Borrar</button>
           <button data-modulo="ventas" data-accion="eliminar">Borrar venta</button>
         </div>`,
      );
    });
    const acciones = page.locator("#acciones");
    await expect(acciones.getByRole("button", { name: "Editar" })).toBeVisible();
    await expect(acciones.getByRole("button", { name: "Reponer" })).toBeVisible();
    await expect(acciones.getByRole("button", { name: "Ocultar" })).toBeHidden();
    await expect(acciones.getByRole("button", { name: "Borrar", exact: true })).toBeHidden();
    await expect(acciones.getByRole("button", { name: "Borrar venta" })).toBeHidden();
  });

  test("el ADMIN ve todos los botones de acción", async ({ page }) => {
    await iniciarSesionComo(page, "ADMIN");
    await page.goto("/dashboard.html");
    await page.evaluate(() => {
      document.querySelector("main").insertAdjacentHTML(
        "beforeend",
        `<button id="borrar" data-modulo="productos" data-accion="eliminar">Borrar</button>`,
      );
    });
    await expect(page.locator("#borrar")).toBeVisible();
  });

  // [módulo, acción, ve el admin, ve el cajero], según el Resumen del Sistema.
  const ACCIONES = [
    ["productos", "reponer", true, true],
    ["productos", "proveedor_nuevo", true, false],
    ["productos", "ocultar", true, false],
    ["productos", "eliminar", true, false],
    ["clientes", "seleccionar", true, true],
    ["clientes", "ver", true, false],
    ["clientes", "ver_datos_completos", false, false],
    ["ventas", "crear", true, true],
    ["ventas", "editar", true, true],
    ["ventas", "ticket", true, true],
    ["ventas", "ocultar", true, false],
    ["ventas", "eliminar", true, false],
    ["ventas", "anular", true, false],
    ["cuentas_corrientes", "ver", true, true],
    ["cuentas_corrientes", "editar", true, true],
    ["cuentas_corrientes", "ver_datos_completos", true, false],
    ["cuentas_corrientes", "ocultar", true, false],
    ["cuentas_corrientes", "eliminar", true, false],
    ["gastos", "ocultar", true, false],
    ["negocio", "editar", true, false],
    ["personal", "habilitar", true, false],
    ["categorias", "crear", true, false],
    ["medios_pago", "crear", true, false],
    ["notificaciones", "eliminar", true, true],
  ];

  for (const [rol, columna] of [["ADMIN", 2], ["CAJERO", 3]]) {
    test(`${rol}: las acciones permitidas coinciden con la matriz del Resumen`, async ({ page }) => {
      await iniciarSesionComo(page, rol);
      await page.goto("/dashboard.html");
      await page.evaluate((acciones) => {
        const contenedor = document.createElement("div");
        contenedor.id = "matriz";
        acciones.forEach(([modulo, accion], i) => {
          const boton = document.createElement("button");
          boton.id = `accion-${i}`;
          boton.dataset.modulo = modulo;
          boton.dataset.accion = accion;
          boton.textContent = `${modulo}/${accion}`;
          contenedor.appendChild(boton);
        });
        document.querySelector("main").appendChild(contenedor);
      }, ACCIONES);

      for (const [i, fila] of ACCIONES.entries()) {
        const boton = page.locator(`#accion-${i}`);
        if (fila[columna]) {
          await expect(boton, `${fila[0]}/${fila[1]}`).toBeVisible();
        } else {
          await expect(boton, `${fila[0]}/${fila[1]}`).toBeHidden();
        }
      }
    });
  }
});

test.describe("Barra lateral", () => {
  const titulosDeGrupo = (page) => page.locator(".sidebar-grupo-titulo");

  test("el ADMIN ve todos los grupos y todos los módulos", async ({ page }) => {
    await iniciarSesionComo(page, "ADMIN");
    await page.goto("/dashboard.html");
    await expect(titulosDeGrupo(page)).toHaveText(["Ventas", "Productos", "Finanzas"]);
    for (const nombre of MODULOS.filter((m) => !["notificaciones", "personal"].includes(m))) {
      await expect(page.getByTestId(`menu-${nombre}`)).toBeVisible();
    }
  });

  test("cada módulo del menú tiene su ícono", async ({ page }) => {
    await iniciarSesionComo(page, "ADMIN");
    await page.goto("/dashboard.html");
    const enlaces = page.locator(".sidebar-link");
    await expect(enlaces).toHaveCount(10);
    for (const enlace of await enlaces.all()) {
      await expect(enlace.locator("svg")).toHaveCount(1);
    }
  });

  test("el botón de contraer es un ícono arriba, sin texto", async ({ page }) => {
    await iniciarSesionComo(page, "ADMIN");
    await page.goto("/dashboard.html");
    const boton = page.getByTestId("btn-contraer-menu");
    await expect(boton.locator("svg")).toHaveCount(1);
    await expect(boton).toHaveText("");
    await expect(boton).toHaveAttribute("aria-label", "Contraer menú");
    const dentroDeLaMarca = await boton.evaluate((el) => !!el.closest(".sidebar-marca"));
    expect(dentroDeLaMarca).toBe(true);
  });

  test("el menú se contrae a solo íconos y se vuelve a expandir", async ({ page }) => {
    await iniciarSesionComo(page, "ADMIN");
    await page.goto("/dashboard.html");
    const texto = page.getByTestId("menu-ventas").locator(".sidebar-texto");
    const ancho = () => page.getByTestId("sidebar").evaluate((el) => el.getBoundingClientRect().width);

    await expect(texto).toBeVisible();
    const anchoCompleto = await ancho();

    await page.getByTestId("btn-contraer-menu").click();
    await expect(texto).toBeHidden();
    await expect(page.getByTestId("menu-ventas").locator("svg")).toBeVisible();
    await expect(page.getByTestId("menu-ventas")).toHaveAttribute("aria-label", "Ventas");
    await expect.poll(ancho).toBeLessThan(anchoCompleto / 2);

    await page.getByTestId("btn-contraer-menu").click();
    await expect(texto).toBeVisible();
    await expect.poll(ancho).toBe(anchoCompleto);
  });

  test("recuerda si el menú quedó contraído al recargar", async ({ page }) => {
    await iniciarSesionComo(page, "ADMIN");
    await page.goto("/dashboard.html");
    await page.getByTestId("btn-contraer-menu").click();
    await page.reload();
    await expect(page.getByTestId("menu-ventas").locator(".sidebar-texto")).toBeHidden();
  });

  test("el CAJERO no ve el grupo Finanzas ni sus módulos", async ({ page }) => {
    await iniciarSesionComo(page, "CAJERO");
    await page.goto("/dashboard.html");
    await expect(titulosDeGrupo(page)).toHaveText(["Ventas", "Productos"]);
    await expect(page.getByTestId("menu-ventas")).toBeVisible();
    await expect(page.getByTestId("menu-cuentas_corrientes")).toBeVisible();
    await expect(page.getByTestId("menu-productos")).toBeVisible();
    for (const nombre of ["clientes", "proveedores", "insumos", "bienes_uso", "gastos", "reportes"]) {
      await expect(page.getByTestId(`menu-${nombre}`)).toHaveCount(0);
    }
  });

  const PANTALLAS = [
    ["ventas", "ventas.html", "Ventas"],
    ["cuentas_corrientes", "cuenta-corriente.html", "Cuenta Corriente"],
    ["clientes", "clientes.html", "Clientes"],
    ["productos", "productos.html", "Productos"],
    ["proveedores", "proveedores.html", "Proveedores"],
    ["insumos", "insumos.html", "Insumos"],
    ["bienes_uso", "bienes-uso.html", "Bienes de Uso"],
    ["gastos", "gastos.html", "Gastos"],
    ["reportes", "reportes.html", "Reportes"],
  ];

  for (const [modulo, archivo, titulo] of PANTALLAS) {
    test(`el menú abre ${titulo} y la pantalla dice En construcción`, async ({ page }) => {
      await iniciarSesionComo(page, "ADMIN");
      await page.goto("/dashboard.html");
      await page.getByTestId(`menu-${modulo}`).click();
      await expect(page).toHaveURL(new RegExp(`${archivo}$`));
      await expect(page.getByRole("heading", { name: titulo, exact: true })).toBeVisible();
      await expect(page.getByText("En construcción")).toBeVisible();
      await expect(page.getByTestId(`menu-${modulo}`)).toHaveAttribute("aria-current", "page");
      await expect(page.getByTestId("btn-cerrar-sesion")).toBeVisible();
    });
  }

  test("el CAJERO también entra a las pantallas que puede ver", async ({ page }) => {
    await iniciarSesionComo(page, "CAJERO");
    await page.goto("/dashboard.html");
    for (const [modulo, archivo] of [["ventas", "ventas.html"], ["cuentas_corrientes", "cuenta-corriente.html"], ["productos", "productos.html"]]) {
      await page.getByTestId(`menu-${modulo}`).click();
      await expect(page).toHaveURL(new RegExp(`${archivo}$`));
      await expect(page.getByText("En construcción")).toBeVisible();
    }
  });

  test("sin sesión, una pantalla de módulo redirige al login", async ({ page }) => {
    await page.goto("/productos.html");
    await expect(page).toHaveURL(/login\.html$/);
  });

  test("el Panel siempre está y figura como página actual", async ({ page }) => {
    await iniciarSesionComo(page, "CAJERO");
    await page.goto("/dashboard.html");
    await expect(page.getByTestId("menu-panel")).toHaveAttribute("aria-current", "page");
  });

  test("el encabezado tiene la campana y Cerrar Sesión", async ({ page }) => {
    await iniciarSesionComo(page, "CAJERO");
    await page.goto("/dashboard.html");
    await expect(page.getByTestId("campana")).toBeVisible();
    await expect(page.getByTestId("btn-cerrar-sesion")).toBeVisible();
  });

  test("en celular el menú está oculto y se abre con el botón", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 700 });
    await iniciarSesionComo(page, "ADMIN");
    await page.goto("/dashboard.html");
    await expect(page.getByTestId("btn-menu")).toBeVisible();
    await expect(page.getByTestId("menu-panel")).not.toBeInViewport();
    await page.getByTestId("btn-menu").click();
    await expect(page.getByTestId("menu-panel")).toBeInViewport();
  });
});

test.describe("Cierre de sesión", () => {
  for (const rol of ["ADMIN", "CAJERO"]) {
    test(`el botón Cerrar Sesión está visible para ${rol}`, async ({ page }) => {
      await iniciarSesionComo(page, rol);
      await page.goto("/dashboard.html");
      await expect(page.getByRole("button", { name: "Cerrar Sesión" })).toBeVisible();
    });
  }

  test("pide confirmación, llama al backend con Bearer, borra los tokens y vuelve al login", async ({ page }) => {
    const llamadas = await simularApi(page, logoutOk);
    await iniciarSesionComo(page, "ADMIN");
    const { access } = await tokensGuardados(page);
    await page.goto("/dashboard.html");

    let tipoDialogo = "";
    page.once("dialog", (dialog) => {
      tipoDialogo = dialog.type();
      dialog.accept();
    });
    await page.getByRole("button", { name: "Cerrar Sesión" }).click();

    await expect(page).toHaveURL(/login\.html$/);
    expect(tipoDialogo).toBe("confirm");
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0].metodo).toBe("POST");
    expect(llamadas[0].ruta).toBe("/auth/logout");
    expect(llamadas[0].headers.authorization).toBe(`Bearer ${access}`);
    expect(await tokensGuardados(page)).toEqual({ access: null, refresh: null });
  });

  test("si se cancela la confirmación se queda en la pantalla y conserva la sesión", async ({ page }) => {
    const llamadas = await simularApi(page, logoutOk);
    await iniciarSesionComo(page, "ADMIN");
    await page.goto("/dashboard.html");

    page.once("dialog", (dialog) => dialog.dismiss());
    await page.getByRole("button", { name: "Cerrar Sesión" }).click();

    await expect(page).toHaveURL(/dashboard\.html$/);
    expect(llamadas).toHaveLength(0);
    expect((await tokensGuardados(page)).access).not.toBeNull();
  });

  test("si el token ya expiró (401) igual cierra la sesión y va al login sin error", async ({ page }) => {
    await simularApi(page, {
      "POST /auth/logout": {
        status: 401,
        body: { status: "error", mensaje: "Token inválido, vencido o no proporcionado" },
      },
    });
    await iniciarSesionComo(page, "ADMIN");
    await page.goto("/dashboard.html");

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Cerrar Sesión" }).click();

    await expect(page).toHaveURL(/login\.html$/);
    expect(await tokensGuardados(page)).toEqual({ access: null, refresh: null });
  });

  test("si el backend no responde igual limpia la sesión y va al login", async ({ page }) => {
    await simularApi(page, { "POST /auth/logout": { abortar: true } });
    await iniciarSesionComo(page, "ADMIN");
    await page.goto("/dashboard.html");

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Cerrar Sesión" }).click();

    await expect(page).toHaveURL(/login\.html$/);
    expect(await tokensGuardados(page)).toEqual({ access: null, refresh: null });
  });

  test("con el botón Atrás no se puede volver a ver el dashboard", async ({ page }) => {
    await simularApi(page, logoutOk);
    await iniciarSesionComo(page, "ADMIN");
    await page.goto("/dashboard.html");

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Cerrar Sesión" }).click();
    await expect(page).toHaveURL(/login\.html$/);

    await page.goBack();
    await expect(page).toHaveURL(/login\.html$/);
  });

  // El front no avisa de una operación sin guardar antes de cerrar sesión: usa un
  // confirm() genérico y todavía no hay módulos con formularios que puedan tenerla.
  test.fixme("con una operación pendiente avisa antes de cerrar sesión", async () => {});

  // Hoy solo se borran los tokens de localStorage; no hay caché de negocio que limpiar.
  test.fixme("al cerrar sesión se invalida la caché y el estado en memoria del negocio", async () => {});
});
