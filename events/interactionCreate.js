import {
    Events,
    MessageFlags,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    PermissionFlagsBits,
    AttachmentBuilder,
    UserSelectMenuBuilder,
    StringSelectMenuBuilder,
} from "discord.js";
import { client } from "../core/client.js";
import { dbQuery } from "../core/db.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

export default {
    name: Events.InteractionCreate,
    async default(interaction) {
        try {
            const guildId = interaction.guild?.id;

            // 1. Slash Commands
            if (interaction.isChatInputCommand()) {
                const command = client.commands.get(interaction.commandName);
                if (!command) return;
                try {
                    await command.execute(interaction);
                } catch (error) {
                    console.error(`[COMMAND ERROR] ${interaction.commandName}:`, error);
                    const msg = {
                        content: "⚠️ コマンドの実行中にエラーが発生しました。",
                        ephemeral: true,
                    };
                    if (interaction.replied || interaction.deferred)
                        await interaction.followUp(msg).catch(() => {});
                    else await interaction.reply(msg).catch(() => {});
                }
                return;
            }

            // 2. Button Interactions
            if (interaction.isButton()) {
                if (!guildId) return;

                // Button Role handling
                if (interaction.customId.startsWith("btn_role_")) {
                    const roleId = interaction.customId.replace("btn_role_", "");
                    await interaction.deferReply({ ephemeral: true });
                    try {
                        if (interaction.member.roles.cache.has(roleId)) {
                            await interaction.member.roles.remove(roleId);
                            await interaction.editReply(`✅ 役職 <@&${roleId}> を解除しました。`);
                        } else {
                            await interaction.member.roles.add(roleId);
                            await interaction.editReply(`✅ 役職 <@&${roleId}> を付与しました。`);
                        }
                    } catch (e) {
                        await interaction.editReply(`❌ エラー: ${e.message}`);
                    }
                    return;
                }

                // Ticket: Create
                if (interaction.customId === "ticket_create") {
                    await interaction.deferReply({ ephemeral: true });

                    const catRes = await dbQuery("SELECT id, name, emoji, description FROM ticket_categories WHERE guild_id = $1 ORDER BY id", [guildId]);
                    if (catRes.rowCount > 0) {
                        const options = catRes.rows.map(c => ({
                            label: c.name.substring(0, 100),
                            description: c.description ? c.description.substring(0, 100) : "",
                            emoji: c.emoji || "🎫",
                            value: c.id.toString(),
                        })).slice(0, 25);
                        
                        const selectMenu = new StringSelectMenuBuilder()
                            .setCustomId("ticket_category_select")
                            .setPlaceholder("チケットの種類を選択してください")
                            .addOptions(options);
                        
                        const row = new ActionRowBuilder().addComponents(selectMenu);
                        await interaction.editReply({
                            content: "作成するチケットのカテゴリを選択してください:",
                            components: [row],
                        });
                        return;
                    }
                    
                    // IF NO CATEGORIES
                    const settingsRes = await dbQuery(
                        "SELECT ticket_welcome_msg, color_ticket, ticket_staff_role_id FROM settings WHERE guild_id = $1",
                        [guildId]
                    );
                    const settings = settingsRes.rows[0];
                    const channel = await interaction.guild.channels.create({
                        name: `ticket-${interaction.user.username}`,
                        type: ChannelType.GuildText,
                        permissionOverwrites: [
                            { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                            {
                                id: interaction.user.id,
                                allow: [
                                    PermissionFlagsBits.ViewChannel,
                                    PermissionFlagsBits.SendMessages,
                                    PermissionFlagsBits.AttachFiles,
                                ],
                            },
                        ],
                    });
                    await dbQuery(
                        "INSERT INTO tickets (guild_id, channel_id, user_id, status) VALUES ($1, $2, $3, 'open')",
                        [guildId, channel.id, interaction.user.id]
                    );

                    const embedColor = settings?.color_ticket
                        ? parseInt(settings.color_ticket.replace("#", ""), 16) || 0x00ff00
                        : 0x00ff00;
                    const userEmbed = new EmbedBuilder()
                        .setTitle("🎫 チケットが作成されました")
                        .setDescription(
                            settings?.ticket_welcome_msg || "スタッフが対応するまでお待ちください。"
                        )
                        .setColor(embedColor)
                        .setTimestamp();

                    const staffEmbed = new EmbedBuilder()
                        .setTitle("🛠️ スタッフ管理パネル")
                        .setDescription("このチケットの対応を担当しますか？")
                        .setColor(0x5865f2);
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
                    const assignMenuRow = new ActionRowBuilder().addComponents(
                        new UserSelectMenuBuilder()
                            .setCustomId("ticket_assign_menu")
                            .setPlaceholder("担当を直接指定")
                    );

                    const mention = settings?.ticket_staff_role_id
                        ? `<@&${settings.ticket_staff_role_id}>`
                        : "";
                    await channel.send({
                        content: `${mention} <@${interaction.user.id}> さんがチケットを作成しました。`,
                        embeds: [userEmbed, staffEmbed],
                        components: [userRow, staffRow, assignMenuRow],
                    });
                    
                    await interaction.editReply(`✅ チケットを作成しました: <#${channel.id}>`);
                }

                // Ticket: Assign Me
                if (interaction.customId === "ticket_assign_me") {
                    await interaction.deferUpdate();
                    await dbQuery("UPDATE tickets SET assigned_to = $1 WHERE channel_id = $2", [
                        interaction.user.id,
                        interaction.channel.id,
                    ]);
                    const embeds = interaction.message.embeds.map((e) => EmbedBuilder.from(e));
                    if (embeds[1])
                        embeds[1]
                            .setDescription(`✅ **担当者決定**: <@${interaction.user.id}>`)
                            .setColor(0x2ecc71);
                    const rows = interaction.message.components.map((c) =>
                        ActionRowBuilder.from(c)
                    );
                    if (rows[1]) rows[1].components[0].setDisabled(true).setLabel("対応中");
                    await interaction.editReply({ embeds, components: rows });
                    await interaction.channel.send(
                        `👤 <@${interaction.user.id}> がこのチケットの担当になりました。`
                    );
                }

                // Ticket: Expert request
                if (interaction.customId === "ticket_request_expert") {
                    await interaction.deferUpdate();
                    await interaction.channel.send(
                        `📢 <@${interaction.user.id}> が専門スタッフに協力を依頼しました。`
                    );
                    const rows = interaction.message.components.map((c) =>
                        ActionRowBuilder.from(c)
                    );
                    if (rows[1]) rows[1].components[1].setDisabled(true).setLabel("依頼済み");
                    await interaction.editReply({ components: rows });
                }

                // Ticket: Close
                if (interaction.customId === "ticket_close") {
                    await interaction.deferReply();
                    const ticketRes = await dbQuery(
                        "SELECT user_id FROM tickets WHERE channel_id = $1",
                        [interaction.channel.id]
                    );
                    const settingsRes = await dbQuery(
                        "SELECT ticket_log_channel_id FROM settings WHERE guild_id = $1",
                        [guildId]
                    );
                    const creatorId = ticketRes.rows[0]?.user_id;

                    // Transcript generation
                    const messages = await interaction.channel.messages.fetch({ limit: 100 });
                    const logs = Array.from(messages.values()).reverse();
                    let html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Transcript</title><style>body { background-color: #36393f; color: #dcddde; font-family: sans-serif; padding: 20px; } .msg { display: flex; margin-bottom: 20px; } .author { font-weight: bold; color: #fff; } .text { margin-top: 5px; }</style></head><body><h2>Transcript: ${interaction.channel.name}</h2>`;
                    for (const m of logs) {
                        html += `<div class="msg"><div class="content"><span class="author">${m.author.tag}</span> <span class="time">${m.createdAt.toLocaleString()}</span><div class="text">${m.content}</div></div></div>`;
                    }
                    html += "</body></html>";

                    const transcriptId = `${guildId}-${Date.now()}`;
                    const transcriptDir = path.join(ROOT_DIR, "public", "transcripts");
                    if (!fs.existsSync(transcriptDir))
                        fs.mkdirSync(transcriptDir, { recursive: true });
                    fs.writeFileSync(path.join(transcriptDir, `${transcriptId}.html`), html);

                    const publicUrl = process.env.PUBLIC_URL || "http://localhost:3000";
                    const webUrl = `${publicUrl.replace(/\/+$/, "")}/transcripts/${transcriptId}.html`;
                    const logEmbed = new EmbedBuilder()
                        .setTitle("🎫 チケットクローズ")
                        .setDescription(
                            `**作成者**: <@${creatorId || "不明"}>\n**クローズ**: <@${interaction.user.id}>\n[Webでログを表示](${webUrl})`
                        )
                        .setColor(0x3498db)
                        .setTimestamp();

                    const logChannelId = settingsRes.rows[0]?.ticket_log_channel_id;
                    const attachment = new AttachmentBuilder(Buffer.from(html), {
                        name: "transcript.html",
                    });

                    if (logChannelId) {
                        const logCh = interaction.guild.channels.cache.get(logChannelId);
                        if (logCh) {
                            await logCh.send({
                                embeds: [logEmbed],
                                files: [attachment],
                            });
                        }
                    }

                    // Always provide the link and file to the closer as fallback/convenience
                    await interaction.editReply({
                        content: `🔒 チケットをクローズしました。5秒後に削除します。\n[Webでログを表示](${webUrl})`,
                        files: [attachment],
                    });

                    await dbQuery(
                        "UPDATE tickets SET status = 'closed', closed_at = NOW(), transcript_id = $1 WHERE channel_id = $2",
                        [transcriptId, interaction.channel.id]
                    );
                    await interaction.editReply(
                        "🔒 チケットをクローズしました。5秒後に削除します。"
                    );
                    setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
                }
                return;
            }

            // 3. String Select Menus
            if (interaction.isStringSelectMenu()) {
                if (!guildId) return;

                if (interaction.customId === "ticket_category_select") {
                    await interaction.deferUpdate();
                    const categoryId = interaction.values[0];
                    const catRes = await dbQuery("SELECT name, emoji FROM ticket_categories WHERE id = $1 AND guild_id = $2", [categoryId, guildId]);
                    const category = catRes.rows[0];
                    if (!category) {
                        await interaction.followUp({ content: "カテゴリが見つかりません。", ephemeral: true });
                        return;
                    }

                    const settingsRes = await dbQuery(
                        "SELECT ticket_welcome_msg, color_ticket, ticket_staff_role_id FROM settings WHERE guild_id = $1",
                        [guildId]
                    );
                    const settings = settingsRes.rows[0];
                    
                    const prefix = category.name.toLowerCase().replace(/[^a-z0-9_-]/g, "");
                    const safePrefix = prefix.length > 0 ? prefix : "ticket";

                    const channel = await interaction.guild.channels.create({
                        name: `${safePrefix}-${interaction.user.username}`,
                        type: ChannelType.GuildText,
                        permissionOverwrites: [
                            { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                            {
                                id: interaction.user.id,
                                allow: [
                                    PermissionFlagsBits.ViewChannel,
                                    PermissionFlagsBits.SendMessages,
                                    PermissionFlagsBits.AttachFiles,
                                ],
                            },
                        ],
                    });
                    
                    await dbQuery(
                        "INSERT INTO tickets (guild_id, channel_id, user_id, status, category_id) VALUES ($1, $2, $3, 'open', $4)",
                        [guildId, channel.id, interaction.user.id, categoryId]
                    );

                    const embedColor = settings?.color_ticket
                        ? parseInt(settings.color_ticket.replace("#", ""), 16) || 0x00ff00
                        : 0x00ff00;
                    
                    const ticketTopic = `【${category.name}】\n`;
                    const userEmbed = new EmbedBuilder()
                        .setTitle("🎫 チケットが作成されました")
                        .setDescription(
                            ticketTopic + (settings?.ticket_welcome_msg || "スタッフが対応するまでお待ちください。")
                        )
                        .setColor(embedColor)
                        .setTimestamp();

                    const staffEmbed = new EmbedBuilder()
                        .setTitle("🛠️ スタッフ管理パネル")
                        .setDescription("このチケットの対応を担当しますか？")
                        .setColor(0x5865f2);
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
                    const assignMenuRow = new ActionRowBuilder().addComponents(
                        new UserSelectMenuBuilder()
                            .setCustomId("ticket_assign_menu")
                            .setPlaceholder("担当を直接指定")
                    );

                    const mention = settings?.ticket_staff_role_id
                        ? `<@&${settings.ticket_staff_role_id}>`
                        : "";
                    await channel.send({
                        content: `${mention} <@${interaction.user.id}> さんがチケットを作成しました。`,
                        embeds: [userEmbed, staffEmbed],
                        components: [userRow, staffRow, assignMenuRow],
                    });
                    
                    await interaction.followUp({ content: `✅ チケットを作成しました: <#${channel.id}>`, ephemeral: true });
                }
                return;
            }

            // 3. Select Menu Interactions
            if (interaction.isUserSelectMenu()) {
                if (interaction.customId === "ticket_assign_menu") {
                    const targetId = interaction.values[0];
                    await interaction.deferUpdate();
                    await dbQuery("UPDATE tickets SET assigned_to = $1 WHERE channel_id = $2", [
                        targetId,
                        interaction.channel.id,
                    ]);
                    const embeds = interaction.message.embeds.map((e) => EmbedBuilder.from(e));
                    if (embeds[1])
                        embeds[1]
                            .setDescription(`✅ **担当者決定**: <@${targetId}>`)
                            .setColor(0x2ecc71);
                    await interaction.editReply({ embeds });
                    await interaction.channel.send(
                        `👤 <@${interaction.user.id}> が <@${targetId}> を担当に指名しました。`
                    );
                }
                return;
            }
        } catch (e) {
            console.error("[CRITICAL INTERACTION ERROR]:", e);
        }
    },
};
