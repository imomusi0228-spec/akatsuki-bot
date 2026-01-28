import { SlashCommandBuilder, EmbedBuilder } from "discord.js";

function msToHuman(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}時間${m}分`;
  return `${m}分`;
}

function monthKeyTokyo() {
  const dtf = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
  });
  return dtf.format(new Date()); // YYYY-MM
}

export const data = new SlashCommandBuilder()
  .setName("vc")
  .setDescription("VCログ/統計")
  .addSubcommand((sc) =>
    sc
      .setName("recent")
      .setDescription("直近のVCログ(参加/退出/移動)を表示")
      .addIntegerOption((o) =>
        o
          .setName("limit")
          .setDescription("表示件数(最大20)")
          .setMinValue(1)
          .setMaxValue(20)
      )
  )
  .addSubcommand((sc) =>
    sc
      .setName("top")
      .setDescription("今月のVC滞在時間Topを表示")
      .addIntegerOption((o) =>
        o
          .setName("limit")
          .setDescription("表示人数(最大20)")
          .setMinValue(1)
          .setMaxValue(20)
      )
  )
  .addSubcommand((sc) =>
    sc
      .setName("user")
      .setDescription("指定ユーザーの今月/累計を表示")
      .addUserOption((o) =>
        o.setName("target").setDescription("対象ユーザー").setRequired(true)
      )
  );

export async function execute(interaction, db) {
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guildId;

  await interaction.deferReply({ ephemeral: true });

  if (sub === "recent") {
    const limit = interaction.options.getInteger("limit") ?? 10;

    const rows = await db.all(
      `SELECT type, user_id, meta, ts
       FROM log_events
       WHERE guild_id = ?
         AND type IN ('vc_join','vc_move','vc_session_end')
       ORDER BY ts DESC
       LIMIT ?`,
      guildId,
      limit
    );

    const lines = rows.map((r) => {
      const dt = new Date(Number(r.ts));
      const time = dt.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
      let meta = {};
      try {
        meta = r.meta ? JSON.parse(r.meta) : {};
      } catch {}
      const u = r.user_id ? `<@${r.user_id}>` : "(unknown)";

      if (r.type === "vc_join") {
        const ch = meta.channelName ? meta.channelName : meta.channelId ?? "?";
        return `🟦 **IN** ${u}  ch:${ch}  (${time})`;
      }
      if (r.type === "vc_move") {
        const from = meta.fromName ?? meta.from ?? "?";
        const to = meta.toName ?? meta.to ?? "?";
        return `🟨 **MOVE** ${u}  ${from} → ${to}  (${time})`;
      }
      const dur = meta.durationMs ? msToHuman(meta.durationMs) : "?";
      const ch = meta.channelName ? meta.channelName : meta.channelId ?? "?";
      return `🟥 **OUT** ${u}  ${dur}  ch:${ch}  (${time})`;
    });

    const embed = new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle("🔊 VC 直近ログ")
      .setDescription(lines.join("\n") || "（ログがありません）")
      .setFooter({ text: "時刻は Asia/Tokyo" });

    return interaction.editReply({ embeds: [embed] });
  }

  if (sub === "top") {
    const limit = interaction.options.getInteger("limit") ?? 10;
    const month = monthKeyTokyo();

    const rows = await db.all(
      `SELECT user_id, joins, total_ms
       FROM vc_stats_month
       WHERE guild_id = ? AND month_key = ?
       ORDER BY total_ms DESC
       LIMIT ?`,
      guildId,
      month,
      limit
    );

    const lines = rows.map((r, i) => {
      const u = r.user_id ? `<@${r.user_id}>` : "(unknown)";
      return `**${i + 1}.** ${u}  |  ${r.joins}回  |  ${msToHuman(
        Number(r.total_ms || 0)
      )}`;
    });

    const embed = new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle(`📊 VC 今月Top（${month}）`)
      .setDescription(lines.join("\n") || "（今月のデータがまだありません）")
      .setFooter({ text: "退出時に統計へ反映されます（INだけだと反映されません）" });

    return interaction.editReply({ embeds: [embed] });
  }

  if (sub === "user") {
    const target = interaction.options.getUser("target", true);
    const month = monthKeyTokyo();

    const monthRow = await db.get(
      `SELECT joins, total_ms
       FROM vc_stats_month
       WHERE guild_id = ? AND month_key = ? AND user_id = ?`,
      guildId,
      month,
      target.id
    );

    const totalRow = await db.get(
      `SELECT joins, total_ms
       FROM vc_stats_total
       WHERE guild_id = ? AND user_id = ?`,
      guildId,
      target.id
    );

    const mJoins = Number(monthRow?.joins ?? 0);
    const mMs = Number(monthRow?.total_ms ?? 0);
    const tJoins = Number(totalRow?.joins ?? 0);
    const tMs = Number(totalRow?.total_ms ?? 0);

    const embed = new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle(`👤 VC個人統計`)
      .setDescription(`${target}（${target.tag}）`)
      .addFields(
        { name: `今月（${month}）参加回数`, value: `${mJoins}回`, inline: true },
        { name: `今月（${month}）合計`, value: msToHuman(mMs), inline: true },
        { name: `累計 参加回数`, value: `${tJoins}回`, inline: true },
        { name: `累計 合計`, value: msToHuman(tMs), inline: true }
      );

    return interaction.editReply({ embeds: [embed] });
  }

  return interaction.editReply("未知のサブコマンドです");
}
