/**
 * Metadata cache utility
 * Caches Salesforce metadata locally to minimize API calls
 */
const Cache = {
    _memoryCache: new Map(),

    _getCacheKey(orgId, type, name) {
        return `cache_${orgId}_${type}_${name || 'all'}`;
    },

    async get(orgId, type, name) {
        const key = this._getCacheKey(orgId, type, name);

        // Check memory cache first
        if (this._memoryCache.has(key)) {
            const entry = this._memoryCache.get(key);
            if (Date.now() - entry.timestamp < entry.ttl) {
                return entry.data;
            }
            this._memoryCache.delete(key);
        }

        // Check storage
        const stored = await Storage.get(key);
        if (stored && Date.now() - stored.timestamp < stored.ttl) {
            this._memoryCache.set(key, stored);
            return stored.data;
        }

        return null;
    },

    async set(orgId, type, name, data, ttl = 3600000) {
        const key = this._getCacheKey(orgId, type, name);
        const entry = { data, timestamp: Date.now(), ttl };
        this._memoryCache.set(key, entry);
        await Storage.set(key, entry);
    },

    async invalidate(orgId, type, name) {
        const key = this._getCacheKey(orgId, type, name);
        this._memoryCache.delete(key);
        await Storage.remove(key);
    },

    async invalidateOrg(orgId) {
        const all = await Storage.getAll();
        const keysToRemove = Object.keys(all).filter(k => k.startsWith(`cache_${orgId}_`));
        for (const key of keysToRemove) {
            this._memoryCache.delete(key);
            await Storage.remove(key);
        }
    },

    clearMemory() {
        this._memoryCache.clear();
    }
};

if (typeof window !== 'undefined') {
    window.Cache = Cache;
}
