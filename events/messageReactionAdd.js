import { Events, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits, MessageFlags } from "discord.js";
import { dbQuery } from "../core/db.js";

export default {
    name: Events.MessageReactionAdd,
    async default(reaction, user) {
        if (user.bot) return;
        if (reaction.partial) {
            try {
                await reaction.fetch();
            } catch (error) {
                console.error('Something went wrong when fetching the reaction:', error);
                return;
            }
        }

        const { guild } = reaction.message;
        if (!guild) return;

        // v2.4.9: Honeypot Trap (Reaction)
        const { cache } = await import("../core/cache.js");
        let settings = cache.getSettings(guild.id);
        if (!settings) {
            const sRes = await dbQuery("SELECT * FROM settings WHERE guild_id = $1", [guild.id]);
            settings = sRes.rows[0] || {};
            cache.setSettings(guild.id, settings);
        }

        if (settings.antiraid_honeypot_channel_id === reaction.message.channel.id) {
            const member = await guild.members.fetch(user.id).catch(() => null);
            const staffRoleId = settings.ticket_staff_role_id;
            if (member && (!staffRoleId || !member.roles.cache.has(staffRoleId))) {
                if (member.bannable) {
                    await member.ban({ reason: "Iron Fortress: Honeypot Trap Triggered (Reaction)" }).catch(() => { });

                    const { EmbedBuilder } = await import("discord.js");
                    const { sendLog } = await import("../core/logger.js");
                    const embed = new EmbedBuilder()
                        .setAuthor({ name: user.tag, iconURL: user.displayAvatarURL() })
                        .setColor(0xFF0000)
                        .setTitle("🛡️ Iron Fortress: Honeypot Trap")
                        .setDescription(`**ユーザー**: <@${user.id}>\n**アクション**: Banned\n**理由**: ハニーポットチャンネルでのリアクション反応`)
                        .setTimestamp();
                    await sendLog(guild, 'ng', embed);
                }
                return;
            }
        }

        const res = await dbQuery(
            "SELECT role_id FROM reaction_roles WHERE guild_id = $1 AND message_id = $2 AND emoji = $3",
            [guild.id, reaction.message.id, reaction.emoji.toString()]
        );

        if (res.rows.length > 0) {
            const member = await guild.members.fetch(user.id);
            for (const row of res.rows) {
                try {
                    await member.roles.add(row.role_id);
                } catch (e) {
                    console.error(`Failed to add role ${row.role_id} to ${user.tag}:`, e.message);
                }
            }
        }
    }
};
