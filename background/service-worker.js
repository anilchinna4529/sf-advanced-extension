/**
 * Background Service Worker
 * Manages OAuth 2.0 (Authorization Code + PKCE), Session Login, API routing, and org sessions
 * 
 * Auth Methods:
 *   1. OAuth 2.0 Authorization Code with PKCE (latest, most secure)
 *   2. Session-based login (paste token / connect from tab)
 * 
 * OAuth 2.0 PKCE Flow:
 *   1. Generate code_verifier (128-char random string)
 *   2. Derive code_challenge via SHA-256
 *   3. Open /services/oauth2/authorize with response_type=code
 *   4. User authenticates on Salesforce login page
 *   5. Salesforce redirects with authorization code
 *   6. Exchange code + code_verifier at /services/oauth2/token
 *   7. Receive access_token + refresh_token
 */

// ========== Constants ==========

const DEFAULT_CLIENT_ID = '3MVG9YOUR_CONNECTED_APP_CLIENT_ID';
const OAUTH_SCOPES = 'api refresh_token web id';
const API_VERSION = 'v62.0'; // Latest API version (Spring '25)

// ========== Message Router ==========

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleMessage(message, sender).then(sendResponse).catch(err => {
        sendResponse({ error: err.message });
    });
    return true; // async response
});

async function handleMessage(message, sender) {
    switch (message.action) {
        case 'login':
            return await handleOAuthLogin(message.loginUrl, message.clientId);
        case 'sessionLogin':
            return await handleSessionLogin(message.instanceUrl, message.accessToken, message.orgType);
        case 'connectFromTab':
            return await handleConnectFromTab();
        case 'logout':
            return await handleLogout(message.orgId);
        case 'getActiveOrg':
            return await getActiveOrg();
        case 'setActiveOrg':
            return await setActiveOrg(message.orgId);
        case 'getOrgs':
            return await getOrgs();
        case 'apiRequest':
            return await handleApiRequest(message);
        case 'query':
            return await handleQuery(message.soql);
        case 'describeGlobal':
            return await handleDescribeGlobal();
        case 'describeSObject':
            return await handleDescribeSObject(message.sobject);
        case 'refreshMetadata':
            return await handleRefreshMetadata(message.sobject);
        case 'getIdentity':
            return await handleGetIdentity();
        case 'getRedirectUrl':
            return { redirectUrl: chrome.identity.getRedirectURL() };
        default:
            throw new Error(`Unknown action: ${message.action}`);
    }
}

// =====================================================================
// OAuth 2.0 Authorization Code Flow with PKCE
// Latest standard — replaces deprecated Implicit Grant (response_type=token)
// Reference: https://help.salesforce.com/s/articleView?id=sf.remoteaccess_oauth_web_server_flow.htm
// =====================================================================

/**
 * Generate a cryptographically random code_verifier for PKCE
 * @returns {string} 128-character URL-safe random string
 */
function generateCodeVerifier() {
    const array = new Uint8Array(96); // 96 bytes → 128 base64url chars
    crypto.getRandomValues(array);
    return base64UrlEncode(array);
}

/**
 * Generate code_challenge from code_verifier using SHA-256
 * @param {string} verifier - The code_verifier
 * @returns {Promise<string>} Base64url-encoded SHA-256 hash
 */
async function generateCodeChallenge(verifier) {
    const encoder = new TextEncoder();
    const data = encoder.encode(verifier);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return base64UrlEncode(new Uint8Array(digest));
}

/**
 * Base64url encoding (no padding, URL-safe chars)
 * @param {Uint8Array} buffer
 * @returns {string}
 */
function base64UrlEncode(buffer) {
    let str = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
        str += String.fromCharCode(bytes[i]);
    }
    return btoa(str)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

/**
 * Main OAuth 2.0 PKCE login handler
 */
