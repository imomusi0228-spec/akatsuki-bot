// In-memory cache system for high-performance scale
// Used to store subscriptions, settings, and NG words to reduce DB load.

class CacheManager {
    constructor() {
        this.tiers = new Map();      // guildId -> tier
        this.settings = new Map();   // guildId -> settings object
        this.ngWords = new Map();    // guildId -> array of ngWord objects
        this.ttl = 10 * 60 * 1000;    // Default 10 minutes TTL
    }

    // Tiers
    setTier(guildId, tier) {
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
        this.ngWords.set(guildId, { value: words, expires: Date.now() + this.ttl });
    }
    getNgWords(guildId) {
        const entry = this.ngWords.get(guildId);
        if (entry && entry.expires > Date.now()) return entry.value;
        return null;
    }
    clearNgWords(guildId) {
        this.ngWords.delete(guildId);
    }

    // Global clear for a guild
    clearAll(guildId) {
        this.clearTier(guildId);
        this.clearSettings(guildId);
        this.clearNgWords(guildId);
    }
}

export const cache = new CacheManager();
