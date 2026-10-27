export function crearEstadoVacio(mensaje = "No hay datos para mostrar.") {
    const div = document.createElement('div');
    div.className = 'estado-vacio';
    div.textContent = mensaje;
    return div;
}