async function handleOAuthLogin(loginUrl = 'https://login.salesforce.com', clientId) {
    const callbackUrl = chrome.identity.getRedirectURL();
    const usedClientId = clientId || DEFAULT_CLIENT_ID;

    console.log('[SF Toolkit] Redirect URL for Connected App:', callbackUrl);

    // Validate client ID
    if (!usedClientId || usedClientId === '3MVG9YOUR_CONNECTED_APP_CLIENT_ID' || usedClientId.trim() === '') {
        throw new Error(
            `NO_CLIENT_ID::${callbackUrl}::` +
            'No Connected App Client ID configured. ' +
            'Go to Settings (⚙️) and enter your Connected App Consumer Key. ' +
            'Your Callback URL is: ' + callbackUrl
        );
    }

    // Step 1: Generate PKCE parameters
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = await generateCodeChallenge(codeVerifier);

    console.log('[SF Toolkit] PKCE code_challenge generated (S256)');

    // Step 2: Build authorization URL with PKCE
    const authParams = new URLSearchParams({
        response_type: 'code',
        client_id: usedClientId,
        redirect_uri: callbackUrl,
        scope: OAUTH_SCOPES,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        prompt: 'login consent'
    });

    const authUrl = `${loginUrl}/services/oauth2/authorize?${authParams.toString()}`;
    console.log('[SF Toolkit] Opening OAuth authorization page...');

    // Step 3: Open the Salesforce login page
    return new Promise((resolve, reject) => {
        chrome.identity.launchWebAuthFlow(
            { url: authUrl, interactive: true },
            async (redirectUrl) => {
                if (chrome.runtime.lastError) {
                    const errMsg = chrome.runtime.lastError.message;
                    console.error('[SF Toolkit] OAuth error:', errMsg);

                    if (errMsg.includes('cannot be loaded') || errMsg.includes('page could not be loaded')) {
                        reject(new Error(
                            'Could not open Salesforce login page. Please verify:\n' +
                            '1. Your Connected App Client ID is correct\n' +
                            '2. The Callback URL in your Connected App matches:\n   ' + callbackUrl + '\n' +
                            '3. OAuth scopes include: api, refresh_token, web\n' +
                            '4. "Require Proof Key for Code Exchange (PKCE)" is enabled\n\n' +
                            'Or use "Connect from Tab" / "Quick Connect" as alternatives.'
                        ));
                    } else if (errMsg.includes('user closed') || errMsg.includes('canceled') || errMsg.includes('cancelled')) {
                        reject(new Error('Login was cancelled by user.'));
                    } else {
                        reject(new Error('OAuth error: ' + errMsg));
                    }
                    return;
                }

                if (!redirectUrl) {
                    reject(new Error('No response received from Salesforce.'));
                    return;
                }

                try {
                    // Step 4: Extract authorization code from redirect URL
                    const responseUrl = new URL(redirectUrl);
                    const authCode = responseUrl.searchParams.get('code');
                    const error = responseUrl.searchParams.get('error');

                    if (error) {
                        const errorDesc = responseUrl.searchParams.get('error_description') || error;
                        throw new Error(`Salesforce denied authorization: ${errorDesc}`);
                    }

                    if (!authCode) {
                        throw new Error('No authorization code received from Salesforce.');
                    }

                    console.log('[SF Toolkit] Authorization code received, exchanging for tokens...');

                    // Step 5: Exchange authorization code for tokens (with PKCE verifier)
                    const tokenResponse = await fetch(`${loginUrl}/services/oauth2/token`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/x-www-form-urlencoded',
                            'Accept': 'application/json'
                        },
                        body: new URLSearchParams({
                            grant_type: 'authorization_code',
                            code: authCode,
                            client_id: usedClientId,
                            redirect_uri: callbackUrl,
                            code_verifier: codeVerifier
                        })
                    });

                    if (!tokenResponse.ok) {
                        const errData = await tokenResponse.json().catch(() => ({}));
                        throw new Error(
                            errData.error_description ||
                            errData.error ||
                            `Token exchange failed (HTTP ${tokenResponse.status})`
                        );
                    }

                    const tokenData = await tokenResponse.json();
                    console.log('[SF Toolkit] Tokens received successfully');

                    const accessToken = tokenData.access_token;
                    const refreshToken = tokenData.refresh_token;
                    const instanceUrl = tokenData.instance_url;
                    const idUrl = tokenData.id; // identity service URL

                    if (!accessToken) {
                        throw new Error('No access_token in token response.');
                    }
                    if (!instanceUrl) {
                        throw new Error('No instance_url in token response.');
                    }

                    // Step 6: Fetch user identity
                    let identity = {};
                    try {
                        const identityResponse = await fetch(`${instanceUrl}/services/oauth2/userinfo`, {
                            headers: { 'Authorization': `Bearer ${accessToken}` }
                        });
                        if (identityResponse.ok) {
                            identity = await identityResponse.json();
                        }
                    } catch (e) {
                        console.warn('[SF Toolkit] Could not fetch user identity:', e.message);
                    }

                    // Step 7: Store org data
                    const orgData = {
                        orgId: identity.organization_id || tokenData.id?.split('/').slice(-2, -1)[0] || 'org_' + Date.now(),
                        instanceUrl,
                        accessToken,
                        refreshToken: refreshToken || null,
                        loginUrl,
                        clientId: usedClientId,
                        userName: identity.preferred_username || identity.email || identity.name || tokenData.id?.split('/').pop() || 'Salesforce User',
                        displayName: identity.name || 'Salesforce User',
                        orgType: loginUrl.includes('test.salesforce.com') ? 'Sandbox' : 'Production',
                        userId: identity.user_id || tokenData.id?.split('/').pop(),
                        connectedAt: new Date().toISOString(),
                        loginMethod: 'oauth_pkce',
                        tokenIssuedAt: tokenData.issued_at,
                        idUrl: idUrl || null
                    };

                    await saveOrg(orgData);
                    await setActiveOrgData(orgData);

                    console.log('[SF Toolkit] Connected to:', orgData.userName);
                    resolve(orgData);

                } catch (error) {
                    console.error('[SF Toolkit] Token exchange error:', error);
                    reject(error);
                }
            }
        );
    });
}

