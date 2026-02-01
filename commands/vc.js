import { SlashCommandBuilder, EmbedBuilder } from "discord.js";

const TIMEZONE = "Asia/Tokyo";

function tokyoNowLabel() {
  const hm = new Intl.DateTimeFormat("ja-JP", {
    timeZone: TIMEZONE,
    hour: "numeric",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
  return `今日 ${hm}`;
}

function monthKeyTokyo(date = new Date()) {
  const dtf = new Intl.DateTimeFormat("sv-SE", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
  });
  return dtf.format(date); // YYYY-MM
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

/** 直近イベントを「人間向け文字列」に */
async function formatVcEventLine(guild, e) {
  const label = await resolveUserLabel(guild, e.user_id);
  const ch = e.channel_id ? `<#${e.channel_id}>` : "unknown";
  const when = e.ts ? `<t:${Math.floor(e.ts / 1000)}:R>` : "";
  if (e.type === "vc_in") return `${when} **${label}** joined 🔊 ${ch}`;
  if (e.type === "vc_out") return `${when} **${label}** left 🔇 ${ch}`;
  if (e.type === "vc_move") {
    const from = e.from ? `<#${e.from}>` : "unknown";
    const to = e.to ? `<#${e.to}>` : "unknown";
    return `${when} **${label}** moved ${from} → ${to}`;
  }
  return `${when} ${label} ${e.type}`;
}

async function getUserMonthLive(db, guildId, userId, ym) {
  const range = tokyoMonthRangeUTC(ym);
  if (!range) return null;

  const row = await db.get(
    `SELECT COALESCE(SUM(COALESCE(duration_ms, 0)), 0) AS dur
     FROM log_events
     WHERE guild_id = ?
       AND user_id = ?
       AND ts >= ? AND ts < ?
       AND type IN ('vc_out', 'vc_move')`,
    [guildId, userId, range.start, range.end]
  );

  const row2 = await db.get(
    `SELECT COUNT(*) AS cnt
     FROM log_events
     WHERE guild_id = ?
       AND user_id = ?
       AND ts >= ? AND ts < ?
       AND type IN ('vc_in', 'vc_move')`,
    [guildId, userId, range.start, range.end]
  );

  let durMs = Number(row?.dur || 0);
  const cnt = Number(row2?.cnt || 0);

  const sess = await db.get(
    `SELECT join_ts FROM vc_sessions WHERE guild_id=? AND user_id=?`,
    [guildId, userId]
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
     WHERE guild_id = ?
       AND user_id = ?
       AND type IN ('vc_out', 'vc_move')`,
    [guildId, userId]
  );

  const row2 = await db.get(
    `SELECT COUNT(*) AS cnt
     FROM log_events
     WHERE guild_id = ?
       AND user_id = ?
       AND type IN ('vc_in', 'vc_move')`,
    [guildId, userId]
  );

  let durMs = Number(row?.dur || 0);
  const cnt = Number(row2?.cnt || 0);

  const sess = await db.get(
    `SELECT join_ts FROM vc_sessions WHERE guild_id=? AND user_id=?`,
    [guildId, userId]
  );
  if (sess?.join_ts) {
    durMs += Math.max(0, Date.now() - Number(sess.join_ts));
  }

  return { durMs, cnt };
}

export const data = new SlashCommandBuilder()
  .setName("vc")
  .setDescription("VC統計")
  .addSubcommand((s) => s.setName("top").setDescription("今月のVC滞在時間Topを表示"))
  .addSubcommand((s) =>
    s
      .setName("user")
      .setDescription("指定ユーザーの今月/累計を表示")
      .addUserOption((o) => o.setName("target").setDescription("対象ユーザー").setRequired(true))
  )
  .addSubcommand((s) =>
    s
      .setName("recent")
      .setDescription("最近のVCログ（みなしで入室中も表示）")
      .addIntegerOption((o) =>
        o.setName("limit").setDescription("表示件数(1〜20)").setRequired(false)
      )
  );

export async function execute(interaction, db) {
  if (!db) return interaction.reply({ content: "❌ DBが準備できていません。", ephemeral: true });

  const guild = interaction.guild;
  if (!guild) return interaction.reply({ content: "❌ サーバー内で実行してください。", ephemeral: true });

  const guildId = guild.id;
  const sub = interaction.options.getSubcommand();
  const ym = monthKeyTokyo(new Date());

  // ===== /vc user =====
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

  // ===== /vc top =====
  if (sub === "top") {
    const range = tokyoMonthRangeUTC(ym);
    if (!range) return interaction.reply({ content: "❌ month range error", ephemeral: true });

    const rows = await db.all(
      `SELECT user_id, COALESCE(SUM(COALESCE(duration_ms,0)),0) AS dur
       FROM log_events
       WHERE guild_id = ?
         AND ts >= ? AND ts < ?
         AND type IN ('vc_out','vc_move')
         AND user_id IS NOT NULL AND user_id <> ''
       GROUP BY user_id`,
      [guildId, range.start, range.end]
    );

    const map = new Map();
    for (const r of rows) map.set(String(r.user_id), Number(r.dur || 0));

    const sessRows = await db.all(
      `SELECT user_id, join_ts FROM vc_sessions WHERE guild_id = ?`,
      [guildId]
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
      return interaction.reply({ content: "今月の集計がまだありません。（入室中の人がいれば /vc recent で見れます）" });
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

  // ===== /vc recent（みなし対応） =====
  if (sub === "recent") {
    const limitRaw = interaction.options.getInteger("limit") ?? 10;
    const limit = Math.max(1, Math.min(20, Number(limitRaw || 10)));

    // 直近の VC イベント（vc_in/vc_out/vc_move）
    const rows = await db.all(
      `SELECT type, user_id, ts, meta
       FROM log_events
       WHERE guild_id = ?
         AND type IN ('vc_in','vc_out','vc_move')
       ORDER BY ts DESC
       LIMIT ?`,
      [guildId, limit]
    );

    // meta からチャンネル情報を引っ張る
    const events = (rows || []).map((r) => {
      let meta = {};
      try { meta = r.meta ? JSON.parse(r.meta) : {}; } catch {}
      return {
        type: r.type,
        user_id: String(r.user_id || ""),
        ts: Number(r.ts || 0),
        channel_id: meta.to || meta.from || meta.channel_id || null,
        from: meta.from || null,
        to: meta.to || null,
      };
    });

    // 入室中（vc_sessions）を「みなし recent」として先頭に混ぜる
    const sessRows = await db.all(
      `SELECT user_id, channel_id, join_ts
       FROM vc_sessions
       WHERE guild_id = ?
       ORDER BY join_ts DESC`,
      [guildId]
    );

    const now = Date.now();
    const assumed = (sessRows || []).slice(0, limit).map((s) => ({
      type: "vc_in_assumed",
      user_id: String(s.user_id || ""),
      ts: Number(s.join_ts || 0),
      channel_id: String(s.channel_id || ""),
      from: null,
      to: null,
      assumed: true,
      live_ms: Math.max(0, now - Number(s.join_ts || now)),
    }));

    const lines = [];

    // みなし（入室中）を先に表示
    for (const a of assumed) {
      const label = await resolveUserLabel(guild, a.user_id);
      const ch = a.channel_id ? `<#${a.channel_id}>` : "unknown";
      const when = a.ts ? `<t:${Math.floor(a.ts / 1000)}:R>` : "";
      lines.push(`${when} **${label}** joined 🔊 ${ch} **(みなし/入室中 ${fmtDuration(a.live_ms)})**`);
    }

    // 確定イベント
    for (const e of events) {
      if (!e.user_id) continue;
      lines.push(await formatVcEventLine(guild, e));
    }

    if (!lines.length) {
      return interaction.reply({
        content: "最近のVCログはまだありません。（でも入室中がいれば表示されるはずなので、Bot再起動直後ならもう一度 /vc recent して）",
      });
    }

    const embed = new EmbedBuilder()
      .setTitle(`🕘 最近のVCログ（みなし含む）`)
      .setDescription(lines.slice(0, 25).join("\n"))
      .setFooter({ text: `表示: ${Math.min(lines.length, 25)}件 / ${tokyoNowLabel()}` })
      .setTimestamp(new Date());

    return interaction.reply({ embeds: [embed] });
  }

  return interaction.reply({ content: "❌ unknown subcommand", ephemeral: true });
}
