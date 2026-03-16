/**
 * Storage utility for Chrome extension
 * Wraps chrome.storage.local with async/await
 */
const Storage = {
  async get(key) {
    return new Promise((resolve) => {
      chrome.storage.local.get(key, (result) => {
        resolve(result[key] || null);
      });
    });
  },

  async set(key, value) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [key]: value }, resolve);
    });
  },

  async remove(key) {
    return new Promise((resolve) => {
      chrome.storage.local.remove(key, resolve);
    });
  },

  async getAll() {
    return new Promise((resolve) => {
      chrome.storage.local.get(null, resolve);
    });
  },

  // Org-specific storage
  async getOrgs() {
    return (await this.get('sf_orgs')) || [];
  },

  async saveOrg(orgData) {
    const orgs = await this.getOrgs();
    const idx = orgs.findIndex(o => o.orgId === orgData.orgId);
    if (idx >= 0) {
      orgs[idx] = { ...orgs[idx], ...orgData };
    } else {
      orgs.push(orgData);
    }
    await this.set('sf_orgs', orgs);
    return orgs;
  },

  async removeOrg(orgId) {
    const orgs = await this.getOrgs();
    const filtered = orgs.filter(o => o.orgId !== orgId);
    await this.set('sf_orgs', filtered);
    return filtered;
  },

  async getActiveOrg() {
    return await this.get('sf_active_org');
  },

  async setActiveOrg(orgData) {
    await this.set('sf_active_org', orgData);
  },

  // Settings
  async getSettings() {
    return (await this.get('sf_settings')) || {
      apiVersion: 'v60.0',
      theme: 'dark',
      cacheTimeout: 3600000,
      openaiApiKey: ''
    };
  },

  async saveSettings(settings) {
    await this.set('sf_settings', settings);
  }
};

// Export for use in other modules
if (typeof window !== 'undefined') {
  window.Storage = Storage;
}