// =====================================================================
// Session-based Login (Like Salesforce Inspector)
// =====================================================================

async function handleSessionLogin(instanceUrl, accessToken, orgType) {
    if (!instanceUrl || !accessToken) {
        throw new Error('Instance URL and Access Token are required');
    }

    // Clean up the instance URL
    instanceUrl = instanceUrl.replace(/\/+$/, '');
    if (!instanceUrl.startsWith('https://')) {
        instanceUrl = 'https://' + instanceUrl;
    }

    // Verify the token works by getting user info
    try {
        const identityResponse = await fetch(`${instanceUrl}/services/oauth2/userinfo`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        if (!identityResponse.ok) {
            // Try /services/data/ as fallback to verify token
            const versionResponse = await fetch(`${instanceUrl}/services/data/`, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });
            if (!versionResponse.ok) {
                throw new Error(`Invalid credentials. HTTP ${identityResponse.status}`);
            }
            // Token works but userinfo may not be available
            const orgData = {
                orgId: 'org_' + Date.now(),
                instanceUrl,
                accessToken,
                refreshToken: null,
                loginUrl: instanceUrl,
                clientId: null,
                userName: instanceUrl.replace('https://', '').split('.')[0],
                displayName: 'Salesforce User',
                orgType: orgType || 'Unknown',
                userId: null,
                connectedAt: new Date().toISOString(),
                loginMethod: 'session'
            };
            await saveOrg(orgData);
            await setActiveOrgData(orgData);
            return orgData;
        }

        const identity = await identityResponse.json();

        const orgData = {
            orgId: identity.organization_id || 'org_' + Date.now(),
            instanceUrl,
            accessToken,
            refreshToken: null,
            loginUrl: instanceUrl,
            clientId: null,
            userName: identity.preferred_username || identity.email || identity.name || 'Unknown',
            displayName: identity.name || 'Salesforce User',
            orgType: orgType || (instanceUrl.includes('test') || instanceUrl.includes('sandbox') ? 'Sandbox' : 'Production'),
            userId: identity.user_id,
            connectedAt: new Date().toISOString(),
            loginMethod: 'session'
        };

        await saveOrg(orgData);
        await setActiveOrgData(orgData);
        return orgData;
    } catch (error) {
        if (error.message.includes('Invalid credentials') || error.message.includes('HTTP')) {
            throw error;
        }
        throw new Error('Could not connect. Check your Instance URL and Access Token.');
    }
}

// =====================================================================
// Connect from Active Salesforce Tab
// =====================================================================

async function handleConnectFromTab() {
    try {
        const tabs = await chrome.tabs.query({
            url: [
                'https://*.salesforce.com/*',
                'https://*.force.com/*',
                'https://*.lightning.force.com/*',
                'https://*.my.salesforce.com/*'
            ]
        });

        if (tabs.length === 0) {
            throw new Error('No Salesforce tab found. Please open Salesforce in a tab first.');
        }

        const tab = tabs[0];
        const url = new URL(tab.url);
        const instanceUrl = `${url.protocol}//${url.hostname}`;

        // Try to get the session ID from cookies
        const cookies = await chrome.cookies.getAll({ domain: url.hostname });
        const sidCookie = cookies.find(c => c.name === 'sid');

        if (!sidCookie) {
            throw new Error('Could not find Salesforce session. Please log into Salesforce in a tab first, then try again.');
        }

        return await handleSessionLogin(instanceUrl, sidCookie.value, 'Session');
    } catch (error) {
        if (error.message.includes('No Salesforce tab') || error.message.includes('Could not find')) {
            throw error;
        }
        throw new Error('Failed to connect from tab. Please try Quick Connect instead.');
    }
}

