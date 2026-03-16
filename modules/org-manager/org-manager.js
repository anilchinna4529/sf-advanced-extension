/**
 * Org Manager Module
 */
const OrgManager = {
    async getConnectedOrgs() {
        return Auth.getOrgs();
    },

    async getActiveOrg() {
        return Auth.getActiveOrg();
    },

    async switchOrg(orgId) {
        return Auth.switchOrg(orgId);
    },

    async getOrgInfo(orgId) {
        const orgs = await this.getConnectedOrgs();
        return orgs.find(o => o.orgId === orgId);
    }
};

if (typeof window !== 'undefined') {
    window.OrgManager = OrgManager;
}
