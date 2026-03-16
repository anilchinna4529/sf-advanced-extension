/**
 * Auth Module
 * Handles OAuth flow communication with background service worker
 */

const Auth = {
    async login(loginUrl = 'https://login.salesforce.com', clientId = null) {
        return sendMessage({ action: 'login', loginUrl, clientId });
    },

    async logout(orgId) {
        return sendMessage({ action: 'logout', orgId });
    },

    async getActiveOrg() {
        return sendMessage({ action: 'getActiveOrg' });
    },

    async getOrgs() {
        const result = await sendMessage({ action: 'getOrgs' });
        return Array.isArray(result) ? result : [];
    },

    async switchOrg(orgId) {
        return sendMessage({ action: 'setActiveOrg', orgId });
    },

    async isAuthenticated() {
        try {
            const org = await this.getActiveOrg();
            return org && org.accessToken;
        } catch {
            return false;
        }
    }
};

if (typeof window !== 'undefined') {
    window.Auth = Auth;
}
