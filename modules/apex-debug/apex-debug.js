/**
 * Apex Debug Helper Module
 * Analyze Apex errors and fetch debug logs
 */

const ApexDebug = {
    init() {
        document.getElementById('btn-analyze-error').addEventListener('click', () => this.analyzeError());
        document.getElementById('btn-fetch-logs').addEventListener('click', () => this.fetchLogs());

        // Allow Enter to analyze
        document.getElementById('apex-error-input').addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                this.analyzeError();
            }
        });
    },

    async analyzeError() {
        const input = document.getElementById('apex-error-input');
        const errorText = input.value.trim();
        const resultsDiv = document.getElementById('debug-results');

        if (!errorText) {
            showToast('Please paste an Apex error', 'error');
            return;
        }

        // Try AI analysis first
        const settings = await getSettings();

        if (settings.openaiApiKey) {
            resultsDiv.innerHTML = '<div class="loading-state"><div class="spinner"></div>Analyzing error with AI...</div>';

            try {
                const response = await fetch('https://api.openai.com/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${settings.openaiApiKey}`
                    },
                    body: JSON.stringify({
                        model: 'gpt-4o-mini',
                        messages: [
                            {
                                role: 'system',
                                content: `You are a Salesforce Apex debugging expert. Analyze the following Apex error or stack trace. Provide:
1. **Error Type**: Identify the exception type
2. **Root Cause**: Explain the likely cause
3. **Fix Suggestions**: Provide 2-3 actionable fixes with code examples
4. **Prevention**: How to prevent this in the future

Use concise language. Wrap code in backticks. Be specific to Salesforce/Apex.`
                            },
                            { role: 'user', content: errorText }
                        ],
                        temperature: 0.5,
                        max_tokens: 800
                    })
                });

                if (response.ok) {
                    const data = await response.json();
                    const analysis = data.choices[0]?.message?.content || '';
                    this.renderAIAnalysis(analysis, resultsDiv);
                    return;
                }
            } catch (e) {
                console.log('AI analysis failed, falling back to pattern matching:', e.message);
            }
        }

        // Fallback: Pattern-based analysis
        this.patternAnalysis(errorText, resultsDiv);
    },

    renderAIAnalysis(analysis, container) {
        // Process markdown
        let html = analysis;
        html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) =>
            `<pre style="background:var(--bg-primary);padding:10px;border-radius:6px;font-family:var(--font-mono);font-size:11px;color:var(--accent-cyan);margin:8px 0">${escapeHtml(code.trim())}</pre>`
        );
        html = html.replace(/`([^`]+)`/g, '<code style="background:var(--bg-primary);padding:1px 4px;border-radius:3px;font-size:11px;color:var(--accent-cyan)">$1</code>');
        html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/\n/g, '<br>');

        container.innerHTML = `
      <div class="debug-result-card">
        <h4>🤖 AI Analysis</h4>
        <div style="line-height:1.6;color:var(--text-secondary)">${html}</div>
      </div>
    `;
    },

    patternAnalysis(errorText, container) {
        const patterns = [
            {
                regex: /System\.NullPointerException/i,
                type: 'NullPointerException',
                cause: 'A variable or object reference was null when it was expected to have a value.',
                fixes: [
                    'Add null checks before accessing object properties: if (obj != null) { ... }',
                    'Initialize variables when declaring them',
                    'Use the safe navigation operator: obj?.field'
                ]
            },
            {
                regex: /System\.LimitException.*Too many SOQL queries/i,
                type: 'Governor Limit - SOQL Queries',
                cause: 'Your code executed more than 100 SOQL queries in a single transaction.',
                fixes: [
                    'Move SOQL queries outside of loops',
                    'Use collections and Maps to cache query results',
                    'Bulkify your code to process records in batches'
                ]
            },
            {
                regex: /System\.DmlException.*REQUIRED_FIELD_MISSING/i,
                type: 'Required Field Missing',
                cause: 'A required field is not populated when trying to insert or update a record.',
                fixes: [
                    'Check which fields are required on the object',
                    'Ensure all required fields are populated before DML',
                    'Check validation rules that may require additional fields'
                ]
            },
            {
                regex: /System\.DmlException.*DUPLICATE_VALUE/i,
                type: 'Duplicate Value',
                cause: 'Attempting to insert or update a record with a duplicate unique field value.',
                fixes: [
                    'Check for existing records before inserting',
                    'Use upsert instead of insert',
                    'Add error handling for duplicate exceptions'
                ]
            },
            {
                regex: /System\.QueryException.*List has no rows/i,
                type: 'Query Exception - No Rows',
                cause: 'A SOQL query assigned to a single sObject returned no results.',
                fixes: [
                    'Use List<sObject> instead of a single sObject assignment',
                    'Add a check: if (!results.isEmpty())',
                    'Verify your query filters return expected results'
                ]
            },
            {
                regex: /System\.LimitException.*Too many DML statements/i,
                type: 'Governor Limit - DML Statements',
                cause: 'Your code executed more than 150 DML statements in a single transaction.',
                fixes: [
                    'Collect records into lists, then perform DML operations on the lists',
                    'Move DML operations outside of loops',
                    'Use Database.insert with allOrNone=false for partial success'
                ]
            }
        ];

        let matched = false;
        for (const pattern of patterns) {
            if (pattern.regex.test(errorText)) {
                matched = true;
                container.innerHTML = `
          <div class="debug-result-card">
            <h4>🔍 ${pattern.type}</h4>
            <p><strong>Cause:</strong> ${pattern.cause}</p>
          </div>
          <div class="debug-result-card">
            <h4>🔧 Suggested Fixes</h4>
            <ul style="padding-left:16px">
              ${pattern.fixes.map(f => `<li style="margin:4px 0;color:var(--text-secondary);font-size:12px">${f}</li>`).join('')}
            </ul>
          </div>
        `;
                break;
            }
        }

        if (!matched) {
            // Generic analysis
            const lineMatch = errorText.match(/line (\d+)/i);
            const classMatch = errorText.match(/Class\.(\w+)/);

            container.innerHTML = `
        <div class="debug-result-card">
          <h4>🔍 Error Analysis</h4>
          <p>${classMatch ? `<strong>Class:</strong> ${classMatch[1]}<br>` : ''}${lineMatch ? `<strong>Line:</strong> ${lineMatch[1]}<br>` : ''}</p>
          <p style="margin-top:8px">Set up an OpenAI API key in Settings for AI-powered analysis, or check the error manually.</p>
        </div>
        <div class="debug-result-card">
          <h4>💡 General Tips</h4>
          <ul style="padding-left:16px">
            <li style="margin:4px 0;color:var(--text-secondary);font-size:12px">Check the stack trace for the exact line causing the error</li>
            <li style="margin:4px 0;color:var(--text-secondary);font-size:12px">Add debug logging to narrow down the issue</li>
            <li style="margin:4px 0;color:var(--text-secondary);font-size:12px">Review null checks and variable initialization</li>
            <li style="margin:4px 0;color:var(--text-secondary);font-size:12px">Check governor limits in the debug log</li>
          </ul>
        </div>
      `;
        }
    },

    async fetchLogs() {
        const container = document.getElementById('debug-logs-list');
        container.innerHTML = '<div class="loading-state"><div class="spinner"></div>Fetching logs...</div>';

        try {
            const result = await sendMessage({
                action: 'apiRequest',
                path: '/services/data/v60.0/tooling/query?q=' + encodeURIComponent(
                    'SELECT Id, Application, DurationMilliseconds, Location, LogLength, Operation, Request, StartTime, Status FROM ApexLog ORDER BY StartTime DESC LIMIT 20'
                ),
                method: 'GET'
            });

            const logs = result.records || [];

            if (logs.length === 0) {
                container.innerHTML = '<div class="empty-state-sm">No debug logs found</div>';
                return;
            }

            container.innerHTML = logs.map(log => `
        <div class="log-item" data-log-id="${log.Id}">
          <div>
            <span style="font-weight:500;font-size:12px">${log.Operation || 'Unknown'}</span>
            <span style="font-size:10px;color:var(--text-muted);margin-left:8px">${log.Status}</span>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:10px;color:var(--text-muted)">${log.DurationMilliseconds || 0}ms</span>
            <span style="font-size:10px;color:var(--text-muted)">${new Date(log.StartTime).toLocaleString()}</span>
          </div>
        </div>
      `).join('');

            setStatus(`Loaded ${logs.length} debug logs`);
        } catch (error) {
            container.innerHTML = `<div class="empty-state-sm" style="color:var(--accent-red)">❌ ${error.message}</div>`;
        }
    }
};

document.addEventListener('DOMContentLoaded', () => ApexDebug.init());

if (typeof window !== 'undefined') {
    window.ApexDebug = ApexDebug;
}
