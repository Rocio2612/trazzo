// js/notificaciones.js

// --- FUNCIONES PURAS (Para Vitest) ---
export const textoAlerta = (alerta) => {
  if (alerta.mensaje) return alerta.mensaje;

  // Acepta tanto producto_nombre como nombre
  const nombre =
    alerta.producto_nombre || alerta.producto || alerta.nombre || "Producto";

  // Acepta tanto stock_actual como cantidad
  const stock =
    alerta.stock_actual !== undefined
      ? alerta.stock_actual
      : alerta.cantidad !== undefined
        ? alerta.cantidad
        : null;

  if (stock === null) return nombre;
  return `${nombre}, quedan ${stock}`;
};

export const textoContador = (cantidad) => {
  if (cantidad > 99) return "99+";
  return String(cantidad);
};

// --- LÓGICA DE LA CAMPANA ---

export const iniciarNotificaciones = () => {
  const btnCampana = document.getElementById("campana");
  const contador = document.getElementById("campana-contador");
  const panel = document.getElementById("panel-alertas");
  if (!btnCampana || !contador) return;

  let pollingInterval;

  const actualizarContador = async () => {
    if (document.hidden) return;
    try {
      const data = await fetchAPI("/notificaciones/contador");
      if (data.cantidad > 0) {
        contador.textContent = textoContador(data.cantidad); // Usamos la función
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

const mostrarSinAlertas = (contenedor) => {
  const p = document.createElement("p");
  p.textContent = "Sin alertas";
  p.style.textAlign = "center";
  p.style.color = "#8c8c8c";
  contenedor.appendChild(p);
};

const cargarAlertas = async (contenedor, actualizarContador) => {
  contenedor.innerHTML = "";
  try {
    const alertas = await fetchAPI("/notificaciones");
    if (alertas.length === 0) {
      mostrarSinAlertas(contenedor);
      return;
    }

    alertas.forEach((alerta) => {
      const div = document.createElement("div");
      div.style.cssText =
        "display:flex; justify-content:space-between; align-items:center; padding:0.5rem 0; border-bottom:1px solid #eee;";

      const p = document.createElement("span");
      p.textContent = textoAlerta(alerta); // Usamos la función
      p.style.fontSize = "0.85rem";

      const btn = document.createElement("button");
      btn.textContent = "Eliminar";
      btn.style.cssText =
        "padding: 0.2rem 0.5rem; font-size: 0.75rem; cursor: pointer; background: white; border: 1px solid #ccc; border-radius: 4px;";

      btn.onclick = async () => {
        try {
          await fetchAPI(
            `/notificaciones/${alerta.id}/eliminar-vista`,
            "PATCH",
          );

          div.remove();
          // Si era la última alerta, el panel avisa que no quedan.
          if (contenedor.children.length === 0) mostrarSinAlertas(contenedor);
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
