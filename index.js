// index.js（完成形：丸ごとコピペでOK）

import http from "node:http";
import crypto from "node:crypto";
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
  MessageFlags,
  Events,
  ChannelType, // ← 追加
} from "discord.js";

import sqlite3 from "sqlite3";
import { open } from "sqlite";

/* =========================
   Log thread helpers (SINGLE SOURCE OF TRUTH)
   - Threads are separated by kind: vc_in / vc_out / ng
   - One thread per day per kind
   - Race-safe (in-process lock + DB claim)
========================= */

// 同一プロセス内の同時実行防止
const _logThreadLocks = new Map();

/**
 * kind: "vc_in" | "vc_out" | "ng"
 */
function threadNameFor(kind, dateKey) {
  if (kind === "vc_in") return `VC IN ${dateKey}`;
  if (kind === "vc_out") return `VC OUT ${dateKey}`;
  if (kind === "ng") return `NGワード ${dateKey}`;
  return `LOG ${kind} ${dateKey}`;
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

function tokyoNowLabel() {
  const hm = new Intl.DateTimeFormat("ja-JP", {
    timeZone: TIMEZONE,
    hour: "numeric",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
  return `今日 ${hm}`;
}

async function findExistingForumThreadByName(parentForum, name) {
  // 1) Active threads
  try {
    const active = await parentForum.threads.fetchActive();
    const hit = active?.threads?.find((t) => t.name === name);
    if (hit) return hit;
  } catch (_) {}

  // 2) Archived public threads (直近100件)
  try {
    const archived = await parentForum.threads.fetchArchived({ type: "public", limit: 100 });
    const hit = archived?.threads?.find((t) => t.name === name);
    if (hit) return hit;
  } catch (_) {}

  // 3) 最後に cache（保険）
  try {
    const hit = parentForum.threads.cache.find((t) => t.name === name);
    if (hit) return hit;
  } catch (_) {}

  return null;
}

async function ensureLogThread(guild, kind) {
  if (!db) return null;

  const st = await getSettings(guild.id);
  const logChannelId = st?.log_channel_id;
  if (!logChannelId) return null;

  const dateKey = todayKeyTokyo();
  const name = threadNameFor(kind, dateKey);

  // ---- in-process lock key
  const lockKey = `${guild.id}:${kind}:${dateKey}`;
  if (_logThreadLocks.has(lockKey)) return await _logThreadLocks.get(lockKey);

  const lockedPromise = (async () => {
    // ---- 1) DBに既存があればそれを優先
    const row = await db.get(
      `SELECT thread_id FROM log_threads WHERE guild_id = ? AND date_key = ? AND kind = ?`,
      guild.id,
      dateKey,
      kind
    );

    if (row?.thread_id && row.thread_id !== "PENDING") {
      const ch =
        guild.channels.cache.get(row.thread_id) ||
        (await guild.channels.fetch(row.thread_id).catch(() => null));
      if (ch) return ch;
    }

    // ---- 2) DB claim（複数インスタンス対策）
    // まだ行がない場合だけ PENDING を先取りして、作成担当を「なるべく」1つにする
    try {
      await db.run(
        `INSERT OR IGNORE INTO log_threads (guild_id, date_key, kind, thread_id)
         VALUES (?, ?, ?, ?)`,
        guild.id,
        dateKey,
        kind,
        "PENDING"
      );
    } catch (_) {}

    // ---- 3) 親チャンネル取得
    const parent =
      guild.channels.cache.get(logChannelId) ||
      (await guild.channels.fetch(logChannelId).catch(() => null));
    if (!parent) return null;

    // ---- 4) Forumなら「同名スレが既にあるか」を fetch までして探す
    if (parent.type === ChannelType.GuildForum) {
      const existing = await findExistingForumThreadByName(parent, name);
      if (existing) {
        await db.run(
          `UPDATE log_threads SET thread_id = ? WHERE guild_id = ? AND date_key = ? AND kind = ?`,
          existing.id,
          guild.id,
          dateKey,
          kind
        );
        return existing;
      }
    }

    // ---- 5) ここまで来たら作成
    let thread = null;

    if (parent.type === ChannelType.GuildForum) {
      thread = await parent.threads.create({
        name,
        autoArchiveDuration: 1440,
        message: { content: `ログ開始: ${name}` },
      });
    } else {
      thread = await parent.threads.create({
        name,
        autoArchiveDuration: 1440,
      });
      await thread.send(`ログ開始: ${name}`);
    }

    await db.run(
      `UPDATE log_threads SET thread_id = ? WHERE guild_id = ? AND date_key = ? AND kind = ?`,
      thread.id,
      guild.id,
      dateKey,
      kind
    );

    return thread;
  })();

  _logThreadLocks.set(lockKey, lockedPromise);

  try {
    return await lockedPromise;
  } finally {
    _logThreadLocks.delete(lockKey);
  }
}

async function sendToKindThread(guild, kind, payload) {
  const th = await ensureLogThread(guild, kind);
  if (!th) return false;
  await th.send(payload).catch(() => null);
  return true;
}

/* =========================
   VC log message builder (plain text like your 2nd screenshot)
========================= */

function vcText(member, action, channelName) {
  // action: "joined" | "left"
  // 例: "@乱重@Mana left voice channel 🔇 総合雑談VC"
  const m = member?.toString?.() ?? "@unknown";
  if (action === "joined") return `${m} joined voice channel 🔊 ${channelName}`;
  if (action === "left") return `${m} left voice channel 🔇 ${channelName}`;
  return `${m} voice channel ${channelName}`;
}

/* =========================
   Example: NG word logging (plain text)
   - kind "ng"
========================= */

// どこかで NG 判定したときにこう呼ぶだけ
async function logNgWord(message, hitWord) {
  const guild = message.guild;
  if (!guild) return;

  const author = message.author?.toString?.() ?? "@unknown";
  const chName = message.channel?.name ? `#${message.channel.name}` : "unknown-channel";
  const now = tokyoNowLabel();

  const text = `${now} ${author} NGワード検出「${hitWord}」 in ${chName}\n${message.content}`;
  await sendToKindThread(guild, "ng", text);
}

/* =========================
   Basic helpers (text/html/json)
========================= */
function text(res, body, status = 200, headers = {}) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", ...headers });
  res.end(body ?? "");
}
function html(res, body, status = 200, headers = {}) {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", ...headers });
  res.end(body ?? "");
}
function json(res, obj, status = 200, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...headers });
  res.end(JSON.stringify(obj));
}
async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf-8") || "{}";
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/* =========================
   HTML renderers
========================= */
function escapeHTML(s = "") {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderHomeHTML({
  title = "Akatsuki Bot",
  message = "",
  links = [],
} = {}) {
  const linkItems = (links || [])
    .map((l) => {
      const href = escapeHTML(l.href || "#");
      const label = escapeHTML(l.label || l.href || "link");
      return `<li><a href="${href}">${label}</a></li>`;
    })
    .join("");

  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHTML(title)}</title>
  <style>
    body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial; margin:24px; line-height:1.6;}
    .card{max-width:820px; padding:18px 20px; border:1px solid #ddd; border-radius:12px;}
    code{background:#f6f6f6; padding:2px 6px; border-radius:6px;}
    ul{padding-left:20px;}
    .muted{opacity:.7}
    a{color:#0b57d0}
    .btn{display:inline-block;padding:10px 12px;border:1px solid #333;border-radius:10px;text-decoration:none;color:#000;margin-right:8px}
  </style>
</head>
<body>
  <div class="card">
    <h1>${escapeHTML(title)}</h1>
    ${message ? `<p>${escapeHTML(message)}</p>` : `<p>Bot is running.</p>`}
    ${linkItems ? `<h3>Links</h3><ul>${linkItems}</ul>` : ""}
    <p class="muted" style="font-size:12px">Server OK</p>
  </div>
</body>
</html>`;
}

function renderNeedLoginHTML({ oauthReady, tokenEnabled }) {
  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Login</title>
  <style>
    body{font-family:system-ui;margin:16px}
    .card{border:1px solid #ddd;border-radius:12px;padding:12px;max-width:860px}
    .btn{display:inline-block;padding:10px 12px;border:1px solid #333;border-radius:10px;text-decoration:none;color:#000}
    .muted{color:#666}
  </style>
</head>
<body>
  <div class="card">
    <h2>Akatsuki Bot 管理画面</h2>
    <p class="muted">Discord OAuthでログインしてください。</p>
    ${oauthReady ? `<a class="btn" href="/login">Discordでログイン</a>` : `<p class="muted">OAuth未設定（DISCORD_CLIENT_ID/SECRET + PUBLIC_URL が必要）</p>`}
    ${tokenEnabled ? `<hr/><p class="muted">（保険）ADMIN_TOKEN方式: <code>/admin?token=XXXX</code></p>` : ``}
  </div>
</body>
</html>`;
}

function renderAdminHTML({ user, oauth, tokenAuthed }) {
  const userLabel = user ? escapeHTML(user.global_name || user.username || user.id) : "";
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Akatsuki Bot Admin</title>
<style>
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 16px; }
  .row { display:flex; gap:12px; flex-wrap:wrap; align-items:center; margin-bottom:12px; }
  select,input,button { padding:8px; }
  button { cursor:pointer; }
  .card { border:1px solid #ddd; border-radius:12px; padding:12px; margin:12px 0; }
  .grid { display:grid; grid-template-columns: repeat(auto-fit,minmax(320px,1fr)); gap:12px; }
  pre { white-space:pre-wrap; word-break:break-word; }
  .muted { color:#666; }
  .err { color:#b00020; font-weight:600; }
  table { width:100%; border-collapse:collapse; }
  th,td { border-bottom:1px solid #eee; padding:8px; text-align:left; }
  .pill{display:inline-block;padding:4px 8px;border:1px solid #ccc;border-radius:999px;font-size:12px}
  a{color:#0b57d0}
</style>
</head>
<body>
  <h2>Akatsuki Bot 管理画面</h2>

  <div class="row">
    <span class="pill">${oauth ? "Discord OAuth" : "Token"} でログイン中</span>
    ${user ? `<span class="pill">User: ${userLabel}</span>` : ``}
    ${oauth ? `<a href="/logout">ログアウト</a>` : ``}
    ${tokenAuthed ? `<span class="pill">tokenAuthed</span>` : ``}
  </div>

  <div class="card">
    <div class="row">
      <label>サーバー:</label>
      <select id="guild"></select>
      <label>Month:</label>
      <input id="month" type="month" />
      <button id="reload">更新</button>
    </div>
    <div id="guildStatus" class="muted"></div>
    <p class="muted">※「あなたが所属」かつ「Botが入ってる」かつ「管理権限(Manage Guild / Admin)」の鯖だけ出ます。</p>
  </div>

  <div class="grid">
    <div class="card">
      <h3>月次サマリ</h3>
      <div id="summary" class="muted">未取得</div>
      <pre id="debugStats" class="muted" style="margin-top:10px;font-size:12px;display:none;"></pre>
    </div>
    <div class="card">
      <h3>Top NG Users</h3>
      <table>
        <thead><tr><th>User</th><th>Count</th></tr></thead>
        <tbody id="topNg"></tbody>
      </table>
    </div>
  </div>

  <div class="grid">
    <div class="card">
      <h3>NGワード</h3>
      <pre id="ngwords" class="muted">未取得</pre>
      <div class="row">
        <input id="ng_add" placeholder="追加（例: ばか / /ばか|あほ/i）" style="flex:1;min-width:240px" />
        <button id="btn_add">追加</button>
      </div>
      <div class="row">
        <input id="ng_remove" placeholder="削除（登録した形式のまま）" style="flex:1;min-width:240px" />
        <button id="btn_remove">削除</button>
      </div>
      <div class="row">
        <button id="btn_clear" style="border:1px solid #f00;">全削除</button>
        <span class="muted">※戻せません</span>
      </div>
      <div id="ngStatus" class="muted"></div>
    </div>

    <div class="card">
      <h3>NG検知の自動処分</h3>
      <div id="settingsBox" class="muted">未取得</div>

      <div class="row" style="margin-top:10px;">
        <label>何回でタイムアウト？</label>
        <input id="threshold" type="number" min="1" step="1" />
        <label>タイムアウト時間（分）</label>
        <input id="timeout" type="number" min="1" step="1" />
        <button id="btn_save">保存</button>
      </div>
      <p class="muted">例：3回で10分タイムアウト</p>
      <div id="settingsStatus" class="muted"></div>
    </div>
  </div>

<script>
const token = new URLSearchParams(location.search).get("token") || "";
const withToken = (url) => {
  if (!token) return url;
  return url + (url.includes("?") ? "&" : "?") + "token=" + encodeURIComponent(token);
};

(() => {
  const $ = (id) => document.getElementById(id);

  function yyyymmNow(){
    const dt = new Date();
    const y = dt.getFullYear();
    const m = String(dt.getMonth()+1).padStart(2,"0");
    return y + "-" + m;
  }

  async function api(path, opts){
  const r = await fetch(withToken(path), opts);
    const text = await r.text().catch(() => "");
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch {
      data = { ok:false, error:"bad_json", raw:text, _httpStatus:r.status };
      return data;
    }
    if (!r.ok && data && data.ok !== true) data._httpStatus = r.status;
    return data;
  }

  async function postJson(path, body){
    return api(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  function showStatus(id, msg, isErr){
    const el = $(id);
    if (!el) return;
    el.className = isErr ? "err" : "muted";
    el.textContent = msg || "";
  }

  function card(label, value){
    return (
      '<div style="border:1px solid #eee;border-radius:12px;padding:10px;">' +
        '<div style="color:#666;font-size:12px;">' + label + '</div>' +
        '<div style="font-size:22px;font-weight:700;">' + value + '</div>' +
      '</div>'
    );
  }

  function renderByTypeTable(obj){
    const keys = Object.keys(obj || {});
    if (!keys.length) return '<div class="muted">（今月のイベントはまだありません）</div>';
    const rows = keys
      .sort((a,b)=> (obj[b]??0)-(obj[a]??0))
      .map(k => '<tr><td>' + k + '</td><td>' + obj[k] + '</td></tr>')
      .join("");
    return (
      '<table>' +
        '<thead><tr><th>type</th><th>count</th></tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table>'
    );
  }

  function renderSettingsBox(s){
    const logCh = s.log_channel_id ? s.log_channel_id : "未設定（/setlog で設定）";
    return (
      '<table><tbody>' +
        '<tr><td style="width:220px;">管理ログ チャンネルID</td><td><b>' + logCh + '</b></td></tr>' +
        '<tr><td>NG検知 → タイムアウトまで</td><td><b>' + (s.ng_threshold ?? 3) + ' 回</b></td></tr>' +
        '<tr><td>タイムアウト時間</td><td><b>' + (s.timeout_minutes ?? 10) + ' 分</b></td></tr>' +
      '</tbody></table>'
    );
  }

  let loading = false;

  async function loadGuilds(){
    const sel = $("guild");
    sel.innerHTML = "";
    sel.disabled = true;

    showStatus("guildStatus", "サーバー一覧を取得中...", false);

    for (let i = 0; i < 10; i++) {
      const data = await api("/api/guilds");
      if (data && data.ok && Array.isArray(data.guilds)) {
        if (data.guilds.length > 0) {
          for (const g of data.guilds) {
            const opt = document.createElement("option");
            opt.value = g.id;
            opt.textContent = String(g.name) + " (" + String(g.id) + ")";
            sel.appendChild(opt);
          }
          sel.disabled = false;
          showStatus("guildStatus", "取得OK", false);
          return true;
        }
        sel.disabled = false;
        const opt = document.createElement("option");
        opt.value = "";
        opt.textContent = "（0件：権限/導入状況を確認）";
        sel.appendChild(opt);
        showStatus("guildStatus", "0件でした（権限/導入状況を確認）", true);
        return false;
      }

      if (data && data.error) {
        showStatus("guildStatus", "取得失敗: " + data.error + (data._httpStatus ? " (HTTP " + data._httpStatus + ")" : ""), true);
      } else {
        showStatus("guildStatus", "取得失敗: unknown", true);
      }
      await new Promise((r)=>setTimeout(r,800));
    }

    sel.disabled = false;
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "（取得できませんでした。/api/guilds を確認）";
    sel.appendChild(opt);
    showStatus("guildStatus", "取得できませんでした。/api/guilds を直接開いて確認してください。", true);
    return false;
  }

  async function reload(){
    if (loading) return;
    loading = true;
    try{
      const guildId = $("guild").value;
      const month = $("month").value;
      if (!guildId || !month) {
        $("summary").textContent = "サーバーと月を選んでください";
        return;
      }

      // stats
      const stats = await api("/api/stats?guild=" + encodeURIComponent(guildId) + "&month=" + encodeURIComponent(month));
      if (!stats || !stats.ok) {
        $("summary").innerHTML = '<div class="err">stats取得失敗: ' + (stats?.error || "unknown") + '</div>';
        // デバッグ表示（bad_jsonならrawが入る）
        const dbg = $("debugStats");
        dbg.style.display = "block";
        dbg.textContent = JSON.stringify(stats, null, 2);
        $("topNg").innerHTML = '<tr><td colspan="2" class="muted">（未取得）</td></tr>';
      } else {
        $("debugStats").style.display = "none";
        const summary = stats.stats?.summary ?? {};
        const byType = summary.byType ?? {};
        $("summary").innerHTML =
          '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:10px;">' +
            card("NG検知", summary.ngDetected ?? 0) +
            card("Timeout", summary.timeouts ?? 0) +
            card("Join", summary.joins ?? 0) +
            card("Leave", summary.leaves ?? 0) +
          '</div>' +
          '<div style="font-weight:600;margin:6px 0;">内訳（byType）</div>' +
          renderByTypeTable(byType);

        const top = stats.stats?.topNgUsers ?? [];
        $("topNg").innerHTML = top.map(x =>
          '<tr>' +
            '<td>' + (x.user_label || (x.display_name ? (x.display_name + ' (@' + (x.username||'') + ')') : x.user_id)) + '</td>' +
            '<td>' + (x.cnt ?? 0) + '</td>' +
          '</tr>'
        ).join("") || '<tr><td colspan="2" class="muted">（なし）</td></tr>';
      }

      // ngwords
      const ng = await api("/api/ngwords?guild=" + encodeURIComponent(guildId));
      if (!ng || !ng.ok) {
        $("ngwords").textContent = "取得失敗: " + (ng?.error || "unknown");
        showStatus("ngStatus", "取得失敗: " + (ng?.error || "unknown"), true);
      } else {
        $("ngwords").textContent = (ng.words || []).map(w =>
          (w.kind === "regex"
            ? "/" + w.word + "/" + (w.flags || "")
            : w.word)
        ).join(String.fromCharCode(10)) || "（なし）";

        showStatus("ngStatus", "取得OK（" + (ng.count ?? (ng.words||[]).length) + "件）", false);
      }

      // settings
      const st = await api("/api/settings?guild=" + encodeURIComponent(guildId));
      if (!st || !st.ok) {
        $("settingsBox").innerHTML = '<div class="err">取得失敗: ' + (st?.error || "unknown") + '</div>';
        showStatus("settingsStatus", "設定取得失敗: " + (st?.error || "unknown"), true);
      } else {
        const s = st.settings ?? { log_channel_id:null, ng_threshold:3, timeout_minutes:10 };
        $("settingsBox").innerHTML = renderSettingsBox(s);
        $("threshold").value = s.ng_threshold ?? 3;
        $("timeout").value = s.timeout_minutes ?? 10;
        showStatus("settingsStatus", "取得OK", false);
      }
    } finally {
      loading = false;
    }
  }

  $("reload").addEventListener("click", reload);
  $("guild").addEventListener("change", reload);
  $("month").addEventListener("change", reload);

  $("btn_add").addEventListener("click", async () => {
    const guildId = $("guild").value;
    const word = $("ng_add").value;
    if (!guildId) return alert("サーバーを選んでください");
    if (!word.trim()) return alert("ワードを入力してください");
    const r = await postJson("/api/ngwords/add", { guild: guildId, word: word.trim() });
    if (!r.ok) alert("追加失敗: " + (r.error || "unknown"));
    $("ng_add").value = "";
    await reload();
  });

  $("btn_remove").addEventListener("click", async () => {
    const guildId = $("guild").value;
    const word = $("ng_remove").value;
    if (!guildId) return alert("サーバーを選んでください");
    if (!word.trim()) return alert("ワードを入力してください");
    const r = await postJson("/api/ngwords/remove", { guild: guildId, word: word.trim() });
    if (!r.ok) alert("削除失敗: " + (r.error || "unknown"));
    $("ng_remove").value = "";
    await reload();
  });

  $("btn_clear").addEventListener("click", async () => {
    if (!confirm("NGワードを全削除します。よろしいですか？")) return;
    const guildId = $("guild").value;
    if (!guildId) return alert("サーバーを選んでください");
    const r = await postJson("/api/ngwords/clear", { guild: guildId });
    if (!r.ok) alert("全削除失敗: " + (r.error || "unknown"));
    await reload();
  });

  $("btn_save").addEventListener("click", async () => {
    const guildId = $("guild").value;
    if (!guildId) return alert("サーバーを選んでください");
    const ng_threshold = Number($("threshold").value);
    const timeout_minutes = Number($("timeout").value);
    const r = await postJson("/api/settings/update", { guild: guildId, ng_threshold, timeout_minutes });
    if (!r.ok) return alert("保存失敗: " + (r.error || "unknown"));
    await reload();
    alert("保存しました");
  });

  (async () => {
    $("month").value = yyyymmNow();
    await loadGuilds();
    await reload();
  })();
})();
</script>
</body>
</html>`;
}

/* =========================
   Settings
========================= */
const DEFAULT_NG_THRESHOLD = Number(process.env.NG_THRESHOLD || 3);
const DEFAULT_TIMEOUT_MIN = Number(process.env.NG_TIMEOUT_MIN || 10);
const TIMEZONE = "Asia/Tokyo";

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const CLIENT_ID = process.env.DISCORD_CLIENT_ID || "";
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || "";
const PUBLIC_URL = process.env.PUBLIC_URL || "";
const REDIRECT_PATH = "/oauth/callback";
const OAUTH_REDIRECT_URI = PUBLIC_URL ? `${PUBLIC_URL}${REDIRECT_PATH}` : "";
const OAUTH_SCOPES = "identify guilds";

/** 429対策（guilds短期キャッシュ） */
const USER_GUILDS_CACHE_TTL_MS = 60_000;
const guildsInFlightBySid = new Map(); // sid -> Promise<guilds>

/* =========================
   Paths
========================= */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* =========================
   DB
========================= */
let db = null;

async function migrateLogThreadsKind(db) {
  try {
    const cols = await db.all(`PRAGMA table_info(log_threads);`);
    const hasKind = cols.some((c) => c.name === "kind");
    if (hasKind) return;

    await db.exec(`
      CREATE TABLE IF NOT EXISTS log_threads_new (
        guild_id TEXT,
        date_key TEXT,
        kind TEXT,
        thread_id TEXT,
        PRIMARY KEY (guild_id, date_key, kind)
      );
    `);

    await db.exec(`
      INSERT OR IGNORE INTO log_threads_new (guild_id, date_key, kind, thread_id)
      SELECT guild_id, date_key, 'main' as kind, thread_id
      FROM log_threads;
    `);

    await db.exec(`DROP TABLE log_threads;`);
    await db.exec(`ALTER TABLE log_threads_new RENAME TO log_threads;`);
    console.log("✅ Migrated log_threads -> kind-aware schema");
  } catch (e) {
    console.error("❌ log_threads migration failed:", e?.message ?? e);
  }
}

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
      kind TEXT DEFAULT 'literal',
      word TEXT,
      flags TEXT DEFAULT 'i',
      PRIMARY KEY (guild_id, kind, word)
    );
  `);

  // 旧schema互換
  try {
    const cols = await db.all(`PRAGMA table_info(ng_words);`);
    const hasKind = cols.some((c) => c.name === "kind");
    const hasFlags = cols.some((c) => c.name === "flags");
    if (!hasKind) await db.exec(`ALTER TABLE ng_words ADD COLUMN kind TEXT DEFAULT 'literal';`);
    if (!hasFlags) await db.exec(`ALTER TABLE ng_words ADD COLUMN flags TEXT DEFAULT 'i';`);
  } catch {}

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

  await db.exec(`
    CREATE TABLE IF NOT EXISTS log_events (
      guild_id TEXT,
      type TEXT,
      user_id TEXT,
      meta TEXT,
      ts INTEGER
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS vc_active (
      guild_id TEXT,
      user_id TEXT,
      channel_id TEXT,
      joined_at INTEGER,
      PRIMARY KEY (guild_id, user_id)
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS vc_stats_month (
      guild_id TEXT,
      month_key TEXT,
      user_id TEXT,
      joins INTEGER DEFAULT 0,
      total_ms INTEGER DEFAULT 0,
      PRIMARY KEY (guild_id, month_key, user_id)
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS vc_stats_total (
      guild_id TEXT,
      user_id TEXT,
      joins INTEGER DEFAULT 0,
      total_ms INTEGER DEFAULT 0,
      PRIMARY KEY (guild_id, user_id)
    );
  `);

  await db.exec(`CREATE INDEX IF NOT EXISTS idx_log_events_guild_ts ON log_events (guild_id, ts);`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_log_events_guild_type_ts ON log_events (guild_id, type, ts);`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_vc_month_guild_month ON vc_stats_month (guild_id, month_key);`);

  await migrateLogThreadsKind(db);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS log_threads (
      guild_id TEXT,
      date_key TEXT,
      kind TEXT,
      thread_id TEXT,
      PRIMARY KEY (guild_id, date_key, kind)
    );
  `);

  console.log("✅ DB ready");
} catch (e) {
  console.error("❌ DB init failed:", e?.message ?? e);
  db = null;
}

/* =========================
   Discord client
========================= */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
});
client.commands = new Collection();

async function importFile(filePath) {
  return import(pathToFileURL(filePath).href);
}

// commands/*.js
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
function normalize(s) {
  return (s ?? "").toLowerCase();
}
function todayKeyTokyo2() {
  const dtf = new Intl.DateTimeFormat("sv-SE", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return dtf.format(new Date()); // YYYY-MM-DD
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
function rand(n = 24) {
  return crypto.randomBytes(n).toString("hex");
}
function baseUrl(req) {
  const proto = req.headers["x-forwarded-proto"] || "http";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`;
}

/* =========================
   Settings / NG
========================= */
const ngProcessed = new Map(); // messageId -> timestamp
const NG_DEDUPE_TTL = 30_000;  // 30秒

function markNgProcessed(messageId) {
  const now = Date.now();
  // 掃除
  for (const [k, t] of ngProcessed) if (now - t > NG_DEDUPE_TTL) ngProcessed.delete(k);
  if (ngProcessed.has(messageId)) return false; // もう処理済み
  ngProcessed.set(messageId, now);
  return true;
}

async function getSettings(guildId) {
  if (!db) return { log_channel_id: null, ng_threshold: DEFAULT_NG_THRESHOLD, timeout_minutes: DEFAULT_TIMEOUT_MIN };
  const row = await db.get("SELECT * FROM settings WHERE guild_id = ?", guildId);
  if (!row) {
    return { log_channel_id: null, ng_threshold: DEFAULT_NG_THRESHOLD, timeout_minutes: DEFAULT_TIMEOUT_MIN };
  }
  return {
    log_channel_id: row.log_channel_id ?? null,
    ng_threshold: Number(row.ng_threshold ?? DEFAULT_NG_THRESHOLD),
    timeout_minutes: Number(row.timeout_minutes ?? DEFAULT_TIMEOUT_MIN),
  };
}
async function updateSettings(guildId, { log_channel_id = null, ng_threshold, timeout_minutes }) {
  if (!db) return { ok: false, error: "db_not_ready" };
  const nt = Number(ng_threshold);
  const tm = Number(timeout_minutes);
  await db.run(
    `INSERT INTO settings (guild_id, log_channel_id, ng_threshold, timeout_minutes)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(guild_id) DO UPDATE SET
       log_channel_id = excluded.log_channel_id,
       ng_threshold = excluded.ng_threshold,
       timeout_minutes = excluded.timeout_minutes`,
    guildId,
    log_channel_id,
    Number.isFinite(nt) ? nt : DEFAULT_NG_THRESHOLD,
    Number.isFinite(tm) ? tm : DEFAULT_TIMEOUT_MIN
  );
  return { ok: true };
}

async function getNgWords(guildId) {
  if (!db) return [];
  const rows = await db.all(
    `SELECT kind, word, flags
     FROM ng_words
     WHERE guild_id = ?
     ORDER BY kind ASC, word ASC`,
    guildId
  );
  return rows
    .map((r) => ({
      kind: (r.kind || "literal").trim(),
      word: (r.word || "").trim(),
      flags: (r.flags || "i").trim(),
    }))
    .filter((x) => x.word.length > 0 && (x.kind === "literal" || x.kind === "regex"));
}

function parseNgInput(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return null;

  if (s.startsWith("/") && s.lastIndexOf("/") > 0) {
    const last = s.lastIndexOf("/");
    const pattern = s.slice(1, last);
    const flags = s.slice(last + 1) || "i";
    if (!pattern.trim()) return null;
    if (!/^[dgimsuvy]*$/.test(flags)) return null;
    try {
      // eslint-disable-next-line no-new
      new RegExp(pattern, flags);
    } catch {
      return null;
    }
    return { kind: "regex", word: pattern, flags };
  }

  return { kind: "literal", word: s, flags: "i" };
}

async function addNgWord(guildId, raw) {
  if (!db) return { ok: false, error: "db_not_ready" };
  const parsed = parseNgInput(raw);
  if (!parsed) return { ok: false, error: "invalid_input" };
  await db.run(
    `INSERT OR IGNORE INTO ng_words (guild_id, kind, word, flags)
     VALUES (?, ?, ?, ?)`,
    guildId,
    parsed.kind,
    parsed.word,
    parsed.flags || "i"
  );
  return { ok: true, added: parsed };
}
async function removeNgWord(guildId, raw) {
  if (!db) return { ok: false, error: "db_not_ready" };
  const parsed = parseNgInput(raw);
  if (!parsed) return { ok: false, error: "invalid_input" };
  const r = await db.run(
    `DELETE FROM ng_words
     WHERE guild_id = ? AND kind = ? AND word = ?`,
    guildId,
    parsed.kind,
    parsed.word
  );
  return { ok: true, deleted: r?.changes ?? 0, target: parsed };
}
async function clearNgWords(guildId) {
  if (!db) return { ok: false, error: "db_not_ready" };
  await db.run(`DELETE FROM ng_words WHERE guild_id = ?`, guildId);
  return { ok: true };
}

/* =========================
   Event logging (stats)
========================= */
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
   Discord API (OAuth)
========================= */
async function discordApi(accessToken, apiPath, method = "GET", body = null, extraHeaders = null, maxRetries = 4) {
  const url = `https://discord.com/api/v10${apiPath}`;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": "AkatsukiBotAdmin/1.0",
      ...(extraHeaders || {}),
    };

    const r = await fetch(url, {
      method,
      headers,
      ...(body ? { body } : {}),
    });

    if (r.ok) {
      const t = await r.text().catch(() => "");
      return t ? JSON.parse(t) : null;
    }

    if (r.status === 429) {
      let waitMs = 1000;
      const ra = r.headers.get("retry-after");
      if (ra) {
        const sec = Number(ra);
        if (Number.isFinite(sec)) waitMs = Math.ceil(sec * 1000);
      } else {
        try {
          const data = await r.json();
          if (typeof data?.retry_after === "number") waitMs = Math.ceil(data.retry_after * 1000);
        } catch {}
      }
      waitMs += 250 + Math.floor(Math.random() * 250);
      if (attempt === maxRetries) throw new Error(`Discord API ${apiPath} failed: 429`);
      await new Promise((res) => setTimeout(res, waitMs));
      continue;
    }

    const msg = await r.text().catch(() => "");
    throw new Error(`Discord API ${apiPath} failed: ${r.status} ${msg}`);
  }
  throw new Error(`Discord API ${apiPath} failed`);
}

function hasAdminPerm(permStr) {
  try {
    const p = BigInt(permStr ?? "0");
    const ADMINISTRATOR = 1n << 3n; // 0x8
    const MANAGE_GUILD = 1n << 5n; // 0x20
    return (p & ADMINISTRATOR) !== 0n || (p & MANAGE_GUILD) !== 0n;
  } catch {
    return false;
  }
}

/* =========================
   OAuth session store (memory)
========================= */
const sessions = new Map(); // sid -> { accessToken, user, guilds, guildsFetchedAt, expiresAt }
const states = new Map();   // state -> createdAt

function parseCookies(req) {
  const raw = req.headers.cookie || "";
  const out = {};
  raw
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach((pair) => {
      const idx = pair.indexOf("=");
      if (idx < 0) return;
      out[pair.slice(0, idx)] = decodeURIComponent(pair.slice(idx + 1));
    });
  return out;
}
function setCookie(res, name, value, opts = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (opts.httpOnly !== false) parts.push("HttpOnly");
  parts.push("Path=/");
  parts.push("SameSite=Lax");
  if (opts.secure !== false) parts.push("Secure");
  if (opts.maxAge) parts.push(`Max-Age=${opts.maxAge}`);
  res.setHeader("Set-Cookie", parts.join("; "));
}
function delCookie(res, name) {
  res.setHeader("Set-Cookie", `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure`);
}

async function getSession(req) {
  const cookies = parseCookies(req);
  const sid = cookies.sid || "";
  if (!sid) return null;
  const s = sessions.get(sid);
  if (!s) return null;
  if (s.expiresAt && Date.now() > s.expiresAt) {
    sessions.delete(sid);
    return null;
  }
  return { sid, ...s };
}

async function ensureGuildsForSession(s) {
  const now = Date.now();
  if (s.guilds && Array.isArray(s.guilds) && s.guildsFetchedAt && now - s.guildsFetchedAt < USER_GUILDS_CACHE_TTL_MS) {
    return s.guilds;
  }

  const inflight = guildsInFlightBySid.get(s.sid);
  if (inflight) return await inflight;

  const p = (async () => {
    try {
      const guilds = await discordApi(s.accessToken, "/users/@me/guilds");
      const raw = sessions.get(s.sid);
      if (raw) {
        raw.guilds = guilds;
        raw.guildsFetchedAt = Date.now();
        sessions.set(s.sid, raw);
      }
      return guilds;
    } catch (e) {
      if (s.guilds && Array.isArray(s.guilds) && s.guilds.length > 0) return s.guilds;
      throw e;
    }
  })().finally(() => {
    guildsInFlightBySid.delete(s.sid);
  });

  guildsInFlightBySid.set(s.sid, p);
  return await p;
}

function intersectUserBotGuilds(userGuilds) {
  const botSet = new Set(client.guilds.cache.map((g) => g.id));
  return (userGuilds || [])
    .filter((g) => botSet.has(g.id))
    .filter((g) => hasAdminPerm(g.permissions))
    .map((g) => ({ id: g.id, name: g.name, owner: !!g.owner, permissions: g.permissions }));
}

/* =========================
   Ready / Commands (NO EPHEMERAL / NO REPLY UI)
   - Always ACK once (public) to avoid "応答しませんでした"
   - Immediately delete the reply UI when possible
   - Provide publicSend() for normal messages
   - DO NOT rely on interaction.reply/editReply/followUp in commands
========================= */
client.once(Events.ClientReady, (c) => {
  console.log(`✅ Logged in as ${c.user.tag}`);
});
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const isUnknown = (err) => err?.code === 10062 || err?.rawError?.code === 10062;
  const isAlreadyAcked = (err) => {
    const c = err?.code ?? err?.rawError?.code ?? err?.name;
    return (
      c === 40060 ||
      c === "InteractionAlreadyReplied" ||
      String(c).includes("AlreadyReplied")
    );
  };

  // ✅ コマンドUIを使う前提なので publicSend は「補助」扱い（使わなくてもOK）
  interaction.publicSend = async (payload) => {
    return await interaction.channel?.send(payload).catch(() => null);
  };

  try {
    const command = client.commands.get(interaction.commandName);

    if (!command) {
      // ここは見えるように ephemeral
      await interaction.reply({ content: `❌ コマンドが見つかりません: /${interaction.commandName}`, ephemeral: true }).catch(() => null);
      return;
    }

    await command.execute(interaction, db);
  } catch (err) {
    console.error("interactionCreate error:", err);
    if (isUnknown(err)) return;

    const msg = `❌ エラー: ${err?.message ?? String(err)}`;

    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: msg }).catch(() => null);
      } else {
        await interaction.reply({ content: msg, ephemeral: true }).catch(() => null);
      }
    } catch (e) {
      if (isUnknown(e) || isAlreadyAcked(e)) return;
      // 最後の保険：通常投稿
      await interaction.publicSend({ content: msg }).catch(() => null);
    }
  }
});

/* =========================
   Message debug log (必要なら残す)
========================= */
client.on(Events.MessageCreate, (m) => {
  if (!m.guild || m.author?.bot) return;
  console.log("🧪 Message seen:", {
    guild: m.guild.id,
    channel: m.channelId,
    author: m.author.id,
    len: (m.content || "").length,
    contentHead: (m.content || "").slice(0, 30),
  });
});

/* =========================
   VC Join/Leave -> kind="vc_in" / kind="vc_out"
   - スレ分け：IN / OUT（MOVEは両方に出す）
========================= */
client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  try {
    const guild = newState.guild || oldState.guild;
    if (!guild) return;

    const member = newState.member || oldState.member;
    if (!member || member.user?.bot) return;

    const oldCh = oldState.channel;
    const newCh = newState.channel;

    // 変化なし（ミュート等）は無視
    if ((oldCh?.id || null) === (newCh?.id || null)) return;

    const authorName = member.user?.username || member.id;
    const displayName = member.displayName || member.user?.globalName || authorName;
    const avatar = member.user?.displayAvatarURL?.() ?? null;

    const timeLabel = tokyoNowLabel();
    const idLine = `${member.id}・${timeLabel}`;

    // IN (null -> channel)
    if (!oldCh && newCh) {
      const embedIn = new EmbedBuilder()
        .setColor(0x2ecc71) // green
        .setAuthor({ name: authorName, iconURL: avatar || undefined })
        .setDescription(`@${displayName} joined voice channel 🔊 <#${newCh.id}>`)
        .addFields({ name: "ID", value: idLine, inline: false })
        .setTimestamp(new Date());

      await sendToKindThread(guild, "vc_in", { embeds: [embedIn] });
      await logEvent(guild.id, "vc_in", member.id, { to: newCh.id });
      return;
    }

    // OUT (channel -> null)
    if (oldCh && !newCh) {
      const embedOut = new EmbedBuilder()
        .setColor(0xe74c3c) // red
        .setAuthor({ name: authorName, iconURL: avatar || undefined })
        .setDescription(`@${displayName} left voice channel 🔇 <#${oldCh.id}>`)
        .addFields({ name: "ID", value: idLine, inline: false })
        .setTimestamp(new Date());

      await sendToKindThread(guild, "vc_out", { embeds: [embedOut] });
      await logEvent(guild.id, "vc_out", member.id, { from: oldCh.id });
      return;
    }

    // MOVE (channel -> channel) → OUTにもINにも出す
    if (oldCh && newCh && oldCh.id !== newCh.id) {
      const embedMoveOut = new EmbedBuilder()
        .setColor(0x95a5a6) // gray
        .setAuthor({ name: authorName, iconURL: avatar || undefined })
        .setDescription(`@${displayName} left voice channel 🔇 <#${oldCh.id}>（MOVE）`)
        .addFields({ name: "ID", value: idLine, inline: false })
        .setTimestamp(new Date());

      const embedMoveIn = new EmbedBuilder()
        .setColor(0x2ecc71) // green
        .setAuthor({ name: authorName, iconURL: avatar || undefined })
        .setDescription(`@${displayName} joined voice channel 🔊 <#${newCh.id}>（MOVE）`)
        .addFields({ name: "ID", value: idLine, inline: false })
        .setTimestamp(new Date());

      await sendToKindThread(guild, "vc_out", { embeds: [embedMoveOut] });
      await sendToKindThread(guild, "vc_in", { embeds: [embedMoveIn] });

      await logEvent(guild.id, "vc_move", member.id, { from: oldCh.id, to: newCh.id });
      return;
    }
  } catch (e) {
    console.error("voiceStateUpdate log error:", e);
  }
});

