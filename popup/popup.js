/**
 * Popup Main Controller
 * Handles navigation, initialization, and global state
 */

// ============================================
// Initialization
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
    initNavigation();
    initOrgSwitcher();
    initSettings();
    initQuickActions();
    await loadInitialState();
});

// ============================================
// Navigation
// ============================================

function initNavigation() {
    const tabs = document.querySelectorAll('.nav-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const tabId = tab.dataset.tab;
            switchTab(tabId);
        });
    });
}

function switchTab(tabId) {
    // Update nav tabs
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    document.querySelector(`.nav-tab[data-tab="${tabId}"]`)?.classList.add('active');

    // Update panels
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.getElementById(`panel-${tabId}`)?.classList.add('active');

    // Trigger tab-specific init
    const event = new CustomEvent('tabActivated', { detail: { tab: tabId } });
    document.dispatchEvent(event);

    setStatus(`Switched to ${tabId.replace(/-/g, ' ')}`);
}

// ============================================
// Quick Actions
// ============================================

function initQuickActions() {
    document.querySelectorAll('[data-navigate]').forEach(btn => {
        btn.addEventListener('click', () => {
            switchTab(btn.dataset.navigate);
        });
    });
}

// ============================================
// Org Switcher
// ============================================

function initOrgSwitcher() {
    const badge = document.getElementById('org-badge');
    const dropdown = document.getElementById('org-dropdown');

    badge.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdown.classList.toggle('visible');
    });

    document.addEventListener('click', () => {
        dropdown.classList.remove('visible');
    });

    dropdown.addEventListener('click', (e) => {
        e.stopPropagation();
    });

    // === Connect from Tab (easiest — grabs session from open SF tab) ===
    document.getElementById('btn-connect-tab').addEventListener('click', async () => {
        try {
            setStatus('Connecting from tab...');
            showToast('Looking for Salesforce tab...', 'info');
            dropdown.classList.remove('visible');

            const response = await chrome.runtime.sendMessage({ action: 'connectFromTab' });

            if (response.error) {
                throw new Error(response.error);
            }

            showToast(`Connected to ${response.userName}`, 'success');
            setStatus(`Connected: ${response.userName}`);
            await refreshOrgList();
            await loadDashboardStats();
        } catch (error) {
            showToast(`${error.message}`, 'error');
            setStatus('Connection failed');
        }
    });

    // === Quick Connect (paste token + instance URL) ===
    document.getElementById('btn-quick-connect').addEventListener('click', () => {
        dropdown.classList.remove('visible');
        document.getElementById('quick-connect-modal').classList.add('visible');
    });

    document.getElementById('btn-close-quick-connect').addEventListener('click', closeQuickConnect);
    document.getElementById('btn-cancel-quick-connect').addEventListener('click', closeQuickConnect);

    document.getElementById('btn-submit-quick-connect').addEventListener('click', async () => {
        const instanceUrl = document.getElementById('qc-instance-url').value.trim();
        const accessToken = document.getElementById('qc-access-token').value.trim();
        const orgType = document.getElementById('qc-org-type').value;

        if (!instanceUrl) {
            showToast('Please enter the Instance URL', 'error');
            return;
        }
        if (!accessToken) {
            showToast('Please enter the Access Token', 'error');
            return;
        }

        try {
            setStatus('Connecting...');
            showToast('Verifying credentials...', 'info');

            const response = await chrome.runtime.sendMessage({
                action: 'sessionLogin',
                instanceUrl,
                accessToken,
                orgType
            });

            if (response.error) {
                throw new Error(response.error);
            }

            showToast(`Connected to ${response.userName}`, 'success');
            setStatus(`Connected: ${response.userName}`);
            closeQuickConnect();
            await refreshOrgList();
            await loadDashboardStats();
        } catch (error) {
            showToast(`Connection failed: ${error.message}`, 'error');
            setStatus('Connection failed');
        }
    });

    // === OAuth Login buttons ===
    document.getElementById('btn-login-prod').addEventListener('click', () => {
        loginToOrg('https://login.salesforce.com');
    });

    document.getElementById('btn-login-sandbox').addEventListener('click', () => {
        loginToOrg('https://test.salesforce.com');
    });
}

