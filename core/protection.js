/**
 * Calculates the Levenshtein distance between two strings.
 */
function levenshteinDistance(a, b) {
    const matrix = [];

    for (let i = 0; i <= b.length; i++) {
        matrix[i] = [i];
    }

    for (let j = 0; j <= a.length; j++) {
        matrix[0][j] = j;
    }

    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1, // substitution
                    matrix[i][j - 1] + 1,     // insertion
                    matrix[i - 1][j] + 1      // deletion
                );
            }
        }
    }

    return matrix[b.length][a.length];
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