/* =========================
   NG detection -> kind="ng"
   - log BEFORE delete (keep deleted content)
   - warn DM (fallback mention)
   - Color: NG orange / Timeout purple
   - includes message debug log (A案)
========================= */

function matchNg(content, ngList) {
  const text = String(content ?? "");

  for (const w of ngList) {
    // ===== regex =====
    if (w.kind === "regex") {
      try {
        const re = new RegExp(w.word, w.flags || "i");
        if (re.test(text)) return { hit: true, pattern: `/${w.word}/${w.flags || "i"}` };
      } catch {}
      continue;
    }

    // ===== plain =====
    const needle = String(w.word ?? "");
    if (!needle) continue;

    const hay = text.toLowerCase();
    const ndl = needle.toLowerCase();

    // カタカナ語の語中除外
    if (isKatakanaOnly(needle)) {
      const re = new RegExp(
        `${escapeRegExp(needle)}(?![\\u30A0-\\u30FF\\u30FC\\u30FB])`,
        "u"
      );
      if (re.test(text)) return { hit: true, pattern: needle };
      continue;
    }

    if (hay.includes(ndl)) {
      return { hit: true, pattern: needle };
    }
  }

  return { hit: false };
}

async function incNgHit(guildId, userId) {
  if (!db) return 0;
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
  const row = await db.get(
    `SELECT count FROM ng_hits WHERE guild_id = ? AND user_id = ?`,
    guildId,
    userId
  );
  return Number(row?.count ?? 0);
}

