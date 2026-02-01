import { SlashCommandBuilder, EmbedBuilder, ChannelType } from "discord.js";

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

/* =========================
   Get log parent channel
   - 1) settings.log_channel_id (if db alive)
   - 2) env LOG_CHANNEL_ID
   - 3) search guild channels that have VC threads
========================= */

async function getLogChannelIdFromDb(db, guildId) {
  if (!db) return null;
  try {
    const row = await db.get(
      `SELECT log_channel_id FROM settings WHERE guild_id = ?`,
      guildId
    );
    const id = row?.log_channel_id ? String(row.log_channel_id) : "";
    return id || null;
  } catch {
    return null;
  }
}

function isVcThreadName(name = "") {
  // VC IN 2026-02-02 / VC OUT 2026-02-02 / VC MOVE 2026-02-02 など
  const n = String(name || "");
  return /^VC (IN|OUT|MOVE)\s+\d{4}-\d{2}-\d{2}/.test(n) || n.startsWith("VC ");
}

async function tryFindParentWithVcThreads(guild) {
  // 乱暴に全チャンネルから「VC系スレッドがあるやつ」を探す保険
  const chans = await guild.channels.fetch().catch(() => null);
  const list = chans ? Array.from(chans.values()) : Array.from(guild.channels.cache.values());

  for (const ch of list) {
    if (!ch) continue;

    // Forum
    if (ch.type === ChannelType.GuildForum) {
      try {
        const active = await ch.threads.fetchActive();
        const hit = active?.threads?.some((t) => isVcThreadName(t.name));
        if (hit) return ch;

        const archived = await ch.threads.fetchArchived({ type: "public", limit: 50 });
        const hit2 = archived?.threads?.some((t) => isVcThreadName(t.name));
        if (hit2) return ch;
      } catch {}
    }

    // Text + threads
    if (ch.threads?.fetchActive) {
      try {
        const active = await ch.threads.fetchActive();
        const hit = active?.threads?.some((t) => isVcThreadName(t.name));
        if (hit) return ch;

        const archived = await ch.threads.fetchArchived({ type: "public", limit: 50 });
        const hit2 = archived?.threads?.some((t) => isVcThreadName(t.name));
        if (hit2) return ch;
      } catch {}
    }
  }

  return null;
}

async function getLogParentChannel(guild, db) {
  // 1) DB settings
  const fromDb = await getLogChannelIdFromDb(db, guild.id);
  if (fromDb) {
    const ch =
      guild.channels.cache.get(fromDb) ||
      (await guild.channels.fetch(fromDb).catch(() => null));
    if (ch) return ch;
  }

  // 2) env
  const fromEnv = (process.env.LOG_CHANNEL_ID || "").trim();
  if (fromEnv) {
    const ch =
      guild.channels.cache.get(fromEnv) ||
      (await guild.channels.fetch(fromEnv).catch(() => null));
    if (ch) return ch;
  }

  // 3) fallback search
  return await tryFindParentWithVcThreads(guild);
}

/* =========================
   Gather VC logs from threads
========================= */

async function fetchVcThreads(parent) {
  const out = [];

  // Forum
  if (parent.type === ChannelType.GuildForum) {
    try {
      const active = await parent.threads.fetchActive();
      for (const t of active.threads.values()) if (isVcThreadName(t.name)) out.push(t);
    } catch {}

    try {
      const archived = await parent.threads.fetchArchived({ type: "public", limit: 100 });
      for (const t of archived.threads.values()) if (isVcThreadName(t.name)) out.push(t);
    } catch {}

    // cache fallback
    try {
      for (const t of parent.threads.cache.values()) if (isVcThreadName(t.name)) out.push(t);
    } catch {}

    return uniqThreads(out);
  }

  // Text thread
  if (parent.threads?.fetchActive) {
    try {
      const active = await parent.threads.fetchActive();
      for (const t of active.threads.values()) if (isVcThreadName(t.name)) out.push(t);
    } catch {}

    try {
      const archived = await parent.threads.fetchArchived({ type: "public", limit: 100 });
      for (const t of archived.threads.values()) if (isVcThreadName(t.name)) out.push(t);
    } catch {}

    try {
      for (const t of parent.threads.cache.values()) if (isVcThreadName(t.name)) out.push(t);
    } catch {}

    return uniqThreads(out);
  }

  return [];
}

function uniqThreads(arr) {
  const m = new Map();
  for (const t of arr) {
    if (!t?.id) continue;
    if (!m.has(t.id)) m.set(t.id, t);
  }
  return Array.from(m.values());
}

function isUsefulVcMessage(msg) {
  // thread の最初の「ログ開始」は除外
  const content = (msg.content || "").trim();
  if (content.startsWith("ログ開始:")) return false;

  const emb = msg.embeds?.[0];
  const desc = emb?.description || "";
  const title = emb?.title || "";

  // embedならだいたいVCログ
  if (desc.includes("voice channel") || title.startsWith("VC ")) return true;

  // plain textログの場合の保険
  if (content.includes("joined voice channel") || content.includes("left voice channel")) return true;

  return false;
}

