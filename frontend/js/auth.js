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

const mostrarError = (idCampo, mensaje) => {
  const errorEl = document.getElementById(`error-${idCampo}`);
  if (errorEl) {
    errorEl.textContent = mensaje;
    errorEl.style.display = "block";
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
