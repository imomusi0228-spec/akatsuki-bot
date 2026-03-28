import { client } from "../core/client.js";
import { dbQuery } from "../core/db.js";

/**
 * AI Sentiment Analysis Service
 * Calculates sentiment score for a message or a batch of messages.
 * Score range: -1.0 (Very Negative) to 1.0 (Very Positive)
 */
export async function analyzeSentiment(text) {
    if (!text || text.length < 5) return 0;
    
    // In a production environment, this would call Gemini / OpenAI / GCP Natural Language API.
    // For now, we use a lightweight keyword-based heuristic as a fallback, 
    // and provide the structure for the AI integration.
    
    const negativeWords = ['死ね', 'ゴミ', 'カス', '消えろ', 'キモ', '殺す', '嫌い', '最悪', 'バカ', '無能'];
    const positiveWords = ['ありがとう', '助かる', 'すごい', '感謝', '最高', '楽しい', '好き', '神', '優秀', 'お疲れ'];
    
    let score = 0;
    const lowerText = text.toLowerCase();
    
    negativeWords.forEach(word => {
        if (lowerText.includes(word)) score -= 0.3;
    });
    positiveWords.forEach(word => {
        if (lowerText.includes(word)) score += 0.2;
    });
    
    // Clamp score
    return Math.max(-1, Math.min(1, score));
}

/**
 * Analyzes the "Atmosphere" of a channel based on recent history
 */
export async function getChannelAtmosphere(guildId, channelId, limit = 15) {
    // This is where real-time monitoring happens.
    // We aggregate scores from recent messages to detect "Heated" situations.
    
    try {
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel || !channel.isTextBased()) return 0;
        
        const messages = await channel.messages.fetch({ limit });
        let totalScore = 0;
        let count = 0;
        
        for (const msg of messages.values()) {
            if (msg.author.bot) continue;
            const score = await analyzeSentiment(msg.content);
            totalScore += score;
            count++;
        }
        
        return count > 0 ? totalScore / count : 0;
    } catch (e) {
        console.error("[SENTIMENT ERROR]", e);
        return 0;
    }
}