function messageToLine(thread, msg) {
  const ts = msg.createdTimestamp ? Math.floor(msg.createdTimestamp / 1000) : null;
  const when = ts ? `<t:${ts}:R>` : "";

  const emb = msg.embeds?.[0];
  const text = (emb?.description || msg.content || "").replace(/\s+/g, " ").trim();

  // thread名も添える（どの日のログか分かる）
  const th = thread?.name ? `【${thread.name}】` : "";
  return `${when} ${th} ${text}`.trim();
}

async function getRecentFromThreads(guild, parent, limit) {
  const threads = await fetchVcThreads(parent);

  // 新しいスレから見ていく（createdTimestamp優先、なければid）
  threads.sort((a, b) => (b.createdTimestamp || 0) - (a.createdTimestamp || 0));

  const lines = [];
  for (const th of threads) {
    if (lines.length >= limit) break;

    // スレ内の最新メッセージを取る
    const msgs = await th.messages.fetch({ limit: Math.min(50, limit + 10) }).catch(() => null);
    if (!msgs) continue;

    const arr = Array.from(msgs.values())
      .filter(isUsefulVcMessage)
      // 新しい順に並んでるので、後で全体ソートする
      .slice(0, 50);

    for (const m of arr) lines.push({ th, m });
  }

  // 全体を「時刻の新しい順」
  lines.sort((a, b) => (b.m.createdTimestamp || 0) - (a.m.createdTimestamp || 0));

  const out = [];
  for (const x of lines) {
    out.push(messageToLine(x.th, x.m));
    if (out.length >= limit) break;
  }

  // それでも空なら「権限不足 or ログが無い」
  return out;
}

/* =========================
   Slash command
========================= */

export const data = new SlashCommandBuilder()
  .setName("vc")
  .setDescription("VC統計")
  .addSubcommand((s) => s.setName("top").setDescription("今月のVC滞在時間Topを表示（DB方式）"))
  .addSubcommand((s) =>
    s
      .setName("user")
      .setDescription("指定ユーザーの今月/累計を表示（DB方式）")
      .addUserOption((o) => o.setName("target").setDescription("対象ユーザー").setRequired(true))
  )
  .addSubcommand((s) =>
    s
      .setName("recent")
      .setDescription("最近のVCログ（ログスレッドから復元 / Disk不要）")
      .addIntegerOption((o) =>
        o.setName("limit").setDescription("表示件数(1〜20)").setRequired(false)
      )
  );

export async function execute(interaction, db) {
  const guild = interaction.guild;
  if (!guild) return interaction.reply({ content: "❌ サーバー内で実行してください。", ephemeral: true });

  const sub = interaction.options.getSubcommand();

  // ✅ ここが目的：/vc recent は DB不要で動かす
  if (sub === "recent") {
    const limitRaw = interaction.options.getInteger("limit") ?? 10;
    const limit = Math.max(1, Math.min(20, Number(limitRaw || 10)));

    const parent = await getLogParentChannel(guild, db);
    if (!parent) {
      return interaction.reply({
        content:
          "❌ ログチャンネルが見つかりません。\n" +
          "対策: ① /setlog でログチャンネルを設定 ② もしくは環境変数 LOG_CHANNEL_ID を設定",
        ephemeral: true,
      });
    }

    const lines = await getRecentFromThreads(guild, parent, limit);

    if (!lines.length) {
      return interaction.reply({
        content:
          "最近のVCログは見つかりませんでした。\n" +
          "・ログスレッドがまだ無い / まだ投稿が無い\n" +
          "・Botに「スレッドの閲覧」「メッセージ履歴を読む」権限が無い\n" +
          "のどれかです。",
      });
    }

    const embed = new EmbedBuilder()
      .setTitle("🕘 最近のVCログ（スレッド復元）")
      .setDescription(lines.join("\n").slice(0, 3900))
      .setFooter({ text: `limit=${limit} / ${tokyoNowLabel()}` })
      .setTimestamp(new Date());

    return interaction.reply({ embeds: [embed] });
  }

  // ここから下（top/user）はDB前提（Diskなしだと毎回0になる）
  if (!db) {
    return interaction.reply({
      content: "❌ DBが準備できていません。（Diskなしだと top/user は毎回リセットされます。/vc recent を使ってください）",
      ephemeral: true,
    });
  }

  // /vc user (DB方式) は必要なら以前の実装を維持してOK。
  // ここは最低限のメッセージにしておく。
  if (sub === "user") {
    const target = interaction.options.getUser("target", true);
    const label = await resolveUserLabel(guild, target.id);
    return interaction.reply({
      content: `（DB方式）/vc user は Diskなしだと集計が保持できません。\n今は /vc recent を使ってください。\n対象: ${label}`,
      ephemeral: true,
    });
  }

  if (sub === "top") {
    return interaction.reply({
      content: "（DB方式）/vc top は Diskなしだと集計が保持できません。\n今は /vc recent を使ってください。",
      ephemeral: true,
    });
  }

  return interaction.reply({ content: "❌ unknown subcommand", ephemeral: true });
}

// 例: /setlog で log_channel_id を更新した後
const who = interaction.user?.tag || interaction.user?.id;
const when = tokyoNowLabel(); // 既にある関数を使えるなら使う
const before = oldLogChannelId ? `<#${oldLogChannelId}>` : "未設定";
const after = newLogChannelId ? `<#${newLogChannelId}>` : "未設定";

await sendToKindThread(interaction.guild, "settings", {
  content: `🛠️ ${when} /setlog by ${who}\n${before} → ${after}`,
});
