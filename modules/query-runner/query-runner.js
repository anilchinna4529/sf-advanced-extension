/**
 * Query Runner Module
 * Execute SOQL queries and display results with table/JSON views and export
 */

const QueryRunner = {
    lastResults: null,
    viewMode: 'table',
    sortColumn: null,
    sortDirection: 'asc',

    init() {
        // Execute query
        document.getElementById('btn-execute-query').addEventListener('click', () => this.executeQuery());

        // Keyboard shortcut: Ctrl+Enter to execute
        document.getElementById('soql-editor').addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                this.executeQuery();
            }
        });

        // Format query
        document.getElementById('btn-format-query').addEventListener('click', () => this.formatQuery());

        // History
        document.getElementById('btn-query-history').addEventListener('click', () => this.showHistory());

        // View modes
        document.getElementById('btn-view-table').addEventListener('click', () => this.setViewMode('table'));
        document.getElementById('btn-view-json').addEventListener('click', () => this.setViewMode('json'));

        // Export
        document.getElementById('btn-export-csv').addEventListener('click', () => this.exportCSV());
        document.getElementById('btn-copy-json').addEventListener('click', () => this.copyJSON());

        // Autocomplete
        this.initAutocomplete();
    },

    async executeQuery() {
        const editor = document.getElementById('soql-editor');
        const query = editor.value.trim();

        if (!query) {
            showToast('Please enter a SOQL query', 'error');
            return;
        }

        setStatus('Executing query...');
        const startTime = Date.now();

        try {
            const result = await sendMessage({ action: 'query', soql: query });
            const elapsed = Date.now() - startTime;

            this.lastResults = result;

            // Show results header
            document.getElementById('results-header').style.display = '';
            document.getElementById('results-count').textContent =
                `${result.totalSize || result.records?.length || 0} records`;
            document.getElementById('results-time').textContent = `${elapsed}ms`;

            // Save to history
            await saveQueryToHistory(query);
            loadRecentQueries();

            // Render results
            this.renderResults(result);
            setStatus(`Query returned ${result.totalSize || 0} records in ${elapsed}ms`);
        } catch (error) {
            document.getElementById('results-header').style.display = '';
            document.getElementById('results-count').textContent = 'Error';
            document.getElementById('results-time').textContent = '';
            document.getElementById('results-body').innerHTML = `
        <div class="empty-state">
          <span class="empty-icon">❌</span>
          <p style="color:var(--accent-red)">${escapeHtml(error.message)}</p>
        </div>
      `;
            setStatus('Query failed');
        }
    },

    renderResults(result) {
        if (this.viewMode === 'table') {
            this.renderTable(result);
        } else {
            this.renderJSON(result);
        }
    },

    renderTable(result) {
        const body = document.getElementById('results-body');
        const records = result.records || [];

        if (records.length === 0) {
            body.innerHTML = '<div class="empty-state"><p>No records found</p></div>';
            return;
        }

        // Get columns
        const columns = this.getColumns(records[0]);

        let html = `<div class="table-container"><table class="data-table"><thead><tr>`;
        columns.forEach(col => {
            html += `<th data-sort="${col}">${col} ${this.sortColumn === col ? (this.sortDirection === 'asc' ? '↑' : '↓') : ''}</th>`;
        });
        html += '</tr></thead><tbody>';

        // Sort if needed
        let sortedRecords = [...records];
        if (this.sortColumn) {
            sortedRecords.sort((a, b) => {
                const va = this.getNestedValue(a, this.sortColumn) || '';
                const vb = this.getNestedValue(b, this.sortColumn) || '';
                const cmp = String(va).localeCompare(String(vb), undefined, { numeric: true });
                return this.sortDirection === 'asc' ? cmp : -cmp;
            });
        }

        sortedRecords.forEach(record => {
            html += '<tr>';
            columns.forEach(col => {
                const val = this.getNestedValue(record, col);
                html += `<td title="${escapeHtml(String(val ?? ''))}">${escapeHtml(String(val ?? ''))}</td>`;
            });
            html += '</tr>';
        });

        html += '</tbody></table></div>';
        body.innerHTML = html;

        // Sort click handlers
        body.querySelectorAll('th[data-sort]').forEach(th => {
            th.addEventListener('click', () => {
                const col = th.dataset.sort;
                if (this.sortColumn === col) {
                    this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
                } else {
                    this.sortColumn = col;
                    this.sortDirection = 'asc';
                }
                this.renderTable(result);
            });
        });
    },

    renderJSON(result) {
        const body = document.getElementById('results-body');
        const jsonStr = JSON.stringify(result, null, 2);
        body.innerHTML = `<pre class="json-view">${this.syntaxHighlightJSON(jsonStr)}</pre>`;
    },

    syntaxHighlightJSON(json) {
        return json.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, (match) => {
            let cls = 'json-number';
            if (/^"/.test(match)) {
                if (/:$/.test(match)) {
                    cls = 'json-key';
                } else {
                    cls = 'json-string';
                }
            } else if (/true|false/.test(match)) {
                cls = 'json-boolean';
            } else if (/null/.test(match)) {
                cls = 'json-null';
            }
            return `<span class="${cls}">${match}</span>`;
        });
    },

    getColumns(record) {
        const cols = [];
        for (const key of Object.keys(record)) {
            if (key === 'attributes') continue;
            const val = record[key];
            if (val && typeof val === 'object' && !Array.isArray(val) && val.attributes) {
                // It's a related record
                for (const subKey of Object.keys(val)) {
                    if (subKey === 'attributes') continue;
                    cols.push(`${key}.${subKey}`);
                }
            } else {
                cols.push(key);
            }
        }
        return cols;
    },

    getNestedValue(obj, path) {
        return path.split('.').reduce((acc, part) => acc?.[part], obj);
    },

    setViewMode(mode) {
        this.viewMode = mode;
        if (this.lastResults) {
            this.renderResults(this.lastResults);
        }
    },

    formatQuery() {
        const editor = document.getElementById('soql-editor');
        let query = editor.value.trim();

        // Basic formatting
        const keywords = ['SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'ORDER BY', 'GROUP BY', 'HAVING', 'LIMIT', 'OFFSET'];
        keywords.forEach(kw => {
            const regex = new RegExp(`\\b${kw}\\b`, 'gi');
            query = query.replace(regex, `\n${kw}`);
        });

        query = query.replace(/^\n/, '').replace(/\n\s*\n/g, '\n');
        editor.value = query;
    },

    async showHistory() {
        const history = await Storage.get('query_history') || [];
        if (history.length === 0) {
            showToast('No query history', 'info');
            return;
        }

        const body = document.getElementById('results-body');
        body.innerHTML = `
      <div style="padding:12px">
        <h4 style="margin-bottom:10px;color:var(--text-secondary)">Query History</h4>
        ${history.slice(0, 20).map(q => `
          <div class="recent-item" style="margin-bottom:6px" data-hist-query="${encodeURIComponent(q.query)}">
            <span class="recent-query-text">${escapeHtml(q.query)}</span>
            <span class="recent-query-time">${formatTime(q.timestamp)}</span>
          </div>
        `).join('')}
      </div>
    `;

        body.querySelectorAll('[data-hist-query]').forEach(item => {
            item.addEventListener('click', () => {
                document.getElementById('soql-editor').value = decodeURIComponent(item.dataset.histQuery);
            });
        });
    },

    exportCSV() {
        if (!this.lastResults?.records?.length) {
            showToast('No data to export', 'error');
            return;
        }

        const records = this.lastResults.records;
        const columns = this.getColumns(records[0]);

        let csv = columns.join(',') + '\n';
        records.forEach(record => {
            const row = columns.map(col => {
                let val = this.getNestedValue(record, col);
                if (val === null || val === undefined) val = '';
                val = String(val).replace(/"/g, '""');
                if (val.includes(',') || val.includes('"') || val.includes('\n')) {
                    val = `"${val}"`;
                }
                return val;
            });
            csv += row.join(',') + '\n';
        });

        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `query_results_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        showToast('CSV exported!', 'success');
    },

    copyJSON() {
        if (!this.lastResults) {
            showToast('No data to copy', 'error');
            return;
        }
        navigator.clipboard.writeText(JSON.stringify(this.lastResults, null, 2));
        showToast('JSON copied to clipboard!', 'success');
    },

    // ========== Autocomplete ==========

    initAutocomplete() {
        const editor = document.getElementById('soql-editor');
        const dropdown = document.getElementById('autocomplete-dropdown');
        let currentSuggestions = [];
        let selectedIndex = -1;

        editor.addEventListener('input', async () => {
            const cursorPos = editor.selectionStart;
            const textBefore = editor.value.substring(0, cursorPos);
            const words = textBefore.split(/\s+/);
            const currentWord = words[words.length - 1] || '';
            const prevWord = words[words.length - 2]?.toUpperCase() || '';

            if (currentWord.length < 1) {
                dropdown.style.display = 'none';
                return;
            }

            let suggestions = [];

            // After FROM — suggest objects
            if (prevWord === 'FROM' || prevWord === 'UPDATE' || prevWord === 'INSERT') {
                try {
                    const data = await sendMessage({ action: 'describeGlobal' });
                    if (data?.sobjects) {
                        suggestions = data.sobjects
                            .filter(o => o.name.toLowerCase().startsWith(currentWord.toLowerCase()))
                            .slice(0, 10)
                            .map(o => ({ label: o.name, type: 'Object' }));
                    }
                } catch { }
            }
            // After SELECT or comma — suggest fields
            else if (prevWord === 'SELECT' || textBefore.match(/SELECT\s+.*,\s*[^,]*$/i)) {
                const fromMatch = editor.value.match(/FROM\s+(\w+)/i);
                if (fromMatch) {
                    try {
                        const data = await sendMessage({ action: 'describeSObject', sobject: fromMatch[1] });
                        if (data?.fields) {
                            suggestions = data.fields
                                .filter(f => f.name.toLowerCase().startsWith(currentWord.toLowerCase()))
                                .slice(0, 10)
                                .map(f => ({ label: f.name, type: f.type }));
                        }
                    } catch { }
                }
            }
            // After WHERE — suggest fields
            else if (prevWord === 'WHERE' || prevWord === 'AND' || prevWord === 'OR') {
                const fromMatch = editor.value.match(/FROM\s+(\w+)/i);
                if (fromMatch) {
                    try {
                        const data = await sendMessage({ action: 'describeSObject', sobject: fromMatch[1] });
                        if (data?.fields) {
                            suggestions = data.fields
                                .filter(f => f.name.toLowerCase().startsWith(currentWord.toLowerCase()))
                                .slice(0, 10)
                                .map(f => ({ label: f.name, type: f.type }));
                        }
                    } catch { }
                }
            }
            // SOQL keywords
            else {
                const keywords = ['SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'LIKE',
                    'ORDER BY', 'GROUP BY', 'HAVING', 'LIMIT', 'OFFSET', 'ASC', 'DESC',
                    'NULLS FIRST', 'NULLS LAST', 'TRUE', 'FALSE', 'NULL',
                    'TODAY', 'YESTERDAY', 'TOMORROW', 'THIS_MONTH', 'THIS_YEAR',
                    'LAST_N_DAYS', 'NEXT_N_DAYS', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX'];
                suggestions = keywords
                    .filter(k => k.toLowerCase().startsWith(currentWord.toLowerCase()))
                    .map(k => ({ label: k, type: 'Keyword' }));
            }

            currentSuggestions = suggestions;
            selectedIndex = -1;

            if (suggestions.length === 0) {
                dropdown.style.display = 'none';
                return;
            }

            dropdown.innerHTML = suggestions.map((s, i) => `
        <div class="autocomplete-item" data-index="${i}" data-value="${s.label}">
          <span>${s.label}</span>
          <span class="autocomplete-type">${s.type}</span>
        </div>
      `).join('');

            // Position dropdown near cursor
            const lines = textBefore.split('\n');
            const lineHeight = 20;
            dropdown.style.top = `${(lines.length) * lineHeight + 12}px`;
            dropdown.style.left = '12px';
            dropdown.style.display = 'block';

            dropdown.querySelectorAll('.autocomplete-item').forEach(item => {
                item.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    this.insertSuggestion(editor, item.dataset.value, currentWord);
                    dropdown.style.display = 'none';
                });
            });
        });

        // Keyboard navigation
        editor.addEventListener('keydown', (e) => {
            if (dropdown.style.display === 'none') return;

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                selectedIndex = Math.min(selectedIndex + 1, currentSuggestions.length - 1);
                this.highlightSuggestion(dropdown, selectedIndex);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                selectedIndex = Math.max(selectedIndex - 1, 0);
                this.highlightSuggestion(dropdown, selectedIndex);
            } else if (e.key === 'Enter' && selectedIndex >= 0) {
                e.preventDefault();
                const selected = currentSuggestions[selectedIndex];
                if (selected) {
                    const words = editor.value.substring(0, editor.selectionStart).split(/\s+/);
                    this.insertSuggestion(editor, selected.label, words[words.length - 1] || '');
                    dropdown.style.display = 'none';
                }
            } else if (e.key === 'Escape') {
                dropdown.style.display = 'none';
            }
        });

        editor.addEventListener('blur', () => {
            setTimeout(() => { dropdown.style.display = 'none'; }, 200);
        });
    },

    insertSuggestion(editor, suggestion, currentWord) {
        const start = editor.selectionStart - currentWord.length;
        const end = editor.selectionStart;
        editor.value = editor.value.substring(0, start) + suggestion + editor.value.substring(end);
        editor.selectionStart = editor.selectionEnd = start + suggestion.length;
        editor.focus();
    },

    highlightSuggestion(dropdown, index) {
        dropdown.querySelectorAll('.autocomplete-item').forEach((item, i) => {
            item.classList.toggle('active', i === index);
        });
    }
};

document.addEventListener('DOMContentLoaded', () => QueryRunner.init());

if (typeof window !== 'undefined') {
    window.QueryRunner = QueryRunner;
}
