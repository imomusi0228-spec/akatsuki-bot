import { dbQuery } from "./db.js";

class Batcher {
    constructor() {
        this.buffers = {
            ng_logs: [],
            member_events: [],
            vc_sessions: [] // Though VC sessions might need more immediate ID return, basic stats can be batched
        };
        this.interval = 5000; // 5 seconds
        this.maxSize = 100;    // Flush if we hit 100 entries
        this.timer = setInterval(() => this.flushAll(), this.interval);
    }

    push(table, data) {
        if (!this.buffers[table]) {
            console.error(`[BATCHER ERROR] Unknown table: ${table}`);
            return;
        }

        // Add timestamp if not present
        if (!data.created_at && table !== 'vc_sessions') {
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
        const data = this.buffers[table];
        if (data.length === 0) return;

        this.buffers[table] = []; // Clear buffer immediately to avoid duplicates during async await

        try {
            if (table === 'ng_logs') {
                // Table: ng_logs (guild_id, user_id, user_name, word)
                const values = [];
                const placeholders = [];
                data.forEach((item, i) => {
                    const base = i * 5;
                    placeholders.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`);
                    values.push(item.guild_id, item.user_id, item.user_name, item.word, item.created_at);
                });
                await dbQuery(`INSERT INTO ng_logs (guild_id, user_id, user_name, word, created_at) VALUES ${placeholders.join(', ')}`, values);
            }
            else if (table === 'member_events') {
                // Table: member_events (guild_id, user_id, event_type, created_at)
                const values = [];
                const placeholders = [];
                data.forEach((item, i) => {
                    const base = i * 4;
                    placeholders.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`);
                    values.push(item.guild_id, item.user_id, item.event_type, item.created_at);
                });
                await dbQuery(`INSERT INTO member_events (guild_id, user_id, event_type, created_at) VALUES ${placeholders.join(', ')}`, values);
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