function closeQuickConnect() {
    document.getElementById('quick-connect-modal').classList.remove('visible');
}

async function loginToOrg(loginUrl) {
    try {
        setStatus('Logging in via OAuth...');
        showToast('Connecting to Salesforce...', 'info');

        const settings = await getSettings();
        const response = await chrome.runtime.sendMessage({
            action: 'login',
            loginUrl,
            clientId: settings.clientId
        });

        if (response.error) {
            throw new Error(response.error);
        }

        showToast(`Connected to ${response.userName}`, 'success');
        setStatus(`Connected: ${response.userName}`);
        await refreshOrgList();
        await loadDashboardStats();
    } catch (error) {
        const msg = error.message;

        // Check if this is a NO_CLIENT_ID error — show setup guide
        if (msg.startsWith('NO_CLIENT_ID::')) {
            const parts = msg.split('::');
            const redirectUrl = parts[1] || '';
            showOAuthSetupGuide(redirectUrl);
        } else {
            showToast(`Login failed: ${msg}`, 'error');
        }
        setStatus('Login failed');
    }
}

function showOAuthSetupGuide(redirectUrl) {
    // Show the guide in the dashboard panel
    switchTab('dashboard');

    const dashWelcome = document.querySelector('.dash-welcome');
    if (dashWelcome) {
        dashWelcome.innerHTML = `
            <div style="text-align:left">
                <h3 style="color:var(--accent-orange);margin-bottom:12px">⚠️ OAuth Setup Required</h3>
                <p style="margin-bottom:12px;color:var(--text-secondary);font-size:12px;line-height:1.6">
                    To use OAuth login, you need a <strong>Salesforce Connected App</strong>. Follow these steps:
                </p>
                <div style="background:var(--bg-primary);border-radius:var(--radius-md);padding:14px;font-size:12px;line-height:1.8;color:var(--text-secondary);margin-bottom:12px">
                    <strong style="color:var(--text-primary)">Step 1:</strong> In Salesforce, go to <span style="color:var(--accent-cyan)">Setup → App Manager → New Connected App</span><br>
                    <strong style="color:var(--text-primary)">Step 2:</strong> Enable OAuth Settings ✅<br>
                    <strong style="color:var(--text-primary)">Step 3:</strong> Set <strong>Callback URL</strong> to:<br>
                    <code style="display:block;background:var(--bg-input);color:var(--accent-green);padding:8px 12px;border-radius:6px;margin:6px 0;font-family:var(--font-mono);font-size:11px;word-break:break-all;cursor:pointer;border:1px solid var(--border-color)" id="copy-redirect-url" title="Click to copy">${escapeHtml(redirectUrl)}</code>
                    <strong style="color:var(--text-primary)">Step 4:</strong> Select OAuth Scopes: <span style="color:var(--accent-cyan)">api, refresh_token, web</span><br>
                    <strong style="color:var(--text-primary)">Step 5:</strong> Save → Copy the <strong>Consumer Key</strong><br>
                    <strong style="color:var(--text-primary)">Step 6:</strong> Paste it in <span style="color:var(--accent-cyan)">Extension Settings (⚙️) → Connected App Client ID</span>
                </div>
                <div style="display:flex;gap:8px;flex-wrap:wrap">
                    <button class="btn btn-sm btn-primary" onclick="document.getElementById('copy-redirect-url').click()">📋 Copy Callback URL</button>
                    <button class="btn btn-sm btn-secondary" onclick="document.getElementById('btn-settings').click()">⚙️ Open Settings</button>
                    <button class="btn btn-sm btn-ghost" onclick="document.getElementById('btn-connect-tab').click()">🔗 Use Connect from Tab Instead</button>
                </div>
                <p style="margin-top:12px;color:var(--text-muted);font-size:11px">
                    💡 <strong>Tip:</strong> The easiest way to connect is <strong>"Connect from Tab"</strong> — just log into Salesforce in a browser tab first, then click the button. No Connected App needed!
                </p>
            </div>
        `;

        // Click to copy redirect URL
        const copyEl = document.getElementById('copy-redirect-url');
        if (copyEl) {
            copyEl.addEventListener('click', () => {
                navigator.clipboard.writeText(redirectUrl);
                showToast('Callback URL copied to clipboard!', 'success');
                copyEl.style.borderColor = 'var(--accent-green)';
                setTimeout(() => { copyEl.style.borderColor = 'var(--border-color)'; }, 1500);
            });
        }
    }
}

