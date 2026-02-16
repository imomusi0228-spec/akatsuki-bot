/**
 * Calculates the Levenshtein distance between two strings (O(N) memory version).
 */
function levenshteinDistance(s1, s2) {
    if (s1.length < s2.length) [s1, s2] = [s2, s1];
    let n = s1.length, m = s2.length;
    let prev = Array.from({ length: m + 1 }, (_, i) => i);
    let curr = new Array(m + 1);

    for (let i = 1; i <= n; i++) {
        curr[0] = i;
        for (let j = 1; j <= m; j++) {
            curr[j] = Math.min(
                prev[j] + 1,
                curr[j - 1] + 1,
                prev[j - 1] + (s1[i - 1] === s2[j - 1] ? 0 : 1)
            );
        }
        [prev, curr] = [curr, prev];
    }
    return prev[m];
}

/**
 * Returns similarity score between 0 and 1.
 */
export function calculateSimilarity(s1, s2) {
    if (!s1 || !s2) return 0;
    if (s1 === s2) return 1;

    const longer = s1.length > s2.length ? s1 : s2;
    const shorter = s1.length > s2.length ? s2 : s1;
    const longerLength = longer.length;

    if (longerLength === 0) return 1.0;

    const distance = levenshteinDistance(longer, shorter);
    return (longerLength - distance) / longerLength;
}

// Protection Caches with strict limits to prevent memory leaks
const MAX_GUILD_ENTRIES = 500;
const MAX_USER_ENTRIES = 1000;

function enforceLimit(map, limit) {
    if (map.size > limit) {
        const firstKey = map.keys().next().value;
        map.delete(firstKey);
    }
}

// Map<guildId, Map<userId, { content: string, count: number, timestamp: number }>>
const spamCache = new Map();

/**
 * Checks if a message is spam.
 * Returns { isSpam: boolean, count: number }
 */
export function checkSpam(guildId, userId, content) {
    if (!content || content.length < 3) return { isSpam: false, count: 0 };

    if (!spamCache.has(guildId)) {
        enforceLimit(spamCache, MAX_GUILD_ENTRIES);
        spamCache.set(guildId, new Map());
    }
    const guildMap = spamCache.get(guildId);
    enforceLimit(guildMap, MAX_USER_ENTRIES);

    const now = Date.now();
    const entry = guildMap.get(userId);

    if (entry) {
        // Expire old entries (e.g., 30 seconds)
        if (now - entry.timestamp > 30000) {
            guildMap.set(userId, { content, count: 1, timestamp: now });
            return { isSpam: false, count: 1 };
        }

        const similarity = calculateSimilarity(entry.content, content);

        // Threshold: 85% similarity
        if (similarity >= 0.85) {
            entry.count += 1;
            entry.timestamp = now;
            entry.content = content; // Update with latest to catch evolving spam
            return { isSpam: true, count: entry.count };
        } else {
            // New content pattern, reset
            guildMap.set(userId, { content, count: 1, timestamp: now });
            return { isSpam: false, count: 1 };
        }
    } else {
        guildMap.set(userId, { content, count: 1, timestamp: now });
        return { isSpam: false, count: 1 };
    }
}
const mentionCache = new Map();

/**
 * Checks if a message contains mention spam.
 */
export function checkMentionSpam(guildId, userId, mentionCount) {
    if (mentionCount === 0) return { isSpam: false, count: 0 };

    // One-message burst check
    if (mentionCount >= 5) return { isSpam: true, count: mentionCount };

    if (!mentionCache.has(guildId)) {
        enforceLimit(mentionCache, MAX_GUILD_ENTRIES);
        mentionCache.set(guildId, new Map());
    }
    const guildMap = mentionCache.get(guildId);
    enforceLimit(guildMap, MAX_USER_ENTRIES);

    const now = Date.now();
    const entry = guildMap.get(userId);

    if (entry && (now - entry.timestamp < 30000)) {
        entry.count += mentionCount;
        entry.timestamp = now;
        return { isSpam: entry.count >= 8, count: entry.count };
    } else {
        guildMap.set(userId, { count: mentionCount, timestamp: now });
        return { isSpam: false, count: mentionCount };
    }
}

const rateLimitCache = new Map();

/**
 * Checks if a user is sending messages too fast (Rate Limit).
 * Threshold: 5 messages in 5 seconds.
 */
