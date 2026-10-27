// --- LÓGICA DE VALIDACIÓN ---
const validarEmail = (email) => {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
};

const validarPassword = (password) => {
  // 8 a 64 caracteres, mayúscula, minúscula, número y símbolo
  const re =
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,64}$/;
  return re.test(password);
};

// Devuelve true si el mensaje se pudo mostrar junto al campo.
const mostrarError = (idCampo, mensaje) => {
  const errorEl = document.getElementById(`error-${idCampo}`);
  if (errorEl) {
    errorEl.textContent = mensaje;
    errorEl.style.display = "block";
  }
  return Boolean(errorEl);
};

// Campos del contrato -> id del input en estas pantallas.
const ID_DE_CAMPO = {
  id_negocio: "negocio",
  correo: "email",
  nueva_password: "password",
};
const idDeCampo = (campo) => ID_DE_CAMPO[campo] || campo;

// Muestra el error que devolvió el Backend junto a su campo, ya sea { errores: { campo: mensaje } }
// o un solo `campo`. Devuelve true solo si todo se pudo mostrar junto a un campo.
const mostrarErrorDeApi = (error) => {
  if (error.errores) {
    const mostrados = Object.entries(error.errores).map(([campo, mensaje]) =>
      mostrarError(idDeCampo(campo), mensaje),
    );
    return mostrados.length > 0 && mostrados.every(Boolean);
  }
  if (error.campo) return mostrarError(idDeCampo(error.campo), error.message);
  return false;
};

// Texto para el bloqueo temporal por demasiados intentos (429).
const mensajeDeBloqueo = (error) => {
  const segundos = error.esperaSegundos;
  if (!segundos) {
    return "Demasiados intentos fallidos. Esperá unos minutos antes de volver a intentar.";
  }
  if (segundos < 60) {
    return `Demasiados intentos fallidos. Esperá ${segundos} segundos antes de volver a intentar.`;
  }
  const minutos = Math.ceil(segundos / 60);
  return `Demasiados intentos fallidos. Esperá ${minutos} ${minutos === 1 ? "minuto" : "minutos"} antes de volver a intentar.`;
};

// Deshabilita el botón de envío mientras se procesa, para no duplicar el pedido.
// La tarea devuelve true si la página está por cambiar (el botón queda deshabilitado).
const conEnvioBloqueado = async (formulario, tarea) => {
  if (formulario.dataset.enviando) return;
  const boton = formulario.querySelector('button[type="submit"]');
  formulario.dataset.enviando = "true";
  if (boton) boton.disabled = true;
  let navegando = false;
  try {
    navegando = Boolean(await tarea());
  } finally {
    delete formulario.dataset.enviando;
    if (boton && !navegando) boton.disabled = false;
  }
};

const limpiarErrores = () => {
  document.querySelectorAll(".error-message").forEach((el) => {
    el.style.display = "none";
    el.textContent = "";
  });
};

// --- LÓGICA DE SESIÓN (JWT) ---
const guardarSesion = (accessToken, refreshToken) => {
  // Guardamos los tokens como acordaron en equipo
  localStorage.setItem("trazzo_access_token", accessToken);
  if (refreshToken) {
    localStorage.setItem("trazzo_refresh_token", refreshToken);
  }
  // Redirigir al panel principal
  window.location.href = "dashboard.html";
};

// Redirigir si ya está logueado (para que no vea el login de nuevo)
if (
  localStorage.getItem("trazzo_access_token") &&
  window.location.pathname.includes("login.html")
) {
  window.location.href = "dashboard.html";
}
