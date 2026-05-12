import { resJson, verifyGuild, getSafeGuild, getBody } from "./helpers.js";
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { dbQuery } from "../../core/db.js";

export async function handleButtonRoleRoutes(req, res, pathname, url, session) {
    const guildId = url.searchParams.get("guild");
    const method = req.method;

    // GET /api/button-roles
    if (pathname === "/api/button-roles" && method === "GET") {
        if (!guildId) return resJson(res, { ok: false, error: "Missing guild ID" }, 400);
        if (!(await verifyGuild(guildId, session))) return resJson(res, { ok: false, error: "Forbidden" }, 403);
        const resDb = await dbQuery("SELECT * FROM button_roles WHERE guild_id = $1 ORDER BY created_at DESC", [guildId]);
        return resJson(res, { ok: true, data: resDb.rows });
    }

    // POST /api/button-roles
    if (pathname === "/api/button-roles" && method === "POST") {
        const body = await getBody(req);
        if (!(await verifyGuild(body.guild, session))) return resJson(res, { ok: false, error: "Forbidden" }, 403);
        try {
            const guild = await getSafeGuild(body.guild);
            const channel = guild?.channels.cache.get(body.channel_id) || await guild?.channels.fetch(body.channel_id).catch(() => null);
            if (!channel) return resJson(res, { ok: false, error: "Channel not found" }, 404);

            const embedContent = body.content || "役職を選択してください。";
            const embedTitle = body.embed_title || "役職パネル";
            const embedColorNum = parseInt((body.color || "#5865F2").replace("#", ""), 16);

            const embed = new EmbedBuilder().setTitle(embedTitle).setDescription(embedContent).setColor(embedColorNum);
            const row = new ActionRowBuilder();
            body.buttons.forEach((btn) => {
                row.addComponents(new ButtonBuilder().setCustomId(`btn_role_${btn.role_id}`).setLabel(btn.label || "Role").setStyle(ButtonStyle.Primary));
            });

            const components = row.components.length > 0 ? [row] : [];
            let messageId = body.message_id;
            let message;
            if (messageId) message = await channel.messages.fetch(messageId).catch(() => null);
            if (message) await message.edit({ embeds: [embed], components });
            else { const sent = await channel.send({ embeds: [embed], components }); messageId = sent.id; }

            if (body.id) {
                await dbQuery("UPDATE button_roles SET channel_id = $1, message_id = $2, content = $3, embed_title = $4, color = $5, buttons = $6, updated_at = NOW() WHERE id = $7 AND guild_id = $8", [body.channel_id, messageId, body.content, body.embed_title, body.color, JSON.stringify(body.buttons), body.id, body.guild]);
            } else {
                await dbQuery("INSERT INTO button_roles (guild_id, channel_id, message_id, content, embed_title, color, buttons) VALUES ($1, $2, $3, $4, $5, $6, $7)", [body.guild, body.channel_id, messageId, body.content, body.embed_title, body.color, JSON.stringify(body.buttons)]);
            }

            return resJson(res, { ok: true });
        } catch (e) { searchButtonRoleError(res, e); }
    }

    // DELETE /api/button-roles
    if (pathname === "/api/button-roles" && method === "DELETE") {
        const body = await getBody(req);
        if (!(await verifyGuild(body.guild, session))) return resJson(res, { ok: false, error: "Forbidden" }, 403);
        await dbQuery("DELETE FROM button_roles WHERE id = $1 AND guild_id = $2", [body.id, body.guild]);
        return resJson(res, { ok: true });
    }

    return false;
}

function searchButtonRoleError(res, e) {
    console.error("[BUTTON ROLE ERROR]", e.message);
    resJson(res, { ok: false, error: "Failed to process button roles" }, 500);
}
