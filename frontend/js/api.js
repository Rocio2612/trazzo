// Rutas que no requieren JWT (según el contrato): no llevan header Authorization
// y un 401 en ellas es un error de credenciales, no una sesión vencida.
const RUTAS_PUBLICAS = [
    '/auth/login',
    '/auth/registro',
    '/auth/refresh',
    '/auth/recuperar',
    '/auth/restablecer'
];

// Mientras se renueva el access token, los demás pedidos esperan ese mismo resultado.
let renovacionEnCurso = null;

// Limpieza total del cliente: borra todo lo que Trazzo guardó en localStorage (tokens y preferencias).
function limpiarSesionLocal() {
    Object.keys(localStorage)
        .filter((clave) => clave.startsWith('trazzo_'))
        .forEach((clave) => localStorage.removeItem(clave));
}

function sesionExpirada() {
    limpiarSesionLocal();
    window.location.href = 'login.html';
}

// Pide un access token nuevo con el refresh token. Devuelve true si lo consiguió.
function renovarAccessToken() {
    if (!renovacionEnCurso) {
        renovacionEnCurso = (async () => {
            const refreshToken = localStorage.getItem('trazzo_refresh_token');
            if (!refreshToken) return false;
            try {
                const response = await fetch(`${API_URL}/auth/refresh`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ refresh_token: refreshToken })
                });
                if (!response.ok) return false;
                const data = await response.json();
                if (!data.access_token) return false;
                localStorage.setItem('trazzo_access_token', data.access_token);
                if (data.refresh_token) localStorage.setItem('trazzo_refresh_token', data.refresh_token);
                return true;
            } catch (error) {
                return false;
            }
        })().finally(() => { renovacionEnCurso = null; });
    }
    return renovacionEnCurso;
}

function enviarPeticion(endpoint, method, body, esPublica) {
    const headers = { 'Content-Type': 'application/json' };
    const token = localStorage.getItem('trazzo_access_token');
    if (token && !esPublica) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    const opciones = { method: method, headers: headers };
    if (body) { opciones.body = JSON.stringify(body); }
    return fetch(`${API_URL}${endpoint}`, opciones);
}

// Error con los datos de la respuesta, para que cada pantalla decida qué mostrar:
// status, campo (un campo con error), errores ({ campo: mensaje }) y esperaSegundos (429).
function crearErrorAPI(response, data) {
    const primerError = data.errores ? Object.values(data.errores)[0] : null;
    const error = new Error(data.mensaje || primerError || 'Error en la petición');
    error.status = response.status;
    error.campo = data.campo;
    error.errores = data.errores;
    const espera = parseInt(response.headers.get('Retry-After'), 10) || data.espera_segundos || data.retry_after;
    if (espera) error.esperaSegundos = Number(espera);
    return error;
}

// 403: la cuenta no tiene permiso. Se avisa y se vuelve al Panel (salvo que ya estemos ahí).
function avisarAccesoDenegado(data) {
    alert(data.mensaje || 'No tenés permiso para realizar esta acción.');
    if (!window.location.pathname.endsWith('dashboard.html')) {
        window.location.href = 'dashboard.html';
    }
}

// Función centralizada para hacer peticiones al Backend
async function fetchAPI(endpoint, method = 'GET', body = null) {
    const esPublica = RUTAS_PUBLICAS.includes(endpoint);

    try {
        let response = await enviarPeticion(endpoint, method, body, esPublica);

        // 401 en una ruta protegida: se intenta renovar el token una vez y se repite el pedido.
        // Si no se puede (o es el logout), la sesión terminó: se limpia todo y se va al login.
        if (response.status === 401 && !esPublica) {
            const renovado = endpoint !== '/auth/logout' && await renovarAccessToken();
            if (renovado) response = await enviarPeticion(endpoint, method, body, esPublica);
            if (response.status === 401) {
                sesionExpirada();
                return;
            }
        }

        const data = await response.json().catch(() => ({}));
        if (response.status === 403 && !esPublica) avisarAccesoDenegado(data);
        if (!response.ok) throw crearErrorAPI(response, data);
        return data;

    } catch (error) {
        console.error('Error en fetchAPI:', error);
        throw error;
    }
}
