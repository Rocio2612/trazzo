// Rutas que no requieren JWT (según el contrato): no llevan header Authorization
// y un 401 en ellas es un error de credenciales, no una sesión vencida.
const RUTAS_PUBLICAS = [
    '/auth/login',
    '/auth/registro',
    '/auth/refresh',
    '/auth/recuperar',
    '/auth/restablecer'
];

// Función centralizada para hacer peticiones al Backend
async function fetchAPI(endpoint, method = 'GET', body = null) {
    const esPublica = RUTAS_PUBLICAS.includes(endpoint);
    const headers = { 'Content-Type': 'application/json' };
    const token = localStorage.getItem('trazzo_access_token');
    if (token && !esPublica) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    const opciones = { method: method, headers: headers };
    if (body) { opciones.body = JSON.stringify(body); }

    try {
        const response = await fetch(`${API_URL}${endpoint}`, opciones);

        if (response.status === 401 && !esPublica) {
            localStorage.removeItem('trazzo_access_token');
            localStorage.removeItem('trazzo_refresh_token');
            window.location.href = 'login.html'; 
            return; 
        }
        
        const data = await response.json();
        if (!response.ok) throw new Error(data.mensaje || 'Error en la petición');
        return data;

    } catch (error) {
        console.error('Error en fetchAPI:', error);
        throw error; 
    }
}