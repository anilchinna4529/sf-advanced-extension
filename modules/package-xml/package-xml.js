/**
 * Package.xml Generator Module
 * Generate deployment manifests from org metadata
 */

const PackageXMLGenerator = {
    selectedTypes: new Map(),

    init() {
        // Generate button
        document.getElementById('btn-generate-package').addEventListener('click', () => this.generate());

        // Copy package.xml
        document.getElementById('btn-copy-package').addEventListener('click', () => {
            const xml = document.getElementById('package-xml-output').textContent;
            navigator.clipboard.writeText(xml);
            showToast('Package.xml copied!', 'success');
        });

        // Download
        document.getElementById('btn-download-package').addEventListener('click', () => this.downloadPackageXml());

        // Select/Clear all
        document.getElementById('btn-select-all-types').addEventListener('click', () => {
            document.querySelectorAll('#package-type-list input[type="checkbox"]').forEach(cb => cb.checked = true);
        });

        document.getElementById('btn-clear-all-types').addEventListener('click', () => {
            document.querySelectorAll('#package-type-list input[type="checkbox"]').forEach(cb => cb.checked = false);
        });

        // Checkbox changes trigger preview
        document.getElementById('package-type-list').addEventListener('change', () => this.updatePreview());
    },

    async generate() {
        const checkboxes = document.querySelectorAll('#package-type-list input[type="checkbox"]:checked');
        const selectedTypes = [];
        checkboxes.forEach(cb => selectedTypes.push(cb.dataset.type));

        if (selectedTypes.length === 0) {
            showToast('Please select at least one metadata type', 'error');
            return;
        }

        setStatus('Generating package.xml...');

        try {
            this.selectedTypes.clear();

            for (const type of selectedTypes) {
                const members = await this.fetchMembers(type);
                this.selectedTypes.set(type, members);
            }

            // Show members panel
            this.renderMembers();
            this.generatePackageXml();
            setStatus('Package.xml generated');
            showToast('Package.xml generated!', 'success');
        } catch (error) {
            showToast(`Error: ${error.message}`, 'error');
            setStatus('Generation failed');
        }
    },

    async fetchMembers(type) {
        const queryMap = {
            'ApexClass': "SELECT Name FROM ApexClass ORDER BY Name",
            'ApexTrigger': "SELECT Name FROM ApexTrigger ORDER BY Name",
            'CustomObject': null, // handled separately
            'CustomField': null,
            'Layout': "SELECT Name FROM Layout ORDER BY Name",
            'Profile': "SELECT Name FROM Profile ORDER BY Name",
            'PermissionSet': "SELECT Name FROM PermissionSet WHERE IsOwnedByProfile = false ORDER BY Name",
            'Flow': "SELECT MasterLabel FROM Flow WHERE Status = 'Active' ORDER BY MasterLabel",
            'LightningComponentBundle': "SELECT MasterLabel FROM LightningComponentBundle ORDER BY MasterLabel",
            'AuraDefinitionBundle': "SELECT DeveloperName FROM AuraDefinitionBundle ORDER BY DeveloperName",
            'ApexPage': "SELECT Name FROM ApexPage ORDER BY Name",
            'ApexComponent': "SELECT Name FROM ApexComponent ORDER BY Name",
            'StaticResource': "SELECT Name FROM StaticResource ORDER BY Name",
            'ValidationRule': null,
            'WorkflowRule': null
        };

        const query = queryMap[type];

        // For types that need describe instead of tooling query
        if (type === 'CustomObject') {
            try {
                const data = await sendMessage({ action: 'describeGlobal' });
                return (data.sobjects || [])
                    .filter(o => o.custom)
                    .map(o => o.name);
            } catch { return ['*']; }
        }

        if (type === 'CustomField') {
            return ['*']; // Wildcard for fields
        }

        if (type === 'ValidationRule' || type === 'WorkflowRule') {
            return ['*'];
        }

        if (!query) return ['*'];

        try {
            const result = await sendMessage({
                action: 'apiRequest',
                path: '/services/data/v60.0/tooling/query?q=' + encodeURIComponent(query),
                method: 'GET'
            });

            return (result.records || []).map(r => r.Name || r.MasterLabel || r.DeveloperName);
        } catch {
            return ['*'];
        }
    },

    renderMembers() {
        const container = document.getElementById('package-members');
        const memberList = document.getElementById('package-member-list');
        const memberCount = document.getElementById('member-count');

        container.style.display = '';

        let totalMembers = 0;
        let html = '';

        for (const [type, members] of this.selectedTypes) {
            totalMembers += members.length;
            html += `
        <div style="margin-bottom:12px">
          <div style="font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:4px">
            ${type} <span class="badge">${members.length}</span>
          </div>
          <div style="max-height:100px;overflow-y:auto;font-size:11px;font-family:var(--font-mono)">
            ${members.slice(0, 20).map(m => `<div style="padding:2px 0;color:var(--text-primary)">${m}</div>`).join('')}
            ${members.length > 20 ? `<div style="color:var(--text-muted)">...and ${members.length - 20} more</div>` : ''}
          </div>
        </div>
      `;
        }

        memberCount.textContent = totalMembers;
        memberList.innerHTML = html;
    },

    generatePackageXml() {
        let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
        xml += '<Package xmlns="http://soap.sforce.com/2006/04/metadata">\n';

        for (const [type, members] of this.selectedTypes) {
            xml += '  <types>\n';
            members.forEach(member => {
                xml += `    <members>${this.xmlEscape(member)}</members>\n`;
            });
            xml += `    <name>${type}</name>\n`;
            xml += '  </types>\n';
        }

        xml += '  <version>60.0</version>\n';
        xml += '</Package>';

        document.getElementById('package-xml-output').textContent = xml;
    },

    updatePreview() {
        const checkboxes = document.querySelectorAll('#package-type-list input[type="checkbox"]:checked');
        const types = [];
        checkboxes.forEach(cb => types.push(cb.dataset.type));

        if (types.length === 0) {
            document.getElementById('package-xml-output').textContent =
                '<?xml version="1.0" encoding="UTF-8"?>\n<Package xmlns="http://soap.sforce.com/2006/04/metadata">\n  <!-- Select metadata types above -->\n  <version>60.0</version>\n</Package>';
            return;
        }

        let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
        xml += '<Package xmlns="http://soap.sforce.com/2006/04/metadata">\n';
        types.forEach(type => {
            xml += '  <types>\n';
            xml += '    <members>*</members>\n';
            xml += `    <name>${type}</name>\n`;
            xml += '  </types>\n';
        });
        xml += '  <version>60.0</version>\n';
        xml += '</Package>';

        document.getElementById('package-xml-output').textContent = xml;
    },

    downloadPackageXml() {
        const xml = document.getElementById('package-xml-output').textContent;
        const blob = new Blob([xml], { type: 'application/xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'package.xml';
        a.click();
        URL.revokeObjectURL(url);
        showToast('package.xml downloaded!', 'success');
    },

    xmlEscape(str) {
        return str.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }
};

document.addEventListener('DOMContentLoaded', () => PackageXMLGenerator.init());

if (typeof window !== 'undefined') {
    window.PackageXMLGenerator = PackageXMLGenerator;
}
