// In-memory cache system for high-performance scale
// Used to store subscriptions, settings, and NG words to reduce DB load.

class CacheManager {
    constructor() {
        this.tiers = new Map();      // guildId -> tier
        this.settings = new Map();   // guildId -> settings object
        this.ngWords = new Map();    // guildId -> array of ngWord objects
        this.members = new Map();    // guildId -> { data: members, expires: number }
        this.intros = new Map();     // intro_channel_id -> { data: userIdSet, expires: number }

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

    // Generic set/get with TTL
    _set(map, key, value, ttlOverride) {
        this._checkSize(map);
        map.set(key, { value, expires: Date.now() + (ttlOverride || this.ttl) });
    }

    _get(map, key) {
        const entry = map.get(key);
        if (entry && entry.expires > Date.now()) return entry.value;
        if (entry) map.delete(key); // Cleanup expired on access
        return null;
    }

    // Tiers
    setTier(guildId, tier) { this._set(this.tiers, guildId, tier); }
    getTier(guildId) { return this._get(this.tiers, guildId); }
    clearTier(guildId) { this.tiers.delete(guildId); }

    // Settings
    setSettings(guildId, settings) { this._set(this.settings, guildId, settings); }
    getSettings(guildId) { return this._get(this.settings, guildId); }
    clearSettings(guildId) { this.settings.delete(guildId); }

    // NG Words
    setNgWords(guildId, words) {
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
        this._set(this.ngWords, guildId, processedWords);
    }
    getNgWords(guildId) { return this._get(this.ngWords, guildId); }
    clearNgWords(guildId) { this.ngWords.delete(guildId); }

    // Members (Activity Audit)
    setMembers(guildId, members) {
        this._set(this.members, guildId, members, 15 * 60 * 1000); // 15 min TTL
    }
    getMembers(guildId) { return this._get(this.members, guildId); }

    // Intros (Activity Audit)
    setIntros(channelId, userIds) {
        this._set(this.intros, channelId, userIds, 30 * 60 * 1000); // 30 min TTL
    }
    getIntros(channelId) { return this._get(this.intros, channelId); }

    // Active VC Sessions (No TTL, managed by events)
    setActiveSession(guildId, userId, session) {
        this._checkSize(this.activeSessions);
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
        this._checkSize(this.joinCounts);
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
        this.members.delete(guildId);
    }
}

export const cache = new CacheManager();
