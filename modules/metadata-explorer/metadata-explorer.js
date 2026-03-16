/**
 * Metadata Explorer Module
 * Browse and search Salesforce org metadata
 */

const MetadataExplorer = {
    objects: [],
    currentObject: null,
    currentFields: [],

    init() {
        document.getElementById('metadata-search').addEventListener('input', (e) => {
            this.filterObjects(e.target.value);
        });

        document.getElementById('btn-refresh-metadata').addEventListener('click', () => {
            this.loadObjects(true);
        });

        document.addEventListener('tabActivated', (e) => {
            if (e.detail.tab === 'metadata-explorer' && this.objects.length === 0) {
                this.loadObjects();
            }
        });
    },

    async loadObjects(forceRefresh = false) {
        const container = document.getElementById('object-list');
        container.innerHTML = '<div class="loading-state"><div class="spinner"></div>Loading objects...</div>';

        try {
            let data;
            if (forceRefresh) {
                data = await sendMessage({ action: 'refreshMetadata' });
            } else {
                data = await sendMessage({ action: 'describeGlobal' });
            }

            if (data && data.sobjects) {
                this.objects = data.sobjects.sort((a, b) => a.name.localeCompare(b.name));
                this.renderObjects(this.objects);
                setStatus(`Loaded ${this.objects.length} objects`);
            }
        } catch (error) {
            container.innerHTML = `<div class="empty-state-sm">❌ ${error.message}</div>`;
        }
    },

    renderObjects(objects) {
        const container = document.getElementById('object-list');
        container.innerHTML = objects.map(obj => `
      <div class="object-item" data-object="${obj.name}" title="${obj.label}">
        <span class="object-item-name">${obj.name}</span>
        ${obj.custom ? '<span class="object-item-badge">Custom</span>' : ''}
      </div>
    `).join('');

        container.querySelectorAll('.object-item').forEach(item => {
            item.addEventListener('click', () => {
                container.querySelectorAll('.object-item').forEach(i => i.classList.remove('active'));
                item.classList.add('active');
                this.loadObjectDetail(item.dataset.object);
            });
        });
    },

    filterObjects(query) {
        if (!query) {
            this.renderObjects(this.objects);
            return;
        }
        const q = query.toLowerCase();
        const filtered = this.objects.filter(o =>
            o.name.toLowerCase().includes(q) ||
            (o.label && o.label.toLowerCase().includes(q))
        );
        this.renderObjects(filtered);
    },

    async loadObjectDetail(objectName) {
        const container = document.getElementById('object-detail');
        container.innerHTML = '<div class="loading-state"><div class="spinner"></div>Loading metadata...</div>';
        this.currentObject = objectName;

        try {
            const data = await sendMessage({ action: 'describeSObject', sobject: objectName });
            this.currentFields = data.fields || [];
            this.renderObjectDetail(data);
        } catch (error) {
            container.innerHTML = `<div class="empty-state"><p>❌ ${error.message}</p></div>`;
        }
    },

    renderObjectDetail(data) {
        const container = document.getElementById('object-detail');
        const fields = data.fields || [];
        const childRelationships = data.childRelationships || [];

        container.innerHTML = `
      <div class="object-detail-header">
        <h3>
          ${data.name}
          ${data.custom ? '<span class="badge">Custom</span>' : ''}
        </h3>
        <div class="object-detail-meta">
          <span>Label: ${data.label}</span>
          <span>Fields: ${fields.length}</span>
          <span>Children: ${childRelationships.length}</span>
          <span>Queryable: ${data.queryable ? '✅' : '❌'}</span>
        </div>
      </div>

      <div class="detail-tabs">
        <button class="detail-tab active" data-detail-tab="fields">Fields (${fields.length})</button>
        <button class="detail-tab" data-detail-tab="relationships">Relationships (${childRelationships.length})</button>
        <button class="detail-tab" data-detail-tab="info">Info</button>
      </div>

      <div class="detail-content" id="detail-fields">
        <input type="text" id="field-filter" placeholder="Filter fields..." style="margin-bottom:8px">
        <div class="table-container">
          <table class="data-table" id="fields-table">
            <thead>
              <tr>
                <th>API Name</th>
                <th>Label</th>
                <th>Type</th>
                <th>Required</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${fields.map(f => `
                <tr class="field-row" data-name="${f.name.toLowerCase()}" data-label="${(f.label || '').toLowerCase()}">
                  <td><span class="text-mono" style="font-size:11px">${f.name}</span></td>
                  <td>${f.label || '-'}</td>
                  <td><span class="badge">${f.type}</span></td>
                  <td>${!f.nillable && !f.defaultedOnCreate ? '✅' : ''}</td>
                  <td>
                    <button class="btn btn-sm btn-ghost copy-field-btn" data-field="${f.name}" title="Copy API name">📋</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <div class="detail-content" id="detail-relationships" style="display:none">
        <div class="table-container">
          <table class="data-table">
            <thead>
              <tr>
                <th>Relationship</th>
                <th>Child Object</th>
                <th>Field</th>
              </tr>
            </thead>
            <tbody>
              ${childRelationships.filter(r => r.relationshipName).map(r => `
                <tr>
                  <td><span class="text-mono" style="font-size:11px">${r.relationshipName}</span></td>
                  <td>${r.childSObject}</td>
                  <td>${r.field}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <div class="detail-content" id="detail-info" style="display:none">
        <div class="debug-result-card">
          <p><strong>API Name:</strong> ${data.name}</p>
          <p><strong>Label:</strong> ${data.label}</p>
          <p><strong>Key Prefix:</strong> ${data.keyPrefix || 'N/A'}</p>
          <p><strong>Custom:</strong> ${data.custom ? 'Yes' : 'No'}</p>
          <p><strong>Queryable:</strong> ${data.queryable ? 'Yes' : 'No'}</p>
          <p><strong>Createable:</strong> ${data.createable ? 'Yes' : 'No'}</p>
          <p><strong>Updateable:</strong> ${data.updateable ? 'Yes' : 'No'}</p>
          <p><strong>Deletable:</strong> ${data.deletable ? 'Yes' : 'No'}</p>
          <p><strong>Searchable:</strong> ${data.searchable ? 'Yes' : 'No'}</p>
        </div>
      </div>
    `;

        // Detail tab switching
        container.querySelectorAll('.detail-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                container.querySelectorAll('.detail-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                container.querySelectorAll('.detail-content').forEach(c => c.style.display = 'none');
                document.getElementById(`detail-${tab.dataset.detailTab}`).style.display = '';
            });
        });

        // Field filter
        const fieldFilter = document.getElementById('field-filter');
        if (fieldFilter) {
            fieldFilter.addEventListener('input', (e) => {
                const q = e.target.value.toLowerCase();
                document.querySelectorAll('.field-row').forEach(row => {
                    const match = row.dataset.name.includes(q) || row.dataset.label.includes(q);
                    row.style.display = match ? '' : 'none';
                });
            });
        }

        // Copy field buttons
        container.querySelectorAll('.copy-field-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                navigator.clipboard.writeText(btn.dataset.field);
                showToast(`Copied: ${btn.dataset.field}`, 'success');
            });
        });
    }
};

// Auto-init
document.addEventListener('DOMContentLoaded', () => MetadataExplorer.init());

if (typeof window !== 'undefined') {
    window.MetadataExplorer = MetadataExplorer;
}