async function refreshOrgList() {
    try {
        const response = await chrome.runtime.sendMessage({ action: 'getOrgs' });
        const orgs = response.error ? [] : (Array.isArray(response) ? response : []);
        const activeOrg = await chrome.runtime.sendMessage({ action: 'getActiveOrg' });

        const orgList = document.getElementById('org-list');
        const orgName = document.getElementById('org-name');
        const orgIndicator = document.getElementById('org-indicator');

        // Update stats
        document.getElementById('stat-orgs').textContent = orgs.length;

        if (activeOrg && !activeOrg.error) {
            orgName.textContent = activeOrg.userName || 'Connected';
            orgIndicator.classList.add('connected');
        } else {
            orgName.textContent = 'No Org Connected';
            orgIndicator.classList.remove('connected');
        }

        // Render org list
        orgList.innerHTML = orgs.map(org => `
      <div class="org-item ${activeOrg && activeOrg.orgId === org.orgId ? 'active' : ''}" 
           data-org-id="${org.orgId}">
        <div class="org-item-info">
          <span class="org-item-name">${org.userName || org.orgId}</span>
          <span class="org-item-type">${org.orgType || 'Unknown'} • ${org.instanceUrl}</span>
        </div>
        <button class="org-item-remove" data-remove="${org.orgId}" title="Disconnect">×</button>
      </div>
    `).join('');

        // Bind click events
        orgList.querySelectorAll('.org-item').forEach(item => {
            item.addEventListener('click', async (e) => {
                if (e.target.closest('.org-item-remove')) return;
                const orgId = item.dataset.orgId;
                await switchOrg(orgId);
            });
        });

        orgList.querySelectorAll('.org-item-remove').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const orgId = btn.dataset.remove;
                if (confirm('Disconnect this org?')) {
                    await disconnectOrg(orgId);
                }
            });
        });

        // Update org compare dropdowns
        updateOrgDropdowns(orgs);
    } catch (error) {
        console.error('Failed to refresh org list:', error);
    }
}

async function switchOrg(orgId) {
    try {
        await chrome.runtime.sendMessage({ action: 'setActiveOrg', orgId });
        showToast('Switched org', 'success');
        await refreshOrgList();
        await loadDashboardStats();
    } catch (error) {
        showToast(`Failed to switch org: ${error.message}`, 'error');
    }
}

async function disconnectOrg(orgId) {
    try {
        await chrome.runtime.sendMessage({ action: 'logout', orgId });
        showToast('Org disconnected', 'success');
        await refreshOrgList();
    } catch (error) {
        showToast(`Failed to disconnect: ${error.message}`, 'error');
    }
}

function updateOrgDropdowns(orgs) {
    const selectors = ['compare-org-1', 'compare-org-2'];
    selectors.forEach(id => {
        const select = document.getElementById(id);
        if (!select) return;
        const currentVal = select.value;
        select.innerHTML = '<option value="">Select Org...</option>' +
            orgs.map(o => `<option value="${o.orgId}">${o.userName} (${o.orgType})</option>`).join('');
        select.value = currentVal;
    });
}

// ============================================
// Settings
// ============================================

function initSettings() {
    document.getElementById('btn-settings').addEventListener('click', () => {
        document.getElementById('settings-modal').classList.add('visible');
        loadSettings();
    });

    document.getElementById('btn-close-settings').addEventListener('click', closeSettings);
    document.getElementById('btn-cancel-settings').addEventListener('click', closeSettings);

    document.getElementById('btn-save-settings').addEventListener('click', async () => {
        await saveSettings();
        closeSettings();
        showToast('Settings saved', 'success');
    });
}

