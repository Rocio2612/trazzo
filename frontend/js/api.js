// Función centralizada para hacer peticiones al Backend
async function fetchAPI(endpoint, method = 'GET', body = null) {
    const headers = { 'Content-Type': 'application/json' };
    const token = localStorage.getItem('trazzo_access_token');
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    const opciones = { method: method, headers: headers };
    if (body) { opciones.body = JSON.stringify(body); }

    try {
        const response = await fetch(`${API_URL}${endpoint}`, opciones);
        
        if (response.status === 401) {
            localStorage.removeItem('trazzo_access_token');
            localStorage.removeItem('trazzo_refresh_token');
            window.location.href = 'login.html'; 
            return; 
        }
        
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || 'Error en la petición');
        return data;

    } catch (error) {
        console.error('Error en fetchAPI:', error);
        throw error; 
    }
}