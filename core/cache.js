// In-memory cache system for high-performance scale
// Used to store subscriptions, settings, and NG words to reduce DB load.

class CacheManager {
    constructor() {
        this.tiers = new Map();      // guildId -> tier
        this.settings = new Map();   // guildId -> settings object
        this.ngWords = new Map();    // guildId -> array of ngWord objects
        this.activeSessions = new Map(); // guildId:userId -> session object (VC)
        this.joinCounts = new Map();     // guildId -> [{ts: number}]

        this.ttl = 10 * 60 * 1000;    // Default 10 minutes TTL
        this.maxSize = 2000;          // Max guilds to keep in memory (LRU-ish)
    }

    // Size management (Simple LRU: delete oldest if full)
    _checkSize(map) {
        if (map.size > this.maxSize) {
            const firstKey = map.keys().next().value;
            map.delete(firstKey);
        }
    }

    // Tiers
    setTier(guildId, tier) {
        this._checkSize(this.tiers);
        this.tiers.set(guildId, { value: tier, expires: Date.now() + this.ttl });
    }
    getTier(guildId) {
        const entry = this.tiers.get(guildId);
        if (entry && entry.expires > Date.now()) return entry.value;
        return null;
    }
    clearTier(guildId) {
        this.tiers.delete(guildId);
    }

    // Settings
    setSettings(guildId, settings) {
        this._checkSize(this.settings);
        this.settings.set(guildId, { value: settings, expires: Date.now() + this.ttl });
    }
    getSettings(guildId) {
        const entry = this.settings.get(guildId);
        if (entry && entry.expires > Date.now()) return entry.value;
        return null;
    }
    clearSettings(guildId) {
        this.settings.delete(guildId);
    }

    // NG Words
    setNgWords(guildId, words) {
        this._checkSize(this.ngWords);

        // Pre-compile regex objects once for extreme performance
        const processedWords = words.map(ng => {
            if (ng.kind === "regex") {
                try {
                    const match = ng.word.match(/^\/(.*?)\/([gimsuy]*)$/);
                    ng.compiled = match ? new RegExp(match[1], match[2]) : new RegExp(ng.word);
                } catch (e) {
                    console.error("[CACHE ERROR] Invalid Regex:", ng.word);
                    ng.compiled = null;
                }
            }
            return ng;
        });

        this.ngWords.set(guildId, { value: processedWords, expires: Date.now() + this.ttl });
    }
    getNgWords(guildId) {
        const entry = this.ngWords.get(guildId);
        if (entry && entry.expires > Date.now()) return entry.value;
        return null;
    }
    clearNgWords(guildId) {
        this.ngWords.delete(guildId);
    }

    // Active VC Sessions (No TTL, managed by events)
    setActiveSession(guildId, userId, session) {
        this.activeSessions.set(`${guildId}:${userId}`, session);
    }
    getActiveSession(guildId, userId) {
        return this.activeSessions.get(`${guildId}:${userId}`);
    }
    clearActiveSession(guildId, userId) {
        this.activeSessions.delete(`${guildId}:${userId}`);
    }

    // Join Counting for Anti-Raid (Fast memory check)
    recordJoin(guildId) {
        let joins = this.joinCounts.get(guildId) || [];
        const now = Date.now();
        joins.push(now);
        // Keep only last 1 minute
        joins = joins.filter(ts => ts > now - 60000);
        this.joinCounts.set(guildId, joins);
        return joins.length;
    }
    getRecentJoinCount(guildId) {
        const joins = this.joinCounts.get(guildId) || [];
        const now = Date.now();
        return joins.filter(ts => ts > now - 60000).length;
    }

    // Global clear for a guild
    clearAll(guildId) {
        this.clearTier(guildId);
        this.clearSettings(guildId);
        this.clearNgWords(guildId);
    }
}

export const cache = new CacheManager();
