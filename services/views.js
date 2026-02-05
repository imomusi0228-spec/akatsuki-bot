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

const COMMON_CSS = \`
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
\`;

const COMMON_SCRIPT = \`
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
     const reload = async () => {
        saveGuildSelection(); const gid = $("guild").value; if(!gid) return;
        const [ng, st] = await Promise.all([api(\`/api/ngwords?guild=\${gid}\`), api(\`/api/settings?guild=\${gid}\`)]);
        if(ng.ok) {
           $("ngwords").textContent = (ng.words||[]).map(w => w.kind==="regex" ? "/" + w.word + "/" : w.word).join("\\n") || "(None)";
           $("ngStatus").textContent = (ng.words||[]).length + " words";
        }
        if(st.ok && st.settings) {
           $("threshold").value = st.settings.ng_threshold ?? 3;
           $("timeout").value = st.settings.timeout_minutes ?? 10;
        }
     };
     $("guild").onchange = reload; $("reload").onclick = reload;
     $("btn_add").onclick = async () => { const w = $("ng_add").value; if(!w)return; await post("/api/ngwords/add", {guild: $("guild").value, word: w }); $("ng_add").value=""; reload(); };
     $("btn_remove").onclick = async () => { const w = $("ng_remove").value; if(!w)return; await post("/api/ngwords/remove", {guild: $("guild").value, word: w }); $("ng_remove").value=""; reload(); };
     $("btn_clear").onclick = async () => { if(!confirm("Clear all?"))return; await post("/api/ngwords/clear", {guild: $("guild").value }); reload(); };
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
\`;

function getLang(req = {}) {
   const cookie = (req.headers && req.headers.cookie) || "";
   const match = cookie.match(/lang=([a-z]{2})/);
   return match ? match[1] : "ja";
}

function renderLayout({ title, content, user, activeTab, oauth = false, scripts = "" }, lang = 'ja') {
    const navItem = (lbl, href, act) => \`<a href="\${href}" class="nav-item \${act ? 'active' : ''}">\${lbl}</a>\`;
    const langBtn = lang === 'ja' 
        ? \`<span class="lang-switch" onclick="setLang('en')">🇺🇸 English</span>\` 
        : \`<span class="lang-switch" onclick="setLang('ja')">🇯🇵 日本語</span>\`;

    return \`<!DOCTYPE html>
<html lang="\${lang}">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>\${title} | Akatsuki</title><style>\${COMMON_CSS}</style></head>
<body>
    <div class="nav-bar" style="border:none; justify-content: space-between; align-items: center; margin-bottom: 0; padding:16px 0;">
        <div style="font-size: 24px; font-weight: bold; display:flex; align-items:center;">
            <span style="color:#f91880; margin-right:10px;">☾</span> Akatsuki \${langBtn}
        </div>
        <div>
            \${oauth && user ? \`
                <span class="muted" style="margin-right:15px;">\${escapeHTML(user.username)}</span>
                <a href="/logout" class="btn" style="padding:4px 12px; font-size:12px;">\${t("logout", lang)}</a>
            \` : \`
                <a href="/login" class="btn">\${t("login", lang)}</a>
            \`}
        </div>
    </div>
    \${oauth && user ? \`
    <div class="nav-bar">
        \${navItem(t("dashboard", lang), "/admin/dashboard", activeTab==="dashboard")}
        \${navItem(t("settings", lang), "/admin/settings", activeTab==="settings")}
        \${navItem(t("activity", lang), "/admin/activity", activeTab==="activity")}
    </div>\` : ''}
    
    <div id="main-content">\${content}</div>
    <div style="text-align:center; padding: 20px; color: #8899a6; font-size:0.8em; margin-top:40px;">&copy; 2026 Akatsuki Bot</div>
    <script>\${COMMON_SCRIPT}</script>
    \${scripts}
</body></html>\`;
}

export function renderLoginHTML(req) { 
  const lang = getLang(req);
  const content = \`<div style="text-align:center; padding:50px;"><h2>\${t("login_required", lang)}</h2><br/><a href="/auth/discord" class="btn">\${t("login", lang)}</a></div>\`;
  return renderLayout({ title: t("login", lang), content, user: null }, lang);
}

export function renderAdminDashboardHTML({ user, req }) { 
  const lang = getLang(req);
  const content = \`<div class="card"><div style="display:flex; gap:12px; flex-wrap:wrap; margin-bottom:16px; align-items:center;"><select id="guild" style="flex:1; max-width:250px; padding:10px;"></select><input id="month" type="month" style="padding:9px;" /><button id="reload" class="btn">Reload</button><span id="guildStatus" class="muted"></span> <div style="margin-left:auto;">Plan: <span id="plan-info">Loading...</span></div></div></div>
  <div class="card"><h3>\${t("summary", lang)}</h3><div id="summary">Loading...</div></div>
  <div class="card"><h3>\${t("top_ng_users", lang)}</h3><table class="data-table"><thead><tr><th>User</th><th style="text-align:right">Count</th></tr></thead><tbody id="topNg"></tbody></table></div>\`;
  const scripts = \`<script>initDashboard();</script>\`;
  return renderLayout({ title: t("dashboard", lang), content, user, activeTab: "dashboard", oauth: true, scripts }, lang);
}

export function renderAdminSettingsHTML({ user, req }) { 
    const lang = getLang(req);
    const content = \`<div class="card"><div class="row" style="margin-bottom:16px;"><select id="guild" style="width:100%; max-width:300px; padding:10px;"></select> <button id="reload" class="btn">Reload</button></div></div>
    <div class="card">
        <h3>\${t("ng_words", lang)}</h3>
        <div style="display:flex; gap:10px; margin-bottom:10px;">
            <input id="newNg" placeholder="\${t("ng_add_placeholder", lang)}" style="flex:1; padding:10px; border:1px solid #38444d; background:#192734; color:white; border-radius:4px;">
            <button id="addNg" class="btn">\${t("ng_add_btn", lang)}</button>
        </div>
        <div id="ngList" style="display:flex; flex-wrap:wrap; gap:8px;"></div>
        <div style="margin-top:20px; text-align:right;"><button id="btn_clear" class="btn" style="color:red; border-color:red;">Clear All</button></div>
    </div>
    <div class="card">
        <h3>Configuration</h3>
        <div class="row" style="margin-bottom:10px;">
           <label>\${t("log_channel", lang)} ID</label>
           <input id="logCh" style="width:100%; padding:8px; background:#192734; border:1px solid #555; color:white; margin-top:5px;">
        </div>
        <div class="row">
           <label>\${t("autorole", lang)} ID (\${t("autorole_desc", lang)})</label>
           <input id="roleId" style="width:100%; padding:8px; background:#192734; border:1px solid #555; color:white; margin-top:5px;">
        </div>
        <div class="row" style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-top:10px;">
            <div><label>NG Threshold</label><input id="threshold" type="number" min="1" style="width:100%;"></div>
            <div><label>Timeout (min)</label><input id="timeout" type="number" min="1" style="width:100%;"></div>
        </div>
    </div>\`;
    const scripts = \`<script>initSettings();</script>\`;
    return renderLayout({ title: t("settings", lang), content, user, activeTab: "settings", oauth: true, scripts }, lang);
}

export function renderAdminActivityHTML({ user, req }) { 
    const lang = getLang(req);
    const content = \`<div class="card"><div class="row" style="margin-bottom:16px;"><select id="guild" style="width:100%; max-width:300px; padding:10px;"></select> <button id="scan" class="btn">\${t("scan_btn", lang)}</button></div></div>
    <div class="card">
        <h3>\${t("activity", lang)}</h3>
        <p class="muted">\${t("activity_desc", lang)}</p>
        <table class="data-table"><thead><tr><th style="text-align:left">User</th><th>\${t("last_vc", lang)}</th><th>Duration</th><th>\${t("last_msg", lang)}</th><th>Status</th></tr></thead>
        <tbody id="act-rows"></tbody></table>
        <div id="act-loading" style="display:none; text-align:center; padding:20px;">Scanning...</div>
    </div>\`;
    const scripts = \`<script>initActivity();</script>\`;
    return renderLayout({ title: t("activity", lang), content, user, activeTab: "activity", oauth: true, scripts }, lang);
}

export function renderPublicGuideHTML(req) { 
    const lang = getLang(req);
    const check = \`<span class="check">\${t("available", lang)}</span>\`;
    const cross = \`<span class="cross">\${t("unavailable", lang)}</span>\`;
    
    const content = \`
    <div style="text-align:center; padding: 60px 0;">
        <h1 style="font-size: 48px; margin-bottom: 20px;">\${t("title", lang)}</h1>
        <p style="font-size: 18px; color: #8899a6; margin-bottom: 40px;">\${t("subtitle", lang)}</p>
        <div style="display:flex; justify-content:center; gap:20px;">
           <a href="/login" class="btn" style="padding:15px 40px; font-size:18px;">\${t("login", lang)}</a>
        </div>
    </div>

    <div class="card">
        <h3>Pricing & Features</h3>
        <table class="pricing-table">
            <thead>
                <tr>
                    <th style="text-align:left">Feature</th>
                    <th>\${t("plan_free", lang)}</th>
                    <th>\${t("plan_pro", lang)}</th>
                    <th>\${t("plan_pro_plus", lang)}</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td style="text-align:left">\${t("feature_ng_limit", lang)}</td>
                    <td>\${t("limit_10", lang)}</td>
                    <td>\${t("limit_50", lang)}</td>
                    <td>\${t("limit_100", lang)}</td>
                </tr>
                <tr>
                    <td style="text-align:left">\${t("feature_logs", lang)}</td>
                    <td>\${cross}</td>
                    <td>\${check}</td>
                    <td>\${check}</td>
                </tr>
                <tr>
                    <td style="text-align:left">\${t("feature_dashboard", lang)}</td>
                    <td>\${cross}</td>
                    <td>\${check}</td>
                    <td>\${check}</td>
                </tr>
                 <tr>
                    <td style="text-align:left">\${t("feature_activity", lang)}</td>
                    <td>\${cross}</td>
                    <td>\${cross}</td>
                    <td>\${check}</td>
                </tr>
            </tbody>
        </table>
    </div>
    \`;
    return renderLayout({ title: t("guide", lang), content, user: null }, lang);
}
