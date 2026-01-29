import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  EmbedBuilder,
} from "discord.js";

function ymNow(ms = Date.now()) {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function fmtDuration(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}時間${m}分${r}秒`;
  if (m > 0) return `${m}分${r}秒`;
  return `${r}秒`;
}

function isUnknownInteraction(err) {
  return err?.code === 10062 || err?.rawError?.code === 10062;
}

export const data = new SlashCommandBuilder()
  .setName("vc")
  .setDescription("VCログ/統計")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((sub) =>
    sub
      .setName("recent")
      .setDescription("直近のVCログを表示")
      .addIntegerOption((opt) =>
        opt
          .setName("limit")
          .setDescription("表示件数（最大20）")
          .setMinValue(1)
          .setMaxValue(20)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("top")
      .setDescription("今月のVC滞在時間Topを表示（上位10）")
  )
  .addSubcommand((sub) =>
    sub
      .setName("user")
      .setDescription("指定ユーザーの今月/累計を表示")
      .addUserOption((opt) =>
        opt.setName("target").setDescription("対象ユーザー").setRequired(true)
      )
  );

export async function execute(interaction, db) {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  } catch (e) {
    if (isUnknownInteraction(e)) return;
    throw e;
  }

  try {
    if (!interaction.guildId) {
      return await interaction.editReply("サーバー内で実行してください。");
    }
    if (!db) {
      return await interaction.editReply("DBが利用できません（Renderログを確認）。");
    }

    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    // /vc recent
    if (sub === "recent") {
      const limit = interaction.options.getInteger("limit") ?? 10;

      const rows = await db.all(
        `SELECT user_id, action,
                from_channel_name, to_channel_name,
                duration_sec, created_at
           FROM vc_events
          WHERE guild_id = ?
          ORDER BY created_at DESC
          LIMIT ?`,
        guildId,
        limit
      );

      if (!rows.length) {
        return await interaction.editReply("直近ログがありません。");
      }

      const lines = rows.map((r) => {
        const t = `<t:${Math.floor(r.created_at / 1000)}:R>`;
        if (r.action === "JOIN") {
          return `${t} 🟦 IN  <@${r.user_id}> → **${r.to_channel_name ?? "?"}**`;
        }
        if (r.action === "LEAVE") {
          const dur = r.duration_sec != null ? `（${fmtDuration(r.duration_sec)}）` : "";
          return `${t} 🟦 OUT <@${r.user_id}> ← **${r.from_channel_name ?? "?"}** ${dur}`;
        }
        // MOVE
        const dur = r.duration_sec != null ? `（${fmtDuration(r.duration_sec)}）` : "";
        return `${t} 🔁 MOVE <@${r.user_id}> **${r.from_channel_name ?? "?"} → ${r.to_channel_name ?? "?"}** ${dur}`;
      });

      const embed = new EmbedBuilder()
        .setTitle(`📜 VCログ（直近${rows.length}件）`)
        .setColor(0x3498db)
        .setDescription(lines.join("\n"))
        .setTimestamp(new Date());

      return await interaction.editReply({ embeds: [embed] });
    }

    // /vc top
    if (sub === "top") {
      const ym = ymNow();
      const rows = await db.all(
        `SELECT user_id, seconds
           FROM vc_monthly
          WHERE guild_id = ? AND ym = ?
          ORDER BY seconds DESC
          LIMIT 10`,
        guildId,
        ym
      );

      if (!rows.length) {
        return await interaction.editReply("今月の集計がまだありません。");
      }

      const lines = rows.map(
        (r, i) => `**${i + 1}.** <@${r.user_id}>  —  ${fmtDuration(r.seconds)}`
      );

      const embed = new EmbedBuilder()
        .setTitle(`🏆 VC滞在時間 Top10（${ym}）`)
        .setColor(0x3498db)
        .setDescription(lines.join("\n"))
        .setTimestamp(new Date());

      return await interaction.editReply({ embeds: [embed] });
    }

    // /vc user
    if (sub === "user") {
      const user = interaction.options.getUser("target", true);
      const ym = ymNow();

      const m = await db.get(
        `SELECT seconds FROM vc_monthly
          WHERE guild_id = ? AND user_id = ? AND ym = ?`,
        guildId,
        user.id,
        ym
      );

      const t = await db.get(
        `SELECT seconds FROM vc_total
          WHERE guild_id = ? AND user_id = ?`,
        guildId,
        user.id
      );

      const thisMonth = m?.seconds ?? 0;
      const total = t?.seconds ?? 0;

      const embed = new EmbedBuilder()
        .setTitle(`👤 VC統計：${user.tag}`)
        .setColor(0x3498db)
        .addFields(
          { name: "今月", value: fmtDuration(thisMonth), inline: true },
          { name: "累計", value: fmtDuration(total), inline: true }
        )
        .setTimestamp(new Date());

      return await interaction.editReply({ embeds: [embed] });
    }

    return await interaction.editReply("不明なサブコマンドです。");
  } catch (e) {
    if (isUnknownInteraction(e)) return;
    console.error("vc error:", e);
    try {
      await interaction.editReply(`エラー: ${e?.message ?? e}`);
    } catch {}
  }
}
