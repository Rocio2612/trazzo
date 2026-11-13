import { test, expect } from "@playwright/test";
import { iniciarSesionComo } from "./helpers.js";

test("abrir el panel y eliminar una alerta de la vista", async ({ page }) => {
  let alertas = [{ id: 7, producto_nombre: "Collar", stock_actual: 2 }];
  await iniciarSesionComo(page, "CAJERO");
  await page.route("**/*", (route) => {
    const req = route.request();
    if (!["fetch", "xhr"].includes(req.resourceType())) return route.fallback();
    const { pathname } = new URL(req.url());
    const json = (b) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(b),
      });
    if (pathname.endsWith("/auth/yo")) return json({});
    if (pathname.endsWith("/notificaciones")) return json(alertas);
    if (pathname.endsWith("/notificaciones/7/eliminar-vista")) {
      alertas = [];
      return json({ ok: true });
    }
    return route.fallback();
  });
  await page.goto("/productos.html");

  await expect(page.getByTestId("campana-contador")).toHaveText("1");
  await page.getByTestId("campana").click();
  await expect(page.getByText("Collar, quedan 2")).toBeVisible();
  await page.getByTestId("alerta-descartar-7").click();
  await expect(page.getByText("No hay alertas.")).toBeVisible();
  await expect(page.getByTestId("campana-contador")).toBeHidden();
});
