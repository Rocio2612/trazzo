import { crearEstadoVacio } from './estado-vacio.js';

export class Tabla {
    constructor({ contenedorId, columnas, datos, modulo, placeholderBusqueda = "Buscar...", onAccion }) {
        this.contenedor = document.getElementById(contenedorId);
        this.columnas = columnas; 
        this.datosOriginales = datos;
        this.datosFiltrados = [...datos];
        this.placeholderBusqueda = placeholderBusqueda;
        this.modulo = modulo; 
        this.onAccion = onAccion;
        this.render();
    }

    render() {
        this.contenedor.innerHTML = '';
        
        const divBuscador = document.createElement('div');
        divBuscador.className = 'tabla-buscador';
        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = this.placeholderBusqueda;
        input.className = 'input-buscar';
        input.dataset.testid = `${this.modulo}-buscador`;
        
        input.addEventListener('input', (e) => {
            const texto = e.target.value.toLowerCase();
            this.datosFiltrados = this.datosOriginales.filter(item => 
                Object.values(item).some(val => String(val).toLowerCase().includes(texto))
            );
            this.actualizarCuerpo();
        });

        divBuscador.appendChild(input);
        this.contenedor.appendChild(divBuscador);

        const table = document.createElement('table');
        table.className = 'tabla-datos';
        table.dataset.testid = `${this.modulo}-tabla`;
        
        const thead = document.createElement('thead');
        const trHead = document.createElement('tr');
        this.columnas.forEach(col => {
            const th = document.createElement('th');
            th.textContent = col.label;
            trHead.appendChild(th);
        });
        thead.appendChild(trHead);
        table.appendChild(thead);

        this.tbody = document.createElement('tbody');
        table.appendChild(this.tbody);
        this.contenedor.appendChild(table);
        this.actualizarCuerpo();
    }

    actualizarCuerpo() {
        this.tbody.innerHTML = '';

        if (this.datosFiltrados.length === 0) {
            const tr = document.createElement('tr');
            const td = document.createElement('td');
            td.colSpan = this.columnas.length + (this.onAccion ? 1 : 0);
            td.appendChild(crearEstadoVacio('No se encontraron resultados.'));
            tr.appendChild(td);
            this.tbody.appendChild(tr);
            return;
        }

        this.datosFiltrados.forEach(fila => {
            const tr = document.createElement('tr');
            this.columnas.forEach(col => {
                const td = document.createElement('td');
                td.textContent = fila[col.key] !== null && fila[col.key] !== undefined ? fila[col.key] : '-';
                tr.appendChild(td);
            });

            if (this.onAccion) {
                const tdAcciones = document.createElement('td');
                tdAcciones.className = 'tabla-acciones';
                this.onAccion(fila, tdAcciones);
                tr.appendChild(tdAcciones);
            }
            this.tbody.appendChild(tr);
        });
    }
}