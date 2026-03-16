/**
 * Content Script - Salesforce Page Enhancement
 * Injected into Salesforce pages to detect context and add tools
 */

(function () {
    'use strict';

    // Detect if we're on a Salesforce page
    const isSalesforcePage = () => {
        return window.location.hostname.includes('salesforce.com') ||
            window.location.hostname.includes('force.com') ||
            window.location.hostname.includes('lightning.force.com');
    };

    if (!isSalesforcePage()) return;

    // ========== Record Detection ==========

    function detectRecordContext() {
        const url = window.location.pathname;
        const context = {
            type: null,
            recordId: null,
            objectName: null
        };

        // Lightning record page: /lightning/r/Account/001XXXX/view
        const lightningMatch = url.match(/\/lightning\/r\/(\w+)\/([a-zA-Z0-9]{15,18})\//);
        if (lightningMatch) {
            context.type = 'record';
            context.objectName = lightningMatch[1];
            context.recordId = lightningMatch[2];
        }

        // Lightning list view: /lightning/o/Account/list
        const listMatch = url.match(/\/lightning\/o\/(\w+)\/list/);
        if (listMatch) {
            context.type = 'list';
            context.objectName = listMatch[1];
        }

        // Setup page
        if (url.includes('/lightning/setup/')) {
            context.type = 'setup';
        }

        return context;
    }

    // ========== Floating Toolbar ==========

    function createFloatingToolbar() {
        // Remove existing
        const existing = document.getElementById('sf-dev-toolkit-bar');
        if (existing) existing.remove();

        const context = detectRecordContext();

        const toolbar = document.createElement('div');
        toolbar.id = 'sf-dev-toolkit-bar';
        toolbar.innerHTML = `
      <div class="sf-toolkit-toggle" id="sf-toolkit-toggle" title="Salesforce Dev Toolkit">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
        </svg>
      </div>
      <div class="sf-toolkit-panel" id="sf-toolkit-panel">
        <div class="sf-toolkit-header">
          <span>⚡ Dev Toolkit</span>
          <span class="sf-toolkit-close" id="sf-toolkit-close">×</span>
        </div>
        <div class="sf-toolkit-actions">
          ${context.recordId ? `
            <button class="sf-toolkit-btn" data-action="copy-id" title="Copy Record ID">
              <span>📋</span> Copy ID: ${context.recordId.substring(0, 8)}...
            </button>
          ` : ''}
          ${context.objectName ? `
            <button class="sf-toolkit-btn" data-action="open-soql" title="Open in SOQL Builder">
              <span>🔍</span> Query ${context.objectName}
            </button>
            <button class="sf-toolkit-btn" data-action="view-metadata" title="View Metadata">
              <span>📊</span> ${context.objectName} Metadata
            </button>
          ` : ''}
          <button class="sf-toolkit-btn" data-action="show-fields" title="Toggle API Names">
            <span>🏷️</span> Show API Names
          </button>
          <button class="sf-toolkit-btn" data-action="open-extension" title="Open Extension">
            <span>⚡</span> Open Toolkit
          </button>
        </div>
      </div>
    `;

        document.body.appendChild(toolbar);

        // Toggle panel
        document.getElementById('sf-toolkit-toggle').addEventListener('click', () => {
            const panel = document.getElementById('sf-toolkit-panel');
            panel.classList.toggle('visible');
        });

        document.getElementById('sf-toolkit-close').addEventListener('click', () => {
            document.getElementById('sf-toolkit-panel').classList.remove('visible');
        });

        // Action handlers
        toolbar.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-action]');
            if (!btn) return;

            const action = btn.dataset.action;
            switch (action) {
                case 'copy-id':
                    navigator.clipboard.writeText(context.recordId);
                    showToast('Record ID copied!');
                    break;
                case 'open-soql':
                    chrome.runtime.sendMessage({
                        action: 'openPopup',
                        tab: 'soql-builder',
                        object: context.objectName
                    });
                    break;
                case 'view-metadata':
                    chrome.runtime.sendMessage({
                        action: 'openPopup',
                        tab: 'metadata-explorer',
                        object: context.objectName
                    });
                    break;
                case 'show-fields':
                    toggleApiNames();
                    break;
                case 'open-extension':
                    chrome.runtime.sendMessage({ action: 'openPopup' });
                    break;
            }
        });
    }

    // ========== API Name Display ==========

    let apiNamesVisible = false;

    function toggleApiNames() {
        apiNamesVisible = !apiNamesVisible;
        const labels = document.querySelectorAll('.test-id__field-label, .slds-form-element__label, [data-target-selection-name]');

        labels.forEach(label => {
            if (apiNamesVisible) {
                const apiName = label.getAttribute('data-target-selection-name') ||
                    label.textContent.trim().replace(/\s+/g, '_');
                const badge = document.createElement('span');
                badge.className = 'sf-api-name-badge';
                badge.textContent = apiName;
                label.appendChild(badge);
            } else {
                const badges = label.querySelectorAll('.sf-api-name-badge');
                badges.forEach(b => b.remove());
            }
        });

        showToast(apiNamesVisible ? 'API names shown' : 'API names hidden');
    }

    // ========== Toast Notification ==========

    function showToast(message) {
        const existing = document.querySelector('.sf-toolkit-toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.className = 'sf-toolkit-toast';
        toast.textContent = message;
        document.body.appendChild(toast);

        setTimeout(() => toast.classList.add('visible'), 10);
        setTimeout(() => {
            toast.classList.remove('visible');
            setTimeout(() => toast.remove(), 300);
        }, 2000);
    }

    // ========== Initialize ==========

    // Wait for page to be ready
    function init() {
        if (document.readyState === 'complete') {
            createFloatingToolbar();
        } else {
            window.addEventListener('load', createFloatingToolbar);
        }

        // Re-init on navigation (SPA)
        let lastUrl = location.href;
        new MutationObserver(() => {
            if (location.href !== lastUrl) {
                lastUrl = location.href;
                setTimeout(createFloatingToolbar, 1000);
            }
        }).observe(document.body, { childList: true, subtree: true });
    }

    init();
})();
