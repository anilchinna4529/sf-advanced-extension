/**
 * SOQL Builder Module
 * Visual SOQL query builder with field selection, relationships, and filters
 */

const SOQLBuilder = {
    selectedObject: null,
    objectMetadata: null,
    selectedFields: new Set(['Id']),
    selectedRelationships: [],
    filters: [],
    allObjects: [],

    init() {
        const objectSearch = document.getElementById('soql-object-search');
        const objectDropdown = document.getElementById('soql-object-dropdown');
        const fieldSearch = document.getElementById('soql-field-search');

        // Object search
        objectSearch.addEventListener('input', (e) => this.searchObjects(e.target.value));
        objectSearch.addEventListener('focus', () => this.searchObjects(objectSearch.value));
        objectSearch.addEventListener('blur', () => {
            setTimeout(() => objectDropdown.classList.remove('visible'), 200);
        });

        // Field search filter
        if (fieldSearch) {
            fieldSearch.addEventListener('input', (e) => this.filterFields(e.target.value));
        }

        // Add filter button
        document.getElementById('btn-add-filter').addEventListener('click', () => this.addFilter());

        // Copy query
        document.getElementById('btn-copy-query').addEventListener('click', () => {
            const query = this.generateQuery();
            navigator.clipboard.writeText(query);
            showToast('Query copied!', 'success');
        });

        // Run query from builder
        document.getElementById('btn-run-builder-query').addEventListener('click', () => {
            const query = this.generateQuery();
            document.getElementById('soql-editor').value = query;
            switchTab('query-runner');
            // Trigger execute
            setTimeout(() => document.getElementById('btn-execute-query').click(), 100);
        });

        // Load objects when tab activates
        document.addEventListener('tabActivated', (e) => {
            if (e.detail.tab === 'soql-builder' && this.allObjects.length === 0) {
                this.loadObjects();
            }
        });
    },

    async loadObjects() {
        try {
            const data = await sendMessage({ action: 'describeGlobal' });
            if (data && data.sobjects) {
                this.allObjects = data.sobjects
                    .filter(o => o.queryable)
                    .sort((a, b) => a.name.localeCompare(b.name));
            }
        } catch (error) {
            console.log('Could not load objects:', error.message);
        }
    },

    searchObjects(query) {
        const dropdown = document.getElementById('soql-object-dropdown');
        if (!query && this.allObjects.length === 0) {
            this.loadObjects();
        }

        const q = (query || '').toLowerCase();
        const filtered = this.allObjects.filter(o =>
            o.name.toLowerCase().includes(q) ||
            (o.label && o.label.toLowerCase().includes(q))
        ).slice(0, 20);

        if (filtered.length === 0 && !query) {
            dropdown.classList.remove('visible');
            return;
        }

        dropdown.innerHTML = filtered.map(o => `
      <div class="search-dropdown-item" data-name="${o.name}">
        <span class="item-label">${o.label || o.name}</span>
        <span class="item-api">${o.name}</span>
      </div>
    `).join('');

        dropdown.classList.add('visible');

        dropdown.querySelectorAll('.search-dropdown-item').forEach(item => {
            item.addEventListener('mousedown', (e) => {
                e.preventDefault();
                this.selectObject(item.dataset.name);
                dropdown.classList.remove('visible');
            });
        });
    },

    async selectObject(objectName) {
        this.selectedObject = objectName;
        document.getElementById('soql-object-search').value = objectName;
        this.selectedFields = new Set(['Id']);
        this.selectedRelationships = [];
        this.filters = [];

        // Show sections
        document.getElementById('soql-fields-section').style.display = '';
        document.getElementById('soql-relationships-section').style.display = '';
        document.getElementById('soql-filters-section').style.display = '';
        document.getElementById('soql-options-section').style.display = '';

        // Load metadata
        try {
            const data = await sendMessage({ action: 'describeSObject', sobject: objectName });
            this.objectMetadata = data;
            this.renderFields(data.fields || []);
            this.renderRelationships(data);
            this.renderOrderBy(data.fields || []);
            this.updateQuery();
        } catch (error) {
            showToast(`Failed to load ${objectName}: ${error.message}`, 'error');
        }
    },

    renderFields(fields) {
        const container = document.getElementById('available-fields');
        const sortedFields = [...fields].sort((a, b) => a.name.localeCompare(b.name));

        container.innerHTML = sortedFields.map(f => `
      <div class="field-item ${this.selectedFields.has(f.name) ? 'selected' : ''}" data-field="${f.name}">
        <input type="checkbox" ${this.selectedFields.has(f.name) ? 'checked' : ''}>
        <span class="field-item-name">${f.name}</span>
        <span class="field-item-type">${f.type}</span>
      </div>
    `).join('');

        container.querySelectorAll('.field-item').forEach(item => {
            item.addEventListener('click', () => {
                const field = item.dataset.field;
                if (this.selectedFields.has(field)) {
                    this.selectedFields.delete(field);
                    item.classList.remove('selected');
                    item.querySelector('input').checked = false;
                } else {
                    this.selectedFields.add(field);
                    item.classList.add('selected');
                    item.querySelector('input').checked = true;
                }
                this.updateSelectedFieldsUI();
                this.updateQuery();
            });
        });

        this.updateSelectedFieldsUI();
    },

    updateSelectedFieldsUI() {
        const container = document.getElementById('selected-fields');
        const countBadge = document.getElementById('field-count');
        countBadge.textContent = this.selectedFields.size;

        container.innerHTML = Array.from(this.selectedFields).map(f => `
      <span class="field-chip">
        ${f}
        <span class="field-chip-remove" data-remove-field="${f}">×</span>
      </span>
    `).join('');

        container.querySelectorAll('.field-chip-remove').forEach(btn => {
            btn.addEventListener('click', () => {
                this.selectedFields.delete(btn.dataset.removeField);
                this.updateSelectedFieldsUI();
                this.renderFields(this.objectMetadata?.fields || []);
                this.updateQuery();
            });
        });
    },

    filterFields(query) {
        const q = query.toLowerCase();
        document.querySelectorAll('#available-fields .field-item').forEach(item => {
            const name = item.dataset.field.toLowerCase();
            item.style.display = name.includes(q) ? '' : 'none';
        });
    },

    renderRelationships(metadata) {
        const container = document.getElementById('relationship-list');
        const childRels = (metadata.childRelationships || []).filter(r => r.relationshipName);
        const parentRels = (metadata.fields || []).filter(f => f.type === 'reference' && f.relationshipName);

        let html = '';

        parentRels.forEach(f => {
            html += `
        <div class="relationship-item" data-rel-type="parent" data-rel-name="${f.relationshipName}" data-rel-object="${f.referenceTo?.[0] || ''}">
          <input type="checkbox">
          <span class="rel-direction">↑ Parent</span>
          <span class="rel-name">${f.relationshipName} → ${f.referenceTo?.[0] || '?'}</span>
        </div>
      `;
        });

        childRels.slice(0, 15).forEach(r => {
            html += `
        <div class="relationship-item" data-rel-type="child" data-rel-name="${r.relationshipName}" data-rel-object="${r.childSObject}">
          <input type="checkbox">
          <span class="rel-direction">↓ Child</span>
          <span class="rel-name">${r.relationshipName} → ${r.childSObject}</span>
        </div>
      `;
        });

        container.innerHTML = html || '<div class="empty-state-sm">No relationships found</div>';

        container.querySelectorAll('.relationship-item').forEach(item => {
            item.addEventListener('click', () => {
                const cb = item.querySelector('input');
                cb.checked = !cb.checked;
                item.classList.toggle('selected', cb.checked);

                const relInfo = {
                    type: item.dataset.relType,
                    name: item.dataset.relName,
                    object: item.dataset.relObject
                };

                if (cb.checked) {
                    this.selectedRelationships.push(relInfo);
                } else {
                    this.selectedRelationships = this.selectedRelationships.filter(
                        r => r.name !== relInfo.name
                    );
                }
                this.updateQuery();
            });
        });
    },

    renderOrderBy(fields) {
        const select = document.getElementById('soql-orderby');
        select.innerHTML = '<option value="">-- None --</option>' +
            fields.filter(f => f.sortable).map(f =>
                `<option value="${f.name}">${f.name}</option>`
            ).join('');

        select.addEventListener('change', () => this.updateQuery());
        document.getElementById('soql-order-dir').addEventListener('change', () => this.updateQuery());
        document.getElementById('soql-limit').addEventListener('input', () => this.updateQuery());
    },

    addFilter() {
        const filterRows = document.getElementById('filter-rows');
        const fields = this.objectMetadata?.fields || [];
        const filterId = Date.now();

        const row = document.createElement('div');
        row.className = 'filter-row';
        row.dataset.filterId = filterId;
        row.innerHTML = `
      <select class="filter-field">
        ${fields.map(f => `<option value="${f.name}">${f.name}</option>`).join('')}
      </select>
      <select class="filter-operator">
        <option value="=">=</option>
        <option value="!=">!=</option>
        <option value="<"><</option>
        <option value=">">></option>
        <option value="<="><=</option>
        <option value=">=">>=</option>
        <option value="LIKE">LIKE</option>
        <option value="IN">IN</option>
        <option value="NOT IN">NOT IN</option>
      </select>
      <input type="text" class="filter-value" placeholder="Value...">
      <button class="filter-remove" data-filter-id="${filterId}">×</button>
    `;

        filterRows.appendChild(row);

        row.querySelectorAll('select, input').forEach(el => {
            el.addEventListener('change', () => this.updateQuery());
            el.addEventListener('input', () => this.updateQuery());
        });

        row.querySelector('.filter-remove').addEventListener('click', () => {
            row.remove();
            this.updateQuery();
        });

        this.updateQuery();
    },

    generateQuery() {
        if (!this.selectedObject) return 'SELECT Id FROM ...';

        let fields = Array.from(this.selectedFields);

        // Add parent relationship fields
        this.selectedRelationships.filter(r => r.type === 'parent').forEach(r => {
            fields.push(`${r.name}.Name`);
            fields.push(`${r.name}.Id`);
        });

        let query = `SELECT ${fields.join(', ')}`;

        // Add child subqueries
        const childRels = this.selectedRelationships.filter(r => r.type === 'child');
        childRels.forEach(r => {
            query += `,\n  (SELECT Id, Name FROM ${r.name})`;
        });

        query += `\nFROM ${this.selectedObject}`;

        // Add filters
        const filterRows = document.querySelectorAll('#filter-rows .filter-row');
        const conditions = [];
        filterRows.forEach(row => {
            const field = row.querySelector('.filter-field').value;
            const operator = row.querySelector('.filter-operator').value;
            let value = row.querySelector('.filter-value').value;
            if (value) {
                // Auto-quote string values
                if (!value.match(/^\d+$/) && !value.match(/^(true|false|null|TODAY|YESTERDAY|THIS_MONTH|THIS_YEAR|LAST_N_DAYS:\d+)$/i) && !value.startsWith('(')) {
                    value = `'${value}'`;
                }
                conditions.push(`${field} ${operator} ${value}`);
            }
        });

        if (conditions.length > 0) {
            query += `\nWHERE ${conditions.join('\nAND ')}`;
        }

        // Order by
        const orderBy = document.getElementById('soql-orderby').value;
        if (orderBy) {
            const dir = document.getElementById('soql-order-dir').value;
            query += `\nORDER BY ${orderBy} ${dir}`;
        }

        // Limit
        const limit = document.getElementById('soql-limit').value;
        if (limit) {
            query += `\nLIMIT ${limit}`;
        }

        return query;
    },

    updateQuery() {
        const preview = document.getElementById('query-preview');
        preview.textContent = this.generateQuery();
    }
};

document.addEventListener('DOMContentLoaded', () => SOQLBuilder.init());

if (typeof window !== 'undefined') {
    window.SOQLBuilder = SOQLBuilder;
}