export function checkRateLimit(guildId, userId) {
    if (!rateLimitCache.has(guildId)) {
        enforceLimit(rateLimitCache, MAX_GUILD_ENTRIES);
        rateLimitCache.set(guildId, new Map());
    }
    const guildMap = rateLimitCache.get(guildId);
    enforceLimit(guildMap, MAX_USER_ENTRIES);

    const now = Date.now();
    const entry = guildMap.get(userId) || { count: 0, timestamp: now };

    if (now - entry.timestamp > 5000) {
        // Reset every 5 seconds
        guildMap.set(userId, { count: 1, timestamp: now });
        return { isSpam: false, count: 1 };
    }

    entry.count += 1;
    guildMap.set(userId, entry);

    // 5 messages in 5 seconds is a bit fast for a normal human
    return { isSpam: entry.count >= 5, count: entry.count };
}

// Global/Cross-user spam cache
// Format: Map<guildId, Map<contentHash, { count: number, users: Set<userId>, timestamp: number }>>
const globalSpamCache = new Map();

/**
 * Checks for "Multiple user identical content" spam (Raid style).
 */
export function checkGlobalSpam(guildId, userId, content) {
    if (!content || content.length < 10) return { isSpam: false, count: 0 };

    if (!globalSpamCache.has(guildId)) {
        enforceLimit(globalSpamCache, MAX_GUILD_ENTRIES);
        globalSpamCache.set(guildId, new Map());
    }
    const guildMap = globalSpamCache.get(guildId);
    enforceLimit(guildMap, MAX_USER_ENTRIES);

    const now = Date.now();
    // Use a simple hash or truncated content as key to catch slightly varied spam
    const key = content.substring(0, 100).toLowerCase().trim();

    const entry = guildMap.get(key) || { count: 0, users: new Set(), timestamp: now };

    if (now - entry.timestamp > 60000) {
        // Reset every 60 seconds
        entry.count = 1;
        entry.users = new Set([userId]);
        entry.timestamp = now;
    } else {
        entry.count += 1;
        entry.users.add(userId);
        entry.timestamp = now;
    }

    guildMap.set(key, entry);

    // If 3+ different users send the same long message in 60s -> Raid Spam
    const isGlobalSpam = entry.users.size >= 3 && entry.count >= 5;
    return { isSpam: isGlobalSpam, count: entry.count, userCount: entry.users.size };
}

/**
 * Detects Discord Invites, Shortened URLs, and Blacklisted Domains.
 */
export function checkSuspiciousContent(content, domainBlacklist = []) {
    if (!content) return { isSuspicious: false, reason: null };

    // 1. Discord Invite Check
    const inviteRegex = /(discord\.(gg|io|me|li)|discordapp\.com\/invite)\/[a-zA-Z0-9]+/i;
    if (inviteRegex.test(content)) return { isSuspicious: true, reason: "Discord Invite" };

    // 2. Shortened URL Check
    const shortenerRegex = /(bit\.ly|t\.co|goo\.gl|tinyurl\.com|ow\.ly|is\.gd|buff\.ly|rebrand\.ly)/i;
    if (shortenerRegex.test(content)) return { isSuspicious: true, reason: "Shortened URL" };

    // 3. Blacklisted Domains
    for (const domain of domainBlacklist) {
        if (domain && content.toLowerCase().includes(domain.toLowerCase())) {
            return { isSuspicious: true, reason: "Blacklisted Domain" };
        }
    }

    // 4. Emoji/URL Density (Advanced)
    const emojiCount = (content.match(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu) || []).length;
    if (emojiCount >= 15) return { isSuspicious: true, reason: "Emoji Spam" };

    const urlCount = (content.match(/https?:\/\/[^\s]+/g) || []).length;
    if (urlCount >= 5) return { isSuspicious: true, reason: "URL Density" };

    return { isSuspicious: false, reason: null };
}

/**
 * Checks if a member is restricted based on account age or join time.
 */
export function isMemberRestricted(member, settings) {
    if (!settings) return false;

    const now = Date.now();
    const joinTime = member.joinedTimestamp;
    const accountTime = member.user.createdTimestamp;

    // 1. Account Age Check (Days)
    const minAccountAgeDays = settings.newcomer_min_account_age || 0;
    if (minAccountAgeDays > 0) {
        const ageInDays = (now - accountTime) / (1000 * 60 * 60 * 24);
        if (ageInDays < minAccountAgeDays) return true;
    }

    // 2. Server Join Time Check (Minutes)
    const restrictMins = settings.newcomer_restrict_mins || 0;
    if (restrictMins > 0) {
        const stayMins = (now - joinTime) / (1000 * 60);
        if (stayMins < restrictMins) return true;
    }

    // 3. Guard Mode 'Lockdown' specific: Absolute restriction for anyone without specific roles
    if (settings.antiraid_guard_level === 2) {
        // If lockdown is on, anyone without a role (except specific ones maybe) is restricted?
        // Let's stick to the user's "Verification Level" and "Newcomer" logic.
        return true;
    }

    return false;
}
