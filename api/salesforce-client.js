/**
 * Salesforce API Client
 * Centralized service for all Salesforce API interactions
 */
const SalesforceClient = {
    /**
     * Make authenticated request to Salesforce
     */
    async request(instanceUrl, accessToken, path, options = {}) {
        const url = `${instanceUrl}${path}`;
        const headers = {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            ...options.headers
        };

        try {
            const response = await fetch(url, {
                method: options.method || 'GET',
                headers,
                body: options.body ? JSON.stringify(options.body) : undefined
            });

            if (response.status === 401) {
                // Token expired — try refresh
                const refreshed = await this.refreshToken();
                if (refreshed) {
                    headers['Authorization'] = `Bearer ${refreshed.accessToken}`;
                    const retry = await fetch(url, {
                        method: options.method || 'GET',
                        headers,
                        body: options.body ? JSON.stringify(options.body) : undefined
                    });
                    return await this._handleResponse(retry);
                }
                throw new Error('Session expired. Please re-login.');
            }

            return await this._handleResponse(response);
        } catch (error) {
            console.error('Salesforce API Error:', error);
            throw error;
        }
    },

    async _handleResponse(response) {
        if (!response.ok) {
            const errorBody = await response.json().catch(() => ({}));
            const message = errorBody[0]?.message || errorBody.message || `HTTP ${response.status}`;
            throw new Error(message);
        }
        if (response.status === 204) return null;
        return await response.json();
    },

    /**
     * Refresh access token
     */
    async refreshToken() {
        const org = await Storage.getActiveOrg();
        if (!org || !org.refreshToken) return null;

        const settings = await Storage.getSettings();
        const clientId = org.clientId || '3MVG9YOUR_CLIENT_ID';

        try {
            const response = await fetch(`${org.loginUrl || 'https://login.salesforce.com'}/services/oauth2/token`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    grant_type: 'refresh_token',
                    client_id: clientId,
                    refresh_token: org.refreshToken
                })
            });

            if (response.ok) {
                const data = await response.json();
                const updatedOrg = {
                    ...org,
                    accessToken: data.access_token,
                    instanceUrl: data.instance_url
                };
                await Storage.setActiveOrg(updatedOrg);
                await Storage.saveOrg(updatedOrg);
                return updatedOrg;
            }
        } catch (e) {
            console.error('Token refresh failed:', e);
        }
        return null;
    },

    // ========== REST API Methods ==========

    async query(instanceUrl, accessToken, soql, apiVersion = 'v60.0') {
        const encoded = encodeURIComponent(soql);
        return this.request(instanceUrl, accessToken, `/services/data/${apiVersion}/query?q=${encoded}`);
    },

    async queryMore(instanceUrl, accessToken, nextRecordsUrl) {
        return this.request(instanceUrl, accessToken, nextRecordsUrl);
    },

    async getRecord(instanceUrl, accessToken, sobject, recordId, fields, apiVersion = 'v60.0') {
        const fieldsParam = fields ? `?fields=${fields.join(',')}` : '';
        return this.request(instanceUrl, accessToken, `/services/data/${apiVersion}/sobjects/${sobject}/${recordId}${fieldsParam}`);
    },

    async createRecord(instanceUrl, accessToken, sobject, data, apiVersion = 'v60.0') {
        return this.request(instanceUrl, accessToken, `/services/data/${apiVersion}/sobjects/${sobject}`, {
            method: 'POST',
            body: data
        });
    },

    async updateRecord(instanceUrl, accessToken, sobject, recordId, data, apiVersion = 'v60.0') {
        return this.request(instanceUrl, accessToken, `/services/data/${apiVersion}/sobjects/${sobject}/${recordId}`, {
            method: 'PATCH',
            body: data
        });
    },

    async deleteRecord(instanceUrl, accessToken, sobject, recordId, apiVersion = 'v60.0') {
        return this.request(instanceUrl, accessToken, `/services/data/${apiVersion}/sobjects/${sobject}/${recordId}`, {
            method: 'DELETE'
        });
    },

    async upsertRecord(instanceUrl, accessToken, sobject, externalIdField, externalId, data, apiVersion = 'v60.0') {
        return this.request(instanceUrl, accessToken,
            `/services/data/${apiVersion}/sobjects/${sobject}/${externalIdField}/${externalId}`, {
            method: 'PATCH',
            body: data
        });
    },

    // ========== Metadata API Methods ==========

    async describeGlobal(instanceUrl, accessToken, apiVersion = 'v60.0') {
        return this.request(instanceUrl, accessToken, `/services/data/${apiVersion}/sobjects`);
    },

    async describeSObject(instanceUrl, accessToken, sobject, apiVersion = 'v60.0') {
        return this.request(instanceUrl, accessToken, `/services/data/${apiVersion}/sobjects/${sobject}/describe`);
    },

    // ========== Tooling API Methods ==========

    async toolingQuery(instanceUrl, accessToken, soql, apiVersion = 'v60.0') {
        const encoded = encodeURIComponent(soql);
        return this.request(instanceUrl, accessToken, `/services/data/${apiVersion}/tooling/query?q=${encoded}`);
    },

    async getApexClasses(instanceUrl, accessToken, apiVersion = 'v60.0') {
        return this.toolingQuery(instanceUrl, accessToken,
            "SELECT Id, Name, Body, Status, ApiVersion FROM ApexClass ORDER BY Name", apiVersion);
    },

    async getApexTriggers(instanceUrl, accessToken, apiVersion = 'v60.0') {
        return this.toolingQuery(instanceUrl, accessToken,
            "SELECT Id, Name, Body, Status, TableEnumOrId FROM ApexTrigger ORDER BY Name", apiVersion);
    },

    async getDebugLogs(instanceUrl, accessToken, apiVersion = 'v60.0') {
        return this.toolingQuery(instanceUrl, accessToken,
            "SELECT Id, Application, DurationMilliseconds, Location, LogLength, LogUserId, Operation, Request, StartTime, Status FROM ApexLog ORDER BY StartTime DESC LIMIT 20", apiVersion);
    },

    // ========== Bulk API Methods ==========

    async createBulkJob(instanceUrl, accessToken, operation, objectName, apiVersion = 'v60.0') {
        return this.request(instanceUrl, accessToken, `/services/data/${apiVersion}/jobs/ingest`, {
            method: 'POST',
            body: {
                operation,
                object: objectName,
                contentType: 'CSV',
                lineEnding: 'CRLF'
            }
        });
    },

    async uploadBulkData(instanceUrl, accessToken, jobId, csvData, apiVersion = 'v60.0') {
        const url = `${instanceUrl}/services/data/${apiVersion}/jobs/ingest/${jobId}/batches`;
        const response = await fetch(url, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'text/csv'
            },
            body: csvData
        });
        return response;
    },

    async closeBulkJob(instanceUrl, accessToken, jobId, apiVersion = 'v60.0') {
        return this.request(instanceUrl, accessToken, `/services/data/${apiVersion}/jobs/ingest/${jobId}`, {
            method: 'PATCH',
            body: { state: 'UploadComplete' }
        });
    },

    async getBulkJobStatus(instanceUrl, accessToken, jobId, apiVersion = 'v60.0') {
        return this.request(instanceUrl, accessToken, `/services/data/${apiVersion}/jobs/ingest/${jobId}`);
    },

    // ========== Identity ==========

    async getIdentity(instanceUrl, accessToken) {
        return this.request(instanceUrl, accessToken, '/services/oauth2/userinfo');
    },

    async getOrgLimits(instanceUrl, accessToken, apiVersion = 'v60.0') {
        return this.request(instanceUrl, accessToken, `/services/data/${apiVersion}/limits`);
    }
};

if (typeof window !== 'undefined') {
    window.SalesforceClient = SalesforceClient;
}
