import { dbQuery } from "./db.js";

class Batcher {
    constructor() {
        this.buffers = {
            ng_logs: [],
            member_events: [],
            member_stats: new Map(), // guildId:userId -> {xp, message_count, level, last_activity_at}
            vc_sessions: [], // Though VC sessions might need more immediate ID return, basic stats can be batched
        };
        this.interval = 5000; // 5 seconds
        this.maxSize = 100; // Flush if we hit 100 entries
        this.timer = setInterval(() => this.flushAll(), this.interval);
    }

    push(table, data) {
        if (!this.buffers[table]) {
            console.error(`[BATCHER ERROR] Unknown table: ${table}`);
            return;
        }

        if (table === "member_stats") {
            const key = `${data.guild_id}:${data.user_id}`;
            const existing = this.buffers.member_stats.get(key) || {
                xp: 0,
                message_count: 0,
                level: data.level,
                guild_id: data.guild_id,
                user_id: data.user_id,
            };
            existing.xp += data.xp || 0;
            existing.message_count += data.message_count || 1;
            existing.level = Math.max(existing.level, data.level);
            existing.last_activity_at = new Date();
            this.buffers.member_stats.set(key, existing);
            
            if (this.buffers.member_stats.size >= this.maxSize) {
                this.flush(table);
            }
            return;
        }

        // Add timestamp if not present
        if (!data.created_at && table !== "vc_sessions") {
            data.created_at = new Date();
        }

        this.buffers[table].push(data);

        if (this.buffers[table].length >= this.maxSize) {
            this.flush(table);
        }
    }

    async flushAll() {
        for (const table in this.buffers) {
            await this.flush(table);
        }
    }

    async flush(table) {
        const rawData = this.buffers[table];
        const isEmpty = table === "member_stats" ? rawData.size === 0 : rawData.length === 0;
        if (isEmpty) return;

        // Clear buffer immediately to avoid duplicates during async await
        if (table === "member_stats") {
            this.buffers[table] = new Map();
        } else {
            this.buffers[table] = [];
        }

        const data = table === "member_stats" ? Array.from(rawData.values()) : rawData;

        try {
            if (table === "ng_logs") {
                // Table: ng_logs (guild_id, user_id, user_name, word)
                const values = [];
                const placeholders = [];
                data.forEach((item, i) => {
                    const base = i * 5;
                    placeholders.push(
                        `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`
                    );
                    values.push(
                        item.guild_id,
                        item.user_id,
                        item.user_name,
                        item.word,
                        item.created_at
                    );
                });
                await dbQuery(
                    `INSERT INTO ng_logs (guild_id, user_id, user_name, word, created_at) VALUES ${placeholders.join(", ")}`,
                    values
                );
            } else if (table === "member_events") {
                // Table: member_events (guild_id, user_id, event_type, created_at)
                const values = [];
                const placeholders = [];
                data.forEach((item, i) => {
                    const base = i * 4;
                    placeholders.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`);
                    values.push(item.guild_id, item.user_id, item.event_type, item.created_at);
                });
                await dbQuery(
                    `INSERT INTO member_events (guild_id, user_id, event_type, created_at) VALUES ${placeholders.join(", ")}`,
                    values
                );
            } else if (table === "member_stats") {
                // Table: member_stats UPSERT (guild_id, user_id, xp, level, message_count, last_activity_at)
                const values = [];
                const placeholders = [];
                data.forEach((item, i) => {
                    const base = i * 6;
                    placeholders.push(
                        `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`
                    );
                    values.push(
                        item.guild_id,
                        item.user_id,
                        item.xp,
                        item.level,
                        item.message_count,
                        item.last_activity_at
                    );
                });
                await dbQuery(
                    `INSERT INTO member_stats (guild_id, user_id, xp, level, message_count, last_activity_at) 
                     VALUES ${placeholders.join(", ")} 
                     ON CONFLICT (guild_id, user_id) DO UPDATE SET 
                        xp = member_stats.xp + EXCLUDED.xp,
                        level = GREATEST(member_stats.level, EXCLUDED.level),
                        message_count = member_stats.message_count + EXCLUDED.message_count,
                        last_activity_at = EXCLUDED.last_activity_at,
                        last_xp_gain_at = CASE WHEN EXCLUDED.xp > 0 THEN EXCLUDED.last_activity_at ELSE member_stats.last_xp_gain_at END`,
                    values
                );
            }
            // Note: vc_sessions is tricky because join/leave need matching.
            // We only batch "insert" of new sessions. Updates are tricky.
            // For now, let's keep it simple and skip vc_sessions batching if it adds too much complexity.

            console.log(`[BATCHER] Flushed ${data.length} items to ${table}`);
        } catch (e) {
            console.error(`[BATCHER ERROR] Flush failed for ${table}:`, e.message);
            // On failure, we might lose data or we could try to re-buffer.
            // At this scale, a few lost logs are better than crashing.
        }
    }
}

export const batcher = new Batcher();