// =====================================================================
// Logout
// =====================================================================

async function handleLogout(orgId) {
    const orgs = await getOrgs();
    const orgToLogout = orgs.find(o => o.orgId === orgId);
    const filtered = orgs.filter(o => o.orgId !== orgId);
    await chrome.storage.local.set({ sf_orgs: filtered });

    // Revoke the access token on Salesforce side
    if (orgToLogout && orgToLogout.accessToken) {
        try {
            const revokeUrl = `${orgToLogout.loginUrl || 'https://login.salesforce.com'}/services/oauth2/revoke`;
            await fetch(revokeUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ token: orgToLogout.accessToken })
            });
            console.log('[SF Toolkit] Token revoked for:', orgToLogout.userName);
        } catch (e) {
            console.warn('[SF Toolkit] Token revocation failed (non-critical):', e.message);
        }
    }

    const active = await getActiveOrg();
    if (active && active.orgId === orgId) {
        if (filtered.length > 0) {
            await setActiveOrgData(filtered[0]);
        } else {
            await chrome.storage.local.remove('sf_active_org');
        }
    }

    // Clear org cache
    const all = await chrome.storage.local.get(null);
    const cacheKeys = Object.keys(all).filter(k => k.startsWith(`cache_${orgId}_`));
    if (cacheKeys.length) {
        await chrome.storage.local.remove(cacheKeys);
    }

    return { success: true };
}

// =====================================================================
// Org Management
// =====================================================================

async function getOrgs() {
    const result = await chrome.storage.local.get('sf_orgs');
    return result.sf_orgs || [];
}

async function saveOrg(orgData) {
    const orgs = await getOrgs();
    const idx = orgs.findIndex(o => o.orgId === orgData.orgId);
    if (idx >= 0) {
        orgs[idx] = { ...orgs[idx], ...orgData };
    } else {
        orgs.push(orgData);
    }
    await chrome.storage.local.set({ sf_orgs: orgs });
}

async function getActiveOrg() {
    const result = await chrome.storage.local.get('sf_active_org');
    return result.sf_active_org || null;
}

async function setActiveOrg(orgId) {
    const orgs = await getOrgs();
    const org = orgs.find(o => o.orgId === orgId);
    if (org) {
        await setActiveOrgData(org);
        return org;
    }
    throw new Error('Org not found');
}

async function setActiveOrgData(orgData) {
    await chrome.storage.local.set({ sf_active_org: orgData });
}

// =====================================================================
// API Routing
// =====================================================================

async function handleApiRequest(message) {
    const org = await getActiveOrg();
    if (!org) throw new Error('No active org. Please login first.');

    const settings = await getSettings();

    const url = `${org.instanceUrl}${message.path}`;
    const headers = {
        'Authorization': `Bearer ${org.accessToken}`,
        'Content-Type': 'application/json',
        ...message.headers
    };

    let response = await fetch(url, {
        method: message.method || 'GET',
        headers,
        body: message.body ? JSON.stringify(message.body) : undefined
    });

    // Handle token expiry — auto-refresh
    if (response.status === 401) {
        console.log('[SF Toolkit] Token expired, attempting refresh...');
        const refreshed = await refreshAccessToken(org);
        if (refreshed) {
            headers['Authorization'] = `Bearer ${refreshed.accessToken}`;
            response = await fetch(url, {
                method: message.method || 'GET',
                headers,
                body: message.body ? JSON.stringify(message.body) : undefined
            });
        } else {
            throw new Error('Session expired. Please re-login.');
        }
    }

    if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        throw new Error(errorBody[0]?.message || errorBody.message || `HTTP ${response.status}`);
    }

    if (response.status === 204) return null;
    return await response.json();
}

async function handleQuery(soql) {
    const org = await getActiveOrg();
    if (!org) throw new Error('No active org. Please login first.');
    const settings = await getSettings();
    const apiVersion = settings.apiVersion || API_VERSION;
    const encoded = encodeURIComponent(soql);

    return handleApiRequest({
        path: `/services/data/${apiVersion}/query?q=${encoded}`,
        method: 'GET'
    });
}

