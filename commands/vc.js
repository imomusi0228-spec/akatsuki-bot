import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import { dbQuery } from "../core/db.js";
import { t } from "../core/i18n.js";

export const data = [
    new SlashCommandBuilder()
        .setName("vc-name")
        .setNameLocalizations({ ja: "vc-名前変更", "en-US": "vc-name", "en-GB": "vc-name" })
        .setDescription("Changes the name of your VC (Owner only).")
        .setDescriptionLocalizations({
            ja: "【オーナー限定】自分のVCの名前を変更します",
            "en-US": "Changes the name of your VC (Owner only).",
            "en-GB": "Changes the name of your VC (Owner only).",
        })
        .addStringOption((opt) =>
            opt
                .setName("name")
                .setNameLocalizations({ ja: "名前", "en-US": "name", "en-GB": "name" })
                .setDescription("The new channel name.")
                .setDescriptionLocalizations({
                    ja: "新しいチャンネル名",
                    "en-US": "The new channel name.",
                    "en-GB": "The new channel name.",
                })
                .setRequired(true)
        ),
    new SlashCommandBuilder()
        .setName("vc-limit")
        .setNameLocalizations({ ja: "vc-人数制限", "en-US": "vc-limit", "en-GB": "vc-limit" })
        .setDescription("Changes the member limit for your VC (Owner only).")
        .setDescriptionLocalizations({
            ja: "【オーナー限定】自分のVCの人数制限を変更します",
            "en-US": "Changes the member limit for your VC (Owner only).",
            "en-GB": "Changes the member limit for your VC (Owner only).",
        })
        .addIntegerOption((opt) =>
            opt
                .setName("limit")
                .setNameLocalizations({ ja: "上限", "en-US": "limit", "en-GB": "limit" })
                .setDescription("Member limit (0 for unlimited).")
                .setDescriptionLocalizations({
                    ja: "最大人数（0で無制限）",
                    "en-US": "Member limit (0 for unlimited).",
                    "en-GB": "Member limit (0 for unlimited).",
                })
                .setRequired(true)
                .setMinValue(0)
                .setMaxValue(99)
        ),
    new SlashCommandBuilder()
        .setName("vc-owner")
        .setNameLocalizations({ ja: "vc-オーナー譲渡", "en-US": "vc-owner", "en-GB": "vc-owner" })
        .setDescription("Transfers VC ownership (Owner only).")
        .setDescriptionLocalizations({
            ja: "【オーナー限定】自分のVCのオーナー権限を譲渡します",
            "en-US": "Transfers VC ownership (Owner only).",
            "en-GB": "Transfers VC ownership (Owner only).",
        })
        .addUserOption((opt) =>
            opt
                .setName("user")
                .setNameLocalizations({ ja: "ユーザー", "en-US": "user", "en-GB": "user" })
                .setDescription("The new owner.")
                .setDescriptionLocalizations({
                    ja: "新しいオーナー",
                    "en-US": "The new owner.",
                    "en-GB": "The new owner.",
                })
                .setRequired(true)
        ),
];

export async function execute(interaction) {
    const locale = interaction.locale.startsWith("ja") ? "ja" : "en";
    const { commandName, guildId, user, member, options } = interaction;
    const channelId = member.voice.channelId;

    if (!channelId) {
        return interaction.reply({
            content:
                locale === "ja"
                    ? "❌ ボイスチャンネルに入室した状態で実行してください。"
                    : "❌ Please execute this command while you are in a voice channel.",
            ephemeral: true,
        });
    }

    const res = await dbQuery("SELECT * FROM auto_vc_channels WHERE channel_id = $1", [channelId]);
    if (res.rows.length === 0) {
        return interaction.reply({
            content:
                locale === "ja"
                    ? "❌ このVCは自動生成されたものではないため、操作できません。"
                    : "❌ This channel is not an auto-generated VC and cannot be modified.",
            ephemeral: true,
        });
    }

    const room = res.rows[0];
    const isStaff = member.permissions.has(PermissionFlagsBits.ManageChannels);

    if (room.owner_id !== user.id && !isStaff) {
        return interaction.reply({
            content:
                locale === "ja"
                    ? "❌ あなたはこの部屋のオーナー（作成者）ではないため、設定を変更できません。"
                    : "❌ You are not the owner of this room. Only the owner or staff can modify it.",
            ephemeral: true,
        });
    }

    const channel = member.voice.channel;

    try {
        if (commandName === "vc-name") {
            const newName = options.getString("name");
            await channel.setName(`🔊 ${newName}`);
            return interaction.reply({
                content:
                    locale === "ja"
                        ? `✅ チャンネル名を **${newName}** に変更しました。`
                        : `✅ Changed channel name to **${newName}**.`,
                ephemeral: true,
            });
        }

        if (commandName === "vc-limit") {
            const limit = options.getInteger("limit");
            await channel.setUserLimit(limit);
            const limitTxt =
                limit === 0
                    ? locale === "ja"
                        ? "無制限"
                        : "Unlimited"
                    : locale === "ja"
                      ? limit + "人"
                      : limit;
            return interaction.reply({
                content:
                    locale === "ja"
                        ? `✅ 人数制限を **${limitTxt}** に変更しました。`
                        : `✅ Changed user limit to **${limitTxt}**.`,
                ephemeral: true,
            });
        }

        if (commandName === "vc-owner") {
            const targetUser = options.getUser("user");
            if (targetUser.bot) {
                return interaction.reply({
                    content:
                        locale === "ja"
                            ? "❌ ボットにオーナー権限を譲渡することはできません。"
                            : "❌ Are you seriously planning to transfer ownership to a bot?",
                    ephemeral: true,
                });
            }

            await dbQuery("UPDATE auto_vc_channels SET owner_id = $1 WHERE channel_id = $2", [
                targetUser.id,
                channelId,
            ]);
            await channel.setName(`🔊 ${targetUser.username}'s Room`).catch(() => {});
            return interaction.reply({
                content:
                    locale === "ja"
                        ? `👑 <@${targetUser.id}> さんにこの部屋のオーナー権限を譲渡しました。`
                        : `👑 Transferred ownership to <@${targetUser.id}>.`,
            });
        }
    } catch (e) {
        console.error(`[VC CMD ERROR] ${commandName}:`, e);
        return interaction.reply({
            content:
                locale === "ja"
                    ? "❌ 申し訳ありません。技術的な問題で操作に失敗しました。"
                    : "❌ Sorry, an error occurred while processing your request.",
            ephemeral: true,
        });
    }
}
