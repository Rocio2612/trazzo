// frontend/js/bienes-uso.js
import { Tabla } from './componentes/tabla.js';
import { Modal } from './componentes/modal.js';
import { mostrarConfirmacion } from './componentes/modal-confirmacion.js';

let datosBienes = [];

const formatearMoneda = (valor) => {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(valor);
};

const estadosMap = {
    'EN_USO': 'En uso',
    'EN_REPARACION': 'En reparación',
    'ROTO': 'Roto',
    'DADO_DE_BAJA': 'Dado de baja'
};

let tablaBienes;

function renderizarTabla(datos) {
    // Calcular y mostrar la sumatoria
    const sumatoria = datos.reduce((total, item) => total + item.valor_total, 0);
    document.getElementById('sumatoria-bienes').textContent = formatearMoneda(sumatoria);

    const columnas = [
        { key: 'nombre', label: 'NOMBRE' },
        { key: 'valor_adquisicion', label: 'VALOR DE ADQUISICIÓN', render: (val) => formatearMoneda(val) },
        { key: 'cantidad', label: 'CANTIDAD' },
        { key: 'valor_total', label: 'VALOR TOTAL', render: (val) => formatearMoneda(val) },
        { key: 'fecha', label: 'FECHA' },
        { 
            key: 'estado', 
            label: 'ESTADO',
            render: (val) => `<span style="background:#f0f0f0; padding:4px 8px; border-radius:12px; font-size:0.85rem; border: 1px solid #ddd;">${estadosMap[val] || val}</span>`
        },
        { key: 'creado_por', label: 'CREADO POR' }
    ];

    tablaBienes = new Tabla({
        contenedorId: 'contenedor-tabla',
        columnas: columnas,
        datos: datos,
        modulo: 'bienes_uso',
        placeholderBusqueda: 'Buscar por nombre...',
        onAccion: (fila, tdAcciones) => {
            const btnEditar = document.createElement('button');
            btnEditar.className = 'btn btn-outline';
            btnEditar.innerHTML = '✏️'; 
            btnEditar.dataset.testid = `bienes-editar-${fila.id}`;
            btnEditar.onclick = () => abrirModalEditar(fila);

            const btnOcultar = document.createElement('button');
            btnOcultar.className = 'btn btn-outline';
            btnOcultar.innerHTML = '🚫'; 
            btnOcultar.dataset.testid = `bienes-ocultar-${fila.id}`;
            btnOcultar.onclick = () => {
                mostrarConfirmacion({
                    titulo: 'Ocultar Bien de Uso',
                    mensaje: `¿Ocultar "${fila.nombre}"? Advertencia: eliminar un bien de uso cambia el flujo de caja histórico.`,
                    textoBoton: 'Ocultar',
                    esPeligro: true,
                    onConfirmar: () => {
                        datosBienes = datosBienes.filter(i => i.id !== fila.id);
                        renderizarTabla(datosBienes);
                    }
                });
            };

            tdAcciones.appendChild(btnEditar);
            tdAcciones.appendChild(btnOcultar);
        }
    });
}

let modalBien;

function crearModalBien() {
    const contenidoHTML = `
        <div style="display:flex; flex-direction:column; gap:1rem;">
            <div><label>Nombre *</label><input type="text" id="bien-nombre" class="input-buscar" style="width:100%"></div>
            <div><label>Valor de adquisición (costo unitario) *</label><input type="number" id="bien-valor" class="input-buscar" style="width:100%"></div>
            <div><label>Cantidad *</label><input type="number" id="bien-cantidad" class="input-buscar" style="width:100%"></div>
            <div><label>Fecha de adquisición *</label><input type="text" id="bien-fecha" class="input-buscar" style="width:100%" placeholder="dd-mm-aaaa"></div>
            <div>
                <label>Estado (opcional)</label>
                <select id="bien-estado" class="input-buscar" style="width:100%">
                    <option value="EN_USO">En uso</option>
                    <option value="EN_REPARACION">En reparación</option>
                    <option value="ROTO">Roto</option>
                    <option value="DADO_DE_BAJA">Dado de baja</option>
                </select>
            </div>
            <div>
                <label>Valor total</label>
                <input type="text" id="bien-valor-total" class="input-buscar" style="width:100%; background-color:#f5f5f5;" value="Se calcula automáticamente" readonly>
                <p style="font-size:0.8rem; color:#666;">Cantidad × valor de adquisición. Lo calcula el sistema.</p>
            </div>
        </div>
    `;

    modalBien = new Modal({
        id: 'bien',
        titulo: 'Nuevo bien de uso',
        contenidoHTML: contenidoHTML,
        onGuardar: async (overlay) => {
            const valor = parseFloat(overlay.querySelector('#bien-valor').value) || 0;
            const cantidad = parseFloat(overlay.querySelector('#bien-cantidad').value) || 0;
            
            const nuevoBien = {
                id: Date.now(),
                nombre: overlay.querySelector('#bien-nombre').value,
                valor_adquisicion: valor,
                cantidad: cantidad,
                valor_total: valor * cantidad,
                fecha: overlay.querySelector('#bien-fecha').value,
                estado: overlay.querySelector('#bien-estado').value,
                creado_por: 'admin1'
            };
            
            datosBienes.push(nuevoBien);
            renderizarTabla(datosBienes);
        }
    });

    const inputValor = modalBien.overlay.querySelector('#bien-valor');
    const inputCantidad = modalBien.overlay.querySelector('#bien-cantidad');
    const inputTotal = modalBien.overlay.querySelector('#bien-valor-total');

    const calcularTotal = () => {
        const valor = parseFloat(inputValor.value) || 0;
        const cantidad = parseFloat(inputCantidad.value) || 0;
        inputTotal.value = (valor * cantidad) > 0 ? formatearMoneda(valor * cantidad) : 'Se calcula automáticamente';
    };

    inputValor.addEventListener('input', calcularTotal);
    inputCantidad.addEventListener('input', calcularTotal);
}

function abrirModalEditar(fila) {
    modalBien.overlay.querySelector('.modal-header h2').textContent = 'Editar bien de uso';
    modalBien.overlay.querySelector('#bien-nombre').value = fila.nombre;
    modalBien.overlay.querySelector('#bien-valor').value = fila.valor_adquisicion;
    modalBien.overlay.querySelector('#bien-cantidad').value = fila.cantidad;
    modalBien.overlay.querySelector('#bien-fecha').value = fila.fecha;
    modalBien.overlay.querySelector('#bien-estado').value = fila.estado;
    
    modalBien.overlay.querySelector('#bien-valor').dispatchEvent(new Event('input'));
    modalBien.abrir();
}

document.addEventListener('DOMContentLoaded', () => {
    renderizarTabla(datosBienes);
    crearModalBien();

    document.getElementById('btn-nuevo-bien').addEventListener('click', () => {
        modalBien.overlay.querySelector('.modal-header h2').textContent = 'Nuevo bien de uso';
        modalBien.overlay.querySelector('#bien-nombre').value = '';
        modalBien.overlay.querySelector('#bien-valor').value = '';
        modalBien.overlay.querySelector('#bien-cantidad').value = '';
        modalBien.overlay.querySelector('#bien-fecha').value = '';
        modalBien.overlay.querySelector('#bien-estado').value = 'EN_USO';
        modalBien.overlay.querySelector('#bien-valor-total').value = 'Se calcula automáticamente';
        modalBien.abrir();
    });
});