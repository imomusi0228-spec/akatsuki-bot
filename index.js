import http from "node:http";
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  Client,
  Collection,
  GatewayIntentBits,
  EmbedBuilder,
  PermissionsBitField,
} from "discord.js";

import sqlite3 from "sqlite3";
import { open } from "sqlite";

/* =========================
   設定（必要ならここだけ変える）
========================= */
const DEFAULT_NG_THRESHOLD = Number(process.env.NG_THRESHOLD || 3);
const DEFAULT_TIMEOUT_MIN = Number(process.env.NG_TIMEOUT_MIN || 10);
const TIMEZONE = "Asia/Tokyo";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || ""; // 管理画面の鍵

/* =========================
   Renderのポートスキャン対策 + 管理画面
========================= */
const PORT = Number(process.env.PORT || 3000);
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const pathname = url.pathname;

    // ---- 管理画面（HTML）----
    if (pathname === "/admin") {
      // ざっくり認証：?token= で一致したらOK
      const t = url.searchParams.get("token") || "";
      if (!ADMIN_TOKEN || t !== ADMIN_TOKEN) {
        res.writeHead(401, { "Content-Type": "text/plain; charset=utf-8" });
        return res.end("401 Unauthorized");
      }

      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(renderAdminHTML());
    }

    // ---- API（JSON）----
    if (pathname.startsWith("/api/")) {
      const t = url.searchParams.get("token") || "";
      if (!ADMIN_TOKEN || t !== ADMIN_TOKEN) {
        res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
        return res.end(JSON.stringify({ ok: false, error: "unauthorized" }));
      }

      // /api/health
      if (pathname === "/api/health") {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        return res.end(JSON.stringify({ ok: true }));
      }

      // /api/ngwords?guild=GUILD_ID
      if (pathname === "/api/ngwords") {
        const guildId = url.searchParams.get("guild") || "";
        if (!guildId) return json(res, { ok: false, error: "missing guild" }, 400);
        const words = await getNgWords(guildId);
        return json(res, { ok: true, guildId, count: words.length, words });
      }

      // /api/settings?guild=GUILD_ID
      if (pathname === "/api/settings") {
        const guildId = url.searchParams.get("guild") || "";
        if (!guildId) return json(res, { ok: false, error: "missing guild" }, 400);
        const s = await getSettings(guildId);
        return json(res, { ok: true, guildId, settings: s });
      }

      // /api/guilds (Botが入ってるGuild一覧)
      if (pathname === "/api/guilds") {
        const list = client?.guilds?.cache?.map((g) => ({ id: g.id, name: g.name })) ?? [];
        return json(res, { ok: true, guilds: list });
      }

      // /api/stats?guild=GUILD_ID&month=YYYY-MM
      if (pathname === "/api/stats") {
        const guildId = url.searchParams.get("guild") || "";
        const month = url.searchParams.get("month") || ""; // 例: 2026-01
        if (!guildId) return json(res, { ok: false, error: "missing guild" }, 400);
        if (!month) return json(res, { ok: false, error: "missing month" }, 400);

        const stats = await getMonthlyStats(guildId, month);
        return json(res, { ok: true, guildId, month, stats });
      }

      return json(res, { ok: false, error: "not found" }, 404);
    }

    // ---- 通常応答（Renderの生存チェック用）----
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("OK");
  } catch (e) {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("500");
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`🌐 Listening on ${PORT}`);
});

