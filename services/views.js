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
     $("btn_save").onclick = async () => { await post("/api/settings/update", { guild: $("guild").value, ng_threshold: $("threshold").value, timeout_minutes: $("timeout").value }); alert("Saved"); };
     reload();
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

function renderLayout({ title, content, user, activeTab, oauth, scripts = "" }) {
   const userLabel = user ? escapeHTML(user.global_name || user.username) : "";
   const nav = (label, path, id) => `<a href="${path}" class="nav-item ${activeTab === id ? 'active' : ''}">${label}</a>`;
   return `<!doctype html><html lang="ja"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${escapeHTML(title)}</title><style>${COMMON_CSS}</style></head><body>
      <div style="max-width:900px; margin:0 auto; display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
        <h2 style="margin:0;">Akatsuki Bot</h2>
        <div style="text-align:right; font-size:14px;">
          ${user ? `<span style="margin-right:12px;">${userLabel}</span>` : ``}
          ${oauth ? `<a href="/logout" class="btn" style="padding:4px 10px; font-size:12px;">Logout</a>` : ``}
        </div>
      </div>
      ${user ? `<div class="nav-bar">${nav("Dashboard", "/admin/dashboard", "dashboard")}${nav("Settings", "/admin/settings", "settings")}${nav("Activity", "/admin/activity", "activity")}</div>` : ``}
      <div id="main-content">${content}</div>
      ${scripts}
    </body></html>`;
}

export function renderNeedLoginHTML({ oauthReady }) {
   return renderLayout({ title: "Login", content: `<div class="card" style="text-align:center; padding: 40px 20px;"><h2>Login Required</h2><p class="muted">Please login with Discord to manage your server.</p>${oauthReady ? `<a class="btn btn-primary" href="/login">Login with Discord</a>` : `<p class="muted" style="color:red">OAuth Config Missing</p>`}</div>`, oauth: false });
}

export function renderAdminDashboardHTML({ user }) {
   const content = `<div class="row" style="display:flex; gap:12px; flex-wrap:wrap; margin-bottom:16px; align-items:center;"><select id="guild" style="flex:1; max-width:250px; padding:10px;"></select><input id="month" type="month" style="padding:9px;" /><button id="reload" class="btn">Reload</button><span id="guildStatus" class="muted"></span> <div style="margin-left:auto;">Plan: <span id="plan-info">Loading...</span></div></div>
  <div class="card"><h3>Summary</h3><div id="summary">Loading...</div></div>
  <div class="card"><h3>Top NG Users</h3><table class="data-table"><thead><tr><th>User</th><th style="text-align:right">Count</th></tr></thead><tbody id="topNg"></tbody></table></div>`;
   const scripts = `<script>${COMMON_SCRIPT} initDashboard();</script>`;
   return renderLayout({ title: "Dashboard", content, user, activeTab: "dashboard", oauth: true, scripts });
}

export function renderAdminSettingsHTML({ user }) {
   const content = `<div class="row" style="display:flex; gap:12px; margin-bottom:16px;"><select id="guild" style="max-width:250px; padding:10px;"></select><button id="reload" class="btn">Reload</button><span id="guildStatus" class="muted"></span></div>
  <div class="card"><h3>NG Words</h3><div style="display:flex; gap:8px; margin-bottom:8px;"><input id="ng_add" placeholder="Add word" style="flex:1;" /><button id="btn_add" class="btn">Add</button></div><div style="display:flex; gap:8px; margin-bottom:8px;"><input id="ng_remove" placeholder="Remove word" style="flex:1;" /><button id="btn_remove" class="btn">Remove</button></div><div style="max-height:200px; overflow-y:auto; background:rgba(0,0,0,0.3); padding:12px; border-radius:6px; margin-top:12px;"><pre id="ngwords" style="margin:0; font-family:monospace; color:#eee;">Loading...</pre></div><div style="margin-top:12px; display:flex; justify-content:space-between;"><span id="ngStatus" class="muted"></span><button id="btn_clear" class="btn" style="color:red; border-color:red;">Clear All</button></div></div>
  <div class="card"><h3>Auto Mod Settings</h3><div style="display:grid; grid-template-columns: auto 1fr; gap: 12px 20px; align-items:center;"><div style="color:var(--text-secondary);">NG Threshold</div><div><input id="threshold" type="number" min="1" style="width:80px;" /></div><div style="color:var(--text-secondary);">Timeout (min)</div><div><input id="timeout" type="number" min="1" style="width:80px;" /></div></div><div style="margin-top:20px; text-align:right;"><button id="btn_save" class="btn btn-primary">Save Settings</button></div></div>`;
   const scripts = `<script>${COMMON_SCRIPT} initSettings();</script>`;
   return renderLayout({ title: "Settings", content, user, activeTab: "settings", oauth: true, scripts });
}

export function renderAdminActivityHTML({ user }) {
   const content = `<div class="row" style="display:flex; gap:12px; margin-bottom:16px;"><select id="guild" style="max-width:250px; padding:10px;"></select><button id="reload" class="btn">Reload</button></div>
  <div class="card"><div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;"><h3>Activity Monitor</h3><button id="btn_scan" class="btn btn-primary">Scan Inactive</button></div><div id="act-loading" style="display:none; padding:20px; text-align:center;" class="muted">Scanning...</div><div style="overflow-x:auto;"><table class="data-table"><thead><tr><th>Joined</th><th>User</th><th>Last VC</th><th>Role</th><th>Intro</th></tr></thead><tbody id="act-rows"><tr><td colspan="5" class="muted" style="text-align:center; padding:20px;">Press Scan</td></tr></tbody></table></div></div>`;
   const scripts = `<script>${COMMON_SCRIPT} initActivity();</script>`;
   return renderLayout({ title: "Activity", content, user, activeTab: "activity", oauth: true, scripts });
}

export function renderPublicGuideHTML() {
   return renderLayout({ title: "Akatsuki Bot Guide", content: `<div style="position: relative;"><div style="position: absolute; top: 0; right: 0;"><a href="/login" class="btn" style="padding: 6px 16px; font-size: 0.9em;">Login / Dashboard</a></div><div style="text-align:center; padding: 60px 0;"><h1 style="font-size:2.5em; margin-bottom:16px;">Akatsuki Bot Guide</h1><p class="muted">Managing your community smarter.</p></div><div class="card"><h3>Features</h3><ul><li><strong>NG Word Filter</strong>: Automatically delete prohibited words.</li><li><strong>VC Statistics</strong>: track voice channel usage.</li><li><strong>Activity Monitor</strong>: Detect inactive members.</li><li><strong>Web Dashboard</strong>: Manage everything from your browser.</li></ul></div></div>`, user: null, activeTab: null, oauth: false });
}
