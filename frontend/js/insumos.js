// frontend/js/insumos.js
import { Tabla } from './componentes/tabla.js';
import { Modal } from './componentes/modal.js';
import { mostrarConfirmacion } from './componentes/modal-confirmacion.js';

// Arranca vacío para probar el estado vacío
let datosInsumos = [];

const formatearMoneda = (valor) => {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(valor);
};

let tablaInsumos;

function renderizarTabla(datos) {
    const columnas = [
        { key: 'nombre', label: 'NOMBRE' },
        { key: 'costo_unitario', label: 'COSTO UNITARIO', render: (val) => formatearMoneda(val) },
        { key: 'cantidad', label: 'CANTIDAD' },
        { key: 'unidad', label: 'UNIDAD' },
        { key: 'costo_total', label: 'COSTO TOTAL', render: (val) => formatearMoneda(val) },
        { key: 'fecha', label: 'FECHA' },
        { key: 'proveedor', label: 'PROVEEDOR' },
        { key: 'creado_por', label: 'CREADO POR' }
    ];

    tablaInsumos = new Tabla({
        contenedorId: 'contenedor-tabla',
        columnas: columnas,
        datos: datos,
        modulo: 'insumos',
        placeholderBusqueda: 'Buscar por nombre...',
        onAccion: (fila, tdAcciones) => {
            const btnEditar = document.createElement('button');
            btnEditar.className = 'btn btn-outline';
            btnEditar.innerHTML = '✏️'; 
            btnEditar.dataset.testid = `insumos-editar-${fila.id}`;
            btnEditar.onclick = () => abrirModalEditar(fila);

            const btnOcultar = document.createElement('button');
            btnOcultar.className = 'btn btn-outline';
            btnOcultar.innerHTML = '🚫'; 
            btnOcultar.dataset.testid = `insumos-ocultar-${fila.id}`;
            btnOcultar.onclick = () => {
                mostrarConfirmacion({
                    titulo: 'Ocultar Insumo',
                    mensaje: `¿Ocultar "${fila.nombre}"? Esta acción no afecta al stock ni a los reportes.`,
                    textoBoton: 'Ocultar',
                    esPeligro: true,
                    onConfirmar: () => {
                        // Borrado visual temporal
                        datosInsumos = datosInsumos.filter(i => i.id !== fila.id);
                        renderizarTabla(datosInsumos);
                    }
                });
            };

            tdAcciones.appendChild(btnEditar);
            tdAcciones.appendChild(btnOcultar);
        }
    });
}

let modalInsumo;

function crearModalInsumo() {
    const contenidoHTML = `
        <div style="display:flex; flex-direction:column; gap:1rem;">
            <div><label>Nombre *</label><input type="text" id="insumo-nombre" class="input-buscar" style="width:100%"></div>
            <div><label>Costo unitario *</label><input type="number" id="insumo-costo" class="input-buscar" style="width:100%"></div>
            <div><label>Cantidad *</label><input type="number" id="insumo-cantidad" class="input-buscar" style="width:100%"></div>
            <div>
                <label>Unidad de medida *</label>
                <select id="insumo-unidad" class="input-buscar" style="width:100%">
                    <option value="unidades">unidades</option>
                    <option value="kg">kg</option>
                    <option value="litros">litros</option>
                    <option value="cajas">cajas</option>
                </select>
            </div>
            <div><label>Fecha *</label><input type="text" id="insumo-fecha" class="input-buscar" style="width:100%" placeholder="dd-mm-aaaa"></div>
            <div><label>Proveedor (opcional)</label><input type="text" id="insumo-proveedor" class="input-buscar" style="width:100%" placeholder="Nombre o razón social"></div>
            <div>
                <label>Costo total</label>
                <input type="text" id="insumo-costo-total" class="input-buscar" style="width:100%; background-color:#f5f5f5;" value="Se calcula automáticamente" readonly>
                <p style="font-size:0.8rem; color:#666;">Costo unitario × cantidad. Lo calcula el sistema.</p>
            </div>
        </div>
    `;

    modalInsumo = new Modal({
        id: 'insumo',
        titulo: 'Nuevo insumo',
        contenidoHTML: contenidoHTML,
        onGuardar: async (overlay) => {
            const nuevoInsumo = {
                id: Date.now(),
                nombre: overlay.querySelector('#insumo-nombre').value,
                costo_unitario: parseFloat(overlay.querySelector('#insumo-costo').value) || 0,
                cantidad: parseFloat(overlay.querySelector('#insumo-cantidad').value) || 0,
                unidad: overlay.querySelector('#insumo-unidad').value,
                fecha: overlay.querySelector('#insumo-fecha').value,
                proveedor: overlay.querySelector('#insumo-proveedor').value || '-',
                creado_por: 'admin1' // Simulado
            };
            nuevoInsumo.costo_total = nuevoInsumo.costo_unitario * nuevoInsumo.cantidad;
            
            datosInsumos.push(nuevoInsumo);
            renderizarTabla(datosInsumos);
        }
    });

    const inputCosto = modalInsumo.overlay.querySelector('#insumo-costo');
    const inputCantidad = modalInsumo.overlay.querySelector('#insumo-cantidad');
    const inputTotal = modalInsumo.overlay.querySelector('#insumo-costo-total');

    const calcularTotal = () => {
        const costo = parseFloat(inputCosto.value) || 0;
        const cantidad = parseFloat(inputCantidad.value) || 0;
        inputTotal.value = (costo * cantidad) > 0 ? formatearMoneda(costo * cantidad) : 'Se calcula automáticamente';
    };

    inputCosto.addEventListener('input', calcularTotal);
    inputCantidad.addEventListener('input', calcularTotal);
}

function abrirModalEditar(fila) {
    modalInsumo.overlay.querySelector('.modal-header h2').textContent = 'Editar insumo';
    modalInsumo.overlay.querySelector('#insumo-nombre').value = fila.nombre;
    modalInsumo.overlay.querySelector('#insumo-costo').value = fila.costo_unitario;
    modalInsumo.overlay.querySelector('#insumo-cantidad').value = fila.cantidad;
    modalInsumo.overlay.querySelector('#insumo-unidad').value = fila.unidad;
    modalInsumo.overlay.querySelector('#insumo-fecha').value = fila.fecha;
    modalInsumo.overlay.querySelector('#insumo-proveedor').value = fila.proveedor === '-' ? '' : fila.proveedor;
    
    modalInsumo.overlay.querySelector('#insumo-costo').dispatchEvent(new Event('input'));
    modalInsumo.abrir();
}

document.addEventListener('DOMContentLoaded', () => {
    renderizarTabla(datosInsumos);
    crearModalInsumo();

    document.getElementById('btn-nuevo-insumo').addEventListener('click', () => {
        modalInsumo.overlay.querySelector('.modal-header h2').textContent = 'Nuevo insumo';
        modalInsumo.overlay.querySelector('#insumo-nombre').value = '';
        modalInsumo.overlay.querySelector('#insumo-costo').value = '';
        modalInsumo.overlay.querySelector('#insumo-cantidad').value = '';
        modalInsumo.overlay.querySelector('#insumo-fecha').value = '';
        modalInsumo.overlay.querySelector('#insumo-proveedor').value = '';
        modalInsumo.overlay.querySelector('#insumo-costo-total').value = 'Se calcula automáticamente';
        modalInsumo.abrir();
    });
});