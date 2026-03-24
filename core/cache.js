// In-memory cache system for high-performance scale
// Used to store subscriptions, settings, and NG words to reduce DB load.

class CacheManager {
    constructor() {
        this.tiers = new Map(); // guildId -> tier
        this.settings = new Map(); // guildId -> settings object
        this.ngWords = new Map(); // guildId -> array of ngWord objects
        this.members = new Map(); // guildId -> { data: members, expires: number }
        this.intros = new Map(); // intro_channel_id -> { data: userIdSet, expires: number }

        this.activeSessions = new Map(); // guildId:userId -> session object (VC)
        this.memberStats = new Map(); // guildId:userId -> {xp, level, lastXpGainAt}
        this.joinCounts = new Map(); // guildId -> [{ts: number}]
        this.userGuilds = new Map(); // userId -> { data: guilds, expires: number }
        this.userTiers = new Map(); // userId -> { tier: number, expires: number }
        this.expertLicense = new Map(); // guildId -> { isUltimate: boolean, expires: number }

        this.ttl = 1 * 60 * 1000; // Reduced to 1 minute for faster tier updates
        this.maxSize = 2000; // Max guilds to keep in memory (LRU-ish)
    }

    // Size management (Simple LRU: delete oldest if full)
    _checkSize(map, limit = this.maxSize) {
        if (map.size > limit) {
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
    setTier(guildId, tier) {
        this._set(this.tiers, guildId, tier);
    }
    getTier(guildId) {
        return this._get(this.tiers, guildId);
    }
    clearTier(guildId) {
        this.tiers.delete(guildId);
    }

    // Settings
    setSettings(guildId, settings) {
        this._set(this.settings, guildId, settings);
    }
    getSettings(guildId) {
        return this._get(this.settings, guildId);
    }
    clearSettings(guildId) {
        this.settings.delete(guildId);
    }

    // NG Words
    setNgWords(guildId, words) {
        // Pre-compile regex objects once for extreme performance
        const processedWords = words.map((ng) => {
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

        // Optimization: Create a combined regex for non-regex patterns for O(1) matching
        const normalWords = processedWords
            .filter((w) => w.kind !== "regex")
            .map((w) => w.word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
        
        const combinedPattern = normalWords.length > 0 
            ? new RegExp(normalWords.join("|"), "i") 
            : null;

        this._set(this.ngWords, guildId, { words: processedWords, combinedPattern });
    }
    getNgWords(guildId) {
        return this._get(this.ngWords, guildId);
    }
    clearNgWords(guildId) {
        this.ngWords.delete(guildId);
    }

    // Members (Activity Audit)
    setMembers(guildId, members) {
        this._set(this.members, guildId, members, 15 * 60 * 1000); // 15 min TTL
    }
    getMembers(guildId) {
        return this._get(this.members, guildId);
    }

    // Intros (Activity Audit)
    setIntros(channelId, userIds) {
        this._set(this.intros, channelId, userIds, 30 * 60 * 1000); // 30 min TTL
    }
    getIntros(channelId) {
        return this._get(this.intros, channelId);
    }

    // Active VC Sessions (Larger limit to prevent dropping active users)
    setActiveSession(guildId, userId, session) {
        this._checkSize(this.activeSessions, 50000);
        this.activeSessions.set(`${guildId}:${userId}`, session);
    }
    getActiveSession(guildId, userId) {
        return this.activeSessions.get(`${guildId}:${userId}`);
    }
    clearActiveSession(guildId, userId) {
        this.activeSessions.delete(`${guildId}:${userId}`);
    }

    // Member Stats Cache
    setMemberStats(guildId, userId, stats) {
        this._checkSize(this.memberStats, 10000);
        this.memberStats.set(`${guildId}:${userId}`, {
            ...stats,
            last_activity_at: stats.last_activity_at || Date.now()
        });
    }
    getMemberStats(guildId, userId) {
        return this.memberStats.get(`${guildId}:${userId}`);
    }
    updateMemberStats(guildId, userId, data) {
        const stats = this.memberStats.get(`${guildId}:${userId}`);
        if (stats) {
            stats.xp += data.xp || 0;
            stats.message_count = (stats.message_count || 0) + (data.message_count || 1);
            if (data.level) stats.level = data.level;
            if (data.last_xp_gain_at) stats.last_xp_gain_at = data.last_xp_gain_at;
            stats.last_activity_at = Date.now();
        }
    }

    // Join Counting for Anti-Raid (Fast memory check)
    recordJoin(guildId) {
        this._checkSize(this.joinCounts);
        let joins = this.joinCounts.get(guildId) || [];
        const now = Date.now();
        joins.push(now);
        // Keep only last 1 minute
        joins = joins.filter((ts) => ts > now - 60000);
        this.joinCounts.set(guildId, joins);
        return joins.length;
    }
    getRecentJoinCount(guildId) {
        const joins = this.joinCounts.get(guildId) || [];
        const now = Date.now();
        return joins.filter((ts) => ts > now - 60000).length;
    }

    // User Guilds (for API stability)
    setUserGuilds(userId, guilds) {
        this._set(this.userGuilds, userId, guilds, 5 * 60 * 1000); // 5 min global cache
    }
    getUserGuilds(userId) {
        return this._get(this.userGuilds, userId);
    }

    // User Tiers (Performance)
    setUserTier(userId, tier) {
        this._set(this.userTiers, userId, tier, 2 * 60 * 1000); // 2 min cache
    }
    getUserTier(userId) {
        return this._get(this.userTiers, userId);
    }
    clearUserTier(userId) {
        this.userTiers.delete(userId);
    }

    // Expert License (ULTIMATE via Admin)
    setExpertLicense(guildId, isUltimate) {
        this._set(this.expertLicense, guildId, isUltimate, 10 * 60 * 1000); // 10 min cache (slow changing)
    }
    getExpertLicense(guildId) {
        return this._get(this.expertLicense, guildId);
    }

    // Global clear for a guild
    clearAll(guildId) {
        this.clearTier(guildId);
        this.clearSettings(guildId);
        this.clearNgWords(guildId);
        this.members.delete(guildId);
        this.expertLicense.delete(guildId);
    }
}

export const cache = new CacheManager();
