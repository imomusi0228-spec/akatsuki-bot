import { dbQuery } from "../../core/db.js";
import { getTier, getUserTier } from "../../core/subscription.js";
import { getFeatures } from "../../core/tiers.js";
import { resJson, verifyGuild, getSafeGuild, getBody, PERMISSION_LEVELS } from "./helpers.js";

export async function handleModerationRoutes(req, res, pathname, url, session) {
    const guildId = url.searchParams.get("guild");
    const method = req.method;

    const isModerationRoute = pathname.startsWith("/api/ngwords") || pathname === "/api/warnings" || pathname === "/api/timeout/release";
    if (!isModerationRoute) return false;

    if (!guildId && method === "GET") {
        resJson(res, { ok: false, error: "Missing guild" }, 400);
        return true;
    }

    // GET /api/ngwords
    if (pathname === "/api/ngwords" && method === "GET") {
        if (!(await verifyGuild(guildId, session))) return resJson(res, { ok: false, error: "Forbidden" }, 403);
        const resDb = await dbQuery("SELECT * FROM ng_words WHERE guild_id = $1", [guildId]);
        return resJson(res, { ok: true, words: resDb.rows });
    }

    // POST /api/ngwords/add
    if (pathname === "/api/ngwords/add" && method === "POST") {
        const body = await getBody(req);
        if (!(await verifyGuild(body.guild, session))) return resJson(res, { ok: false, error: "Forbidden" }, 403);
        const rawWords = body.word.split(/\s+/).filter((w) => w.trim().length > 0);
        const [tier, userTier] = await Promise.all([getTier(body.guild), getUserTier(session.user.id)]);
        const features = getFeatures(tier, body.guild, userTier);
        const existingRes = await dbQuery("SELECT word FROM ng_words WHERE guild_id = $1", [body.guild]);
        const existingSet = new Set(existingRes.rows.map((r) => r.word));
        const uniqueNewWords = [...new Set(rawWords.filter((w) => !existingSet.has(w)))];
        if (existingSet.size + uniqueNewWords.length > features.maxNgWords) return resJson(res, { ok: false, error: `Limit exceeded. (Max ${features.maxNgWords})` }, 403);
        for (const w of uniqueNewWords) {
            const isRegex = w.startsWith("/") && w.endsWith("/");
            await dbQuery("INSERT INTO ng_words (guild_id, word, kind, created_by) VALUES ($1, $2, $3, 'Web')", [body.guild, w, isRegex ? "regex" : "exact"]);
        }
        return resJson(res, { ok: true });
    }

    // POST /api/ngwords/remove
    if (pathname === "/api/ngwords/remove" && method === "POST") {
        const body = await getBody(req);
        if (!(await verifyGuild(body.guild, session))) return resJson(res, { ok: false, error: "Forbidden" }, 403);
        await dbQuery("DELETE FROM ng_words WHERE guild_id = $1 AND word = $2", [body.guild, body.word]);
        await dbQuery("DELETE FROM ng_logs WHERE guild_id = $1 AND word = $2", [body.guild, body.word]);
        return resJson(res, { ok: true });
    }

    // POST /api/ngwords/clear
    if (pathname === "/api/ngwords/clear" && method === "POST") {
        const body = await getBody(req);
        if (!(await verifyGuild(body.guild, session, PERMISSION_LEVELS.ADMIN))) return resJson(res, { ok: false, error: "Forbidden: Admin access required" }, 403);
        await dbQuery("DELETE FROM ng_words WHERE guild_id = $1", [body.guild]);
        await dbQuery("DELETE FROM ng_logs WHERE guild_id = $1", [body.guild]);
        return resJson(res, { ok: true });
    }

    // GET /api/warnings
    if (pathname === "/api/warnings" && method === "GET") {
        const userId = url.searchParams.get("user");
        if (!(await verifyGuild(guildId, session))) return resJson(res, { ok: false, error: "Forbidden" }, 403);
        let query = "SELECT * FROM warnings WHERE guild_id = $1";
        const params = [guildId];
        if (userId) { query += " AND user_id = $2 ORDER BY created_at DESC"; params.push(userId); }
        else query += " ORDER BY created_at DESC LIMIT 200";
        const result = await dbQuery(query, params);
        return resJson(res, { ok: true, warnings: result.rows });
    }

    // POST /api/warnings
    if (pathname === "/api/warnings" && method === "POST") {
        const body = await getBody(req);
        if (!(await verifyGuild(body.guild, session))) return resJson(res, { ok: false, error: "Forbidden" }, 403);
        const issuedBy = session.user?.username || "Web Dashboard";
        await dbQuery("INSERT INTO warnings (guild_id, user_id, reason, issued_by) VALUES ($1, $2, $3, $4)", [body.guild, body.user_id, body.reason, issuedBy]);
        return resJson(res, { ok: true });
    }

    // DELETE /api/warnings
    if (pathname === "/api/warnings" && method === "DELETE") {
        const body = await getBody(req);
        if (!(await verifyGuild(body.guild, session))) return resJson(res, { ok: false, error: "Forbidden" }, 403);
        if (body.id) await dbQuery("DELETE FROM warnings WHERE id=$1 AND guild_id=$2", [body.id, body.guild]);
        else await dbQuery("DELETE FROM warnings WHERE guild_id=$1 AND user_id=$2", [body.guild, body.user_id]);
        return resJson(res, { ok: true });
    }

    // POST /api/timeout/release
    if (pathname === "/api/timeout/release" && method === "POST") {
        const body = await getBody(req);
        if (!(await verifyGuild(body.guild, session))) return resJson(res, { ok: false, error: "Forbidden" }, 403);
        const guild = await getSafeGuild(body.guild);
        const member = await guild?.members.fetch(body.user_id).catch(() => null);
        if (member?.isCommunicationDisabled()) {
            await member.timeout(null, "Manual release from Web Dashboard");
            return resJson(res, { ok: true });
        }
        return resJson(res, { ok: false, error: "Not timed out" }, 400);
    }

    return false;
}
