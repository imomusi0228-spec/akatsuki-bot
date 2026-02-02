import { EmbedBuilder } from "discord.js";

// Cache: guildId -> { data: [], ts: number }
const ngWordsCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

export function invalidateNgCache(guildId) {
    ngWordsCache.delete(guildId);
}

// Helper: Parse Input
export function parseNgInput(raw) {
    const s = String(raw || "").trim();
    if (!s) return null;
    const m = s.match(/^\/(.+)\/([a-z]*)$/);
    if (m) return { kind: "regex", word: m[1], flags: m[2] || "i" };
    return { kind: "literal", word: s, flags: "i" };
}

export async function getNgWords(db, guildId) {
    // 1. Check cache
    const cached = ngWordsCache.get(guildId);
    if (cached && (Date.now() - cached.ts < CACHE_TTL_MS)) {
        return cached.data;
    }

    if (!db) return [];

    // 2. Fetch DB
    const rows = await db.all(
        `SELECT kind, word, flags
         FROM ng_words
         WHERE guild_id = $1
         ORDER BY kind ASC, word ASC`,
        guildId
    );

    const result = (rows || [])
        .map((r) => ({
            kind: (r.kind || "literal").trim(),
            word: (r.word || "").trim(),
            flags: (r.flags || "i").trim(),
        }))
        .filter(
            (x) =>
                x.word.length > 0 && (x.kind === "literal" || x.kind === "regex")
        );

    // 3. Set cache
    ngWordsCache.set(guildId, { data: result, ts: Date.now() });
    return result;
}

export async function addNgWord(db, guildId, raw) {
    if (!db) return { ok: false, error: "db_not_ready" };

    const parsed = parseNgInput(raw);
    if (!parsed) return { ok: false, error: "invalid_input" };

    await db.run(
        `INSERT INTO ng_words (guild_id, kind, word, flags)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (guild_id, kind, word) DO NOTHING`,
        guildId,
        parsed.kind,
        parsed.word,
        parsed.flags || "i"
    );

    invalidateNgCache(guildId);
    return { ok: true, added: parsed };
}

export async function removeNgWord(db, guildId, raw) {
    if (!db) return { ok: false, error: "db_not_ready" };
    const parsed = parseNgInput(raw);
    const word = parsed ? parsed.word : String(raw || "").trim();

    if (!word) return { ok: false, error: "empty_word" };

    // 1. NGワード削除
    const r = await db.run(
        `DELETE FROM ng_words WHERE guild_id = $1 AND word = $2`,
        guildId,
        word
    );

    // 2. 関連ログの削除 (Always clean up)
    await db.run(
        `DELETE FROM log_events
         WHERE guild_id = $1
           AND type = 'ng_detected'
           AND meta LIKE '%' || $2 || '%'`,
        guildId,
        word
    );

    // 3. ng_hitsの完全再計算 (Repair)
    await db.run(`DELETE FROM ng_hits WHERE guild_id = $1`, guildId);

    await db.run(`
      INSERT INTO ng_hits (guild_id, user_id, count, updated_at)
      SELECT guild_id, user_id, COUNT(*) as cnt, MAX(ts) as last_ts
      FROM log_events
      WHERE guild_id = $1 AND type = 'ng_detected'
      GROUP BY guild_id, user_id
    `, guildId);

    invalidateNgCache(guildId);
    return { ok: true, changes: r.changes, target: parsed || { word } };
}

export async function clearNgWords(db, guildId) {
    if (!db) return { ok: false, error: "db_not_ready" };

    await db.run(`DELETE FROM ng_words WHERE guild_id = $1`, guildId);

    // 2. NG検知ログの全削除 (過去の違反をなかったことにする)
    await db.run(`DELETE FROM log_events WHERE guild_id = $1 AND type = 'ng_detected'`, guildId);

    // 3. 違反カウントの全削除 (ユーザーをクリーンな状態に戻す)
    await db.run(`DELETE FROM ng_hits WHERE guild_id = $1`, guildId);

    invalidateNgCache(guildId);
    return { ok: true };
}