client.on(Events.MessageCreate, async (message) => {
  try {
    if (!message.guild || message.author?.bot) return;

    /* ===== 🧪 message debug log ===== */
    console.log("🧪 Message seen:", {
      guild: message.guild.id,
      channel: message.channelId,
      author: message.author.id,
      len: (message.content || "").length,
      contentHead: (message.content || "").slice(0, 30),
    });

    if (!markNgProcessed(message.id)) return;

    const guildId = message.guild.id;
    const ngList = await getNgWords(guildId);
    if (!ngList.length) return;

    const m = matchNg(message.content, ngList);
    if (!m.hit) return;

    const st = await getSettings(guildId);

    const member = message.member;
    const authorName = message.author?.username || message.author?.id;
    const displayName =
      member?.displayName || message.author?.globalName || authorName;
    const avatar = message.author?.displayAvatarURL?.() ?? null;

    const timeLabel = tokyoNowLabel();
    const idLine = `${message.author.id}・${timeLabel}`;
    const content = message.content || "";

    /* ===== ① NGログ（削除前） ===== */
    const embed = new EmbedBuilder()
      .setColor(0xe67e22) // NG orange
      .setAuthor({ name: authorName, iconURL: avatar || undefined })
      .setDescription(`@${displayName} NG word detected in <#${message.channelId}>`)
      .addFields(
        { name: "Matched", value: m.pattern, inline: true },
        { name: "ID", value: idLine, inline: true },
        {
          name: "Content",
          value: content
            ? content.length > 900
              ? content.slice(0, 900) + "…"
              : content
            : "（空）",
          inline: false,
        }
      )
      .setTimestamp(new Date());

    await sendToKindThread(message.guild, "ng", { embeds: [embed] });

    await logEvent(guildId, "ng_detected", message.author.id, {
      channel_id: message.channelId,
      matched: m.pattern,
      message_id: message.id,
    });

    /* ===== ② 削除 ===== */
    await message.delete().catch(() => null);

    /* ===== ③ 個人警告（DM → fallback mention） ===== */
    const warnText =
      `⚠️ **NGワード警告**\n` +
      `あなたのメッセージは削除されました。\n\n` +
      `該当: ${m.pattern}\n` +
      `繰り返すとタイムアウト等の処分が行われます。`;

    const dmOk = await message.author
      .send(warnText)
      .then(() => true)
      .catch(() => false);

    if (!dmOk) {
      await message.channel
        .send({ content: `<@${message.author.id}> ${warnText}` })
        .then((msg) =>
          setTimeout(() => msg.delete().catch(() => null), 10_000)
        )
        .catch(() => null);
    }

    /* ===== ④ 回数加算 → 閾値でタイムアウト ===== */
    const count = await incNgHit(guildId, message.author.id);
    const threshold = Number(st.ng_threshold ?? DEFAULT_NG_THRESHOLD);
    const timeoutMin = Number(st.timeout_minutes ?? DEFAULT_TIMEOUT_MIN);

    if (count >= threshold) {
      const mem = await message.guild.members
        .fetch(message.author.id)
        .catch(() => null);

      if (mem?.moderatable) {
        await mem
          .timeout(timeoutMin * 60_000, "NGワード検出の累積")
          .catch(() => null);

        await logEvent(guildId, "timeout_applied", message.author.id, {
          minutes: timeoutMin,
          threshold,
          count,
        });

        const embed2 = new EmbedBuilder()
          .setColor(0x8e44ad) // timeout purple
          .setAuthor({ name: authorName, iconURL: avatar || undefined })
          .setDescription(`@${displayName} timeout applied`)
          .addFields(
            { name: "Count", value: String(count), inline: true },
            { name: "Duration(min)", value: String(timeoutMin), inline: true },
            { name: "ID", value: idLine, inline: false }
          )
          .setTimestamp(new Date());

        await sendToKindThread(message.guild, "ng", { embeds: [embed2] });
      }
    }
  } catch (e) {
    console.error("MessageCreate NG handler error:", e);
  }
});

