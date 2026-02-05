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
`;

const COMMON_SCRIPT = `
  const $ = (id) => document.getElementById(id);
  function yyyymmNow(){ const d=new Date(); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0"); }
  async function api(path){ const r = await fetch(path); const t = await r.text(); try { return JSON.parse(t); } catch { return { ok:false, error:t }; } }
  async function post(path, body){ const r = await fetch(path, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body)}); const t = await r.text(); try { return JSON.parse(t); } catch { return { ok:false, error:t }; } }

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
function setLang(l) { document.cookie = "lang="+l+";path=/;max-age=31536000"; location.reload(); }
async function api(url, method="GET", body=null) {
    const res = await fetch(url, { method, headers: {"Content-Type":"application/json"}, body: body ? JSON.stringify(body) : null });
    return res.json();
}
function escapeHTML(str) { return str.replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[m]); }
const $ = (id) => document.getElementById(id);
const yyyymmNow = () => new Date().toISOString().slice(0, 7);
function saveGuildSelection() { localStorage.setItem("last_guild", $("guild").value); }
async function loadGuilds() {
    const res = await api("/api/guilds");
    if (res.ok) {
        let opts = "";
        res.data.forEach(g => opts += \`<option value="\${g.id}">\${escapeHTML(g.name)}</option>\`);
        if (!opts) return false;
        $("guild").innerHTML = opts;
        const last = localStorage.getItem("last_guild");
        if (last && Array.from($("guild").options).some(o => o.value === last)) $("guild").value = last;
        return true;
    } else if (res.redirect) { location.href = res.redirect; return false; }
    return false;
}
`;

function renderLayout({ title, content, user, activeTab, oauth = false, scripts = "" }, lang = 'ja') {
   const navItem = (lbl, href, act) => `<a href="${href}" style="margin-left: 20px; color:${act ? '#fff' : '#8899a6'}; font-weight:${act ? 'bold' : 'normal'}">${lbl}</a>`;
   const langBtn = lang === 'ja'
      ? `<span class="lang-switch" onclick="setLang('en')">🇺🇸 English</span>`
      : `<span class="lang-switch" onclick="setLang('ja')">🇯🇵 日本語</span>`;

   return `<!DOCTYPE html>
<html lang="${lang}">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${title} | Akatsuki</title><style>${COMMON_CSS}</style></head>
<body>
    <div class="container">
        <div class="header">
            <div style="font-size: 24px; font-weight: bold; display:flex; align-items:center;">
                <span style="color:#f91880; margin-right:10px;">☾</span> Akatsuki ${langBtn}
            </div>
            <div>
                ${oauth && user ? `
                    ${navItem(t("dashboard", lang), "/admin/dashboard", activeTab === "dashboard")}
                    ${navItem(t("settings", lang), "/admin/settings", activeTab === "settings")}
                    ${navItem(t("activity", lang), "/admin/activity", activeTab === "activity")}
                    <span style="margin-left:20px; color:#8899a6;">${escapeHTML(user.username)}</span>
                    <a href="/logout" class="btn" style="margin-left:10px; padding:5px 15px; font-size:12px;">${t("logout", lang)}</a>
                ` : `
                    <a href="/login" class="btn">${t("login", lang)}</a>
                `}
            </div>
        </div>
        ${content}
        <div class="footer">&copy; 2026 Akatsuki Bot</div>
    </div>
    ${scripts}
</body></html>`;
}

function getLang(req) {
   const cookie = req.headers.cookie || "";
   const match = cookie.match(/lang=([a-z]{2})/);
   return match ? match[1] : "ja";
}

return renderLayout({ title: "Activity", content, user, activeTab: "activity", oauth: true, scripts });
}

export function renderPublicGuideHTML() {
   return renderLayout({ title: "Akatsuki Bot Guide", content: `<div style="position: relative;"><div style="position: absolute; top: 0; right: 0;"><a href="/login" class="btn" style="padding: 6px 16px; font-size: 0.9em;">Login / Dashboard</a></div><div style="text-align:center; padding: 60px 0;"><h1 style="font-size:2.5em; margin-bottom:16px;">Akatsuki Bot Guide</h1><p class="muted">Managing your community smarter.</p></div><div class="card"><h3>Features</h3><ul><li><strong>NG Word Filter</strong>: Automatically delete prohibited words.</li><li><strong>VC Statistics</strong>: track voice channel usage.</li><li><strong>Activity Monitor</strong>: Detect inactive members.</li><li><strong>Web Dashboard</strong>: Manage everything from your browser.</li></ul></div></div>`, user: null, activeTab: null, oauth: false });
}
