import { Events, MessageFlags, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits, AttachmentBuilder } from "discord.js";
import { client } from "../core/client.js";
import { dbQuery } from "../core/db.js";

export default {
    name: Events.InteractionCreate,
    async default(interaction) {
        if (interaction.isChatInputCommand()) {
            const command = client.commands.get(interaction.commandName);
            if (!command) return;
            try {
                await command.execute(interaction);
            } catch (error) {
                console.error(`Error executing ${interaction.commandName}:`, error);
                const msg = { content: 'コマンドの実行中にエラーが発生しました。', flags: [MessageFlags.Ephemeral] };
                if (interaction.replied || interaction.deferred) await interaction.followUp(msg);
                else await interaction.reply(msg);
            }
            return;
        }

        if (interaction.isButton()) {
            const guildId = interaction.guild.id;

            // Ticket Creation
            if (interaction.customId === 'ticket_create') {
                await interaction.deferReply({ ephemeral: true });

                const settingsRes = await dbQuery("SELECT ticket_welcome_msg, color_ticket FROM settings WHERE guild_id = $1", [guildId]);
                const settings = settingsRes.rows[0];

                const channel = await interaction.guild.channels.create({
                    name: `ticket-${interaction.user.username}`,
                    type: ChannelType.GuildText,
                    permissionOverwrites: [
                        { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                        { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles] },
                    ],
                });

                await dbQuery("INSERT INTO tickets (guild_id, channel_id, user_id) VALUES ($1, $2, $3)", [guildId, channel.id, interaction.user.id]);

                const welcomeMsg = settings?.ticket_welcome_msg || `こんにちは <@${interaction.user.id}> さん。\nスタッフが対応するまで、相談内容や証拠をここに記入してお待ちください。\n解決した場合は、下のボタンでチケットをクローズできます。`;
                const embedColor = settings?.color_ticket ? parseInt(settings.color_ticket.replace('#', ''), 16) : 0x00FF00;

                const userEmbed = new EmbedBuilder()
                    .setTitle("🎫 チケットが作成されました")
                    .setDescription(welcomeMsg)
                    .setColor(embedColor)
                    .setTimestamp();

                const staffEmbed = new EmbedBuilder()
                    .setTitle("🛠️ スタッフ管理パネル")
                    .setDescription("このチケットの対応を担当しますか？")
                    .setColor(0x5865F2)
                    .setFooter({ text: "担当者が決まるとユーザーに通知されます" });

                const userRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId("ticket_close")
                        .setLabel("チケットを閉じる")
                        .setStyle(ButtonStyle.Danger)
                );

                const staffRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId("ticket_assign_me")
                        .setLabel("担当を引き受ける")
                        .setStyle(ButtonStyle.Primary),
                    new ButtonBuilder()
                        .setCustomId("ticket_request_expert")
                        .setLabel("専門家に依頼")
                        .setStyle(ButtonStyle.Secondary)
                );

                await channel.send({ content: `<@${interaction.user.id}> さんがチケットを作成しました。`, embeds: [userEmbed, staffEmbed], components: [userRow, staffRow] });
                await interaction.editReply(`✅ チケットを作成しました: <#${channel.id}>`);
            }

            // Ticket Assignment
            if (interaction.customId === 'ticket_assign_me') {
                await interaction.deferUpdate();
                await dbQuery("UPDATE tickets SET assigned_to = $1 WHERE channel_id = $2", [interaction.user.id, interaction.channel.id]);

                const embeds = interaction.message.embeds.map(e => EmbedBuilder.from(e));
                if (embeds[1]) {
                    embeds[1].setDescription(`✅ **担当者決定**: <@${interaction.user.id}>`)
                        .setColor(0x2ECC71);
                }

                const rows = interaction.message.components.map(c => ActionRowBuilder.from(c));
                // Disable assign button
                if (rows[1]) {
                    rows[1].components[0].setDisabled(true).setLabel("対応中");
                }

                await interaction.editReply({ embeds, components: rows });
                await interaction.channel.send(`👤 <@${interaction.user.id}> がこのチケットの担当になりました。`);
            }

            // Ticket Request Expert
            if (interaction.customId === 'ticket_request_expert') {
                await interaction.deferUpdate();
                await interaction.channel.send(`📢 <@${interaction.user.id}> が専門のモデレーターに協力を依頼しました。`);

                const rows = interaction.message.components.map(c => ActionRowBuilder.from(c));
                if (rows[1]) {
                    rows[1].components[1].setDisabled(true).setLabel("依頼済み");
                }
                await interaction.editReply({ components: rows });
            }

            // Ticket Closing
            if (interaction.customId === 'ticket_close') {
                await interaction.deferReply();

                // Get Ticket Info from DB
                const ticketRes = await dbQuery("SELECT user_id, created_at FROM tickets WHERE channel_id = $1", [interaction.channel.id]);
                const ticketData = ticketRes.rows[0];
                const creatorId = ticketData?.user_id;
                const creator = creatorId ? await interaction.guild.members.fetch(creatorId).catch(() => null) : null;
                const creatorTag = creator ? creator.user.tag : "不明なユーザー";

                // Generate HTML Transcript (Ticket Tool Style)
                const messages = await interaction.channel.messages.fetch({ limit: 100 });
                const logs = Array.from(messages.values()).reverse();

                let html = `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="utf-8">
                    <title>Ticket Transcript - ${interaction.channel.name}</title>
                    <style>
                        body { background-color: #36393f; color: #dcddde; font-family: sans-serif; padding: 20px; }
                        .msg { display: flex; margin-bottom: 20px; }
                        .avatar { width: 40px; height: 40px; border-radius: 50%; margin-right: 15px; }
                        .content { flex-grow: 1; }
                        .author { font-weight: bold; color: #fff; margin-right: 5px; }
                        .time { font-size: 0.75rem; color: #72767d; }
                        .text { margin-top: 5px; line-height: 1.4; }
                    </style>
                </head>
                <body>
                    <h2>Transcript: ${interaction.channel.name}</h2>
                    <p>Created by: ${creatorTag} | Closed by: ${interaction.user.tag}</p>
                    <hr style="border-color: #4f545c;">
                `;

                for (const m of logs) {
                    const time = m.createdAt.toLocaleString("ja-JP");
                    const content = m.content.replace(/\n/g, "<br>");
                    html += `
                    <div class="msg">
                        <img class="avatar" src="${m.author.displayAvatarURL()}">
                        <div class="content">
                            <span class="author">${m.author.tag}</span>
                            <span class="time">${time}</span>
                            <div class="text">${content}</div>
                        </div>
                    </div>`;
                }
                html += "</body></html>";

                const buffer = Buffer.from(html, "utf-8");
                const attachment = new AttachmentBuilder(buffer, { name: `transcript-${interaction.channel.name}.html` });

                const { sendLog } = await import("../core/logger.js");
                const logEmbed = new EmbedBuilder()
                    .setTitle("🎫 チケットクローズ")
                    .setDescription(`**チケット**: ${interaction.channel.name}\n**作成者**: <@${creatorId || interaction.user.id}>\n**クローズした人**: <@${interaction.user.id}>`)
                    .setColor(0x00A2E8) // 青いバー
                    .setTimestamp();

                await sendLog(interaction.guild, 'ng', { embeds: [logEmbed], files: [attachment] });

                await dbQuery("UPDATE tickets SET status = 'closed', closed_at = NOW() WHERE channel_id = $1", [interaction.channel.id]);
                await interaction.editReply("🔒 チケットをクローズし、ログを保存しました。5秒後にチャンネルを削除します。");
                setTimeout(() => interaction.channel.delete().catch(() => { }), 5000);
            }
        }
    },
};
