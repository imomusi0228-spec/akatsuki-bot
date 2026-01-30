// index.js・亥ｮ梧・蠖｢・壻ｸｸ縺斐→繧ｳ繝斐・縺ｧOK・・

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
  ChannelType, // 竊・霑ｽ蜉
} from "discord.js";

import sqlite3 from "sqlite3";
import { open } from "sqlite";

/* =========================
   Log thread helpers (SINGLE SOURCE OF TRUTH)
========================= */

function threadNameFor(kind, dateKey) {
  if (kind === "vc") return `児 VC繝ｭ繧ｰ ${dateKey}`;
  if (kind === "ng") return `圻 NG繝ｭ繧ｰ ${dateKey}`;
  return `東 ${kind} ${dateKey}`;
}

async function ensureLogThread(guild, kind) {
  if (!db) return null;

  const st = await getSettings(guild.id);
  const logChannelId = st?.log_channel_id;
  if (!logChannelId) return null;

  const dateKey = todayKeyTokyo();

  const row = await db.get(
    `SELECT thread_id FROM log_threads WHERE guild_id = ? AND date_key = ? AND kind = ?`,
    guild.id,
    dateKey,
    kind
  );

  if (row?.thread_id) {
    const cached = guild.channels.cache.get(row.thread_id);
    if (cached) return cached;
    const fetched = await guild.channels.fetch(row.thread_id).catch(() => null);
    if (fetched) return fetched;
  }

  const parent =
    guild.channels.cache.get(logChannelId) ||
    (await guild.channels.fetch(logChannelId).catch(() => null));
  if (!parent) return null;

  // 繝・く繧ｹ繝医メ繝｣繝ｳ繝阪Ν蜑肴署・医ヵ繧ｩ繝ｼ繝ｩ繝驕狗畑縺ｪ繧牙ｾ後〒蛻・ｲ舌ｒ雜ｳ縺呻ｼ・
  if (!parent.threads?.create) return null;

    const name = threadNameFor(kind, dateKey);

  let thread = null;

  // 繝輔か繝ｼ繝ｩ繝・域兜遞ｿ=繧ｹ繝ｬ繝・ラ・・
  if (parent.type === ChannelType.GuildForum) {
    thread = await parent.threads.create({
      name,
      autoArchiveDuration: 1440,
      message: { content: `繝ｭ繧ｰ髢句ｧ・ ${name}` },
      reason: "Create daily log thread",
    }).catch(() => null);
  }
  // 繝・く繧ｹ繝茨ｼ医メ繝｣繝ｳ繝阪Ν蜀・せ繝ｬ繝・ラ・・
  else if (parent.threads?.create) {
    thread = await parent.threads.create({
      name,
      autoArchiveDuration: 1440,
      reason: "Create daily log thread",
    }).catch(() => null);

    if (thread) {
      await thread.send({ content: `繝ｭ繧ｰ髢句ｧ・ ${name}` }).catch(() => null);
    }
  }

  if (!thread) return null;

async function sendToKindThread(guild, kind, payload) {
  const th = await ensureLogThread(guild, kind);
  if (!th) return false;
  await th.send(payload).catch(() => null);
  return true;
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
  return `莉頑律 ${hm}`;
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
    <h2>Akatsuki Bot 邂｡逅・判髱｢</h2>
    <p class="muted">Discord OAuth縺ｧ繝ｭ繧ｰ繧､繝ｳ縺励※縺上□縺輔＞縲・/p>
    ${oauthReady ? `<a class="btn" href="/login">Discord縺ｧ繝ｭ繧ｰ繧､繝ｳ</a>` : `<p class="muted">OAuth譛ｪ險ｭ螳夲ｼ・ISCORD_CLIENT_ID/SECRET + PUBLIC_URL 縺悟ｿ・ｦ・ｼ・/p>`}
    ${tokenEnabled ? `<hr/><p class="muted">・井ｿ晞匱・陰DMIN_TOKEN譁ｹ蠑・ <code>/admin?token=XXXX</code></p>` : ``}
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
  <h2>Akatsuki Bot 邂｡逅・判髱｢</h2>

  <div class="row">
    <span class="pill">${oauth ? "Discord OAuth" : "Token"} 縺ｧ繝ｭ繧ｰ繧､繝ｳ荳ｭ</span>
    ${user ? `<span class="pill">User: ${userLabel}</span>` : ``}
    ${oauth ? `<a href="/logout">繝ｭ繧ｰ繧｢繧ｦ繝・/a>` : ``}
    ${tokenAuthed ? `<span class="pill">tokenAuthed</span>` : ``}
  </div>

  <div class="card">
    <div class="row">
      <label>繧ｵ繝ｼ繝舌・:</label>
      <select id="guild"></select>
      <label>Month:</label>
      <input id="month" type="month" />
      <button id="reload">譖ｴ譁ｰ</button>
    </div>
    <div id="guildStatus" class="muted"></div>
    <p class="muted">窶ｻ縲後≠縺ｪ縺溘′謇螻槭阪°縺､縲沓ot縺悟・縺｣縺ｦ繧九阪°縺､縲檎ｮ｡逅・ｨｩ髯・Manage Guild / Admin)縲阪・魃悶□縺大・縺ｾ縺吶・/p>
  </div>

  <div class="grid">
    <div class="card">
      <h3>譛域ｬ｡繧ｵ繝槭Μ</h3>
      <div id="summary" class="muted">譛ｪ蜿門ｾ・/div>
    </div>
    <div class="card">
      <h3>Top NG Users</h3>
      <table>
        <thead><tr><th>User ID</th><th>Count</th></tr></thead>
        <tbody id="topNg"></tbody>
      </table>
    </div>
  </div>

  <div class="grid">
    <div class="card">
      <h3>NG繝ｯ繝ｼ繝・/h3>
      <pre id="ngwords" class="muted">譛ｪ蜿門ｾ・/pre>
      <div class="row">
        <input id="ng_add" placeholder="霑ｽ蜉・井ｾ・ 縺ｰ縺・/ /縺ｰ縺弓縺ゅ⊇/i・・ style="flex:1;min-width:240px" />
        <button id="btn_add">霑ｽ蜉</button>
      </div>
      <div class="row">
        <input id="ng_remove" placeholder="蜑企勁・育匳骭ｲ縺励◆蠖｢蠑上・縺ｾ縺ｾ・・ style="flex:1;min-width:240px" />
        <button id="btn_remove">蜑企勁</button>
      </div>
      <div class="row">
        <button id="btn_clear" style="border:1px solid #f00;">蜈ｨ蜑企勁</button>
        <span class="muted">窶ｻ謌ｻ縺帙∪縺帙ｓ</span>
      </div>
      <div id="ngStatus" class="muted"></div>
    </div>

    <div class="card">
      <h3>NG讀懃衍縺ｮ閾ｪ蜍募・蛻・/h3>
      <div id="settingsBox" class="muted">譛ｪ蜿門ｾ・/div>

      <div class="row" style="margin-top:10px;">
        <label>菴募屓縺ｧ繧ｿ繧､繝繧｢繧ｦ繝茨ｼ・/label>
        <input id="threshold" type="number" min="1" step="1" />
        <label>繧ｿ繧､繝繧｢繧ｦ繝域凾髢難ｼ亥・・・/label>
        <input id="timeout" type="number" min="1" step="1" />
        <button id="btn_save">菫晏ｭ・/button>
      </div>
      <p class="muted">萓具ｼ・蝗槭〒10蛻・ち繧､繝繧｢繧ｦ繝・/p>
      <div id="settingsStatus" class="muted"></div>
    </div>
  </div>

<script>
(() => {
  const $ = (id) => document.getElementById(id);

  function yyyymmNow(){
    const dt = new Date();
    const y = dt.getFullYear();
    const m = String(dt.getMonth()+1).padStart(2,"0");
    return y + "-" + m;
  }

  async function api(path, opts){
    const r = await fetch(path, opts);
    let data = null;
    try { data = await r.json(); } catch { data = { ok:false, error:"bad_json" }; }
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
    if (!keys.length) return '<div class="muted">・井ｻ頑怦縺ｮ繧､繝吶Φ繝医・縺ｾ縺縺ゅｊ縺ｾ縺帙ｓ・・/div>';
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
    const logCh = s.log_channel_id ? s.log_channel_id : "譛ｪ險ｭ螳夲ｼ・setlog 縺ｧ險ｭ螳夲ｼ・;
    return (
      '<table><tbody>' +
        '<tr><td style="width:220px;">邂｡逅・Ο繧ｰ 繝√Ε繝ｳ繝阪ΝID</td><td><b>' + logCh + '</b></td></tr>' +
        '<tr><td>NG讀懃衍 竊・繧ｿ繧､繝繧｢繧ｦ繝医∪縺ｧ</td><td><b>' + (s.ng_threshold ?? 3) + ' 蝗・/b></td></tr>' +
        '<tr><td>繧ｿ繧､繝繧｢繧ｦ繝域凾髢・/td><td><b>' + (s.timeout_minutes ?? 10) + ' 蛻・/b></td></tr>' +
      '</tbody></table>'
    );
  }

  let loading = false;

  async function loadGuilds(){
    const sel = $("guild");
    sel.innerHTML = "";
    sel.disabled = true;

    showStatus("guildStatus", "繧ｵ繝ｼ繝舌・荳隕ｧ繧貞叙蠕嶺ｸｭ...", false);

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
          showStatus("guildStatus", "蜿門ｾ涌K", false);
          return true;
        }
        sel.disabled = false;
        const opt = document.createElement("option");
        opt.value = "";
        opt.textContent = "・・莉ｶ・壽ｨｩ髯・蟆主・迥ｶ豕√ｒ遒ｺ隱搾ｼ・;
        sel.appendChild(opt);
        showStatus("guildStatus", "0莉ｶ縺ｧ縺励◆・域ｨｩ髯・蟆主・迥ｶ豕√ｒ遒ｺ隱搾ｼ・, true);
        return false;
      }

      if (data && data.error) {
        showStatus("guildStatus", "蜿門ｾ怜､ｱ謨・ " + data.error + (data._httpStatus ? " (HTTP " + data._httpStatus + ")" : ""), true);
      } else {
        showStatus("guildStatus", "蜿門ｾ怜､ｱ謨・ unknown", true);
      }
      await new Promise((r)=>setTimeout(r,800));
    }

    sel.disabled = false;
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "・亥叙蠕励〒縺阪∪縺帙ｓ縺ｧ縺励◆縲・api/guilds 繧堤｢ｺ隱搾ｼ・;
    sel.appendChild(opt);
    showStatus("guildStatus", "蜿門ｾ励〒縺阪∪縺帙ｓ縺ｧ縺励◆縲・api/guilds 繧堤峩謗･髢九＞縺ｦ遒ｺ隱阪＠縺ｦ縺上□縺輔＞縲・, true);
    return false;
  }

  async function reload(){
    if (loading) return;
    loading = true;
    try{
      const guildId = $("guild").value;
      const month = $("month").value;
      if (!guildId || !month) {
        $("summary").textContent = "繧ｵ繝ｼ繝舌・縺ｨ譛医ｒ驕ｸ繧薙〒縺上□縺輔＞";
        return;
      }

      // stats
      const stats = await api("/api/stats?guild=" + encodeURIComponent(guildId) + "&month=" + encodeURIComponent(month));
      if (!stats.ok) {
        $("summary").innerHTML = '<div class="err">stats蜿門ｾ怜､ｱ謨・ ' + (stats.error || "unknown") + '</div>';
      } else {
        const summary = stats.stats?.summary ?? {};
        const byType = summary.byType ?? {};
        $("summary").innerHTML =
          '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:10px;">' +
            card("NG讀懃衍", summary.ngDetected ?? 0) +
            card("Timeout", summary.timeouts ?? 0) +
            card("Join", summary.joins ?? 0) +
            card("Leave", summary.leaves ?? 0) +
          '</div>' +
          '<div style="font-weight:600;margin:6px 0;">蜀・ｨｳ・・yType・・/div>' +
          renderByTypeTable(byType);

        const top = stats.stats?.topNgUsers ?? [];
        $("topNg").innerHTML = top.map(x => '<tr><td>' + x.user_id + '</td><td>' + x.cnt + '</td></tr>').join("");
      }

      // ngwords
      const ng = await api("/api/ngwords?guild=" + encodeURIComponent(guildId));
      if (!ng.ok) {
        $("ngwords").textContent = "蜿門ｾ怜､ｱ謨・ " + (ng.error || "unknown");
        showStatus("ngStatus", "蜿門ｾ怜､ｱ謨・ " + (ng.error || "unknown"), true);
      } else {
       $("ngwords").textContent = (ng.words || []).map(w =>
  (w.kind === "regex"
    ? "/" + w.word + "/" + (w.flags || "")
    : w.word)
).join(String.fromCharCode(10)) || "・医↑縺暦ｼ・;

        showStatus("ngStatus", "蜿門ｾ涌K・・ + (ng.count ?? (ng.words||[]).length) + "莉ｶ・・, false);
      }

      // settings
      const st = await api("/api/settings?guild=" + encodeURIComponent(guildId));
      if (!st.ok) {
        $("settingsBox").innerHTML = '<div class="err">蜿門ｾ怜､ｱ謨・ ' + (st.error || "unknown") + '</div>';
        showStatus("settingsStatus", "險ｭ螳壼叙蠕怜､ｱ謨・ " + (st.error || "unknown"), true);
      } else {
        const s = st.settings ?? { log_channel_id:null, ng_threshold:3, timeout_minutes:10 };
        $("settingsBox").innerHTML = renderSettingsBox(s);
        $("threshold").value = s.ng_threshold ?? 3;
        $("timeout").value = s.timeout_minutes ?? 10;
        showStatus("settingsStatus", "蜿門ｾ涌K", false);
      }
    } finally {
      loading = false;
    }
  }

  $("reload").addEventListener("click", reload);
