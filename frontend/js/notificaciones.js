// Trazzo - Sprint 2 - Notificaciones y Alertas de Stock
// Lógica de la campana común del layout (ids: campana, campana-contador, panel-alertas).
// Lo inicia layout.js en todas las pantallas. Usa fetchAPI global (api.js).

let iniciado = false;

export const iniciarNotificaciones = () => {
  if (iniciado) return;

  const btnCampana = document.getElementById("campana");
  const contador = document.getElementById("campana-contador");
  const panel = document.getElementById("panel-alertas");
  if (!btnCampana || !contador) return;
  iniciado = true;

  let pollingInterval;

  const actualizarContador = async () => {
    if (document.hidden) return;
    try {
      const data = await fetchAPI("/notificaciones/contador");
      if (data.cantidad > 0) {
        contador.textContent = data.cantidad > 99 ? "99+" : data.cantidad;
        contador.hidden = false;
      } else {
        contador.hidden = true;
      }
    } catch (error) {
      console.warn("Fallo al consultar alertas", error);
    }
  };

  actualizarContador();
  pollingInterval = setInterval(actualizarContador, 45000);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) clearInterval(pollingInterval);
    else {
      actualizarContador();
      pollingInterval = setInterval(actualizarContador, 45000);
    }
  });

  btnCampana.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (!panel) return;
    panel.hidden = !panel.hidden;
    if (!panel.hidden) {
      cargarAlertas(panel, actualizarContador);
    }
  });

  document.addEventListener("click", (e) => {
    if (panel && !panel.contains(e.target) && !btnCampana.contains(e.target)) {
      panel.hidden = true;
    }
  });
};

const cargarAlertas = async (contenedor, actualizarContador) => {
  contenedor.innerHTML = ""; // Limpiar
  try {
    const alertas = await fetchAPI("/notificaciones");
    if (alertas.length === 0) {
      const p = document.createElement("p");
      p.textContent = "Sin alertas";
      p.style.textAlign = "center";
      p.style.color = "#8c8c8c";
      contenedor.appendChild(p);
      return;
    }

    alertas.forEach((alerta) => {
      const div = document.createElement("div");
      div.style.cssText =
        "display:flex; justify-content:space-between; align-items:center; padding:0.5rem 0; border-bottom:1px solid #eee;";

      const p = document.createElement("span");
      p.textContent = `Quedan ${alerta.stock_actual} de ${alerta.producto_nombre}`;
      p.style.fontSize = "0.85rem";
      p.style.color = "#212529";

      const btn = document.createElement("button");
      btn.textContent = "Eliminar";
      btn.style.cssText =
        "padding: 0.2rem 0.5rem; font-size: 0.75rem; cursor: pointer; background: white; border: 1px solid #ccc; border-radius: 4px;";

      btn.onclick = async () => {
        try {
          // Endpoint actualizado según Sprint 2 (Módulo 4)
          await fetchAPI(
            `/notificaciones/${alerta.id}/eliminar-vista`,
            "PATCH",
          );
          div.remove();
          actualizarContador();
        } catch (e) {
          alert("Error al eliminar la alerta");
        }
      };

      div.appendChild(p);
      div.appendChild(btn);
      contenedor.appendChild(div);
    });
  } catch (error) {
    contenedor.textContent = "Error al cargar alertas.";
  }
};
