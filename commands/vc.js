import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  EmbedBuilder,
} from "discord.js";

function isUnknownInteraction(err) {
  return err?.code === 10062 || err?.rawError?.code === 10062;
}

function ymTokyo(date = new Date()) {
  const dtf = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
  });
  return dtf.format(date); // YYYY-MM
}

function msToHuman(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) return `${h}時間${m}分${ss}秒`;
  if (m > 0) return `${m}分${ss}秒`;
  return `${ss}秒`;
}

export const data = new SlashCommandBuilder()
  .setName("vc")
  .setDescription("VCログ/統計")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((sub) =>
    sub
      .setName("recent")
      .setDescription("直近のVCログを表示（log_events から）")
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
        `SELECT type, user_id, meta, ts
           FROM log_events
          WHERE guild_id = ?
            AND type IN ('vc_join','vc_session_end','vc_move_merged')
          ORDER BY ts DESC
          LIMIT ?`,
        guildId,
        limit
      );

      if (!rows.length) {
        return await interaction.editReply("直近ログがありません。");
      }

      const lines = rows.map((r) => {
        const t = `<t:${Math.floor(Number(r.ts) / 1000)}:R>`;
        let meta = null;
        try { meta = r.meta ? JSON.parse(r.meta) : null; } catch { meta = null; }

        if (r.type === "vc_join") {
          const name = meta?.channelName || meta?.channelId || "?";
          return `${t} 🟦 IN  <@${r.user_id}> → **${name}**`;
        }
        if (r.type === "vc_session_end") {
          const name = meta?.channelName || meta?.channelId || "?";
          const dur = meta?.durationMs != null ? `（${msToHuman(meta.durationMs)}）` : "";
          return `${t} 🟦 OUT <@${r.user_id}> ← **${name}** ${dur}`;
        }
        // vc_move_merged
        const route = meta?.route || "?";
        return `${t} 🔁 MOVE <@${r.user_id}> **${route}**`;
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
      const ym = ymTokyo();

      const rows = await db.all(
        `SELECT user_id, total_ms, joins
           FROM vc_stats_month
          WHERE guild_id = ? AND month_key = ?
          ORDER BY total_ms DESC
          LIMIT 10`,
        guildId,
        ym
      );

      if (!rows.length) {
        return await interaction.editReply("今月の集計がまだありません。");
      }

      const lines = rows.map(
        (r, i) =>
          `**${i + 1}.** <@${r.user_id}>  —  ${msToHuman(Number(r.total_ms ?? 0))}（${r.joins ?? 0}回）`
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
      const ym = ymTokyo();

      const m = await db.get(
        `SELECT total_ms, joins
           FROM vc_stats_month
          WHERE guild_id = ? AND user_id = ? AND month_key = ?`,
        guildId,
        user.id,
        ym
      );

      const t = await db.get(
        `SELECT total_ms, joins
           FROM vc_stats_total
          WHERE guild_id = ? AND user_id = ?`,
        guildId,
        user.id
      );

      const thisMonthMs = Number(m?.total_ms ?? 0);
      const thisMonthJoins = Number(m?.joins ?? 0);
      const totalMs = Number(t?.total_ms ?? 0);
      const totalJoins = Number(t?.joins ?? 0);

      const embed = new EmbedBuilder()
        .setTitle(`👤 VC統計：${user.tag}`)
        .setColor(0x3498db)
        .addFields(
          { name: `今月（${ym}）`, value: `${msToHuman(thisMonthMs)} / ${thisMonthJoins}回`, inline: true },
          { name: "累計", value: `${msToHuman(totalMs)} / ${totalJoins}回`, inline: true }
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
