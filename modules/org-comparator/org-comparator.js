/**
 * Org Comparator Module
 * Compare metadata between two connected Salesforce orgs
 */

const OrgComparator = {
    init() {
        const org1Select = document.getElementById('compare-org-1');
        const org2Select = document.getElementById('compare-org-2');
        const compareBtn = document.getElementById('btn-compare-orgs');

        const updateBtnState = () => {
            compareBtn.disabled = !org1Select.value || !org2Select.value || org1Select.value === org2Select.value;
        };

        org1Select.addEventListener('change', updateBtnState);
        org2Select.addEventListener('change', updateBtnState);

        compareBtn.addEventListener('click', () => this.compare());
    },

    async compare() {
        const org1Id = document.getElementById('compare-org-1').value;
        const org2Id = document.getElementById('compare-org-2').value;
        const resultsDiv = document.getElementById('compare-results');

        const compareObjects = document.getElementById('compare-objects').checked;
        const compareFields = document.getElementById('compare-fields').checked;
        const compareApex = document.getElementById('compare-apex').checked;

        resultsDiv.innerHTML = '<div class="loading-state"><div class="spinner"></div>Comparing orgs...</div>';
        setStatus('Comparing orgs...');

        try {
            const orgs = await sendMessage({ action: 'getOrgs' });
            const org1 = orgs.find(o => o.orgId === org1Id);
            const org2 = orgs.find(o => o.orgId === org2Id);

            if (!org1 || !org2) throw new Error('Could not find org data');

            const differences = [];

            // Compare objects
            if (compareObjects) {
                await sendMessage({ action: 'setActiveOrg', orgId: org1Id });
                const org1Objects = await sendMessage({ action: 'describeGlobal' });

                await sendMessage({ action: 'setActiveOrg', orgId: org2Id });
                const org2Objects = await sendMessage({ action: 'describeGlobal' });

                const org1Names = new Set((org1Objects.sobjects || []).map(o => o.name));
                const org2Names = new Set((org2Objects.sobjects || []).map(o => o.name));

                const onlyInOrg1 = [...org1Names].filter(n => !org2Names.has(n));
                const onlyInOrg2 = [...org2Names].filter(n => !org1Names.has(n));

                if (onlyInOrg1.length > 0 || onlyInOrg2.length > 0) {
                    differences.push({
                        section: 'Objects',
                        icon: '📦',
                        items: [
                            ...onlyInOrg1.map(n => ({ name: n, type: 'removed', label: `Only in ${org1.userName}` })),
                            ...onlyInOrg2.map(n => ({ name: n, type: 'added', label: `Only in ${org2.userName}` }))
                        ]
                    });
                }

                // Compare fields of common custom objects
                if (compareFields) {
                    const commonCustomObjects = [...org1Names].filter(n => org2Names.has(n) && n.endsWith('__c')).slice(0, 10);

                    for (const objName of commonCustomObjects) {
                        await sendMessage({ action: 'setActiveOrg', orgId: org1Id });
                        const obj1 = await sendMessage({ action: 'describeSObject', sobject: objName });

                        await sendMessage({ action: 'setActiveOrg', orgId: org2Id });
                        const obj2 = await sendMessage({ action: 'describeSObject', sobject: objName });

                        const fields1 = new Set((obj1.fields || []).map(f => f.name));
                        const fields2 = new Set((obj2.fields || []).map(f => f.name));

                        const onlyIn1 = [...fields1].filter(n => !fields2.has(n));
                        const onlyIn2 = [...fields2].filter(n => !fields1.has(n));

                        if (onlyIn1.length > 0 || onlyIn2.length > 0) {
                            differences.push({
                                section: `${objName} Fields`,
                                icon: '🏷️',
                                items: [
                                    ...onlyIn1.map(n => ({ name: `${objName}.${n}`, type: 'removed', label: `Only in ${org1.userName}` })),
                                    ...onlyIn2.map(n => ({ name: `${objName}.${n}`, type: 'added', label: `Only in ${org2.userName}` }))
                                ]
                            });
                        }
                    }
                }
            }

            // Compare Apex classes
            if (compareApex) {
                try {
                    await sendMessage({ action: 'setActiveOrg', orgId: org1Id });
                    const apex1Result = await sendMessage({
                        action: 'apiRequest',
                        path: '/services/data/v60.0/tooling/query?q=' + encodeURIComponent('SELECT Name FROM ApexClass ORDER BY Name'),
                        method: 'GET'
                    });

                    await sendMessage({ action: 'setActiveOrg', orgId: org2Id });
                    const apex2Result = await sendMessage({
                        action: 'apiRequest',
                        path: '/services/data/v60.0/tooling/query?q=' + encodeURIComponent('SELECT Name FROM ApexClass ORDER BY Name'),
                        method: 'GET'
                    });

                    const apex1Names = new Set((apex1Result.records || []).map(r => r.Name));
                    const apex2Names = new Set((apex2Result.records || []).map(r => r.Name));

                    const onlyIn1 = [...apex1Names].filter(n => !apex2Names.has(n));
                    const onlyIn2 = [...apex2Names].filter(n => !apex1Names.has(n));

                    if (onlyIn1.length > 0 || onlyIn2.length > 0) {
                        differences.push({
                            section: 'Apex Classes',
                            icon: '⚡',
                            items: [
                                ...onlyIn1.map(n => ({ name: n, type: 'removed', label: `Only in ${org1.userName}` })),
                                ...onlyIn2.map(n => ({ name: n, type: 'added', label: `Only in ${org2.userName}` }))
                            ]
                        });
                    }
                } catch (e) {
                    console.log('Apex comparison skipped:', e.message);
                }
            }

            // Render results
            this.renderResults(differences, org1, org2);

            // Restore active org
            await sendMessage({ action: 'setActiveOrg', orgId: org1Id });
            setStatus('Comparison complete');
        } catch (error) {
            resultsDiv.innerHTML = `<div class="empty-state"><p style="color:var(--accent-red)">❌ ${error.message}</p></div>`;
            setStatus('Comparison failed');
        }
    },

    renderResults(differences, org1, org2) {
        const resultsDiv = document.getElementById('compare-results');

        if (differences.length === 0) {
            resultsDiv.innerHTML = `
        <div class="debug-result-card">
          <h4>✅ No Differences Found</h4>
          <p>The selected metadata types are identical between ${org1.userName} and ${org2.userName}.</p>
        </div>
      `;
            return;
        }

        let totalDiffs = differences.reduce((sum, d) => sum + d.items.length, 0);

        resultsDiv.innerHTML = `
      <div class="debug-result-card" style="margin-bottom:16px">
        <h4>⚖️ Comparison Results</h4>
        <p><strong>${org1.userName}</strong> vs <strong>${org2.userName}</strong></p>
        <p>${totalDiffs} differences found</p>
      </div>
      ${differences.map(diff => `
        <div class="compare-section">
          <h4>${diff.icon} ${diff.section} <span class="badge">${diff.items.length}</span></h4>
          ${diff.items.map(item => `
            <div class="diff-item ${item.type}">
              <span class="diff-badge ${item.type}">${item.type === 'added' ? '+' : item.type === 'removed' ? '-' : '~'}</span>
              <span class="text-mono" style="font-size:11px">${item.name}</span>
              <span class="text-muted text-sm" style="margin-left:auto">${item.label}</span>
            </div>
          `).join('')}
        </div>
      `).join('')}
    `;
    }
};

document.addEventListener('DOMContentLoaded', () => OrgComparator.init());

if (typeof window !== 'undefined') {
    window.OrgComparator = OrgComparator;
}
