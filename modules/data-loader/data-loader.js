/**
 * Data Loader Module
 * Import/Export data via CSV with Insert, Update, Upsert, Delete operations
 */

const DataLoader = {
    csvData: null,
    csvHeaders: [],
    selectedObject: null,
    allObjects: [],

    init() {
        // Operation selection
        document.querySelectorAll('input[name="loader-op"]').forEach(radio => {
            radio.addEventListener('change', () => {
                const op = document.querySelector('input[name="loader-op"]:checked').value;
                document.getElementById('loader-upsert-field').style.display = op === 'upsert' ? '' : 'none';
            });
        });

        // Object search
        const objectSearch = document.getElementById('loader-object-search');
        const objectDropdown = document.getElementById('loader-object-dropdown');

        objectSearch.addEventListener('input', (e) => this.searchObjects(e.target.value));
        objectSearch.addEventListener('focus', () => this.searchObjects(objectSearch.value));
        objectSearch.addEventListener('blur', () => {
            setTimeout(() => objectDropdown.classList.remove('visible'), 200);
        });

        // File handling
        const dropZone = document.getElementById('file-drop-zone');
        const fileInput = document.getElementById('csv-file-input');

        document.getElementById('btn-browse-file').addEventListener('click', () => fileInput.click());

        fileInput.addEventListener('change', (e) => {
            if (e.target.files[0]) this.handleFile(e.target.files[0]);
        });

        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.classList.add('drag-over');
        });

        dropZone.addEventListener('dragleave', () => {
            dropZone.classList.remove('drag-over');
        });

        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('drag-over');
            if (e.dataTransfer.files[0]) this.handleFile(e.dataTransfer.files[0]);
        });

        // Clear CSV
        document.getElementById('btn-clear-csv').addEventListener('click', () => this.clearCSV());

        // Start load
        document.getElementById('btn-start-load').addEventListener('click', () => this.startLoad());

        // Load objects when tab activates
        document.addEventListener('tabActivated', (e) => {
            if (e.detail.tab === 'data-loader' && this.allObjects.length === 0) {
                this.loadObjects();
            }
        });
    },

    async loadObjects() {
        try {
            const data = await sendMessage({ action: 'describeGlobal' });
            if (data?.sobjects) {
                this.allObjects = data.sobjects
                    .filter(o => o.createable || o.updateable)
                    .sort((a, b) => a.name.localeCompare(b.name));
            }
        } catch { }
    },

    searchObjects(query) {
        const dropdown = document.getElementById('loader-object-dropdown');
        const q = (query || '').toLowerCase();
        const filtered = this.allObjects.filter(o =>
            o.name.toLowerCase().includes(q) || (o.label && o.label.toLowerCase().includes(q))
        ).slice(0, 15);

        if (filtered.length === 0) {
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
        document.getElementById('loader-object-search').value = objectName;
        this.updateStartButton();

        // Load external ID fields for upsert
        try {
            const data = await sendMessage({ action: 'describeSObject', sobject: objectName });
            const externalIdFields = (data.fields || []).filter(f => f.externalId || f.idLookup);
            const select = document.getElementById('loader-external-id');
            select.innerHTML = externalIdFields.map(f =>
                `<option value="${f.name}">${f.name} (${f.type})</option>`
            ).join('');
        } catch { }
    },

    handleFile(file) {
        if (!file.name.endsWith('.csv')) {
            showToast('Please upload a CSV file', 'error');
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            const text = e.target.result;
            this.parseCSV(text, file.name);
        };
        reader.readAsText(file);
    },

    parseCSV(text, filename) {
        const lines = text.split(/\r?\n/).filter(l => l.trim());
        if (lines.length < 2) {
            showToast('CSV must have at least a header and one data row', 'error');
            return;
        }

        this.csvHeaders = this.parseCSVLine(lines[0]);
        const rows = lines.slice(1).map(line => this.parseCSVLine(line));
        this.csvData = rows;

        // Show preview
        document.getElementById('file-drop-zone').style.display = 'none';
        document.getElementById('csv-preview').style.display = '';
        document.getElementById('csv-filename').textContent = filename;
        document.getElementById('csv-row-count').textContent = `${rows.length} rows`;

        // Render preview table (first 10 rows)
        const previewRows = rows.slice(0, 10);
        let html = '<table class="data-table"><thead><tr>';
        this.csvHeaders.forEach(h => { html += `<th>${escapeHtml(h)}</th>`; });
        html += '</tr></thead><tbody>';
        previewRows.forEach(row => {
            html += '<tr>';
            row.forEach(cell => { html += `<td>${escapeHtml(cell)}</td>`; });
            html += '</tr>';
        });
        if (rows.length > 10) {
            html += `<tr><td colspan="${this.csvHeaders.length}" style="text-align:center;color:var(--text-muted)">... and ${rows.length - 10} more rows</td></tr>`;
        }
        html += '</tbody></table>';
        document.getElementById('csv-preview-table').innerHTML = html;

        this.updateStartButton();
    },

    parseCSVLine(line) {
        const result = [];
        let current = '';
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === '"') {
                if (inQuotes && line[i + 1] === '"') {
                    current += '"';
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (char === ',' && !inQuotes) {
                result.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }
        result.push(current.trim());
        return result;
    },

    clearCSV() {
        this.csvData = null;
        this.csvHeaders = [];
        document.getElementById('file-drop-zone').style.display = '';
        document.getElementById('csv-preview').style.display = 'none';
        document.getElementById('csv-file-input').value = '';
        this.updateStartButton();
    },

    updateStartButton() {
        const btn = document.getElementById('btn-start-load');
        btn.disabled = !(this.selectedObject && this.csvData);
    },

    async startLoad() {
        const operation = document.querySelector('input[name="loader-op"]:checked').value;
        const progressDiv = document.getElementById('loader-progress');
        const progressFill = document.getElementById('loader-progress-fill');
        const progressText = document.getElementById('loader-progress-text');
        const progressCount = document.getElementById('loader-progress-count');
        const resultsDiv = document.getElementById('loader-results');

        progressDiv.style.display = '';
        resultsDiv.style.display = 'none';

        const total = this.csvData.length;
        let processed = 0;
        let successes = 0;
        let failures = 0;
        const errors = [];
        const batchSize = 200;

        setStatus(`${operation}ing ${total} records...`);

        try {
            // Process in batches
            for (let i = 0; i < total; i += batchSize) {
                const batch = this.csvData.slice(i, Math.min(i + batchSize, total));

                for (const row of batch) {
                    try {
                        const record = {};
                        this.csvHeaders.forEach((header, idx) => {
                            if (row[idx] !== undefined && row[idx] !== '') {
                                record[header] = row[idx];
                            }
                        });

                        const org = await sendMessage({ action: 'getActiveOrg' });
                        const settings = await getSettings();
                        const apiVersion = settings.apiVersion || 'v60.0';

                        switch (operation) {
                            case 'insert':
                                await sendMessage({
                                    action: 'apiRequest',
                                    path: `/services/data/${apiVersion}/sobjects/${this.selectedObject}`,
                                    method: 'POST',
                                    body: record
                                });
                                break;
                            case 'update':
                                const updateId = record.Id;
                                delete record.Id;
                                await sendMessage({
                                    action: 'apiRequest',
                                    path: `/services/data/${apiVersion}/sobjects/${this.selectedObject}/${updateId}`,
                                    method: 'PATCH',
                                    body: record
                                });
                                break;
                            case 'upsert':
                                const extField = document.getElementById('loader-external-id').value;
                                const extValue = record[extField];
                                delete record[extField];
                                await sendMessage({
                                    action: 'apiRequest',
                                    path: `/services/data/${apiVersion}/sobjects/${this.selectedObject}/${extField}/${extValue}`,
                                    method: 'PATCH',
                                    body: record
                                });
                                break;
                            case 'delete':
                                await sendMessage({
                                    action: 'apiRequest',
                                    path: `/services/data/${apiVersion}/sobjects/${this.selectedObject}/${record.Id}`,
                                    method: 'DELETE'
                                });
                                break;
                        }
                        successes++;
                    } catch (error) {
                        failures++;
                        errors.push({ row: processed + 1, error: error.message });
                    }
                    processed++;
                    const pct = Math.round((processed / total) * 100);
                    progressFill.style.width = `${pct}%`;
                    progressText.textContent = `Processing...`;
                    progressCount.textContent = `${processed}/${total}`;
                }
            }

            // Show results
            resultsDiv.style.display = '';
            resultsDiv.innerHTML = `
        <div class="debug-result-card">
          <h4>✅ Load Complete</h4>
          <p><strong>Total:</strong> ${total}</p>
          <p><strong>Successes:</strong> <span style="color:var(--accent-green)">${successes}</span></p>
          <p><strong>Failures:</strong> <span style="color:var(--accent-red)">${failures}</span></p>
          ${errors.length > 0 ? `
            <div style="margin-top:10px">
              <strong>Errors:</strong>
              <div style="max-height:100px;overflow-y:auto;margin-top:4px">
                ${errors.slice(0, 10).map(e => `<div style="font-size:11px;color:var(--accent-red);padding:2px 0">Row ${e.row}: ${escapeHtml(e.error)}</div>`).join('')}
                ${errors.length > 10 ? `<div style="color:var(--text-muted);font-size:11px">...and ${errors.length - 10} more errors</div>` : ''}
              </div>
            </div>
          ` : ''}
        </div>
      `;

            setStatus(`Load complete: ${successes} success, ${failures} failed`);
            showToast(`Data load complete!`, successes > 0 ? 'success' : 'error');
        } catch (error) {
            showToast(`Load failed: ${error.message}`, 'error');
            setStatus('Load failed');
        }
    }
};

document.addEventListener('DOMContentLoaded', () => DataLoader.init());

if (typeof window !== 'undefined') {
    window.DataLoader = DataLoader;
}
