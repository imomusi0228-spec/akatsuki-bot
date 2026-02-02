import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from "discord.js";

const TIMEZONE = "Asia/Tokyo";

function monthKeyTokyo(date = new Date()) {
  const dtf = new Intl.DateTimeFormat("ja-JP", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
  });
  // ja-JPのformatter: "2024/02" or "2024年02月" depending on impl
  // sv-SEの方が安全に YYYY-MM が取れるが、ユーザー要望コードに合わせつつ修正
  // ここでは sv-SE を使う方が安全
  const dtf2 = new Intl.DateTimeFormat("sv-SE", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
  });
  return dtf2.format(date); // YYYY-MM
}

function tokyoMonthRangeUTC(monthStr) {
  const [y, m] = monthStr.split("-").map((x) => Number(x));
  if (!y || !m) return null;
  const start = Date.UTC(y, m - 1, 1, -9, 0, 0, 0);
  const end = Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1, -9, 0, 0, 0);
  return { start, end };
}

function fmtDuration(ms) {
  ms = Math.max(0, Number(ms || 0));
  const sec = Math.floor(ms / 1000);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}時間${m}分${s}秒`;
  if (m > 0) return `${m}分${s}秒`;
  return `${s}秒`;
}

function overlapMs(aStart, aEnd, bStart, bEnd) {
  const s = Math.max(aStart, bStart);
  const e = Math.min(aEnd, bEnd);
  return Math.max(0, e - s);
}

async function resolveUserLabel(guild, userId) {
  const id = String(userId || "");
  if (!id) return "unknown";

  const mem =
    guild.members.cache.get(id) ||
    (await guild.members.fetch(id).catch(() => null));

  if (mem) {
    const display = mem.displayName;
    const username = mem.user?.username || id;
    return `${display} (@${username})`;
  }

  const u =
    guild.client.users.cache.get(id) ||
    (await guild.client.users.fetch(id).catch(() => null));

  if (u) return `${u.username} (@${u.username})`;
  return id;
}

async function getUserMonthLive(db, guildId, userId, ym) {
  const range = tokyoMonthRangeUTC(ym);
  if (!range) return null;

  // 確定滞在：vc_out / vc_move の duration_ms を合算
  const row = await db.get(
    `SELECT COALESCE(SUM(COALESCE(duration_ms, 0)), 0) AS dur
       FROM log_events
      WHERE guild_id = $1
        AND user_id = $2
        AND ts >= $3 AND ts < $4
        AND type IN ('vc_out', 'vc_move')`,
    guildId,
    userId,
    range.start,
    range.end
  );

  // 回数：vc_in / vc_move を数える（入室ベース）
  const row2 = await db.get(
    `SELECT COUNT(*) AS cnt
       FROM log_events
      WHERE guild_id = $1
        AND user_id = $2
        AND ts >= $3 AND ts < $4
        AND type IN ('vc_in', 'vc_move')`,
    guildId,
    userId,
    range.start,
    range.end
  );

  let durMs = Number(row?.dur || 0);
  const cnt = Number(row2?.cnt || 0);

  // 入室中セッションがある場合、今この瞬間までを加算（今月分だけ）
  const sess = await db.get(
    `SELECT join_ts FROM vc_sessions WHERE guild_id=$1 AND user_id=$2`,
    guildId,
    userId
  );
  if (sess?.join_ts) {
    const now = Date.now();
    durMs += overlapMs(Number(sess.join_ts), now, range.start, range.end);
  }

  return { durMs, cnt };
}

async function getUserTotal(db, guildId, userId) {
  const row = await db.get(
    `SELECT COALESCE(SUM(COALESCE(duration_ms, 0)), 0) AS dur
       FROM log_events
      WHERE guild_id = $1
        AND user_id = $2
        AND type IN ('vc_out','vc_move')`,
    guildId,
    userId
  );

  const row2 = await db.get(
    `SELECT COUNT(*) AS cnt
       FROM log_events
      WHERE guild_id = $1
        AND user_id = $2
        AND type IN ('vc_in','vc_move')`,
    guildId,
    userId
  );

  let durMs = Number(row?.dur || 0);
  const cnt = Number(row2?.cnt || 0);

  // 入室中は累計にも加算
  const sess = await db.get(
    `SELECT join_ts FROM vc_sessions WHERE guild_id=$1 AND user_id=$2`,
    guildId,
    userId
  );
  if (sess?.join_ts) {
    durMs += Math.max(0, Date.now() - Number(sess.join_ts));
  }

  return { durMs, cnt };
}

export const data = new SlashCommandBuilder()
  .setName("vc")
  .setDescription("VC統計")
  .addSubcommand((s) =>
    s.setName("top").setDescription("今月のVC滞在時間Topを表示")
  )
  .addSubcommand((s) =>
    s
      .setName("user")
      .setDescription("指定ユーザーの今月/累計を表示")
      .addUserOption((o) =>
        o.setName("target").setDescription("対象ユーザー").setRequired(true)
      )
  );

export async function execute(interaction, db) {
  if (!db) {
    return interaction.reply({ content: "❌ DBが準備できていません。", flags: MessageFlags.Ephemeral });
  }

  const guild = interaction.guild;
  if (!guild) {
    return interaction.reply({ content: "❌ サーバー内で実行してください。", flags: MessageFlags.Ephemeral });
  }

  const sub = interaction.options.getSubcommand();
  const guildId = guild.id;
  const ym = monthKeyTokyo(new Date());

  if (sub === "user") {
    const target = interaction.options.getUser("target", true);
    const uid = target.id;

    const month = await getUserMonthLive(db, guildId, uid, ym);
    const total = await getUserTotal(db, guildId, uid);
    const label = await resolveUserLabel(guild, uid);

    const embed = new EmbedBuilder()
      .setTitle(`👤 VC統計：${label}`)
      .setDescription(
        `**今月(${ym})**\n滞在 **${fmtDuration(month?.durMs || 0)}**　回数 **${month?.cnt || 0}回**\n\n` +
        `**累計**\n滞在 **${fmtDuration(total?.durMs || 0)}**　回数 **${total?.cnt || 0}回**`
      )
      .setTimestamp(new Date());

    return interaction.reply({ embeds: [embed] });
  }

  if (sub === "top") {
    const range = tokyoMonthRangeUTC(ym);
    if (!range) return interaction.reply({ content: "❌ month range error", flags: MessageFlags.Ephemeral });

    // 確定滞在（vc_out/vc_move）を集計
    const rows = await db.all(
      `SELECT user_id, COALESCE(SUM(COALESCE(duration_ms,0)),0) AS dur
         FROM log_events
        WHERE guild_id = $1
          AND ts >= $2 AND ts < $3
          AND type IN ('vc_out','vc_move')
          AND user_id IS NOT NULL AND user_id <> ''
        GROUP BY user_id`,
      guildId,
      range.start,
      range.end
    );

    const map = new Map();
    for (const r of rows) map.set(String(r.user_id), Number(r.dur || 0));

    // 入室中セッションを今月分だけ加算
    const sessRows = await db.all(
      `SELECT user_id, join_ts FROM vc_sessions WHERE guild_id = $1`,
      guildId
    );
    const now = Date.now();
    for (const s of sessRows || []) {
      const uid = String(s.user_id || "");
      if (!uid) continue;
      const extra = overlapMs(Number(s.join_ts), now, range.start, range.end);
      map.set(uid, (map.get(uid) || 0) + extra);
    }

    const list = Array.from(map.entries())
      .map(([user_id, durMs]) => ({ user_id, durMs }))
      .sort((a, b) => b.durMs - a.durMs)
      .slice(0, 10);

    if (!list.length) {
      return interaction.reply({ content: "今月の集計がまだありません。（VC入退室後に貯まります）" });
    }

    const lines = [];
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      const label = await resolveUserLabel(guild, it.user_id);
      lines.push(`**${i + 1}.** ${label} — **${fmtDuration(it.durMs)}**`);
    }

    const embed = new EmbedBuilder()
      .setTitle(`🏆 今月(${ym}) VC滞在時間 Top`)
      .setDescription(lines.join("\n"))
      .setTimestamp(new Date());

    return interaction.reply({ embeds: [embed] });
  }

  return interaction.reply({ content: "❌ unknown subcommand", flags: MessageFlags.Ephemeral });
}
