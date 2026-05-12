import { dbQuery } from "../../core/db.js";
import { resJson, verifyGuild, getSafeGuild, getBody } from "./helpers.js";
import path from "node:path";
import fs from "node:fs";

export async function handleTicketRoutes(req, res, pathname, url, session) {
    const guildId = url.searchParams.get("guild");
    const method = req.method;

    const isTicketRoute = pathname.startsWith("/api/tickets") || pathname.startsWith("/api/ticket-categories");
    if (!isTicketRoute) return false;

    if (!guildId && method === "GET") {
        resJson(res, { ok: false, error: "Missing guild ID" }, 400);
        return true;
    }

    // GET /api/tickets
    if (pathname === "/api/tickets" && method === "GET") {
        if (!(await verifyGuild(guildId, session))) return resJson(res, { ok: false, error: "Forbidden" }, 403);
        try {
            const status = url.searchParams.get("status") || "all";
            let query = "SELECT * FROM tickets WHERE guild_id = $1";
            const params = [guildId];
            if (status !== "all") {
                query += " AND status = $2";
                params.push(status);
            }
            query += " ORDER BY created_at DESC LIMIT 100";
            const result = await dbQuery(query, params);

            const userIds = new Set(result.rows.map((t) => t.user_id));
            result.rows.forEach((t) => { if (t.assigned_to) userIds.add(t.assigned_to); });

            const guild = await getSafeGuild(guildId);
            let membersMap = new Map();
            if (guild && userIds.size > 0) {
                membersMap = await guild.members.fetch({ user: Array.from(userIds) }).catch(() => new Map());
            }

            const tickets = result.rows.map((t) => {
                const member = membersMap.get(t.user_id);
                const staff = t.assigned_to ? membersMap.get(t.assigned_to) : null;
                const userName = member ? `${member.user.username}#${member.user.discriminator || "0000"}` : t.user_id;
                const staffName = staff ? staff.user.username : t.assigned_to || "未割り当て";
                return { ...t, userName, staffName };
            });

            return resJson(res, { ok: true, tickets });
        } catch (e) {
            console.error("[TICKETS ERROR]", e);
            return resJson(res, { ok: false, error: "Database Error" }, 500);
        }
    }

    // POST /api/tickets/close
    if (pathname === "/api/tickets/close" && method === "POST") {
        const body = await getBody(req);
        if (!body.guild || !body.ticket_id) return resJson(res, { ok: false, error: "Missing fields" }, 400);
        if (!(await verifyGuild(body.guild, session))) return resJson(res, { ok: false, error: "Forbidden" }, 403);

        const resData = await dbQuery("SELECT channel_id FROM tickets WHERE id = $1 AND guild_id = $2", [body.ticket_id, body.guild]);
        const ticket = resData.rows[0];
        if (!ticket) return resJson(res, { ok: false, error: "Ticket not found" }, 404);

        const guild = await getSafeGuild(body.guild);
        const channel = guild?.channels.cache.get(ticket.channel_id);

        let transcriptId = null;
        if (channel) {
            try {
                const messages = await channel.messages.fetch({ limit: 100 }).catch(() => []);
                const transcriptData = Array.from(messages.values()).reverse().map((m) => {
                    return `<div style="margin-bottom:15px; border-bottom:1px solid #333; padding-bottom:10px;">
                        <strong style="color:#5865F2">${m.author.tag}</strong> <small style="color:#72767d">${m.createdAt.toLocaleString()}</small><br>
                        <div style="margin-top:5px;">${m.content.replace(/\n/g, "<br>")}</div>
                        ${m.attachments.size > 0 ? `<div style="color:#1da1f2; font-size:0.8em;">[Attachment: ${m.attachments.first().url}]</div>` : ""}
                    </div>`;
                }).join("");

                const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Ticket Transcript</title>
                    <style>body{background:#36393f; color:#dcddde; font-family:sans-serif; padding:20px; line-height:1.5;} strong{color:#fff;}</style>
                    </head><body><h2>Transcript: #${channel.name}</h2>${transcriptData}</body></html>`;

                const { randomBytes } = await import("node:crypto");
                transcriptId = randomBytes(32).toString("hex");
                const dir = path.join(process.cwd(), "public", "transcripts");
                if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                fs.writeFileSync(path.join(dir, `${transcriptId}.html`), html);
            } catch (e) { console.error("[TRANSCRIPT ERROR]", e); }
        }

        await dbQuery("UPDATE tickets SET status = 'closed', closed_at = NOW(), transcript_id = $1 WHERE id = $2", [transcriptId, body.ticket_id]);
        if (channel) {
            await channel.send("🔒 このチケットはウェブダッシュボードから解決済みとしてマークされました。チャンネルを削除します...");
            setTimeout(() => channel.delete().catch(() => {}), 5000);
        }
        return resJson(res, { ok: true });
    }

    // POST /api/tickets/assign
    if (pathname === "/api/tickets/assign" && method === "POST") {
        const body = await getBody(req);
        if (!(await verifyGuild(body.guild, session))) return resJson(res, { ok: false, error: "Forbidden" }, 403);
        await dbQuery("UPDATE tickets SET assigned_to = $1 WHERE id = $2 AND guild_id = $3", [body.user_id, body.ticket_id, body.guild]);
        return resJson(res, { ok: true });
    }

    // POST /api/tickets/delete
    if (pathname === "/api/tickets/delete" && method === "POST") {
        const body = await getBody(req);
        if (!(await verifyGuild(body.guild, session))) return resJson(res, { ok: false, error: "Forbidden" }, 403);
        await dbQuery("DELETE FROM tickets WHERE id = $1 AND guild_id = $2", [body.ticket_id, body.guild]);
        return resJson(res, { ok: true });
    }

    // GET /api/ticket-categories
    if (pathname === "/api/ticket-categories" && method === "GET") {
        if (!(await verifyGuild(guildId, session))) return resJson(res, { ok: false, error: "Forbidden" }, 403);
        const r = await dbQuery("SELECT * FROM ticket_categories WHERE guild_id=$1 ORDER BY id", [guildId]);
        return resJson(res, { ok: true, categories: r.rows });
    }

    // POST /api/ticket-categories
    if (pathname === "/api/ticket-categories" && method === "POST") {
        const body = await getBody(req);
        if (!(await verifyGuild(body.guild, session))) return resJson(res, { ok: false, error: "Forbidden" }, 403);
        await dbQuery("INSERT INTO ticket_categories (guild_id, name, emoji, description) VALUES ($1, $2, $3, $4)", [body.guild, body.name, body.emoji || "🎫", body.description || ""]);
        return resJson(res, { ok: true });
    }

    // DELETE /api/ticket-categories
    if (pathname === "/api/ticket-categories" && method === "DELETE") {
        const body = await getBody(req);
        if (!(await verifyGuild(body.guild, session))) return resJson(res, { ok: false, error: "Forbidden" }, 403);
        await dbQuery("DELETE FROM ticket_categories WHERE id=$1 AND guild_id=$2", [body.id, body.guild]);
        return resJson(res, { ok: true });
    }

    return false;
}
