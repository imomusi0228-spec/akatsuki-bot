import { ENV } from "../config/env.js";
import { t } from "../core/i18n.js";

export function escapeHTML(s = "") {
    return String(s)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

const COMMON_CSS = `
  :root { --bg-color: #0b1622; --card-bg: #15202b; --text-primary: #ffffff; --text-secondary: #8b9bb4; --border-color: #253341; --accent-color: #1d9bf0; --danger-color: #f4212e; --success-color: #00ba7c; }
  body { font-family: system-ui, -apple-system, sans-serif; margin: 0; padding: 16px; background-color: var(--bg-color); color: var(--text-primary); }
  a { color: var(--accent-color); text-decoration: none; } a:hover { text-decoration: underline; }
  .btn { display: inline-block; padding: 8px 16px; border-radius: 6px; text-decoration: none; font-weight: 600; cursor: pointer; border: 1px solid var(--border-color); background: var(--card-bg); color: var(--text-primary); transition: background 0.2s; }
  .btn:hover { background: #2c3640; text-decoration: none; }
  .btn-primary { background: var(--accent-color); border-color: var(--accent-color); color: #fff; }
  .btn-primary:hover { opacity: 0.9; }
  .card { background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 12px; padding: 20px; margin-bottom: 16px; max-width: 900px; margin-left: auto; margin-right: auto; }
  .muted { color: var(--text-secondary); font-size: 0.9em; }
  input, select, button { padding: 8px 12px; border-radius: 6px; border: 1px solid var(--border-color); background: #000; color: #fff; font-size: 14px; }
  h1, h2, h3 { color: var(--text-primary); margin-top: 0; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; color: var(--text-secondary); border-bottom: 1px solid var(--border-color); padding: 8px; }
  td { border-bottom: 1px solid var(--border-color); padding: 8px; }
  tr:last-child td { border-bottom: none; }
  .nav-bar { display: flex; gap: 8px; margin-bottom: 20px; border-bottom: 1px solid var(--border-color); padding-bottom: 12px; max-width: 900px; margin-left: auto; margin-right: auto; }
  .nav-item { padding: 8px 16px; border-radius: 6px; color: var(--text-secondary); font-weight: 600; }
  .nav-item:hover { background: rgba(255,255,255,0.05); text-decoration: none; }
  .nav-item.active { color: var(--accent-color); background: rgba(29, 155, 240, 0.1); }
  .pricing-table th, .pricing-table td { border: 1px solid #38444d; padding: 12px; text-align: center; }
  .pricing-table th { background: #192734; }
  .check { color: #00ba7c; font-weight: bold; }
  .cross { color: #f91880; font-weight: bold; }
  .lang-switch { cursor: pointer; color: #8899a6; margin-left: 15px; font-size: 0.9em; }
  .lang-switch:hover { color: #fff; }
`;

const COMMON_SCRIPT = `
  const $ = (id) => document.getElementById(id);
  function yyyymmNow(){ const d=new Date(); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0"); }
  async function api(path){ const r = await fetch(path); const t = await r.text(); try { return JSON.parse(t); } catch { return { ok:false, error:t }; } }
  async function post(path, body){ const r = await fetch(path, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body)}); const t = await r.text(); try { return JSON.parse(t); } catch { return { ok:false, error:t }; } }
  function setLang(l) { document.cookie = "lang="+l+";path=/;max-age=31536000"; location.reload(); }

  let _guildsLoaded = false;
  async function loadGuilds() {
     if (_guildsLoaded) return true;
     const sel = $("guild");
     if(!sel) return false;
     sel.innerHTML = "<option>Loading...</option>"; sel.disabled = true;
     const d = await api("/api/guilds");
     sel.innerHTML = "";
     if (d && d.ok && d.guilds && d.guilds.length) {
       const lastGid = localStorage.getItem("last_guild_id"); let selectedIndex = 0;
       d.guilds.forEach((g, i) => { const o = document.createElement("option"); o.value = g.id; o.textContent = g.name; sel.appendChild(o); if(lastGid && g.id === lastGid) selectedIndex = i; });
       sel.selectedIndex = selectedIndex; sel.disabled = false; _guildsLoaded = true; return true;
     }
     const o = document.createElement("option"); o.textContent = "(No Guilds)"; sel.appendChild(o);
     $("guildStatus").textContent = "Check Bot Permissions/Invite"; return false;
  }
  function saveGuildSelection() { const sel = $("guild"); if(sel && sel.value) localStorage.setItem("last_guild_id", sel.value); }

  async function initDashboard() {
     if(!await loadGuilds()) return;
     $("month").value = yyyymmNow();
     const reload = async () => {
        saveGuildSelection(); const gid = $("guild").value; const mon = $("month").value; if(!gid) return;
        $("summary").innerHTML = "Loading...";
        const res = await api(\`/api/stats?guild=\${gid}&month=\${mon}\`);
        if (res.ok) {
           const s = res.stats.summary;
           const sub = res.subscription;
           $("plan-info").innerHTML = \`<span style="color:var(--accent-color); font-weight:bold;">\${sub.name}</span> \${sub.valid_until ? '('+sub.valid_until.split('T')[0]+')' : ''}\`;
           
           const box = (l,v) => \`<div style="background:rgba(255,255,255,0.05); padding:10px; border-radius:8px; text-align:center;"><div style="font-size:24px; font-weight:bold;">\${v}</div><div style="font-size:11px; color:#888;">\${l}</div></div>\`;
           $("summary").innerHTML = \`<div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:8px; width:100%;">\${box("VC Joins", s.joins)} \${box("Leaves", s.leaves)} \${box("Timeouts", s.timeouts)} \${box("NG Detect", s.ngDetected)}</div>\`;
           let rows = ""; (res.stats.topNgUsers || []).forEach(u => { rows += \`<tr><td>\${escapeHTML(u.display_name)}</td><td style="text-align:right">\${u.cnt}</td></tr>\`; });
           $("topNg").innerHTML = rows || '<tr><td colspan="2" class="muted" style="text-align:center; padding:10px;">None</td></tr>';
        } else { $("summary").innerText = "Error: " + res.error; }
     };
     $("guild").onchange = reload; $("month").onchange = reload; $("reload").onclick = reload; reload();
  }

  async function initSettings() {
     if(!await loadGuilds()) return;
     
     const lang = document.documentElement.lang || 'ja';
     const selLog = $("logCh");
     const selRole = $("roleId");
     const selGuild = $("guild");

     const loadMasters = async (gid) => {
        const [ch, rl] = await Promise.all([api(\`/api/channels?guild=\${gid}\`), api(\`/api/roles?guild=\${gid}\`)]);
        if(selLog) {
            selLog.innerHTML = '<option value="">(None / No Log)</option>';
            if(ch.ok) ch.channels.forEach(c => { const o=document.createElement("option"); o.value=c.id; o.textContent="#"+c.name; selLog.appendChild(o); });
        }
        if(selRole) {
            selRole.innerHTML = '<option value="">(None / No AutoRole)</option>';
            if(rl.ok) rl.roles.forEach(r => { const o=document.createElement("option"); o.value=r.id; o.textContent=r.name; selRole.appendChild(o); });
        }
     };

     const reload = async () => {
        saveGuildSelection(); const gid = selGuild.value; if(!gid) return;
        
        await loadMasters(gid);
        const [ng, st] = await Promise.all([api(\`/api/ngwords?guild=\${gid}\`), api(\`/api/settings?guild=\${gid}\`)]);
        
        if(ng.ok) {
            $("ngList").innerHTML = (ng.words||[]).map(w => `< span class="btn" style = "padding:4px 8px; font-size:12px; margin-right:5px; margin-bottom:5px;" >\${ escapeHTML(w.word) } <span onclick="removeNg('\${escapeHTML(w.word)}')" style="color:var(--danger-color); cursor:pointer; margin-left:5px;">×</span></span > `).join("");
        }
        if(st.ok && st.settings) {
            if(selLog) selLog.value = st.settings.log_channel_id || "";
            if(selRole) selRole.value = st.settings.autorole_id || "";
            if($("threshold")) $("threshold").value = st.settings.ng_threshold ?? 3;
            if($("timeout")) $("timeout").value = st.settings.timeout_minutes ?? 10;
        }
     };

     window.removeNg = async (w) => { await post("/api/ngwords/remove", {guild: selGuild.value, word: w }); reload(); };
     $("addNg").onclick = async () => { const w = $("newNg").value; if(!w)return; await post("/api/ngwords/add", {guild: selGuild.value, word: w }); $("newNg").value=""; reload(); };
     $("btn_clear").onclick = async () => { if(!confirm("Clear all?"))return; await post("/api/ngwords/clear", {guild: selGuild.value }); reload(); };
     
     $("save").onclick = async () => {
        const body = {
            guild: selGuild.value,
            log_channel_id: selLog.value,
            autorole_id: selRole.value,
            ng_threshold: parseInt($("threshold").value),
            timeout_minutes: parseInt($("timeout").value)
        };
        const res = await post("/api/settings/update", body);
        const stat = $("saveStatus");
        if(res.ok) {
            stat.textContent = lang === 'ja' ? "✅ 設定を保存しました" : "✅ Settings saved";
            stat.style.color = "var(--success-color)";
            setTimeout(() => stat.textContent="", 3000);
        } else {
            stat.textContent = "Error: " + res.error;
            stat.style.color = "var(--danger-color)";
        }
     };

     selGuild.onchange = reload; $("reload").onclick = reload; reload();
  }

  async function initActivity() {
     if(!await loadGuilds()) return;
     const runScan = async () => {
        saveGuildSelection(); const gid = $("guild").value;
        $("act-rows").innerHTML = ""; $("act-loading").style.display = "block";
        const res = await api(\`/api/activity?guild=\${gid}\`);
        $("act-loading").style.display = "none";
        
        if(!res.ok) { 
            const errorMsg = res.error.includes("Upgrade") ? \`🔒 \${res.error} <a href="/admin/dashboard" style="margin-left:8px;">Check Plans</a>\` : res.error;
            $("act-rows").innerHTML = \`<tr><td colspan="5" style="color:red; text-align:center;">\${errorMsg}</td></tr>\`; 
            return; 
        }
        
        let html = "";
        (res.data || []).forEach(r => {
           const av = r.avatar_url || "";
           html += \`<tr><td>\${r.joined_at}</td><td><div style="display:flex; align-items:center; gap:8px;"><img src="\${av}" style="width:24px; height:24px; border-radius:50%;" /> <span>\${escapeHTML(r.display_name)}</span></div></td><td>\${r.last_vc}</td><td>\${r.has_role}</td><td>\${r.has_intro}</td></tr>\`;
        });
        $("act-rows").innerHTML = html || '<tr><td colspan="5" class="muted" style="text-align:center;">None</td></tr>';
     };
     $("guild").onchange = () => { $("act-rows").innerHTML = ''; };
     $("reload").onclick = runScan; $("btn_scan").onclick = runScan;
  }
`;

function getLang(req = {}) {
    const cookie = (req.headers && req.headers.cookie) || "";
    const match = cookie.match(/lang=([a-z]{2})/);
    return match ? match[1] : "ja";
}

function renderLayout({ title, content, user, activeTab, oauth = false, scripts = "" }, lang = 'ja') {
    const navItem = (lbl, href, act) => `<a href="${href}" class="nav-item ${act ? 'active' : ''}">${lbl}</a>`;
    const langBtn = lang === 'ja'
        ? `<span class="lang-switch" onclick="setLang('en')">🇺🇸 English</span>`
        : `<span class="lang-switch" onclick="setLang('ja')">🇯🇵 日本語</span>`;

    return `<!DOCTYPE html>
<html lang="${lang}">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${title} | Akatsuki</title><style>${COMMON_CSS}</style></head>
<body>
    <div class="nav-bar" style="border:none; justify-content: space-between; align-items: center; margin-bottom: 0; padding:16px 0;">
        <div style="font-size: 24px; font-weight: bold; display:flex; align-items:center;">
            <span style="color:#f91880; margin-right:10px;">☾</span> Akatsuki ${langBtn}
        </div>
        <div>
            ${oauth && user ? `
                <span class="muted" style="margin-right:15px;">${escapeHTML(user.username)}</span>
                <a href="/logout" class="btn" style="padding:4px 12px; font-size:12px;">${t("logout", lang)}</a>
            ` : `
                <a href="/login" class="btn">${t("login", lang)}</a>
            `}
        </div>
    </div>
    ${oauth && user ? `
    <div class="nav-bar">
        ${navItem(t("dashboard", lang), "/admin/dashboard", activeTab === "dashboard")}
        ${navItem(t("settings", lang), "/admin/settings", activeTab === "settings")}
        ${navItem(t("activity", lang), "/admin/activity", activeTab === "activity")}
    </div>` : ''}
    
    <div id="main-content">${content}</div>
    <div style="text-align:center; padding: 20px; color: #8899a6; font-size:0.8em; margin-top:40px;">&copy; 2026 Akatsuki Bot</div>
    <script>${COMMON_SCRIPT}</script>
    ${scripts}
</body></html>`;
}

export function renderLoginHTML(req) {
    const lang = getLang(req);
    const content = `<div style="text-align:center; padding:50px;"><h2>${t("login_required", lang)}</h2><br/><a href="/auth/discord" class="btn">${t("login", lang)}</a></div>`;
    return renderLayout({ title: t("login", lang), content, user: null }, lang);
}

export function renderAdminDashboardHTML({ user, req }) {
    const lang = getLang(req);
    const content = `<div class="card"><div style="display:flex; gap:12px; flex-wrap:wrap; margin-bottom:16px; align-items:center;"><select id="guild" style="flex:1; max-width:250px; padding:10px;"></select><input id="month" type="month" style="padding:9px;" /><button id="reload" class="btn">Reload</button><span id="guildStatus" class="muted"></span> <div style="margin-left:auto;">Plan: <span id="plan-info">Loading...</span></div></div></div>
  <div class="card"><h3>${t("summary", lang)}</h3><div id="summary">Loading...</div></div>
  <div class="card"><h3>${t("top_ng_users", lang)}</h3><table class="data-table"><thead><tr><th>User</th><th style="text-align:right">Count</th></tr></thead><tbody id="topNg"></tbody></table></div>`;
    const scripts = `<script>initDashboard();</script>`;
    return renderLayout({ title: t("dashboard", lang), content, user, activeTab: "dashboard", oauth: true, scripts }, lang);
}

export function renderAdminSettingsHTML({ user, req }) {
    const lang = getLang(req);
    const content = `<div class="card"><div class="row" style="margin-bottom:16px;"><select id="guild" style="width:100%; max-width:300px; padding:10px;"></select> <button id="reload" class="btn">Reload</button></div></div>
    
    <div class="card">
        <h3>${t("ng_words", lang)}</h3>
        <div style="display:flex; gap:10px; margin-bottom:10px;">
            <input id="newNg" placeholder="${t("ng_add_placeholder", lang)}" style="flex:1; padding:10px; border:1px solid #38444d; background:#192734; color:white; border-radius:4px;">
            <button id="addNg" class="btn">${t("ng_add_btn", lang)}</button>
        </div>
        <div id="ngList" style="display:flex; flex-wrap:wrap; gap:8px;"></div>
        <div style="margin-top:20px; text-align:right;"><button id="btn_clear" class="btn" style="color:red; border-color:red;">Clear All</button></div>
    </div>

    <div class="card">
        <h3>${t("config_general", lang)}</h3>
        
        <div class="row" style="margin-bottom:15px;">
           <label style="display:block; margin-bottom:5px; font-weight:bold;">${t("log_channel", lang)}</label>
           <p class="muted" style="margin-bottom:8px;">${t("log_channel_desc", lang)}</p>
           <select id="logCh" style="width:100%; padding:10px; background:#192734; border:1px solid #555; color:white;"></select>
        </div>

        <div class="row" style="margin-bottom:15px;">
           <label style="display:block; margin-bottom:5px; font-weight:bold;">${t("autorole", lang)}</label>
           <p class="muted" style="margin-bottom:8px;">${t("autorole_desc", lang)}</p>
           <select id="roleId" style="width:100%; padding:10px; background:#192734; border:1px solid #555; color:white;"></select>
        </div>

        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:15px; margin-top:20px; border-top: 1px solid var(--border-color); padding-top:20px;">
            <div>
                <label style="display:block; margin-bottom:8px;">${t("threshold_label", lang)}</label>
                <input id="threshold" type="number" min="1" max="10" style="width:100%; padding:10px;">
            </div>
            <div>
                <label style="display:block; margin-bottom:8px;">${t("timeout_label", lang)}</label>
                <select id="timeout" style="width:100%; padding:10px; background:#192734; border:1px solid #555; color:white;">
                    <option value="1">1分 (60秒)</option>
                    <option value="5">5分</option>
                    <option value="10">10分</option>
                    <option value="60">1時間</option>
                    <option value="1440">1日</option>
                    <option value="10080">1週間</option>
                </select>
            </div>
        </div>

        <div style="margin-top:30px; text-align:center;">
            <button id="save" class="btn btn-primary" style="padding:12px 40px; font-size:16px;">${t("save", lang)}</button>
            <div id="saveStatus" style="margin-top:10px; min-height:20px; font-weight:bold;"></div>
        </div>
    </div>`;
    const scripts = `<script>initSettings();</script>`;
    return renderLayout({ title: t("settings", lang), content, user, activeTab: "settings", oauth: true, scripts }, lang);
}

export function renderAdminActivityHTML({ user, req }) {
    const lang = getLang(req);
    const content = `<div class="card"><div class="row" style="margin-bottom:16px;"><select id="guild" style="width:100%; max-width:300px; padding:10px;"></select> <button id="scan" class="btn">${t("scan_btn", lang)}</button></div></div>
    <div class="card">
        <h3>${t("activity", lang)}</h3>
        <p class="muted">${t("activity_desc", lang)}</p>
        <table class="data-table"><thead><tr><th style="text-align:left">User</th><th>${t("last_vc", lang)}</th><th>Duration</th><th>${t("last_msg", lang)}</th><th>Status</th></tr></thead>
        <tbody id="act-rows"></tbody></table>
        <div id="act-loading" style="display:none; text-align:center; padding:20px;">Scanning...</div>
    </div>`;
    const scripts = `<script>initActivity();</script>`;
    return renderLayout({ title: t("activity", lang), content, user, activeTab: "activity", oauth: true, scripts }, lang);
}

export function renderLandingHTML(req) {
    const lang = getLang(req);
    const content = `
    <div style="text-align:center; padding: 100px 20px;">
        <h1 style="font-size: 56px; margin-bottom: 20px;">☾ ${t("title", lang)}</h1>
        <p style="font-size: 20px; color: #8899a6; margin-bottom: 50px; max-width: 600px; margin-left: auto; margin-right: auto;">${t("subtitle", lang)}</p>
        <div style="display:flex; justify-content:center; gap:20px; flex-wrap: wrap;">
           <a href="/login" class="btn btn-primary" style="padding:16px 48px; font-size:18px;">${t("login", lang)}</a>
           <a href="/features" class="btn" style="padding:16px 48px; font-size:18px;">${t("view_features", lang)}</a>
        </div>
    </div>
    `;
    return renderLayout({ title: t("title", lang), content, user: null }, lang);
}

export function renderFeaturesHTML(req) {
    const lang = getLang(req);
    const check = `<span class="check">${t("available", lang)}</span>`;
    const cross = `<span class="cross">${t("unavailable", lang)}</span>`;

    const content = `
    <div style="text-align:center; padding: 60px 0;">
        <h1 style="font-size: 48px; margin-bottom: 20px;">${t("features_title", lang)}</h1>
        <p style="font-size: 18px; color: #8899a6; margin-bottom: 40px;">${t("features_subtitle", lang)}</p>
    </div>

    <div class="card">
        <h3>Pricing & Features</h3>
        <table class="pricing-table">
            <thead>
                <tr>
                    <th style="text-align:left">Feature</th>
                    <th>${t("plan_free", lang)}</th>
                    <th>${t("plan_pro", lang)}</th>
                    <th>${t("plan_pro_plus", lang)}</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td style="text-align:left">${t("feature_ng_limit", lang)}</td>
                    <td>${t("limit_10", lang)}</td>
                    <td>${t("limit_50", lang)}</td>
                    <td>${t("limit_100", lang)}</td>
                </tr>
                <tr>
                    <td style="text-align:left">${t("feature_logs", lang)}</td>
                    <td>${cross}</td>
                    <td>${check}</td>
                    <td>${check}</td>
                </tr>
                <tr>
                    <td style="text-align:left">${t("feature_dashboard", lang)}</td>
                    <td>${cross}</td>
                    <td>${check}</td>
                    <td>${check}</td>
                </tr>
                 <tr>
                    <td style="text-align:left">${t("feature_activity", lang)}</td>
                    <td>${cross}</td>
                    <td>${cross}</td>
                    <td>${check}</td>
                </tr>
            </tbody>
        </table>
    </div>

    <div style="text-align:center; padding: 40px 0;">
        <a href="/login" class="btn btn-primary" style="padding:16px 48px; font-size:18px;">${t("get_started", lang)}</a>
    </div>
    `;
    return renderLayout({ title: t("features_title", lang), content, user: null }, lang);
}
