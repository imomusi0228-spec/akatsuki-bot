export function escapeHTML(s = "") {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const COMMON_CSS = `
  :root {
    --bg-color: #0b1622;
    --card-bg: #15202b;
    --text-primary: #ffffff;
    --text-secondary: #8b9bb4;
    --border-color: #253341;
    --accent-color: #1d9bf0;
    --danger-color: #f4212e;
    --success-color: #00ba7c;
  }
  body {
    font-family: system-ui, -apple-system, sans-serif;
    margin: 0;
    padding: 16px;
    background-color: var(--bg-color);
    color: var(--text-primary);
  }
  a { color: var(--accent-color); text-decoration: none; }
  a:hover { text-decoration: underline; }
  .btn {
    display: inline-block;
    padding: 8px 16px;
    border-radius: 6px;
    text-decoration: none;
    font-weight: 600;
    cursor: pointer;
    border: 1px solid var(--border-color);
    background: var(--card-bg);
    color: var(--text-primary);
    transition: background 0.2s;
  }
  .btn:hover { background: #2c3640; text-decoration: none; }
  .btn-primary { background: var(--accent-color); border-color: var(--accent-color); color: #fff; }
  .btn-primary:hover { opacity: 0.9; }
  .card {
    background: var(--card-bg);
    border: 1px solid var(--border-color);
    border-radius: 12px;
    padding: 20px;
    margin-bottom: 16px;
    max-width: 900px;
    margin-left: auto;
    margin-right: auto;
  }
  .muted { color: var(--text-secondary); font-size: 0.9em; }
  input, select, button {
    padding: 8px 12px;
    border-radius: 6px;
    border: 1px solid var(--border-color);
    background: #000;
    color: #fff;
    font-size: 14px;
  }
  h1, h2, h3 { color: var(--text-primary); margin-top: 0; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; color: var(--text-secondary); border-bottom: 1px solid var(--border-color); padding: 8px; }
  td { border-bottom: 1px solid var(--border-color); padding: 8px; }
  tr:last-child td { border-bottom: none; }
  
  .nav-bar {
    display: flex; gap: 8px; margin-bottom: 20px;
    border-bottom: 1px solid var(--border-color);
    padding-bottom: 12px;
    max-width: 900px; margin-left: auto; margin-right: auto;
  }
  .nav-item {
    padding: 8px 16px;
    border-radius: 6px;
    color: var(--text-secondary);
    font-weight: 600;
  }
  .nav-item:hover { background: rgba(255,255,255,0.05); text-decoration: none; }
  .nav-item.active {
    color: var(--text-primary);
    background: rgba(29, 155, 240, 0.1);
    color: var(--accent-color);
  }
`;

const COMMON_SCRIPT = `
  const $ = (id) => document.getElementById(id);
  function yyyymmNow(){ const d=new Date(); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0"); }

  async function api(path){
    const r = await fetch(path);
    const t = await r.text();
    try { return JSON.parse(t); } catch { return { ok:false, error:t }; }
  }
  async function post(path, body){
    const r = await fetch(path, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body)});
    const t = await r.text();
    try { return JSON.parse(t); } catch { return { ok:false, error:t }; }
  }

  // --- Common Init ---
  let _guildsLoaded = false;
  async function loadGuilds() {
     if (_guildsLoaded) return true;
     const sel = $("guild");
     if(!sel) return false;
     
     sel.innerHTML = "<option>読み込み中...</option>";
     sel.disabled = true;
     
     const d = await api("/api/guilds");
     sel.innerHTML = "";
     
     if (d && d.ok && d.guilds && d.guilds.length) {
       // Restore selection from localStorage if possible
       const lastGid = localStorage.getItem("last_guild_id");
       let selectedIndex = 0;
       
       d.guilds.forEach((g, i) => {
         const o = document.createElement("option");
         o.value = g.id; 
         o.textContent = g.name;
         sel.appendChild(o);
         if(lastGid && g.id === lastGid) selectedIndex = i;
       });
       sel.selectedIndex = selectedIndex;
       
       sel.disabled = false;
       _guildsLoaded = true;
       return true;
     }
     
     if (d && d.ok && (!d.guilds || d.guilds.length === 0)) {
        const o = document.createElement("option");
        o.textContent = "（管理可能なサーバーがありません）";
        sel.appendChild(o);
        $("guildStatus").textContent = "権限/導入を確認してください";
        return false;
     }

     $("guildStatus").textContent = "エラー: " + (d?.error || "unknown");
     return false;
  }
  
  function saveGuildSelection() {
     const sel = $("guild");
     if(sel && sel.value) localStorage.setItem("last_guild_id", sel.value);
  }

  // --- Page Specific inits ---
  
  async function initDashboard() {
     if(!await loadGuilds()) return;
     $("month").value = yyyymmNow();
     
     const reload = async () => {
        saveGuildSelection();
        const gid = $("guild").value;
        const mon = $("month").value;
        if(!gid) return;
        
        $("summary").innerHTML = "読み込み中...";
        const res = await api(\`/api/stats?guild=\${gid}&month=\${mon}\`);
        
        if (res.ok) {
           const s = res.stats.summary;
           const box = (l,v) => \`<div style="background:rgba(255,255,255,0.05); padding:10px; border-radius:8px; text-align:center;"><div style="font-size:24px; font-weight:bold;">\${v}</div><div style="font-size:11px; color:#888;">\${l}</div></div>\`;
           $("summary").innerHTML = \`<div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:8px; width:100%;">\${box("VC参加", s.joins)} \${box("VC退室", s.leaves)} \${box("タイムアウト", s.timeouts)} \${box("NG検知", s.ngDetected)}</div>\`;
           
           let rows = "";
           (res.stats.topNgUsers || []).forEach(u => {
              const av = u.avatar_url || "https://cdn.discordapp.com/embed/avatars/0.png";
              rows += \`<tr><td><div style="display:flex; align-items:center; gap:8px;"><img src="\${av}" style="width:24px; height:24px; border-radius:50%;" /> <span>\${u.display_name}</span></div></td><td style="text-align:right">\${u.cnt}</td></tr>\`;
           });
           $("topNg").innerHTML = rows || '<tr><td colspan="2" class="muted" style="text-align:center; padding:10px;">なし</td></tr>';
        } else {
           $("summary").innerText = "エラー: " + res.error;
        }
     };
     
     $("guild").onchange = reload;
     $("month").onchange = reload;
     $("reload").onclick = reload;
     reload(); // initial load
  }

  async function initSettings() {
     if(!await loadGuilds()) return;
     
     const reload = async () => {
        saveGuildSelection();
        const gid = $("guild").value;
        if(!gid) return;
        
        const [ng, st] = await Promise.all([
          api(\`/api/ngwords?guild=\${gid}\`),
          api(\`/api/settings?guild=\${gid}\`)
        ]);
        
        if(ng.ok) {
           $("ngwords").textContent = (ng.words||[]).map(w => w.kind==="regex" ? "/" + w.word + "/" + w.flags : w.word).join("\\n") || "（なし）";
           $("ngStatus").textContent = (ng.words||[]).length + " words";
        }
        
        if(st.ok && st.settings) {
           let settingsText = "現在の設定";
           if(st.settings.log_channel_id) {
              // チャンネル名が取得できた場合はそれを表示、できなかった場合はIDを表示
              const channelDisplay = st.settings.log_channel_name 
                ? st.settings.log_channel_name 
                : st.settings.log_channel_id;
              settingsText += " | ログ送信先: #" + channelDisplay;
           }
  $("settingsBox").innerHTML = settingsText;
  $("threshold").value = st.settings.ng_threshold ?? 3;
  $("timeout").value = st.settings.timeout_minutes ?? 10;
        }
     };

  $("guild").onchange = reload;
  $("reload").onclick = reload;
     
     $("btn_add").onclick = async () => {
        const w = $("ng_add").value; if(!w)return;
  const res = await post("/api/ngwords/add", {guild: $("guild").value, word: w });
  if(!res.ok) alert("追加失敗: " + (res.error || "未知のエラー"));
  $("ng_add").value=""; reload();
     };
     $("btn_remove").onclick = async () => {
        const w = $("ng_remove").value; if(!w)return;
  const res = await post("/api/ngwords/remove", {guild: $("guild").value, word: w });
  if(!res.ok) alert("削除失敗: " + (res.error || "未知のエラー"));
  $("ng_remove").value=""; reload();
     };
     $("btn_clear").onclick = async () => {
        if(!confirm("本当に全削除しますか？"))return;
  const res = await post("/api/ngwords/clear", {guild: $("guild").value });
  if(!res.ok) alert("全削除失敗: " + (res.error || "未知のエラー"));
  reload();
     };
     $("btn_save").onclick = async () => {
    await post("/api/settings/update", {
      guild: $("guild").value,
      ng_threshold: $("threshold").value,
      timeout_minutes: $("timeout").value
    });
  alert("設定を保存しました");
     };

  reload();
  }

  async function initActivity() {
     if(!await loadGuilds()) return;

  let currentData = [];
  let sortKey = "display_name";
  let sortOrder = 1;

     const renderTable = () => {
        const el = $("act-rows");
  el.innerHTML = "";
        const sorted = [...currentData].sort((a, b) => {
           const valA = (a[sortKey] || "").toLowerCase();
  const valB = (b[sortKey] || "").toLowerCase();
  return valA < valB ? -sortOrder : (valA > valB ? sortOrder : 0);
        });
        const updateSortIcon = (id, key) => {
           const span = $(id);
  if (!span) return;
  if (sortKey === key) {
    span.innerText = sortOrder === 1 ? "▲" : "▼";
  span.style.opacity = "1";
  span.style.color = "var(--accent-color)";
           } else {
    span.innerText = "▼";
  span.style.opacity = "0.3";
  span.style.color = "inherit";
           }
        };
  updateSortIcon("sort-name", "display_name");
  updateSortIcon("sort-joined", "joined_at");

  let html = "";
        sorted.forEach(r => {
           const yes = "<span style='color:var(--success-color)'>Yes</span>";
  const no = "<span style='color:var(--danger-color)'>No</span>";
  const av = r.avatar_url || "https://cdn.discordapp.com/embed/avatars/0.png";
  // YYYY/MM/DD
  const joined = (r.joined_at || "").replace(/-/g, "/");
  html += \`<tr>
    <td style="white-space:nowrap; text-align:center;">\${joined}</td>
    <td><div style="display:flex; align-items:center; gap:8px;"><img src="\${av}" style="width:24px; height:24px; border-radius:50%;" /> <span>\${r.display_name}</span></div></td>
    <td style="text-align:center;">\${r.last_vc}</td>
    <td style="text-align:center;">\${r.has_role === "Yes" ? yes : (r.has_role === "No" ? no : "-")}</td>
    <td style="text-align:center;">\${r.has_intro === "Yes" ? yes : (r.has_intro.includes("No") ? no : "-")}</td>
  </tr>\`;
        });
  el.innerHTML = html;
     };

     const runScan = async () => {
    saveGuildSelection();
  const gid = $("guild").value;
  const el = $("act-rows");
  const ld = $("act-loading");
  el.innerHTML = "";
  ld.style.display = "block";
  $("csv-tools").style.display = "none";
  const res = await api(\`/api/activity?guild=\${gid}\`);
  ld.style.display = "none";

  if(!res.ok) {
           if(res.error === "Upgrade to Pro+") {
    el.innerHTML = \`<tr><td colspan="5" style="padding:40px; text-align:center;">
      <div style="font-size:1.2em; font-weight:bold; margin-bottom:8px;">🔒 Pro+ 限定機能</div>
      <div class="muted" style="margin-bottom:16px;">高度なアクティビティモニター（参加日・ソート・CSV抽出）は Pro+ ティアでご利用いただけます。</div>
      <a href="https://discord.gg/your-support-server" target="_blank" class="btn btn-primary">プランを確認する</a>
    </td></tr>\`;
           } else {
    el.innerHTML = \`<tr><td colspan="5" style="color:red; text-align:center; padding:20px;">\${res.error}</td></tr>\`;
           }
  return;
        }

  $("act-criteria").innerText = \`判定期間: \${res.config.weeks}週間\`;
  currentData = res.data || [];
  if(currentData.length === 0) {
    el.innerHTML = '<tr><td colspan="5" class="muted" style="text-align:center; padding:20px;">該当者なし</td></tr>';
  return;
        }
  $("csv-tools").style.display = "flex";
  renderTable();
     };
     
      $("guild").onchange = () => {$("act-rows").innerHTML = '<tr><td colspan="5" class="muted" style="text-align:center; padding:20px;">スキャンしてください</td></tr>'; $("act-criteria").textContent=""; $("csv-tools").style.display="none"; };
  $("reload").onclick = runScan;
  $("btn_scan").onclick = runScan;

      $("th-name").onclick = () => {
         if(currentData.length === 0) return;
  if(sortKey === "display_name") sortOrder *= -1;
  else {sortKey = "display_name"; sortOrder = 1; }
  renderTable();
      };
      $("th-joined").onclick = () => {
         if(currentData.length === 0) return;
  if(sortKey === "joined_at") sortOrder *= -1;
  else {sortKey = "joined_at"; sortOrder = 1; }
  renderTable();
      };

      $("btn_csv").onclick = () => {
           const gid = $("guild").value;
  if(!gid) return;
  const role = $("csv-role").value;
  const intro = $("csv-intro").value;
  window.location.href = \`/api/activity/download?guild=\${gid}&role=\${role}&intro=\${intro}\`;
      };
   }
  `;

function renderLayout({ title, content, user, activeTab, oauth, scripts = "" }) {
  const userLabel = user ? escapeHTML(user.global_name || user.username || user.id) : "";

  const nav = (label, path, id) => `
  <a href="${path}" class="nav-item ${activeTab === id ? 'active' : ''}">${label}</a>
  `;

  return `<!doctype html>
  <html lang="ja">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${escapeHTML(title)}</title>
      <style>${COMMON_CSS}</style>
    </head>
    <body>
      <div style="max-width:900px; margin:0 auto; display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
        <h2 style="margin:0;">Akatsuki Bot</h2>
        <div style="text-align:right; font-size:14px;">
          ${user ? `<span style="margin-right:12px;">${userLabel}</span>` : ``}
          ${oauth ? `<a href="/logout" class="btn" style="padding:4px 10px; font-size:12px;">ログアウト</a>` : ``}
        </div>
      </div>

      ${user ? `
  <div class="nav-bar">
    ${nav("ダッシュボード", "/admin/dashboard", "dashboard")}
    ${nav("設定", "/admin/settings", "settings")}
    ${nav("アクティビティ", "/admin/activity", "activity")}
  </div>
  ` : ``}

      <div id="main-content">
        ${content}
      </div>

      ${scripts}
    </body>
  </html>`;
}

export function renderNeedLoginHTML({ oauthReady, tokenEnabled }) {
  const content = `
  <div class="card" style="text-align:center; padding: 40px 20px;">
    <h2>Akatsuki Bot 管理画面</h2>
    <p class="muted" style="margin-bottom:24px;">管理操作を行うには Discord アカウントでログインしてください。</p>

    ${oauthReady
      ? `<a class="btn btn-primary" href="/login" style="font-size:16px; padding:12px 24px;">Discord でログイン</a>`
      : `<p class="muted" style="color:var(--danger-color)">OAuth設定が不足しています (DISCORD_CLIENT_ID / SECRET)</p>`
    }

    ${tokenEnabled
      ? `<div style="margin-top:40px; border-top:1px solid var(--border-color); padding-top:20px;">
             <p class="muted" style="font-size:12px;">管理者用トークンログイン: <code>/admin?token=...</code></p>
           </div>`
      : ``
    }
  </div>
  `;

  return renderLayout({ title: "ログイン - Akatsuki Bot", content, user: null, activeTab: null, oauth: false });
}

export function renderAdminDashboardHTML({ user }) {
  const content = `
  <div class="row" style="display:flex; gap:12px; flex-wrap:wrap; margin-bottom:16px; align-items:center;">
    <select id="guild" style="flex:1; max-width:250px; padding:10px;"></select>
    <input id="month" type="month" style="padding:9px;" />
    <button id="reload" class="btn">更新</button>
    <span id="guildStatus" class="muted"></span>
  </div>

  <div class="card">
    <h3>本日のサマリー (JST)</h3>
    <div id="summary" style="min-height:80px; display:flex; align-items:center; justify-content:center;">読み込み中...</div>
  </div>

  <div class="card">
    <h3>NGユーザー上位 (30日間)</h3>
    <table class="data-table">
      <thead><tr><th>ユーザー</th><th style="text-align:right">回数</th></tr></thead>
      <tbody id="topNg">
        <tr><td colspan="2" class="muted" style="text-align:center; padding:20px;">読み込み中...</td></tr>
      </tbody>
    </table>
  </div>
  `;

  const scripts = `
  <script>
    ${COMMON_SCRIPT}
    initDashboard();
  </script>
  `;

  return renderLayout({ title: "ダッシュボード", content, user, activeTab: "dashboard", oauth: true, scripts });
}

export function renderAdminSettingsHTML({ user }) {
  const content = `
  <div class="row" style="display:flex; gap:12px; margin-bottom:16px;">
    <select id="guild" style="max-width:250px; padding:10px;"></select>
    <button id="reload" class="btn">更新</button>
    <span id="guildStatus" class="muted"></span>
  </div>

  <div class="card">
    <h3>NGワード設定</h3>
    <div style="display:flex; gap:8px; margin-bottom:8px;">
      <input id="ng_add" placeholder="追加（例: ばか または /regex/i）" style="flex:1;" />
      <button id="btn_add" class="btn" style="min-width:40px;">＋</button>
    </div>
    <div style="display:flex; gap:8px; margin-bottom:8px;">
      <input id="ng_remove" placeholder="削除（登録されている文字）" style="flex:1;" />
      <button id="btn_remove" class="btn" style="min-width:40px;">−</button>
    </div>

    <div style="max-height:200px; overflow-y:auto; background:rgba(0,0,0,0.3); padding:12px; border-radius:6px; margin-top:12px; border:1px solid var(--border-color);">
      <pre id="ngwords" style="margin:0; font-family:monospace; color:#eee;">未取得</pre>
    </div>

    <div style="margin-top:12px; display:flex; justify-content:space-between;">
      <span id="ngStatus" class="muted"></span>
      <button id="btn_clear" class="btn" style="color:var(--danger-color); border-color:var(--danger-color); padding:4px 12px; font-size:12px;">全削除</button>
    </div>
  </div>

  <div class="card">
    <h3>自動処分設定</h3>
    <div id="settingsBox" class="muted" style="margin-bottom:16px;">未取得</div>

    <div style="display:grid; grid-template-columns: auto 1fr; gap: 12px 20px; align-items:center;">
      <div style="color:var(--text-secondary);">NGワードカウント</div>
      <div>
        <input id="threshold" type="number" min="1" style="width:80px;" /> 回
        <div class="muted" style="font-size:0.8em; margin-top:4px;">※NGワードの累計ヒット数がこの値に達すると処分</div>
      </div>

      <div style="color:var(--text-secondary);">タイムアウト期間</div>
      <div>
        <select id="timeout" style="width:120px;">
          <option value="1">60秒</option>
          <option value="5">5分</option>
          <option value="10">10分</option>
          <option value="60">1時間</option>
          <option value="1440">1日</option>
          <option value="10080">1週間</option>
        </select>
      </div>
    </div>

    <div style="margin-top:20px; text-align:right;">
      <button id="btn_save" class="btn btn-primary" style="padding:10px 30px;">設定を保存</button>
    </div>
  </div>
  `;

  const scripts = `
  <script>
    ${COMMON_SCRIPT}
    initSettings();
  </script>
  `;

  return renderLayout({ title: "設定", content, user, activeTab: "settings", oauth: true, scripts });
}

export function renderAdminActivityHTML({ user }) {
  const content = `
  <div class="row" style="display:flex; gap:12px; margin-bottom:16px;">
    <select id="guild" style="max-width:250px; padding:10px;"></select>
    <button id="reload" class="btn">更新</button>
    <span id="guildStatus" class="muted"></span>
  </div>

  <div class="card">
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
      <h3>アクティビティモニター <small id="act-criteria" class="muted" style="font-weight:normal; font-size:0.7em;"></small></h3>
      <div style="display:flex; gap:8px;">
        <button id="btn_scan" class="btn btn-primary">スキャン開始</button>
        <div id="csv-tools" style="display:none; align-items:center; gap:8px;">
          <select id="csv-role" style="font-size:0.8em; padding:4px; height:100%;">
            <option value="all">ロール: すべて</option>
            <option value="yes">ロールあり</option>
            <option value="no">ロールなし</option>
          </select>
          <select id="csv-intro" style="font-size:0.8em; padding:4px; height:100%;">
            <option value="all">自己紹介: すべて</option>
            <option value="yes">記入済み</option>
            <option value="no">未記入</option>
          </select>
          <button id="btn_csv" class="btn" style="padding:6px 12px; font-size:0.8em; background:#444;">CSV</button>
        </div>
      </div>
    </div>

    <div id="act-loading" style="display:none; padding:20px; text-align:center;" class="muted">スキャン中...</div>

    <div style="overflow-x:auto;">
      <table class="data-table">
        <thead>
          <tr>
            <th id="th-joined" style="text-align:center; cursor:pointer; user-select:none; white-space:nowrap;">参加日 <span id="sort-joined">▼</span></th>
            <th id="th-name" style="cursor:pointer; user-select:none;">ユーザー <span id="sort-name">▼</span></th>
            <th style="text-align:center;">最終VC</th>
            <th style="text-align:center;">ロール</th>
            <th style="text-align:center;">自己紹介</th>
          </tr>
        </thead>
        <tbody id="act-rows">
          <tr><td colspan="5" class="muted" style="text-align:center; padding:20px;">スキャンしてください</td></tr>
        </tbody>
      </table>
    </div>
  </div>
  `;

  const scripts = `
  <script>
    ${COMMON_SCRIPT}
    initActivity();
  </script>
  `;

  return renderLayout({ title: "アクティビティ", content, user, activeTab: "activity", oauth: true, scripts });
}


export function renderPublicGuideHTML() {
  return `
  <!DOCTYPE html>
  <html lang="ja">
    <head>
      <meta charset="UTF-8">
        <title>Akatsuki Bot | ご利用ガイド</title>
        <style>
          ${COMMON_CSS}
          .guide-container {max - width: 800px; margin: 40px auto; padding: 20px; }
          .hero {text - align: center; padding: 40px 0 60px; }
          .hero h1 {font - size: 2.5em; margin-bottom: 8px; background: linear-gradient(90deg, #fff, var(--accent-color)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }

          /* Tabs */
          .tier-tabs {display: flex; justify-content: center; gap: 16px; margin-bottom: 40px; }
          .tab-btn {
            padding: 12px 32px;
          border-radius: 99px;
          border: 1px solid var(--border-color);
          background: rgba(255,255,255,0.05);
          color: var(--text-secondary);
          font-weight: bold;
          cursor: pointer;
          transition: all 0.2s;
          font-size: 1.1em;
    }
          .tab-btn:hover {background: rgba(255,255,255,0.1); transform: translateY(-2px); }
          .tab-btn.active {border - color: transparent; color: #fff; box-shadow: 0 4px 20px rgba(0,0,0,0.5); }

          .tab-free.active {background: linear-gradient(135deg, #7f8c8d, #2c3e50); }
          .tab-pro.active {background: linear-gradient(135deg, #00ba7c, #006442); }
          .tab-pro_plus.active {background: linear-gradient(135deg, #1d9bf0, #0c4a78); }

          /* Content Sections */
          .tier-section {display: none; animation: fadeIn 0.4s ease; }
          .tier-section.active {display: block; }

          .cmd-card {background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 12px; padding: 24px; margin-bottom: 24px; }
          .cmd-name {font - family: monospace; font-size: 1.4em; color: var(--text-primary); margin-bottom: 12px; display: flex; align-items: center; gap: 12px; }
          .cmd-badge {font - size: 0.6em; padding: 4px 8px; border-radius: 4px; background: rgba(255,255,255,0.1); }

          .use-case {
            margin - top: 16px;
          padding: 16px;
          background: rgba(29, 155, 240, 0.05);
          border-left: 3px solid var(--accent-color);
          border-radius: 0 8px 8px 0;
          font-size: 0.95em;
          line-height: 1.6;
    }

          @keyframes fadeIn {
            from {opacity: 0; transform: translateY(10px); }
          to {opacity: 1; transform: translateY(0); }
    }
        </style>
    </head>
    <body>
      <div class="guide-container">
        <div class="hero">
          <h1 style="text-align:center;">Akatsuki Bot Guide</h1>
          <p class="muted" style="text-align:center;">全てのサーバーを管理されている管理者の皆さまへ。<br>月明かりのような静寂と、鉄壁の守りをご提供いたします。</p>
        </div>

        <div class="tier-tabs">
          <button class="tab-btn tab-free active" onclick="switchTab('free')">Free Tier</button>
          <button class="tab-btn tab-pro" onclick="switchTab('pro')">Pro Tier</button>
          <button class="tab-btn tab-pro_plus" onclick="switchTab('pro_plus')">Pro+ Tier</button>
        </div>

        <!-- FREE TIER -->
        <div id="section-free" class="tier-section active">
          <div style="text-align:center; margin-bottom:32px;" class="muted">
            <p>基本となる「守り」と「可視化」の機能群でございます。<br>まずはここから、快適なサーバー運営をお始めください。</p>
          </div>

          <div class="cmd-card">
            <div class="cmd-name">/ngword <span class="cmd-badge">基本防衛</span></div>
            <p>サーバーの品位を損なう言葉を検閲・排除いたします。正規表現（Regex）を用いた高度なパターンマッチングも可能でございますので、隠語や表記ゆれにも柔軟に対応可能でございます。</p>
            <div class="use-case">
              <strong>🎩 執事の提案：品位ある空間のために</strong><br>
                「死ね」や「消えろ」といった直接的な暴言はもちろん、<code>/regex/i</code> の形式でご登録いただければ、大文字小文字の違いや、スペースを挟んだ悪意ある投稿も逃さず対処いたします。
            </div>
          </div>

          <div class="cmd-card">
            <div class="cmd-name">/vc <span class="cmd-badge">活動記録</span></div>
            <p>メンバー様のボイスチャンネルにおける滞在時間を集計し、報告させていただきます。誰がコミュニティの盛り上げ役であるか、一目瞭然となります。</p>
            <div class="use-case">
              <strong>🎩 執事の提案：貢献者への称賛</strong><br>
                月末に <code>/vc top</code> を実行し、最も長く滞在された方を表彰してはいかがでしょうか。皆様のモチベーションを高め、より活気ある社交場となることでしょう。
            </div>
          </div>

          <div class="cmd-card">
            <div class="cmd-name">/setlog <span class="cmd-badge">記録保管</span></div>
            <p>わたくしが執り行った処罰（NGワード削除など）や、メンバー様の入退室記録を報告する「日誌」の提出先をご指定いただけます。</p>
          </div>
        </div>

        <!-- PRO TIER -->
        <div id="section-pro" class="tier-section">
          <div style="text-align:center; margin-bottom:32px;" class="muted">
            <p>Web管理画面へのアクセス権が解禁されます。<br>「休眠メンバー」の整理や、迅速な処罰解除など、より実務的な管理が可能でございます。</p>
          </div>

          <div class="cmd-card">
            <div class="cmd-name">/activity <span class="cmd-badge">休眠管理</span></div>
            <p>「長期間お姿を見かけない方」をリストアップいたします。期間の定義はWeb管理画面より自由に設定いただけます。</p>
            <div class="use-case">
              <strong>🎩 執事の提案：スマートな名簿整理</strong><br>
                定員のあるサーバーや、アクティブな方のみで交流を深めたい場合にご活用ください。Web画面の「アクティビティモニター」と併用することで、幽霊部員の把握が驚くほどスムーズになります。
            </div>
          </div>

          <div class="cmd-card">
            <div class="cmd-name">NGワード設定 > 削除 <span class="cmd-badge">特権操作</span></div>
            <p>Web管理画面の「NGワード設定」から該当のワードを削除していただくことで、タイムアウトを即座に解除し、違反カウントも帳消しにいたします。</p>
            <div class="use-case">
              <strong>🎩 執事の提案：慈悲ある救済</strong><br>
                身内同士の冗談が誤って検閲されてしまった際、管理者の皆様はその場でスマートに、そしてエレガントに救済の手を差し伸べることができます。
            </div>
          </div>

          <div class="cmd-card">
            <div class="cmd-name">Web管理画面 <span class="cmd-badge">司令塔</span></div>
            <p><code>/admin</code> コマンドよりアクセスいただける、専用の執務室でございます。NGワードの一括管理や、アクティビティ状況の視覚的な確認が可能となります。</p>
          </div>
        </div>

        <!-- PRO+ TIER -->
        <div id="section-pro_plus" class="tier-section">
          <div style="text-align:center; margin-bottom:32px;" class="muted">
            <p>最上級の「分析」機能をご提供いたします。<br>過去を紐解き、現在を正しく評価するための、最強のツールでございます。</p>
          </div>

          <div class="cmd-card">
            <div class="cmd-name">/scan <span class="cmd-badge">過去調査</span></div>
            <p>過去の全ログを遡り、後から追加されたルールに抵触している発言がないか、徹底的に洗い出します。</p>
            <div class="use-case">
              <strong>🎩 執事の提案：完全な潔白の証明</strong><br>
                「あの騒動の際、他に不穏な動きはなかったか？」……リアルタイムの監視だけでは漏れてしまう過去の痕跡も、わたくしが見つけ出して報告いたします。
            </div>
          </div>

          <div class="cmd-card">
            <div class="cmd-name">詳細アクティビティ分析 <span class="cmd-badge">Web機能</span></div>
            <p>Web管理画面にて、参加日やロール有無など、より詳細な条件でのメンバー抽出・CSVダウンロードが可能となります。</p>
            <div class="use-case">
              <strong>🎩 執事の提案：データに基づく運営</strong><br>
                「自己紹介未記入の方」や「特定のロールを持たない方」だけのリストを作成し、個別にご案内を送るなど、きめ細やかなフォローアップにお役立てください。
            </div>
          </div>
        </div>

        <footer style="text-align: center; padding-top: 40px; border-top: 1px solid var(--border-color); margin-top:60px;" class="muted">
          <p>&copy; 2026 Akatsuki Bot - お嬢のための、究極の執事サービス。</p>
        </footer>
      </div>

      <script>
        function switchTab(tier) {
          // Buttons
          document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelector('.tab-' + tier).classList.add('active');

      // Sections
      document.querySelectorAll('.tier-section').forEach(s => s.classList.remove('active'));
        document.getElementById('section-' + tier).classList.add('active');
    }
      </script>
    </body>
  </html>`;
}