// ===== 月次統計（log_threads）=====
// 置き場所：const server = http.createServer(...) の前
async function getMonthlyStats({ db, guildId, ym }) {
  if (!db || !guildId || !ym) return null;

  const cols = await db.all("PRAGMA table_info(log_threads)");
  const colNames = cols.map((c) => String(c.name));

  // 日時カラムを自動検出
  const dateCandidates = [
    "created_at",
    "createdAt",
    "created",
    "timestamp",
    "ts",
    "time",
    "created_ms",
    "createdAtMs",
    "created_time",
  ];
  const dateCol = dateCandidates.find((n) => colNames.includes(n));
  if (!dateCol) {
    throw new Error(`no date column in log_threads. columns=${colNames.join(",")}`);
  }

  // user_id を自動検出（あれば topNgUsers を作る）
  const userCandidates = ["user_id", "userId", "author_id", "authorId", "member_id", "memberId"];
  const userCol = userCandidates.find((n) => colNames.includes(n)) || null;

  // サンプル値から ISO / unix秒 / unixms を推定
  const sampleRow = await db.get(
    `SELECT ${dateCol} AS v FROM log_threads WHERE ${dateCol} IS NOT NULL LIMIT 1`
  );
  const v = sampleRow?.v;

  // 月判定の式を決める
  let monthExpr;
  if (typeof v === "number") {
    monthExpr =
      v > 1e12
        ? `strftime('%Y-%m', datetime(${dateCol}/1000, 'unixepoch'))` // ms
        : `strftime('%Y-%m', datetime(${dateCol}, 'unixepoch'))`;     // sec
  } else if (typeof v === "string" && /^\d+$/.test(v.trim())) {
    const n = Number(v.trim());
    monthExpr =
      n > 1e12
        ? `strftime('%Y-%m', datetime(${dateCol}/1000, 'unixepoch'))`
        : `strftime('%Y-%m', datetime(${dateCol}, 'unixepoch'))`;
  } else {
    monthExpr = `strftime('%Y-%m', ${dateCol})`; // ISO/日時文字列
  }

  // kind別集計
  const byKindRows = await db.all(
    `
    SELECT kind, COUNT(*) AS cnt
    FROM log_threads
    WHERE guild_id = ?
      AND ${monthExpr} = ?
    GROUP BY kind
    ORDER BY cnt DESC
    `,
    [guildId, ym]
  );

  const totalRow = await db.get(
    `
    SELECT COUNT(*) AS total
    FROM log_threads
    WHERE guild_id = ?
      AND ${monthExpr} = ?
    `,
    [guildId, ym]
  );

  const byKind = Object.fromEntries(
    byKindRows.map((r) => [r.kind ?? "unknown", Number(r.cnt || 0)])
  );

  // NGユーザー上位（userCol がある時だけ）
  let topNgUsers = [];
  if (userCol) {
    try {
      const topRows = await db.all(
        `
        SELECT ${userCol} AS user_id, COUNT(*) AS cnt
        FROM log_threads
        WHERE guild_id = ?
          AND ${monthExpr} = ?
          AND kind = 'ng'
          AND ${userCol} IS NOT NULL AND ${userCol} <> ''
        GROUP BY ${userCol}
        ORDER BY cnt DESC
        LIMIT 10
        `,
        [guildId, ym]
      );

      topNgUsers = topRows.map((r) => ({
        user_id: String(r.user_id),
        count: Number(r.cnt || 0),
      }));
    } catch {
      topNgUsers = [];
    }
  }

  return {
    ym,
    total: Number(totalRow?.total || 0),
    byKind,
    topNgUsers,
  };
}

