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
  const escapeHTML = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  function yyyymmNow(){ const d=new Date(); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0"); }
  async function api(path){ const r = await fetch(path); if(r.status===401){window.location.href="/login";return {ok:false};} const t = await r.text(); try { return JSON.parse(t); } catch { return { ok:false, error:t }; } }
  async function post(path, body){ const r = await fetch(path, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body)}); if(r.status===401){window.location.href="/login";return {ok:false};} const t = await r.text(); try { return JSON.parse(t); } catch { return { ok:false, error:t }; } }
  function setLang(l) { document.cookie = "lang="+l+";path=/;max-age=31536000;SameSite=Lax"; location.reload(); }

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
     const selGuild = $("guild");

     const loadMasters = async (gid) => {
        const [ch, rl] = await Promise.all([api(\`/api/channels?guild=\${gid}\`), api(\`/api/roles?guild=\${gid}\`)]);
        if(selLog) {
            selLog.innerHTML = '<option value="">(None / No Log)</option>';
            if(ch.ok) ch.channels.forEach(c => { const o=document.createElement("option"); o.value=c.id; o.textContent="#"+c.name; selLog.appendChild(o); });
        }
        if($("auditRole")) {
            $("auditRole").innerHTML = '<option value="">(None / No Audit)</option>';
            if(rl.ok) rl.roles.forEach(r => { const o=document.createElement("option"); o.value=r.id; o.textContent=r.name; $("auditRole").appendChild(o); });
        }
        if($("introCh")) {
            $("introCh").innerHTML = '<option value="">(None / No Intro Check)</option>';
            if(ch.ok) ch.channels.forEach(c => { const o=document.createElement("option"); o.value=c.id; o.textContent="#"+c.name; $("introCh").appendChild(o); });
        }
     };

     const reload = async () => {
        saveGuildSelection(); const gid = selGuild.value; if(!gid) return;
        
        await loadMasters(gid);
        const [ng, st] = await Promise.all([api(\`/api/ngwords?guild=\${gid}\`), api(\`/api/settings?guild=\${gid}\`)]);
        
        if(ng.ok) {
            const list = $("ngList");
            const words = ng.words || [];
            if(words.length === 0) {
                const clientLang = document.documentElement.lang || 'ja';
                const noneText = clientLang === 'en' ? '(None)' : '(なし)';
                list.innerHTML = '<div class="muted" style="padding:10px; text-align:center;">' + noneText + '</div>';
            } else {
                list.innerHTML = words.map(w => \`
                <div style="display:flex; justify-content:space-between; align-items:center; background:#192734; padding:8px 12px; border-radius:4px; border:1px solid #38444d;">
                    <span style="font-family:monospace;">\${escapeHTML(w.word)}</span>
                    <button onclick="removeNg('\${escapeHTML(w.word)}')" class="btn" style="width:24px; height:24px; padding:0; line-height:22px; color:#f4212e; border-color:#38444d; display:flex; align-items:center; justify-content:center;">－</button>
                </div>\`).join("");
            }
            if($("ngCount")) $("ngCount").textContent = words.length + " words";
        }
        if(st.ok && st.settings) {
            if(selLog) selLog.value = st.settings.log_channel_id || "";
            if($("auditRole")) $("auditRole").value = st.settings.audit_role_id || "";
            if($("introCh")) $("introCh").value = st.settings.intro_channel_id || "";
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
            audit_role_id: $("auditRole")?.value || "",
            intro_channel_id: $("introCh")?.value || "",
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
      const selGuild = document.getElementById("guild");
      const selRole = document.getElementById("auditRole");
      const selIntro = document.getElementById("introCh");

      const reloadCriteria = async () => {
         const gid = selGuild.value;
         if(!gid) return;
         
         const [chRes, roleRes, setRes] = await Promise.all([
            api("/api/channels?guild=" + gid),
            api("/api/roles?guild=" + gid),
            api("/api/settings?guild=" + gid)
         ]);

         if(chRes.ok) {
            selIntro.innerHTML = '<option value="">None</option>' + chRes.channels.map(c => '<option value="' + c.id + '">#' + c.name + '</option>').join('');
         }
         if(roleRes.ok) {
            selRole.innerHTML = '<option value="">None</option>' + roleRes.roles.map(r => '<option value="' + r.id + '">' + r.name + '</option>').join('');
         }
         if(setRes.ok && setRes.settings) {
            selRole.value = setRes.settings.audit_role_id || "";
            selIntro.value = setRes.settings.intro_channel_id || "";
         }
      };

      const runScan = async () => {
         saveGuildSelection(); 
         const gid = selGuild.value;
         const ar = selRole.value;
         const ic = selIntro.value;

         const rows = document.getElementById("act-rows");
         const loading = document.getElementById("act-loading");

         rows.innerHTML = ""; 
         loading.style.display = "block";
         const res = await api("/api/activity?guild=" + gid + "&audit_role_id=" + ar + "&intro_channel_id=" + ic);
         loading.style.display = "none";
         
         if(!res.ok) { 
             const errorMsg = res.error.includes("Upgrade") ? "🔒 " + res.error + ' <a href="/admin/dashboard" style="margin-left:8px;">Check Plans</a>' : res.error;
             rows.innerHTML = '<tr><td colspan="5" style="color:red; text-align:center;">' + errorMsg + '</td></tr>'; 
             return; 
         }
         
      
      let currentData = [];
      const renderRows = (data) => {
          const rows = document.getElementById("act-rows");
          let html = "";
          data.forEach(r => {
             const av = r.avatar_url || "";
             const roleTxt = r.has_role ? '<span style="color:#1da1f2;">✔</span>' : '<span style="color:var(--danger-color);">✘</span>';
             const introTxt = r.has_intro ? '<span style="color:#1da1f2;">✔</span>' : '<span style="color:var(--danger-color);">✘</span>';
             const statusStyle = r.status === "OK" ? 'color:#1da1f2; font-weight:bold;' : 'color:var(--danger-color); font-weight:bold;';
             
             html += '<tr>' +
                 '<td>' + (r.joined_at || '-') + '</td>' +
                 '<td><div style="display:flex; align-items:center; gap:8px;"><img src="' + av + '" style="width:24px; height:24px; border-radius:50%;" /> <span>' + escapeHTML(r.display_name) + '</span></div></td>' +
                 '<td style="text-align:center;">' + roleTxt + '</td>' +
                 '<td style="text-align:center;">' + introTxt + '</td>' +
                 '<td style="text-align:center;">' + r.last_vc + '</td>' +
                 '<td style="text-align:center; ' + statusStyle + '">' + r.status + '</td>' +
             '</tr>';
          });
          rows.innerHTML = html || '<tr><td colspan="6" class="muted" style="text-align:center;">None</td></tr>';
      };

      window.sortActivity = (key) => {
          if(!currentData.length) return;
          currentData.sort((a, b) => {
              const valA = a[key] || "";
              const valB = b[key] || "";
              return valA.localeCompare(valB);
          });
          renderRows(currentData);
      };

      const runScan = async () => {
         saveGuildSelection(); 
         const gid = selGuild.value;
         const ar = selRole.value;
         const ic = selIntro.value;

         const rows = document.getElementById("act-rows");
         const loading = document.getElementById("act-loading");

         rows.innerHTML = ""; 
         loading.style.display = "block";
         const res = await api("/api/activity?guild=" + gid + "&audit_role_id=" + ar + "&intro_channel_id=" + ic);
         loading.style.display = "none";
         
         if(!res.ok) { 
             const errorMsg = res.error.includes("Upgrade") ? "🔒 " + res.error + ' <a href="/admin/dashboard" style="margin-left:8px;">Check Plans</a>' : res.error;
             rows.innerHTML = '<tr><td colspan="6" style="color:red; text-align:center;">' + errorMsg + '</td></tr>'; 
             return; 
         }
         
         currentData = res.data || [];
         // Default sort: NG first (already done by API? Yes, but let's keep it). 
         // API sorts by status NG first. Jst render.
         renderRows(currentData);
      };

      selGuild.onchange = () => { reloadCriteria(); document.getElementById("act-rows").innerHTML = ""; };
      const btnReload = document.getElementById("reload");
      if(btnReload) btnReload.onclick = runScan; 
      document.getElementById("scan").onclick = runScan;

      reloadCriteria();
   }
`;

function getLang(req = {}) {
    const cookies = {};
    (req.headers && req.headers.cookie || "").split(";").forEach((c) => {
        const [k, v] = c.trim().split("=");
        if (k && v) cookies[k] = decodeURIComponent(v);
    });
    return cookies.lang || "ja";
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
            <span style="color:#f91880; margin-right:10px;">☾</span> ${oauth ? t("admin_title", lang) : t("title", lang)} ${langBtn}
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
    <script>const lang = "${lang}"; ${COMMON_SCRIPT}</script>
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
        <div style="background:rgba(0,0,0,0.3); padding:15px; border-radius:8px; border:1px solid #38444d;">
            <div style="margin-bottom:15px;">
                <label style="display:block; margin-bottom:5px; font-size:12px; font-weight:bold; color:#8899a6;">${t("ng_add_label", lang)}</label>
                <div style="display:flex; gap:10px;">
                    <input id="newNg" style="flex:1; padding:10px; border:1px solid #38444d; background:#192734; color:white; border-radius:4px;">
                    <button id="addNg" class="btn" style="width:40px; font-size:20px; padding:0; display:flex; align-items:center; justify-content:center;">＋</button>
                </div>
            </div>
            
            <label style="display:block; margin-bottom:5px; font-size:12px; font-weight:bold; color:#8899a6;">${t("ng_delete_label", lang)}</label>
            <div id="ngList" style="display:flex; flex-direction:column; gap:8px; max-height:300px; overflow-y:auto; padding:5px;"></div>
            
            <div style="display:flex; justify-content:space-between; align-items:center; margin-top:15px; border-top:1px solid #38444d; padding-top:10px;">
                <span id="ngCount" class="muted">0 words</span>
                <button id="btn_clear" class="btn" style="color:#f4212e; border-color:#f4212e; padding:4px 12px; font-size:12px;">${t("ng_clear_all", lang)}</button>
            </div>
        </div>
    </div>

    <div class="card">
        <h3>${t("config_general", lang)}</h3>
        
        <div class="row" style="margin-bottom:15px;">
           <label style="display:block; margin-bottom:5px; font-weight:bold;">${t("log_channel", lang)}</label>
           <p class="muted" style="margin-bottom:8px;">${t("log_channel_desc", lang)}</p>
           <select id="logCh" style="width:100%; padding:10px; background:#192734; border:1px solid #555; color:white;"></select>
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
    const content = `<div class="card">
        <div style="display:flex; flex-wrap:wrap; gap:10px; align-items:flex-end;">
            <div style="flex:1; min-width:200px;">
                <label style="display:block; font-size:12px; margin-bottom:4px; font-weight:bold;">Guild</label>
                <select id="guild" style="width:100%; padding:10px;"></select>
            </div>
            <div style="flex:1; min-width:200px;">
                <label style="display:block; font-size:12px; margin-bottom:4px; font-weight:bold;">${t("audit_role", lang)}</label>
                <select id="auditRole" style="width:100%; padding:10px; background:#192734; border:1px solid #555; color:white;"></select>
            </div>
            <div style="flex:1; min-width:200px;">
                <label style="display:block; font-size:12px; margin-bottom:4px; font-weight:bold;">${t("intro_channel", lang)}</label>
                <select id="introCh" style="width:100%; padding:10px; background:#192734; border:1px solid #555; color:white;"></select>
            </div>
            <div style="display:flex; gap:8px;">
                <button id="scan" class="btn btn-primary">🔍 ${t("scan_btn", lang)}</button>
                <button id="csvExport" class="btn" style="border-color: #ffd700; color: #ffd700;">📊 CSV</button>
            </div>
        </div>
    </div>
    <div class="card">
        <h3 style="display:flex; align-items:center; gap:10px;">
            ${t("activity", lang)}
            <div style="font-size:12px; font-weight:normal; margin-left:auto; display:flex; gap:10px;">
                <button onclick="sortActivity('joined_at')" class="btn" style="padding:4px 8px;">${t("sort_joined", lang)} ▼</button>
                <button onclick="sortActivity('display_name')" class="btn" style="padding:4px 8px;">${t("sort_user", lang)} ▼</button>
            </div>
        </h3>
        <p class="muted">${t("activity_desc", lang)}</p>
        <table class="data-table"><thead><tr><th style="text-align:left">${t("header_joined_at", lang)}</th><th style="text-align:left">${t("header_user", lang)}</th><th>${t("audit_role", lang)}</th><th>${t("last_msg", lang)}</th><th>${t("last_vc", lang)}</th><th>${t("audit_status", lang)}</th></tr></thead>
        <tbody id="act-rows"></tbody></table>
        <div id="act-loading" style="display:none; text-align:center; padding:20px;">Scanning...</div>
    </div>`;
    const scripts = `<script>
        initActivity();
        document.getElementById("csvExport").onclick = () => {
            const gid = $("guild").value;
            const ar = $("auditRole").value;
            const ic = $("introCh").value;
            if(!gid) return;
            window.location.href = \`/api/activity/export?guild=\${gid}&audit_role_id=\${ar}&intro_channel_id=\${ic}\`;
        };
    </script>`;
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
    <style>
        .feature-tabs { display: flex; justify-content: center; gap: 10px; margin-bottom: 30px; }
        .tab-btn { padding: 10px 20px; border: 1px solid var(--border-color); background: #192734; color: #8899a6; cursor: pointer; border-radius: 20px; font-weight: bold; transition: 0.3s; font-size: 14px; }
        .tab-btn.active { background: var(--primary-color); color: white; border-color: var(--primary-color); box-shadow: 0 4px 12px rgba(29, 161, 242, 0.2); }
        .tab-content { display: none; animation: fadeIn 0.4s ease-out; }
        .tab-content.active { display: block; }
        .feature-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 15px; margin-top: 25px; max-width: 1000px; margin-left: auto; margin-right: auto; }
        .plan-card { background: rgba(25, 39, 52, 0.5); border: 1px solid var(--border-color); border-radius: 16px; padding: 40px 20px; text-align: center; max-width: 1100px; margin: 0 auto; }
        .plan-price { font-size: 36px; font-weight: 900; margin: 10px 0; color: var(--primary-color); }
        .plan-badge { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 11px; background: rgba(29, 161, 242, 0.1); color: var(--primary-color); margin-bottom: 10px; text-transform: uppercase; letter-spacing: 1px; }
        .feature-item-card { background: #15202b; border: 1px solid rgba(255,255,255,0.05); padding: 20px; border-radius: 12px; text-align: left; transition: transform 0.2s; }
        .feature-item-card:hover { transform: translateY(-3px); border-color: var(--primary-color); }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
    </style>

    <div style="text-align:center; padding: 40px 20px 20px;">
        <h1 style="font-size: 42px; margin-bottom: 10px;">${t("features_title", lang)}</h1>
        <p style="font-size: 17px; color: #8899a6; margin-bottom: 30px; max-width: 600px; margin-left: auto; margin-right: auto;">${t("features_subtitle", lang)}</p>
    </div>

    <div class="feature-tabs">
        <button class="tab-btn active" onclick="switchTab('free')">${t("plan_free", lang)}</button>
        <button class="tab-btn" onclick="switchTab('pro')">${t("plan_pro", lang)}</button>
        <button class="tab-btn" onclick="switchTab('pro-plus')">${t("plan_pro_plus", lang)}</button>
    </div>

    <div id="tab-free" class="tab-content active">
        <div class="plan-card">
            <span class="plan-badge">Standard</span>
            <h2 style="font-size: 28px;">${t("plan_free", lang)}</h2>
            <div class="plan-price">¥0 <span style="font-size:14px; color:#8899a6; font-weight:normal;">/ Forever</span></div>
            <p style="color:#8899a6; margin-bottom:25px; max-width: 700px; margin-left: auto; margin-right: auto;">${t("plan_free_desc", lang)}</p>
            <div class="feature-grid">
                <div class="feature-item-card">
                    <h4 style="margin-bottom:8px;">🛡️ Security (Basic)</h4>
                    <p class="muted" style="font-size:13px; line-height:1.6;">NGワード制限: ${t("limit_10", lang)}<br/>メッセージの自動削除で清潔な環境を維持します。</p>
                </div>
                <div class="feature-item-card">
                    <h4 style="margin-bottom:8px;">🔊 VC Tracking</h4>
                    <p class="muted" style="font-size:13px; line-height:1.6;">ボイスチャンネルの参加・退出を記録。基本的な統計をお手元に。</p>
                </div>
            </div>
        </div>
    </div>

    <div id="tab-pro" class="tab-content">
        <div class="plan-card" style="border-color: var(--primary-color); background: rgba(29, 161, 242, 0.03);">
            <span class="plan-badge" style="background:var(--primary-color); color:white;">Recommended</span>
            <h2 style="font-size: 28px;">${t("plan_pro", lang)}</h2>
            <div class="plan-price">¥500 <span style="font-size:14px; color:#8899a6; font-weight:normal;">/ Month</span></div>
            <p style="color:#8899a6; margin-bottom:25px; max-width: 700px; margin-left: auto; margin-right: auto;">${t("plan_pro_desc", lang)}</p>
            <div class="feature-grid">
                <div class="feature-item-card">
                    <h4 style="margin-bottom:8px;">⚡ Advanced Security</h4>
                    <p class="muted" style="font-size:13px; line-height:1.6;">NGワード制限: ${t("limit_50", lang)}<br/>${t("features_detail_security", lang)}</p>
                </div>
                <div class="feature-item-card">
                    <h4 style="margin-bottom:8px;">📜 Live Logs</h4>
                    <p class="muted" style="font-size:13px; line-height:1.6;">${t("features_detail_log", lang)}</p>
                </div>
                <div class="feature-item-card">
                    <h4 style="margin-bottom:8px;">🖥️ Web Dashboard</h4>
                    <p class="muted" style="font-size:13px; line-height:1.6;">PC・スマホからいつでもサーバーの状態を直感的に管理。</p>
                </div>
            </div>
        </div>
    </div>

    <div id="tab-pro-plus" class="tab-content">
        <div class="plan-card" style="border-color: #ffd700; background: rgba(255, 215, 0, 0.02);">
            <span class="plan-badge" style="background:#ffd700; color:black;">Premium</span>
            <h2 style="font-size: 28px;">${t("plan_pro_plus", lang)}</h2>
            <div class="plan-price">¥1,500 <span style="font-size:14px; color:#8899a6; font-weight:normal;">/ Month</span></div>
            <p style="color:#8899a6; margin-bottom:25px; max-width: 700px; margin-left: auto; margin-right: auto;">${t("plan_pro_plus_desc", lang)}</p>
            <div class="feature-grid">
                <div class="feature-item-card">
                    <h4 style="margin-bottom:8px;">💎 Multi-Server</h4>
                    <p class="muted" style="font-size:13px; line-height:1.6;">1ライセンスで**最大3つのサーバー**に全特典を適用可能な特権。</p>
                </div>
                <div class="feature-item-card">
                    <h4 style="margin-bottom:8px;">🔍 Server Audit</h4>
                    <p class="muted" style="font-size:13px; line-height:1.6;">${t("features_detail_audit", lang)}</p>
                </div>
                <div class="feature-item-card">
                    <h4 style="margin-bottom:8px;">📊 Data Expert</h4>
                    <p class="muted" style="font-size:13px; line-height:1.6;">CSVエクスポート機能により、自由自在な活動分析を実現。</p>
                </div>
                <div class="feature-item-card">
                    <h4 style="margin-bottom:8px;">🔥 Ultra Security</h4>
                    <p class="muted" style="font-size:13px; line-height:1.6;">NGワード制限: ${t("limit_100", lang)}<br/>制限からの完全な解放。</p>
                </div>
                </div>
            </div>
        </div>
    </div>

    <div class="card" style="margin-top: 40px; padding: 30px;">
        <h3 style="text-align:center; margin-bottom:20px;">${t("quick_comparison", lang)}</h3>
        <table class="compare-table">
            <thead>
                <tr>
                    <th style="text-align:left;"></th>
                    <th>${t("plan_free", lang)}</th>
                    <th>${t("plan_pro", lang)}</th>
                    <th>${t("plan_pro_plus", lang)}</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td style="text-align:left; font-weight:bold;">${t("feature_max_guilds", lang)}</td>
                    <td>1</td>
                    <td>1</td>
                    <td>3</td>
                </tr>
                <tr>
                    <td style="text-align:left; font-weight:bold;">${t("feature_ng_limit", lang)}</td>
                    <td>${t("limit_10", lang)}</td>
                    <td>${t("limit_50", lang)}</td>
                    <td>${t("limit_100", lang)}</td>
                </tr>
                <tr>
                    <td style="text-align:left; font-weight:bold;">${t("feature_logs", lang)}</td>
                    <td>${t("unavailable", lang)}</td>
                    <td>${t("available", lang)}</td>
                    <td>${t("available", lang)}</td>
                </tr>
                <tr>
                    <td style="text-align:left; font-weight:bold;">${t("feature_activity", lang)}</td>
                    <td>${t("unavailable", lang)}</td>
                    <td>${t("unavailable", lang)}</td>
                    <td>${t("available", lang)}</td>
                </tr>
                <tr>
                    <td style="text-align:left; font-weight:bold;">${t("feature_csv", lang)}</td>
                    <td>${t("unavailable", lang)}</td>
                    <td>${t("unavailable", lang)}</td>
                    <td>${t("available", lang)}</td>
                </tr>
            </tbody>
        </table>
    </div>

    <div style="text-align:center; padding: 60px 0;">
        <a href="/login" class="btn btn-primary" style="padding:18px 60px; font-size:20px; border-radius:50px;">${t("get_started", lang)}</a>
    </div>

    <script>
        function switchTab(tab) {
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.getElementById('tab-' + tab).classList.add('active');
            event.currentTarget.classList.add('active');
        }
    </script>
    `;
    return renderLayout({ title: t("features_title", lang), content, user: null }, lang);
}
