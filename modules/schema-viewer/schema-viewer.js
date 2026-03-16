/**
 * Schema Graph Viewer Module
 * Visualizes object relationships in an interactive node graph
 */

const SchemaViewer = {
    nodes: [],
    rootObject: null,

    init() {
        document.getElementById('btn-load-schema').addEventListener('click', () => {
            const objectName = document.getElementById('schema-search').value.trim();
            if (objectName) this.loadSchema(objectName);
        });

        document.getElementById('schema-search').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                const objectName = e.target.value.trim();
                if (objectName) this.loadSchema(objectName);
            }
        });

        document.getElementById('btn-reset-schema').addEventListener('click', () => this.resetView());
    },

    async loadSchema(objectName) {
        const canvas = document.getElementById('schema-canvas');
        canvas.innerHTML = '<div class="loading-state"><div class="spinner"></div>Loading schema...</div>';
        this.rootObject = objectName;

        try {
            const data = await sendMessage({ action: 'describeSObject', sobject: objectName });
            this.renderGraph(data);
            setStatus(`Schema loaded for ${objectName}`);
        } catch (error) {
            canvas.innerHTML = `<div class="empty-state"><span class="empty-icon">❌</span><p>${error.message}</p></div>`;
        }
    },

    renderGraph(metadata) {
        const canvas = document.getElementById('schema-canvas');
        canvas.innerHTML = '';
        canvas.style.position = 'relative';

        const fields = metadata.fields || [];
        const childRels = (metadata.childRelationships || []).filter(r => r.relationshipName);
        const parentRefs = fields.filter(f => f.type === 'reference' && f.referenceTo?.length);

        // Root node
        const rootNode = this.createNode(metadata.name, fields.slice(0, 10), true, 280, 30);
        canvas.appendChild(rootNode);

        // Layout parent nodes on the left
        const parentNodes = [];
        parentRefs.slice(0, 6).forEach((ref, idx) => {
            const refObj = ref.referenceTo[0];
            const node = this.createNode(refObj, [
                { name: 'Id', type: 'id' },
                { name: 'Name', type: 'string' },
                { name: `↑ ${ref.name} (${ref.relationshipName || ''})`, type: 'reference' }
            ], false, 20, 30 + idx * 140);
            parentNodes.push({ element: node, name: refObj, x: 20, y: 30 + idx * 140 });
            canvas.appendChild(node);

            // Draw connector
            const connector = this.createConnector(190, 60 + idx * 140, 280, 50 + idx * 20);
            canvas.appendChild(connector);
        });

        // Layout child nodes on the right
        childRels.slice(0, 8).forEach((rel, idx) => {
            const node = this.createNode(rel.childSObject, [
                { name: 'Id', type: 'id' },
                { name: rel.field, type: 'reference' },
                { name: `${rel.relationshipName}`, type: 'child' }
            ], false, 540, 30 + idx * 130);
            canvas.appendChild(node);

            // Draw connector
            const connector = this.createConnector(460, 50 + idx * 20, 540, 60 + idx * 130);
            canvas.appendChild(connector);
        });

        // Make nodes draggable
        canvas.querySelectorAll('.schema-node').forEach(node => {
            this.makeDraggable(node, canvas);
        });
    },

    createNode(name, fields, isRoot, x, y) {
        const node = document.createElement('div');
        node.className = `schema-node ${isRoot ? 'root' : 'child'}`;
        node.style.left = `${x}px`;
        node.style.top = `${y}px`;

        let fieldsHtml = fields.map(f => `
      <div class="schema-field" data-field="${f.name}" title="${f.type}">
        <span>${f.name}</span>
        <span class="schema-field-type">${f.type}</span>
      </div>
    `).join('');

        node.innerHTML = `
      <div class="schema-node-header">
        <span>${name}</span>
        <span style="font-size:10px;opacity:0.7">${isRoot ? '⚡ Root' : '🔗'}</span>
      </div>
      <div class="schema-node-fields">${fieldsHtml}</div>
    `;

        // Click on node to load its schema
        if (!isRoot) {
            node.querySelector('.schema-node-header').addEventListener('dblclick', () => {
                document.getElementById('schema-search').value = name;
                this.loadSchema(name);
            });
        }

        // Click on field to generate query
        node.querySelectorAll('.schema-field').forEach(field => {
            field.addEventListener('click', () => {
                const fieldName = field.dataset.field;
                if (isRoot) {
                    const query = `SELECT ${fieldName} FROM ${name} LIMIT 10`;
                    navigator.clipboard.writeText(query);
                    showToast(`Copied: ${query}`, 'success');
                }
            });
        });

        return node;
    },

    createConnector(x1, y1, x2, y2) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.classList.add('schema-connector');
        svg.style.position = 'absolute';
        svg.style.left = '0';
        svg.style.top = '0';
        svg.style.width = '100%';
        svg.style.height = '100%';
        svg.style.pointerEvents = 'none';

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const midX = (x1 + x2) / 2;
        path.setAttribute('d', `M${x1},${y1} C${midX},${y1} ${midX},${y2} ${x2},${y2}`);
        path.setAttribute('stroke', 'rgba(123, 47, 247, 0.4)');
        path.setAttribute('stroke-width', '2');
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke-dasharray', '4,4');

        svg.appendChild(path);
        return svg;
    },

    makeDraggable(element, container) {
        element.addEventListener('mousedown', (e) => {
            if (e.target.closest('.schema-field')) return; // Don't drag when clicking fields
            e.preventDefault();

            const startX = e.clientX;
            const startY = e.clientY;
            const startLeft = parseInt(element.style.left) || 0;
            const startTop = parseInt(element.style.top) || 0;

            element.style.zIndex = '10';

            const onMouseMove = (ev) => {
                const dx = ev.clientX - startX;
                const dy = ev.clientY - startY;
                element.style.left = `${startLeft + dx}px`;
                element.style.top = `${startTop + dy}px`;
            };

            const onMouseUp = () => {
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
                element.style.zIndex = '';
            };

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });
    },

    resetView() {
        document.getElementById('schema-canvas').innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">🌐</span>
        <p>Search for an object to view its relationship graph</p>
      </div>
    `;
        document.getElementById('schema-search').value = '';
    }
};

document.addEventListener('DOMContentLoaded', () => SchemaViewer.init());

if (typeof window !== 'undefined') {
    window.SchemaViewer = SchemaViewer;
}