/* =========================
   Web server: admin + API + OAuth
========================= */
const PORT = Number(process.env.PORT || 10000);

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url || "/", baseUrl(req));
    const pathname = (u.pathname || "/").replace(/\/+$/, "") || "/";

    // health (Render)
    if (pathname === "/health") return text(res, "ok", 200);

    // token auth
    const tokenQ = u.searchParams.get("token") || "";
    const tokenAuthed = ADMIN_TOKEN && tokenQ === ADMIN_TOKEN;

    // OAuth session（/admin と /api/ と /logout のときだけ読む）
    let sess = null;
    if (pathname === "/admin" || pathname.startsWith("/api/") || pathname === "/logout") {
      sess = await getSession(req);
    }

    const oauthReady = !!(CLIENT_ID && CLIENT_SECRET && (PUBLIC_URL || req.headers.host));
    const isAuthed = !!sess || tokenAuthed;

    // ===== OAuth endpoints =====
    if (pathname === "/login") {
      if (!oauthReady) {
        return text(res, "OAuth not configured. Set DISCORD_CLIENT_ID/SECRET and PUBLIC_URL.", 500);
      }
      const state = rand(12);
      states.set(state, Date.now());

      const redirectUri = OAUTH_REDIRECT_URI || `${baseUrl(req)}${REDIRECT_PATH}`;
      const authUrl =
        "https://discord.com/oauth2/authorize" +
        `?client_id=${encodeURIComponent(CLIENT_ID)}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&response_type=code` +
        `&scope=${encodeURIComponent(OAUTH_SCOPES)}` +
        `&state=${encodeURIComponent(state)}`;

      res.writeHead(302, { Location: authUrl });
      return res.end();
    }

    if (pathname === REDIRECT_PATH) {
      if (!oauthReady) return text(res, "OAuth is not configured.", 500);

      const code = u.searchParams.get("code") || "";
      const state = u.searchParams.get("state") || "";
      const created = states.get(state);
      if (!code || !state || !created) return text(res, "Invalid OAuth state/code", 400);
      states.delete(state);

      const redirectUri = OAUTH_REDIRECT_URI || `${baseUrl(req)}${REDIRECT_PATH}`;

      const body = new URLSearchParams();
      body.set("client_id", CLIENT_ID);
      body.set("client_secret", CLIENT_SECRET);
      body.set("grant_type", "authorization_code");
      body.set("code", code);
      body.set("redirect_uri", redirectUri);

      const tr = await fetch("https://discord.com/api/v10/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
      if (!tr.ok) return text(res, `Token exchange failed: ${tr.status}`, 500);
      const tok = await tr.json();

      const accessToken = tok.access_token;
      const expiresIn = Number(tok.expires_in || 3600);

      const user = await discordApi(accessToken, "/users/@me");
      const sid = rand(24);

      sessions.set(sid, {
        accessToken,
        user,
        guilds: null,
        guildsFetchedAt: 0,
        expiresAt: Date.now() + expiresIn * 1000,
      });

      setCookie(res, "sid", sid, { maxAge: expiresIn });
      res.writeHead(302, { Location: "/admin" });
      return res.end();
    }

    if (pathname === "/logout") {
      if (sess?.sid) sessions.delete(sess.sid);
      delCookie(res, "sid");
      res.writeHead(302, { Location: "/" });
      return res.end();
    }

    // ===== Pages =====
    if (pathname === "/") {
      return html(
        res,
        renderHomeHTML({
          title: "Akatsuki Bot",
          links: [
            { label: "Admin", href: "/admin" },
            { label: "Health", href: "/health" },
          ],
        })
      );
    }

    if (pathname === "/admin") {
      if (!isAuthed) {
        return html(res, renderNeedLoginHTML({ oauthReady, tokenEnabled: !!ADMIN_TOKEN }));
      }
      const user = sess?.user || null;
      return html(res, renderAdminHTML({ user, oauth: !!sess, tokenAuthed: !!tokenAuthed }));
    }

    // ===== APIs =====
if (pathname.startsWith("/api/")) {
  // まず認証チェック（ここが最重要）
  if (!isAuthed) return json(res, { ok: false, error: "unauthorized" }, 401);

  // OAuth時は「Bot入り + 管理権限がある鯖」だけ許可
  let allowedGuildIds = null;
  if (sess) {
    const userGuilds = await ensureGuildsForSession(sess);
    const allowed = intersectUserBotGuilds(userGuilds);
    allowedGuildIds = new Set(allowed.map((g) => g.id));
  }

  function requireGuildAllowed(guildId) {
    if (!guildId) return { ok: false, status: 400, error: "missing guild" };
    if (allowedGuildIds && !allowedGuildIds.has(guildId)) {
      return { ok: false, status: 403, error: "forbidden guild" };
    }
    return { ok: true };
  }

  // /api/health
  if (pathname === "/api/health") return json(res, { ok: true });

  // /api/me
  if (pathname === "/api/me") {
    return json(res, {
      ok: true,
      oauth: !!sess,
      user: sess?.user
        ? { id: sess.user.id, username: sess.user.username, global_name: sess.user.global_name }
        : null,
      botGuildCount: client.guilds.cache.size,
    });
  }

  // /api/guilds
  if (pathname === "/api/guilds") {
    // tokenログイン等（OAuthなし）の時：Botが入ってる鯖一覧
    if (!sess) {
      const guilds = client.guilds.cache.map((g) => ({ id: g.id, name: g.name }));
      return json(res, { ok: true, guilds });
    }

    // OAuthあり：ユーザー所属 && Bot導入 && 権限あり の鯖だけ
    const userGuilds = await ensureGuildsForSession(sess);
    const guilds = intersectUserBotGuilds(userGuilds);
    return json(res, { ok: true, guilds });
  }

  // /api/stats
  if (pathname === "/api/stats") {
    const guildId = u.searchParams.get("guild") || "";
    const month = u.searchParams.get("month") || ""; // 例 "2026-01"
    const chk = requireGuildAllowed(guildId);
    if (!chk.ok) return json(res, { ok: false, error: chk.error }, chk.status);

    if (!/^\d{4}-\d{2}$/.test(month)) {
      return json(res, { ok: false, error: "invalid_month_format", hint: "use YYYY-MM (e.g. 2026-01)" }, 400);
    }

    const stats = await getMonthlyStats({ db, guildId, ym: month });
    if (!stats) return json(res, { ok: false, error: "no_stats" }, 400);

    const guild =
      client.guilds.cache.get(guildId) ||
      (await client.guilds.fetch(guildId).catch(() => null));

    if (guild && Array.isArray(stats.topNgUsers)) {
      const named = [];
      for (const row of stats.topNgUsers) {
        const uinfo = await resolveUserLabel(guild, row.user_id);
        named.push({
          ...row,
          user_label: uinfo.user_label,
          display_name: uinfo.display_name,
          username: uinfo.username,
        });
      }
      stats.topNgUsers = named;
    }

    return json(res, { ok: true, stats });
  }

  // /api/ngwords
  if (pathname === "/api/ngwords") {
    const guildId = u.searchParams.get("guild") || "";
    const chk = requireGuildAllowed(guildId);
    if (!chk.ok) return json(res, { ok: false, error: chk.error }, chk.status);

    const words = await getNgWords(guildId);
    return json(res, { ok: true, count: words.length, words });
  }

  // /api/ngwords/add
  if (pathname === "/api/ngwords/add" && req.method === "POST") {
    const body = await readJson(req);
    const guildId = String(body.guild || "");
    const word = String(body.word || "");
    const chk = requireGuildAllowed(guildId);
    if (!chk.ok) return json(res, { ok: false, error: chk.error }, chk.status);

    const r = await addNgWord(guildId, word);
    return json(res, r, r.ok ? 200 : 400);
  }

  // /api/ngwords/remove
  if (pathname === "/api/ngwords/remove" && req.method === "POST") {
    const body = await readJson(req);
    const guildId = String(body.guild || "");
    const word = String(body.word || "");
    const chk = requireGuildAllowed(guildId);
    if (!chk.ok) return json(res, { ok: false, error: chk.error }, chk.status);

    const r = await removeNgWord(guildId, word);
    return json(res, r, r.ok ? 200 : 400);
  }

  // /api/ngwords/clear
  if (pathname === "/api/ngwords/clear" && req.method === "POST") {
    const body = await readJson(req);
    const guildId = String(body.guild || "");
    const chk = requireGuildAllowed(guildId);
    if (!chk.ok) return json(res, { ok: false, error: chk.error }, chk.status);

    const r = await clearNgWords(guildId);
    return json(res, r, r.ok ? 200 : 400);
  }

  // /api/settings
  if (pathname === "/api/settings") {
    const guildId = u.searchParams.get("guild") || "";
    const chk = requireGuildAllowed(guildId);
    if (!chk.ok) return json(res, { ok: false, error: chk.error }, chk.status);

    const settings = await getSettings(guildId);
    return json(res, { ok: true, settings });
  }

  // /api/settings/update
  if (pathname === "/api/settings/update" && req.method === "POST") {
    const body = await readJson(req);
    const guildId = String(body.guild || "");
    const chk = requireGuildAllowed(guildId);
    if (!chk.ok) return json(res, { ok: false, error: chk.error }, chk.status);

    const r = await updateSettings(guildId, {
      ng_threshold: Number(body.ng_threshold),
      timeout_minutes: Number(body.timeout_minutes),
    });
    return json(res, r, r.ok ? 200 : 400);
  }

  // API fallback（必ずJSONで返す：bad_json防止）
  return json(res, { ok: false, error: "not_found" }, 404);
}

/* =========================
   Discord Bot 起動（外で1回だけ）
========================= */
const discordToken =
  process.env.DISCORD_TOKEN ||
  process.env.BOT_TOKEN ||
  process.env.TOKEN ||
  "";

console.log("DISCORD_TOKEN exists:", !!discordToken);

client.on("error", (e) => console.error("Discord client error:", e));
client.on("shardError", (e) => console.error("Discord shard error:", e));

if (!discordToken) {
  console.error("❌ Discord token is missing");
} else {
  client.login(discordToken).catch((e) => {
    console.error("❌ Discord login failed:", e);
  });
}

  } catch (err) {
    console.error("HTTP server error:", err);
    return json(
      res,
      { ok: false, error: "internal_error", message: err?.message || "Internal Server Error" },
      500
    );
  }
}); // ← ★ createServer の閉じ

// ★★★ Render 用：必ず listen ★★★
server.listen(PORT, "0.0.0.0", () => {
  console.log(`🌐 Listening on ${PORT}`);
});
