import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
} from "discord.js";

const TIMEZONE = "Asia/Tokyo";

function isUnknownInteraction(err) {
  return err?.code === 10062 || err?.rawError?.code === 10062;
}

function ymTokyo(date = new Date()) {
  const dtf = new Intl.DateTimeFormat("sv-SE", {
    timeZone: TIMEZONE,
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

function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

export const data = new SlashCommandBuilder()
  .setName("vc")
  .setDescription("VCログ/統計")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((sub) =>
    sub
      .setName("recent")
      .setDescription("直近のVCログを表示（IN/MOVE/OUT）")
      .addIntegerOption((opt) =>
        opt
          .setName("limit")
          .setDescription("表示件数（最大20）")
          .setMinValue(1)
          .setMaxValue(20)
      )
  )
  .addSubcommand((sub) =>
    sub.setName("top").setDescription("今月のVC滞在時間Topを表示（上位10）")
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
  // ✅ まずACK（これで「応答しませんでした」通知が消える）
  try {
    await interaction.deferReply({ ephemeral: true });
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

    // =========================
    // /vc recent
    // =========================
    if (sub === "recent") {
      const limit = interaction.options.getInteger("limit") ?? 10;

      const rows = await db.all(
        `SELECT type, user_id, meta, ts
           FROM log_events
          WHERE guild_id = ?
            AND type IN ('vc_join', 'vc_session_end', 'vc_move_merged')
          ORDER BY ts DESC
          LIMIT ?`,
        guildId,
        limit
      );

      if (!rows.length) {
        return await interaction.editReply(
          "直近ログがありません。\n（Bot起動後に誰かがVCに入って→出ると貯まります）"
        );
      }

      const lines = rows.map((r) => {
        const t = `<t:${Math.floor(r.ts / 1000)}:R>`;
        const meta = safeJsonParse(r.meta) || {};
        const u = r.user_id ? `<@${r.user_id}>` : "(unknown user)";

        if (r.type === "vc_join") {
          const name = meta.channelName || (meta.channelId ? `#${meta.channelId}` : "?");
          return `${t} 🟦 IN  ${u} → **${name}**`;
        }

        if (r.type === "vc_session_end") {
          const name = meta.channelName || (meta.channelId ? `#${meta.channelId}` : "?");
          const dur = meta.durationMs != null ? `（${msToHuman(meta.durationMs)}）` : "";
          return `${t} 🟦 OUT ${u} ← **${name}** ${dur}`;
        }

        const route = meta.route || "?";
        return `${t} 🔁 MOVE ${u} **${route}**`;
      });

      const embed = new EmbedBuilder()
        .setTitle(`📜 VCログ（直近${rows.length}件）`)
        .setColor(0x3498db)
        .setDescription(lines.join("\n"))
        .setTimestamp(new Date());

      return await interaction.editReply({ embeds: [embed] });
    }

    // =========================
    // /vc top
    // =========================
    if (sub === "top") {
      const monthKey = ymTokyo();

      const rows = await db.all(
        `SELECT user_id, joins, total_ms
           FROM vc_stats_month
          WHERE guild_id = ? AND month_key = ?
          ORDER BY total_ms DESC
          LIMIT 10`,
        guildId,
        monthKey
      );

      if (!rows.length) {
        return await interaction.editReply("今月の集計がまだありません。（VC入退室後に貯まります）");
      }

      const lines = rows.map((r, i) => {
        const dur = msToHuman(Number(r.total_ms ?? 0));
        const joins = Number(r.joins ?? 0);
        return `**${i + 1}.** <@${r.user_id}>  —  ${dur}（${joins}回）`;
      });

      const embed = new EmbedBuilder()
        .setTitle(`🏆 VC滞在時間 Top10（${monthKey}）`)
        .setColor(0x3498db)
        .setDescription(lines.join("\n"))
        .setTimestamp(new Date());

      return await interaction.editReply({ embeds: [embed] });
    }

    // =========================
    // /vc user
    // =========================
    if (sub === "user") {
      const user = interaction.options.getUser("target", true);
      const monthKey = ymTokyo();

      const m = await db.get(
        `SELECT joins, total_ms
           FROM vc_stats_month
          WHERE guild_id = ? AND month_key = ? AND user_id = ?`,
        guildId,
        monthKey,
        user.id
      );

      const t = await db.get(
        `SELECT joins, total_ms
           FROM vc_stats_total
          WHERE guild_id = ? AND user_id = ?`,
        guildId,
        user.id
      );

      const mJoins = Number(m?.joins ?? 0);
      const mMs = Number(m?.total_ms ?? 0);
      const tJoins = Number(t?.joins ?? 0);
      const tMs = Number(t?.total_ms ?? 0);

      const embed = new EmbedBuilder()
        .setTitle(`👤 VC統計：${user.tag}`)
        .setColor(0x3498db)
        .addFields(
          { name: `今月(${monthKey}) 滞在`, value: msToHuman(mMs), inline: true },
          { name: `今月(${monthKey}) 回数`, value: `${mJoins}回`, inline: true },
          { name: "累計 滞在", value: msToHuman(tMs), inline: true },
          { name: "累計 回数", value: `${tJoins}回`, inline: true }
        )
        .setTimestamp(new Date());

      return await interaction.editReply({ embeds: [embed] });
    }

    return await interaction.editReply("不明なサブコマンドです。");
  } catch (e) {
    if (isUnknownInteraction(e)) return;
    console.error("vc error:", e);

    // ✅ ここも事故りにくくする
    try {
      await interaction.editReply(`エラー: ${e?.message ?? e}`);
    } catch {
      // editReplyすら無理なら諦め（ここでthrowするとログだけ増える）
    }
  }
}
