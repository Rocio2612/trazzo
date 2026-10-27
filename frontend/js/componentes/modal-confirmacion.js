export function mostrarConfirmacion({ titulo, mensaje, textoBoton = 'Confirmar', esPeligro = false, onConfirmar }) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.display = 'flex';

    const claseBoton = esPeligro ? 'btn-peligro' : 'btn-primario';
    const testidBoton = esPeligro ? 'modal-confirmar-eliminar' : 'modal-confirmar-accion';

    overlay.innerHTML = `
        <div class="modal-contenido modal-sm" role="alertdialog">
            <div class="modal-header">
                <h2>${titulo}</h2>
            </div>
            <div class="modal-body">
                <p>${mensaje}</p>
            </div>
            <div class="modal-footer">
                <button class="btn btn-outline" id="btn-cancelar-confirm">Cancelar</button>
                <button class="btn ${claseBoton}" id="btn-aceptar-confirm" data-testid="${testidBoton}">${textoBoton}</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector('#btn-cancelar-confirm').addEventListener('click', () => overlay.remove());
    overlay.querySelector('#btn-aceptar-confirm').addEventListener('click', () => {
        overlay.remove();
        onConfirmar();
    });
}