async function handleDescribeGlobal() {
    const org = await getActiveOrg();
    if (!org) throw new Error('No active org');
    const settings = await getSettings();
    const apiVersion = settings.apiVersion || API_VERSION;

    // Check cache
    const cacheKey = `cache_${org.orgId}_global_describe`;
    const cached = await chrome.storage.local.get(cacheKey);
    const cacheTimeout = settings.cacheTimeout || 3600000;
    if (cached[cacheKey] && Date.now() - cached[cacheKey].timestamp < cacheTimeout) {
        return cached[cacheKey].data;
    }

    const data = await handleApiRequest({
        path: `/services/data/${apiVersion}/sobjects`,
        method: 'GET'
    });

    await chrome.storage.local.set({
        [cacheKey]: { data, timestamp: Date.now() }
    });

    return data;
}

async function handleDescribeSObject(sobject) {
    const org = await getActiveOrg();
    if (!org) throw new Error('No active org');
    const settings = await getSettings();
    const apiVersion = settings.apiVersion || API_VERSION;

    // Check cache
    const cacheKey = `cache_${org.orgId}_describe_${sobject}`;
    const cached = await chrome.storage.local.get(cacheKey);
    const cacheTimeout = settings.cacheTimeout || 3600000;
    if (cached[cacheKey] && Date.now() - cached[cacheKey].timestamp < cacheTimeout) {
        return cached[cacheKey].data;
    }

    const data = await handleApiRequest({
        path: `/services/data/${apiVersion}/sobjects/${sobject}/describe`,
        method: 'GET'
    });

    await chrome.storage.local.set({
        [cacheKey]: { data, timestamp: Date.now() }
    });

    return data;
}

async function handleRefreshMetadata(sobject) {
    const org = await getActiveOrg();
    if (!org) return;

    if (sobject) {
        const cacheKey = `cache_${org.orgId}_describe_${sobject}`;
        await chrome.storage.local.remove(cacheKey);
        return await handleDescribeSObject(sobject);
    } else {
        const cacheKey = `cache_${org.orgId}_global_describe`;
        await chrome.storage.local.remove(cacheKey);
        return await handleDescribeGlobal();
    }
}

async function handleGetIdentity() {
    const org = await getActiveOrg();
    if (!org) throw new Error('No active org');
    return handleApiRequest({ path: '/services/oauth2/userinfo', method: 'GET' });
}

// =====================================================================
// Token Refresh (OAuth 2.0 Refresh Token Grant)
// =====================================================================

async function refreshAccessToken(org) {
    if (!org.refreshToken) {
        console.log('[SF Toolkit] No refresh token available for this org');
        return null;
    }

    try {
        const tokenUrl = `${org.loginUrl || 'https://login.salesforce.com'}/services/oauth2/token`;

        const body = new URLSearchParams({
            grant_type: 'refresh_token',
            client_id: org.clientId || DEFAULT_CLIENT_ID,
            refresh_token: org.refreshToken
        });

        console.log('[SF Toolkit] Refreshing access token...');

        const response = await fetch(tokenUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'application/json'
            },
            body
        });

        if (response.ok) {
            const data = await response.json();
            const updatedOrg = {
                ...org,
                accessToken: data.access_token,
                instanceUrl: data.instance_url || org.instanceUrl,
                tokenIssuedAt: data.issued_at
            };

            // If a new refresh token was issued, update it
            if (data.refresh_token) {
                updatedOrg.refreshToken = data.refresh_token;
            }

            await saveOrg(updatedOrg);
            await setActiveOrgData(updatedOrg);
            console.log('[SF Toolkit] Token refreshed successfully');
            return updatedOrg;
        } else {
            const errData = await response.json().catch(() => ({}));
            console.error('[SF Toolkit] Token refresh failed:', errData.error_description || errData.error);
        }
    } catch (e) {
        console.error('[SF Toolkit] Token refresh exception:', e);
    }
    return null;
}

// =====================================================================
// Settings
// =====================================================================

async function getSettings() {
    const result = await chrome.storage.local.get('sf_settings');
    return result.sf_settings || {
        apiVersion: API_VERSION,
        theme: 'dark',
        cacheTimeout: 3600000,
        openaiApiKey: ''
    };
}

// =====================================================================
// Extension Lifecycle
// =====================================================================

chrome.runtime.onInstalled.addListener((details) => {
    console.log(`[SF Toolkit] Extension ${details.reason}: v1.0.0`);
    if (details.reason === 'install') {
        console.log('[SF Toolkit] Redirect URL for Connected App:', chrome.identity.getRedirectURL());
    }
});

// Keep service worker alive for long-running operations
chrome.alarms.create('keepAlive', { periodInMinutes: 4.9 });
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'keepAlive') {
        console.log('[SF Toolkit] Service worker heartbeat');
    }
});