/* =========================
   Discord / DB 初期化
========================= */
const token = process.env.DISCORD_TOKEN;
if (!token) console.error("❌ DISCORD_TOKEN が未設定です (.env / Render Env Vars)");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let db;
try {
  db = await open({
    filename: path.join(__dirname, "data.db"),
    driver: sqlite3.Database,
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      guild_id TEXT PRIMARY KEY,
      log_channel_id TEXT,
      ng_threshold INTEGER DEFAULT ${DEFAULT_NG_THRESHOLD},
      timeout_minutes INTEGER DEFAULT ${DEFAULT_TIMEOUT_MIN}
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS ng_words (
      guild_id TEXT,
      word TEXT,
      PRIMARY KEY (guild_id, word)
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS ng_hits (
      guild_id TEXT,
      user_id TEXT,
      count INTEGER DEFAULT 0,
      updated_at INTEGER,
      PRIMARY KEY (guild_id, user_id)
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS log_threads (
      guild_id TEXT,
      date_key TEXT,
      thread_id TEXT,
      PRIMARY KEY (guild_id, date_key)
    );
  `);

  // ★月次集計のためのイベントログ
  await db.exec(`
    CREATE TABLE IF NOT EXISTS log_events (
      guild_id TEXT,
      type TEXT,
      user_id TEXT,
      meta TEXT,
      ts INTEGER
    );
  `);

  // よく使う検索のためのIndex（任意）
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_log_events_guild_ts ON log_events (guild_id, ts);`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_log_events_guild_type_ts ON log_events (guild_id, type, ts);`);
} catch (e) {
  console.error("❌ DB init failed:", e?.message ?? e);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.commands = new Collection();

async function importFile(filePath) {
  return import(pathToFileURL(filePath).href);
}

/* =========================
   コマンド読み込み
========================= */
try {
  const commandsPath = path.join(__dirname, "commands");
  if (fs.existsSync(commandsPath)) {
    const files = fs.readdirSync(commandsPath).filter((f) => f.endsWith(".js"));
    for (const file of files) {
      const filePath = path.join(commandsPath, file);
      const mod = await importFile(filePath);
      if (mod?.data?.name && typeof mod.execute === "function") {
        client.commands.set(mod.data.name, mod);
      }
    }
  }
} catch (e) {
  console.error("❌ Command load failed:", e?.message ?? e);
}

/* =========================
   Utils
========================= */
function isUnknownInteraction(err) {
  return err?.code === 10062 || err?.rawError?.code === 10062;
}
function normalize(s) {
  return (s ?? "").toLowerCase();
}
function todayKeyTokyo() {
  const dtf = new Intl.DateTimeFormat("sv-SE", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return dtf.format(new Date()); // YYYY-MM-DD
}
function tokyoMonthRangeUTC(monthStr) {
  // monthStr: "YYYY-MM"
  const [y, m] = monthStr.split("-").map((x) => Number(x));
  if (!y || !m) return null;

  // Tokyo は UTC+9（DSTなし）なので、Tokyo 00:00 は UTC前日の15:00
  const start = Date.UTC(y, m - 1, 1, -9, 0, 0, 0);
  const end = Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1, -9, 0, 0, 0);
  return { start, end };
}

async function getSettings(guildId) {
  if (!db) {
    return { log_channel_id: null, ng_threshold: DEFAULT_NG_THRESHOLD, timeout_minutes: DEFAULT_TIMEOUT_MIN };
  }
  await db.run(
    `INSERT INTO settings (guild_id, log_channel_id, ng_threshold, timeout_minutes)
     VALUES (?, NULL, ?, ?)
     ON CONFLICT(guild_id) DO NOTHING`,
    guildId,
    DEFAULT_NG_THRESHOLD,
    DEFAULT_TIMEOUT_MIN
  );

  const row = await db.get(
    "SELECT log_channel_id, ng_threshold, timeout_minutes FROM settings WHERE guild_id = ?",
    guildId
  );

  return {
    log_channel_id: row?.log_channel_id ?? null,
    ng_threshold: Number(row?.ng_threshold ?? DEFAULT_NG_THRESHOLD),
    timeout_minutes: Number(row?.timeout_minutes ?? DEFAULT_TIMEOUT_MIN),
  };
}

async function getNgWords(guildId) {
  if (!db) return [];
  const rows = await db.all("SELECT word FROM ng_words WHERE guild_id = ?", guildId);
  return rows.map((r) => (r.word ?? "").trim()).filter(Boolean);
}

async function logEvent(guildId, type, userId = null, metaObj = null) {
  try {
    if (!db) return;
    const meta = metaObj ? JSON.stringify(metaObj) : null;
    await db.run(
      "INSERT INTO log_events (guild_id, type, user_id, meta, ts) VALUES (?, ?, ?, ?, ?)",
      guildId,
      type,
      userId,
      meta,
      Date.now()
    );
  } catch {}
}

/* =========================
   日付スレッド作成/取得
========================= */
async function getDailyLogThread(channel, guildId) {
  try {
    const dateKey = todayKeyTokyo();

    const row = await db.get(
      "SELECT thread_id FROM log_threads WHERE guild_id = ? AND date_key = ?",
      guildId,
      dateKey
    );
    if (row?.thread_id) {
      const existing = await channel.threads.fetch(row.thread_id).catch(() => null);
      if (existing) return existing;
      await db.run("DELETE FROM log_threads WHERE guild_id = ? AND date_key = ?", guildId, dateKey);
    }

    if (!channel?.threads?.create) return null;

    const thread = await channel.threads.create({
      name: `logs-${dateKey}`,
      autoArchiveDuration: 1440,
      reason: "Daily log thread",
    });

    await db.run(
      "INSERT OR REPLACE INTO log_threads (guild_id, date_key, thread_id) VALUES (?, ?, ?)",
      guildId,
      dateKey,
      thread.id
    );

    return thread;
  } catch {
    return null;
  }
}

/* =========================
   管理ログ送信 helper（スレッド優先）
========================= */
async function sendLog(guild, payload) {
  try {
    if (!guild || !db) return;

    const settings = await getSettings(guild.id);
    if (!settings.log_channel_id) return;

    const ch = await guild.channels.fetch(settings.log_channel_id).catch(() => null);
    if (!ch) return;

    const thread = await getDailyLogThread(ch, guild.id);
    const target = thread ?? ch;

    await target.send(payload).catch(() => null);
  } catch (e) {
    console.error("❌ sendLog error:", e?.message ?? e);
  }
}

/* =========================
   月次統計
========================= */
async function getMonthlyStats(guildId, monthStr) {
  if (!db) return null;
  const range = tokyoMonthRangeUTC(monthStr);
  if (!range) return null;

  const { start, end } = range;

  const byTypeRows = await db.all(
    `SELECT type, COUNT(*) as cnt
     FROM log_events
     WHERE guild_id = ? AND ts >= ? AND ts < ?
     GROUP BY type
     ORDER BY cnt DESC`,
    guildId,
    start,
    end
  );

  const byType = Object.fromEntries(byTypeRows.map((r) => [r.type, Number(r.cnt)]));

  const topNgUsers = await db.all(
    `SELECT user_id, COUNT(*) as cnt
     FROM log_events
     WHERE guild_id = ? AND type = 'ng_detected' AND ts >= ? AND ts < ? AND user_id IS NOT NULL
     GROUP BY user_id
     ORDER BY cnt DESC
     LIMIT 10`,
    guildId,
    start,
    end
  );

  const timeouts = Number(byType["timeout_applied"] ?? 0);
  const ngDetected = Number(byType["ng_detected"] ?? 0);
  const joins = Number(byType["member_join"] ?? 0);
  const leaves = Number(byType["member_leave"] ?? 0);

  return {
    summary: { ngDetected, timeouts, joins, leaves, byType },
    topNgUsers,
  };
}

/* =========================
   Events
========================= */
client.once("clientReady", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

// ★コマンド実行ログは送らない（要望対応）
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction, db);
  } catch (err) {
    console.error(err);
    if (isUnknownInteraction(err)) return;

    const payload = { content: `❌ エラー: ${err?.message ?? err}`, ephemeral: true };
    try {
      if (interaction.deferred || interaction.replied) await interaction.followUp(payload);
      else await interaction.reply(payload);
    } catch (e) {
      if (!isUnknownInteraction(e)) console.error("reply failed:", e?.message ?? e);
    }
  }
});

/* ===== NGワード検知（メッセージ監視） ===== */
const processedMessageIds = new Map();
const DEDUPE_TTL_MS = 60_000;
function markProcessed(id) {
  const now = Date.now();
  processedMessageIds.set(id, now);
  for (const [mid, ts] of processedMessageIds) {
    if (now - ts > DEDUPE_TTL_MS) processedMessageIds.delete(mid);
  }
}
function alreadyProcessed(id) {
  const ts = processedMessageIds.get(id);
  return ts && Date.now() - ts <= DEDUPE_TTL_MS;
}

async function incrementHit(guildId, userId) {
  const now = Date.now();
  await db.run(
    `INSERT INTO ng_hits (guild_id, user_id, count, updated_at)
     VALUES (?, ?, 1, ?)
     ON CONFLICT(guild_id, user_id) DO UPDATE SET
       count = count + 1,
       updated_at = excluded.updated_at`,
    guildId,
    userId,
    now
  );
  const row = await db.get("SELECT count FROM ng_hits WHERE guild_id = ? AND user_id = ?", guildId, userId);
  return Number(row?.count ?? 1);
}

async function resetHit(guildId, userId) {
  await db.run(
    "UPDATE ng_hits SET count = 0, updated_at = ? WHERE guild_id = ? AND user_id = ?",
    Date.now(),
    guildId,
    userId
  );
}

client.on("messageCreate", async (message) => {
  try {
    if (!message.guild) return;
    if (message.author?.bot) return;
    if (typeof message.content !== "string") return;

    if (alreadyProcessed(message.id)) return;
    markProcessed(message.id);

    const ngWords = await getNgWords(message.guildId);
    if (!ngWords.length) return;

    const contentLower = normalize(message.content);
    const hit = ngWords.find((w) => contentLower.includes(normalize(w)));
    if (!hit) return;

    const settings = await getSettings(message.guildId);

    // 削除（権限があれば）
    const me = await message.guild.members.fetchMe().catch(() => null);
    const canManage =
      me?.permissionsIn(message.channel)?.has(PermissionsBitField.Flags.ManageMessages);

    if (canManage) await message.delete().catch(() => null);

    // 本人DM（ヒット語は見せない）
    await message.author
      .send({
        content:
          "⚠️ サーバーのルールに抵触する可能性のある表現が検出されたため、メッセージが削除されました。\n内容を見直して再投稿してください。",
      })
      .catch(() => null);

    // 検知回数カウント
    const count = await incrementHit(message.guildId, message.author.id);

    // 月次統計用イベント
    await logEvent(message.guildId, "ng_detected", message.author.id, {
      channelId: message.channelId,
      word: hit,
    });

    // タイムアウト判定
    let timeoutApplied = false;
    const threshold = Math.max(1, settings.ng_threshold);
    const timeoutMin = Math.max(1, settings.timeout_minutes);

    if (count >= threshold) {
      const member = await message.guild.members.fetch(message.author.id).catch(() => null);
      const canTimeout = me?.permissions?.has(PermissionsBitField.Flags.ModerateMembers);

      if (member && canTimeout) {
        const ms = timeoutMin * 60 * 1000;
        await member.timeout(ms, `NGワード検知 ${count}/${threshold}`).catch(() => null);
        timeoutApplied = true;
        await resetHit(message.guildId, message.author.id);

        await logEvent(message.guildId, "timeout_applied", message.author.id, {
          minutes: timeoutMin,
          threshold,
        });
      }
    }

    // 管理ログ：赤Embed
    const embed = new EmbedBuilder()
      .setColor(0xff3b3b)
      .setAuthor({
        name: message.author.tag,
        iconURL: message.author.displayAvatarURL?.() ?? undefined,
      })
      .setTitle("🚫 NGワード検知")
      .setDescription(`Channel: ${message.channel}  |  [Jump to Message](${message.url})`)
      .addFields(
        { name: "Hit", value: `\`${hit}\``, inline: true },
        { name: "Count", value: `${Math.min(count, threshold)}/${threshold}`, inline: true },
        {
          name: "Content",
          value: `\`\`\`\n${message.content.slice(0, 1800)}\n\`\`\``,
          inline: false,
        }
      )
      .setFooter({ text: timeoutApplied ? `✅ Timeout applied: ${timeoutMin} min` : `Message ID: ${message.id}` })
      .setTimestamp(new Date());

    await sendLog(message.guild, { embeds: [embed] });
  } catch (e) {
    console.error("NG word monitor error:", e?.message ?? e);
  }
});

