// js/notificaciones.js
import { fetchAPI } from "./api.js";
import { generarTextoAlerta } from "./utils/productosUtils.js";

let pollingInterval = null;

export const iniciarNotificaciones = () => {
  const campanaContador = document.getElementById("campana-contador");
  if (!campanaContador) return; // Si no hay campana en esta vista, no hace nada

  const actualizarContador = async () => {
    if (document.hidden) return; // Pausar si la pestaña está oculta
    try {
      const data = await fetchAPI("/notificaciones/contador");
      if (data.cantidad > 0) {
        campanaContador.textContent =
          data.cantidad > 99 ? "99+" : data.cantidad;
        campanaContador.style.display = "inline-block";
      } else {
        campanaContador.style.display = "none";
      }
    } catch (error) {
      console.warn("Error al consultar notificaciones (silencioso)");
    }
  };

  // Polling cada 45 segundos
  actualizarContador();
  pollingInterval = setInterval(actualizarContador, 45000);

  // Pausar/Reanudar con visibilitychange
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      clearInterval(pollingInterval);
    } else {
      actualizarContador();
      pollingInterval = setInterval(actualizarContador, 45000);
    }
  });

  // Lógica para abrir/cerrar el panel de alertas (asumiendo un dropdown)
  const btnCampana = document.getElementById("btn-campana");
  const panelAlertas = document.getElementById("panel-alertas");

  if (btnCampana && panelAlertas) {
    btnCampana.addEventListener("click", async () => {
      panelAlertas.classList.toggle("hidden");
      if (!panelAlertas.classList.contains("hidden")) {
        cargarListaAlertas(panelAlertas);
      }
    });
  }
};

const cargarListaAlertas = async (contenedor) => {
  contenedor.innerHTML = "<p>Cargando...</p>"; // Solo carga estática segura
  try {
    const alertas = await fetchAPI("/notificaciones");
    contenedor.innerHTML = ""; // Limpiar

    if (alertas.length === 0) {
      const p = document.createElement("p");
      p.className = "texto-vacio";
      p.textContent = "Sin alertas";
      contenedor.appendChild(p);
      return;
    }

    alertas.forEach((alerta) => {
      const div = document.createElement("div");
      div.className = "alerta-item";

      const p = document.createElement("p");
      p.textContent = generarTextoAlerta(
        alerta.producto_nombre,
        alerta.stock_actual,
      );

      const btnDescartar = document.createElement("button");
      btnDescartar.textContent = "Descartar";
      btnDescartar.className = "btn btn-outline btn-sm";
      btnDescartar.setAttribute("data-testid", `alerta-descartar-${alerta.id}`);

      btnDescartar.onclick = async () => {
        try {
          await fetchAPI(`/notificaciones/${alerta.id}/descartar`, "PATCH");
          div.remove();
          // Actualizar contador rápido
          document.getElementById("campana-contador").click();
        } catch (e) {
          alert("Error al descartar alerta");
        }
      };

      div.appendChild(p);
      div.appendChild(btnDescartar);
      contenedor.appendChild(div);
    });
  } catch (error) {
    contenedor.innerHTML = "<p>Error al cargar alertas.</p>";
  }
};
