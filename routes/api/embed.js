import { resJson, verifyGuild, getSafeGuild, getBody } from "./helpers.js";
import { EmbedBuilder } from "discord.js";

export async function handleEmbedRoutes(req, res, pathname, url, session) {
    if (pathname === "/api/embed/send" && req.method === "POST") {
        const body = await getBody(req);
        const { guild: guildId, channel_id: channelId, title, description, color, footer, image } = body;

        if (!guildId || !channelId) return resJson(res, { ok: false, error: "Missing guild or channel" }, 400);
        if (!(await verifyGuild(guildId, session))) return resJson(res, { ok: false, error: "Forbidden" }, 403);

        try {
            const guild = await getSafeGuild(guildId);
            const channel = guild?.channels.cache.get(channelId);
            if (!channel || !channel.isTextBased()) return resJson(res, { ok: false, error: "Channel not found" }, 404);

            const embed = new EmbedBuilder()
                .setTitle(title || null)
                .setDescription(description || null)
                .setColor(color || "#5865F2")
                .setFooter(footer ? { text: footer } : null)
                .setImage(image || null)
                .setTimestamp();

            await channel.send({ embeds: [embed] });
            return resJson(res, { ok: true });
        } catch (e) {
            console.error("[EMBED ERROR]", e);
            return resJson(res, { ok: false, error: "Failed to send embed" }, 500);
        }
    }
    return false;
}