// INログ（参加）: 青Embed
client.on("guildMemberAdd", async (member) => {
  try {
    await logEvent(member.guild.id, "member_join", member.user.id);

    const embed = new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle("📥 ユーザー参加")
      .setThumbnail(member.user.displayAvatarURL?.() ?? null)
      .addFields(
        { name: "User", value: `${member.user.tag}`, inline: true },
        { name: "User ID", value: `${member.user.id}`, inline: true }
      )
      .setTimestamp(new Date());

    await sendLog(member.guild, { embeds: [embed] });
  } catch (e) {
    console.error("guildMemberAdd log error:", e?.message ?? e);
  }
});

// OUTログ（退出）: 青Embed
client.on("guildMemberRemove", async (member) => {
  try {
    await logEvent(member.guild.id, "member_leave", member.user.id);

    const embed = new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle("📤 ユーザー退出")
      .setThumbnail(member.user.displayAvatarURL?.() ?? null)
      .addFields(
        { name: "User", value: `${member.user.tag}`, inline: true },
        { name: "User ID", value: `${member.user.id}`, inline: true }
      )
      .setTimestamp(new Date());

    await sendLog(member.guild, { embeds: [embed] });
  } catch (e) {
    console.error("guildMemberRemove log error:", e?.message ?? e);
  }
});