function closeSettings() {
    document.getElementById('settings-modal').classList.remove('visible');
}

async function loadSettings() {
    const settings = await getSettings();
    document.getElementById('setting-api-version').value = settings.apiVersion || 'v60.0';
    document.getElementById('setting-openai-key').value = settings.openaiApiKey || '';
    document.getElementById('setting-client-id').value = settings.clientId || '';
    document.getElementById('setting-cache-ttl').value = settings.cacheTimeout || '3600000';
}

async function saveSettings() {
    const settings = {
        apiVersion: document.getElementById('setting-api-version').value,
        openaiApiKey: document.getElementById('setting-openai-key').value,
        clientId: document.getElementById('setting-client-id').value,
        cacheTimeout: parseInt(document.getElementById('setting-cache-ttl').value)
    };
    await Storage.set('sf_settings', settings);
}

async function getSettings() {
    return (await Storage.get('sf_settings')) || {
        apiVersion: 'v62.0',
        theme: 'dark',
        cacheTimeout: 3600000,
        openaiApiKey: '',
        clientId: ''
    };
}

// ============================================
// Dashboard
// ============================================

async function loadInitialState() {
    try {
        await refreshOrgList();
        await loadDashboardStats();
        loadRecentQueries();
    } catch (error) {
        console.error('Init error:', error);
    }
}

async function loadDashboardStats() {
    try {
        const activeOrg = await chrome.runtime.sendMessage({ action: 'getActiveOrg' });
        if (activeOrg && !activeOrg.error) {
            const globalDesc = await chrome.runtime.sendMessage({ action: 'describeGlobal' });
            if (globalDesc && !globalDesc.error && globalDesc.sobjects) {
                document.getElementById('stat-objects').textContent = globalDesc.sobjects.length;
            }
        }
    } catch (error) {
        console.log('Dashboard stats skipped:', error.message);
    }

    // Load query count from history
    const history = await Storage.get('query_history') || [];
    document.getElementById('stat-queries').textContent = history.length;
}

async function loadRecentQueries() {
    const history = await Storage.get('query_history') || [];
    const container = document.getElementById('recent-queries-list');

    if (history.length === 0) {
        container.innerHTML = '<div class="empty-state-sm">No recent queries</div>';
        return;
    }

    container.innerHTML = history.slice(0, 5).map(q => `
    <div class="recent-item" data-query="${encodeURIComponent(q.query)}">
      <span class="recent-query-text">${escapeHtml(q.query)}</span>
      <span class="recent-query-time">${formatTime(q.timestamp)}</span>
    </div>
  `).join('');

    container.querySelectorAll('.recent-item').forEach(item => {
        item.addEventListener('click', () => {
            const query = decodeURIComponent(item.dataset.query);
            document.getElementById('soql-editor').value = query;
            switchTab('query-runner');
        });
    });
}

// ============================================
// Global Utilities
// ============================================

function setStatus(text) {
    document.getElementById('status-text').textContent = text;
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
    ${type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️'}
    <span>${message}</span>
  `;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(20px)';
        toast.style.transition = 'all 0.3s';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatTime(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return date.toLocaleDateString();
}

async function saveQueryToHistory(query) {
    const history = await Storage.get('query_history') || [];
    history.unshift({ query, timestamp: Date.now() });
    // Keep last 50
    if (history.length > 50) history.splice(50);
    await Storage.set('query_history', history);
    document.getElementById('stat-queries').textContent = history.length;
}

// ============================================
// Helper: Send message to background
// ============================================

async function sendMessage(message) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(message, (response) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
            } else if (response && response.error) {
                reject(new Error(response.error));
            } else {
                resolve(response);
            }
        });
    });
}

// Make utilities globally available
window.showToast = showToast;
window.setStatus = setStatus;
window.sendMessage = sendMessage;
window.switchTab = switchTab;
window.escapeHtml = escapeHtml;
window.saveQueryToHistory = saveQueryToHistory;
window.getSettings = getSettings;
window.loadRecentQueries = loadRecentQueries;
