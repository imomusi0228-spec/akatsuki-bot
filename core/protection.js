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

// In-memory cache for recent messages per user to detect spam
// Format: Map<guildId, Map<userId, { content: string, count: number, timestamp: number }>>
const spamCache = new Map();

/**
 * Checks if a message is spam.
 * Returns { isSpam: boolean, count: number }
 */
export function checkSpam(guildId, userId, content) {
    if (!content || content.length < 3) return { isSpam: false, count: 0 };

    if (!spamCache.has(guildId)) spamCache.set(guildId, new Map());
    const guildMap = spamCache.get(guildId);

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

    if (!mentionCache.has(guildId)) mentionCache.set(guildId, new Map());
    const guildMap = mentionCache.get(guildId);

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
    if (!rateLimitCache.has(guildId)) rateLimitCache.set(guildId, new Map());
    const guildMap = rateLimitCache.get(guildId);

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