/* =========================
   Login
========================= */
if (token) {
  client.login(token).catch((e) => console.error("❌ login failed:", e?.message ?? e));
} else {
  console.error("❌ DISCORD_TOKEN が無いのでログインできません");
}

/* =========================
   Web UI helpers
========================= */
function json(res, obj, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

function renderAdminHTML() {
  // token はクエリで渡す想定（?token=...）
  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Akatsuki Bot Admin</title>
  <style>
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 16px; }
    .row { display:flex; gap:12px; flex-wrap:wrap; align-items:center; margin-bottom:12px; }
    select,input { padding:8px; }
    button { padding:8px 12px; cursor:pointer; }
    .card { border:1px solid #ddd; border-radius:10px; padding:12px; margin:12px 0; }
    .grid { display:grid; grid-template-columns: repeat(auto-fit,minmax(220px,1fr)); gap:12px; }
    pre { white-space:pre-wrap; word-break:break-word; }
    .muted { color:#666; }
    table { width:100%; border-collapse:collapse; }
    th,td { border-bottom:1px solid #eee; padding:8px; text-align:left; }
  </style>
</head>
<body>
  <h2>Akatsuki Bot 管理画面</h2>
  <p class="muted">※URLに token が必要です（/admin?token=...）</p>

  <div class="card">
    <div class="row">
      <label>Guild:</label>
      <select id="guild"></select>
      <label>Month:</label>
      <input id="month" type="month" />
      <button id="reload">更新</button>
    </div>
  </div>

  <div class="grid">
    <div class="card">
      <h3>月次サマリ</h3>
      <pre id="summary">読み込み中...</pre>
    </div>
    <div class="card">
      <h3>Top NG Users</h3>
      <table>
        <thead><tr><th>User ID</th><th>Count</th></tr></thead>
        <tbody id="top"></tbody>
      </table>
    </div>
  </div>

  <div class="card">
    <h3>NGワード一覧（管理者のみ）</h3>
    <pre id="ngwords">読み込み中...</pre>
  </div>

<script>
(() => {
  const token = new URL(location.href).searchParams.get("token") || "";
  const $ = (id) => document.getElementById(id);

  function yyyymmNowTokyo(){
    const dt = new Date();
    // month input expects YYYY-MM
    const y = dt.getFullYear();
    const m = String(dt.getMonth()+1).padStart(2,"0");
    return \`\${y}-\${m}\`;
  }

  async function api(path){
    const u = new URL(path, location.origin);
    u.searchParams.set("token", token);
    const r = await fetch(u);
    return r.json();
  }

  async function loadGuilds(){
    const data = await api("/api/guilds");
    const sel = $("guild");
    sel.innerHTML = "";
    (data.guilds || []).forEach(g => {
      const opt = document.createElement("option");
      opt.value = g.id;
      opt.textContent = \`\${g.name} (\${g.id})\`;
      sel.appendChild(opt);
    });
  }

  async function reload(){
    const guildId = $("guild").value;
    const month = $("month").value;
    if (!guildId || !month) return;

    // stats
    const stats = await api(\`/api/stats?guild=\${encodeURIComponent(guildId)}&month=\${encodeURIComponent(month)}\`);
    $("summary").textContent = JSON.stringify(stats.stats?.summary ?? {}, null, 2);

    const top = $("top");
    top.innerHTML = "";
    (stats.stats?.topNgUsers || []).forEach(r => {
      const tr = document.createElement("tr");
      tr.innerHTML = \`<td>\${r.user_id}</td><td>\${r.cnt}</td>\`;
      top.appendChild(tr);
    });

    // ngwords
    const ng = await api(\`/api/ngwords?guild=\${encodeURIComponent(guildId)}\`);
    $("ngwords").textContent = (ng.words || []).join("\\n") || "(empty)";
  }

  $("reload").addEventListener("click", reload);
  $("guild").addEventListener("change", reload);
  $("month").addEventListener("change", reload);

  (async () => {
    $("month").value = yyyymmNowTokyo();
    await loadGuilds();
    await reload();
  })();
})();
</script>
</body>
</html>`;
}
