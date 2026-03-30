import { Client, GatewayIntentBits, EmbedBuilder } from "discord.js";
import { dbQuery } from "../core/db.js";
import { ENV } from "../config/env.js";

async function runCleanup() {
    console.log("🚀 Starting retroactive message cleanup...");

    const client = new Client({ 
        intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] 
    });

    try {
        await client.login(ENV.TOKEN);
        console.log(`✅ Connected as ${client.user.tag}`);

        // Get all channels that might contain AI reports
        const res = await dbQuery("SELECT guild_id, ai_insight_channel_id, ai_predict_channel_id FROM settings");
        
        for (const row of res.rows) {
            const channels = [row.ai_insight_channel_id, row.ai_predict_channel_id].filter(id => id);
            
            for (const channelId of channels) {
                try {
                    const guild = await client.guilds.fetch(row.guild_id).catch(() => null);
                    if (!guild) continue;

                    const channel = await guild.channels.fetch(channelId).catch(() => null);
                    if (!channel || !channel.isTextBased()) continue;

                    console.log(`🔍 Scanning channel ${channel.name} (#${channelId}) in guild ${guild.name}...`);
                    
                    const messages = await channel.messages.fetch({ limit: 50 });
                    for (const msg of messages.values()) {
                        // Only edit our own messages
                        if (msg.author.id !== client.user.id) continue;

                        let updated = false;
                        let newContent = msg.content;
                        let newEmbeds = msg.embeds.map(e => EmbedBuilder.from(e));

                        // 1. Patterns to replace
                        const patterns = [
                            { from: /お嬢様、今週の分析が完了いたしました。ご査収ください。/g, to: "今週のサーバー分析レポートが完了しました。以下の内容をご確認ください。" },
                            { from: /お嬢様|お嬢/g, to: "" },
                            { from: /してくださいわ。/g, to: "してください。" },
                            { from: /できませんわ。/g, to: "できません。" },
                            { from: /ではありませんわ。/g, to: "ではありません。" },
                            { from: /変更しましたわ。/g, to: "変更しました。" },
                            { from: /しましたわ。/g, to: "しました。" },
                            { from: /失敗しましたわ。/g, to: "失敗しました。" },
                            { from: /お問い合わせくださいわ。/g, to: "お問い合わせください。" }
                        ];

                        // Clean content
                        for (const p of patterns) {
                            if (p.from.test(newContent)) {
                                newContent = newContent.replace(p.from, p.to);
                                updated = true;
                            }
                        }

                        // Clean embeds
                        for (const embed of newEmbeds) {
                            // Description
                            if (embed.data.description) {
                                for (const p of patterns) {
                                    if (p.from.test(embed.data.description)) {
                                        embed.setDescription(embed.data.description.replace(p.from, p.to));
                                        updated = true;
                                    }
                                }
                            }
                            // Title
                            if (embed.data.title) {
                                for (const p of patterns) {
                                    if (p.from.test(embed.data.title)) {
                                        embed.setTitle(embed.data.title.replace(p.from, p.to));
                                        updated = true;
                                    }
                                }
                            }
                            // Footer
                            if (embed.data.footer && embed.data.footer.text) {
                                for (const p of patterns) {
                                    if (p.from.test(embed.data.footer.text)) {
                                        embed.setFooter({ text: embed.data.footer.text.replace(p.from, p.to) });
                                        updated = true;
                                    }
                                }
                            }
                        }

                        if (updated) {
                            console.log(`   ✨ Updating message ${msg.id}`);
                            await msg.edit({ content: newContent, embeds: newEmbeds })
                                .catch(err => console.error(`   ❌ Failed to edit ${msg.id}:`, err.message));
                        }
                    }
                } catch (err) {
                    console.error(`   ❌ Error in channel ${channelId}:`, err.message);
                }
            }
        }
    } catch (err) {
        console.error("❌ Fatal error during cleanup:", err.message);
    } finally {
        client.destroy();
        console.log("🏁 Cleanup process finished.");
        process.exit(0);
    }
}

runCleanup();
