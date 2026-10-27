import { mostrarConfirmacion } from './modal-confirmacion.js';

export class Modal {
    constructor({ id, titulo, contenidoHTML, onGuardar, onCancelar }) {
        this.id = id;
        this.isDirty = false;
        this.onGuardar = onGuardar;
        this.onCancelar = onCancelar;
        this.crearDOM(titulo, contenidoHTML);
        this.agregarEventos();
    }

    crearDOM(titulo, contenidoHTML) {
        this.overlay = document.createElement('div');
        this.overlay.className = 'modal-overlay';
        this.overlay.id = `modal-${this.id}`;
        this.overlay.style.display = 'none';

        this.overlay.innerHTML = `
            <div class="modal-contenido" role="dialog" aria-modal="true">
                <div class="modal-header">
                    <h2>${titulo}</h2>
                    <button class="modal-cerrar" data-testid="modal-cerrar" aria-label="Cerrar">&times;</button>
                </div>
                <div class="modal-body">
                    ${contenidoHTML}
                </div>
                <div class="modal-footer">
                    <button class="btn btn-outline" data-testid="modal-cancelar">Cancelar</button>
                    <button class="btn btn-primario" data-testid="modal-guardar">Guardar</button>
                </div>
            </div>
        `;
        document.body.appendChild(this.overlay);

        this.btnGuardar = this.overlay.querySelector('[data-testid="modal-guardar"]');
        this.btnCancelar = this.overlay.querySelector('[data-testid="modal-cancelar"]');
        this.btnCerrar = this.overlay.querySelector('[data-testid="modal-cerrar"]');
    }

    agregarEventos() {
        this.overlay.addEventListener('input', () => { this.isDirty = true; });

        const intentarCerrar = () => {
            if (this.isDirty) {
                mostrarConfirmacion({
                    titulo: 'Descartar cambios',
                    mensaje: 'Hay datos sin guardar. ¿Seguro que querés salir?',
                    onConfirmar: () => {
                        this.cerrar();
                        if (this.onCancelar) this.onCancelar();
                    }
                });
            } else {
                this.cerrar();
                if (this.onCancelar) this.onCancelar();
            }
        };

        this.btnCerrar.addEventListener('click', intentarCerrar);
        this.btnCancelar.addEventListener('click', intentarCerrar);

        this.btnGuardar.addEventListener('click', async () => {
            this.btnGuardar.disabled = true;
            this.btnGuardar.textContent = 'Guardando...';
            try {
                if (this.onGuardar) await this.onGuardar(this.overlay);
                this.isDirty = false;
                this.cerrar();
            } catch (error) {
                this.mostrarErrorGeneral(error.message || 'Error al guardar');
            } finally {
                this.btnGuardar.disabled = false;
                this.btnGuardar.textContent = 'Guardar';
            }
        });
    }

    abrir() { this.overlay.style.display = 'flex'; this.isDirty = false; }
    cerrar() { this.overlay.style.display = 'none'; this.limpiarErrores(); this.isDirty = false; }

    mostrarError(campo, mensaje) {
        const input = this.overlay.querySelector(`[name="${campo}"]`);
        if (input) {
            input.classList.add('input-error');
            const errorSpan = input.parentElement.querySelector('.mensaje-error');
            if (errorSpan) errorSpan.textContent = mensaje;
        }
    }

    mostrarErrorGeneral(mensaje) {
        let alerta = this.overlay.querySelector('.alerta-general');
        if (!alerta) {
            alerta = document.createElement('div');
            alerta.className = 'alerta-general';
            this.overlay.querySelector('.modal-body').prepend(alerta);
        }
        alerta.textContent = mensaje;
    }

    limpiarErrores() {
        this.overlay.querySelectorAll('.input-error').forEach(el => el.classList.remove('input-error'));
        this.overlay.querySelectorAll('.mensaje-error').forEach(el => el.textContent = '');
        const alerta = this.overlay.querySelector('.alerta-general');
        if (alerta) alerta.remove();
    }
}