import { ENV } from "../config/env.js";
import { t, DICTIONARY } from "../core/i18n.js";

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
    --primary-color: #1d9bf0;
    --danger-color: #f4212e; 
    --success-color: #00ba7c; 
  }
  body { font-family: system-ui, -apple-system, sans-serif; margin: 0; padding: 16px; background-color: var(--bg-color); color: var(--text-primary); }
  a { color: var(--accent-color); text-decoration: none; } a:hover { text-decoration: underline; }
  .btn { display: inline-block; padding: 8px 16px; border-radius: 6px; text-decoration: none; font-weight: 600; cursor: pointer; border: 1px solid var(--border-color); background: var(--card-bg); color: var(--text-primary); transition: all 0.2s; }
  .btn:hover { background: #2c3640; border-color: var(--accent-color); text-decoration: none; }
  .btn-primary { background: var(--accent-color); border-color: var(--accent-color); color: #fff; }
  .btn-primary:hover { opacity: 0.9; box-shadow: 0 0 15px rgba(29, 155, 240, 0.4); }
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
  .check { color: #00ba7c; font-weight: bold; }
  .cross { color: #f91880; font-weight: bold; }
  .lang-switch { cursor: pointer; color: #8899a6; margin-left: 15px; font-size: 0.9em; }
  .lang-switch:hover { color: #fff; }
  
  /* Accordion Styles */
  .accordion-item { border: 1px solid var(--border-color); border-radius: 12px; margin-bottom: 12px; background: var(--card-bg); overflow: hidden; }
  .accordion-header { padding: 16px 20px; cursor: pointer; display: flex; align-items: center; justify-content: space-between; font-weight: bold; font-size: 1.1em; transition: background 0.2s; }
  .accordion-header:hover { background: rgba(255,255,255,0.03); }
  .accordion-content { display: none; padding: 20px; border-top: 1px solid var(--border-color); background: rgba(0,0,0,0.1); }
  .accordion-item.active .accordion-content { display: block; }
  .accordion-arrow { transition: transform 0.2s; color: var(--text-secondary); }
  .accordion-item.active .accordion-arrow { transform: rotate(180deg); }
  
  /* Tooltip Styles */
  .help-icon { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; border-radius: 50%; background: #38444d; color: #8899a6; font-size: 12px; cursor: help; margin-left: 6px; vertical-align: middle; position: relative; }
  .help-icon:hover { background: var(--accent-color); color: white; }
  .help-icon:hover::after { content: attr(data-help); position: absolute; bottom: 125%; left: 50%; transform: translateX(-50%); background: #000; color: #fff; padding: 10px; border-radius: 8px; font-size: 12px; width: 220px; line-height: 1.4; z-index: 100; box-shadow: 0 4px 15px rgba(0,0,0,0.5); border: 1px solid var(--border-color); white-space: normal; pointer-events: none; }
  
  .setting-section { margin-bottom: 24px; padding-bottom: 24px; border-bottom: 1px dashed var(--border-color); }
  .setting-section:last-child { border-bottom: none; margin-bottom: 0; padding-bottom: 0; }
  .setting-title { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; color: var(--accent-color); font-size: 16px; font-weight: bold; }
  
  .switch-label { display: flex; align-items: center; gap: 10px; cursor: pointer; }
  .switch-label input { width: 18px; height: 18px; cursor: pointer; }
`;

const COMMON_SCRIPT = /* v2.4 (Optimized) */ `
  const $ = (id) => document.getElementById(id);
  const escapeHTML = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  function yyyymmNow(){ const d=new Date(); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0"); }
  const api = async (path, body) => {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 15000);
    try {
        const r = await fetch(path, {
            method: body ? "POST" : "GET",
            headers: body ? {"Content-Type":"application/json"} : {},
            body: body ? JSON.stringify(body) : null,
            signal: ctrl.signal
        });
        clearTimeout(tid);
        if(r.status===401){ location.href="/login"; return {ok:false}; }
        return await r.json();
    } catch (e) {
        clearTimeout(tid);
        return { ok:false, error: e.name==='AbortError' ? 'Timeout' : e.message };
    }
  };
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
     const errMsg = (d && d.error) ? d.error : "Check Bot Permissions/Invite";
     $("guildStatus").innerHTML = '<span style="color:var(--danger-color)">' + escapeHTML(errMsg) + '</span>';
     return false;
  }
  function saveGuildSelection() { const sel = $("guild"); if(sel && sel.value) localStorage.setItem("last_guild_id", sel.value); }

  async function initDashboard() {
     try {
        if(!await loadGuilds()) return;
        const monInput = $("month");
        if(monInput) monInput.value = yyyymmNow();
        
        const reload = async () => {
           try {
              saveGuildSelection(); 
              const gid = $("guild").value; 
              const mon = $("month").value; 
              if(!gid) return;
              
              $("summary").innerHTML = "Loading...";
              const res = await api(\`/api/stats?guild=\${gid}&month=\${mon}\`);
              if (res.ok) {
                 const s = res.stats.summary;
                 const sub = res.subscription;
                 $("plan-info").innerHTML = \`<span style="color:var(--accent-color); font-weight:bold;">\${sub.name}</span> \${sub.valid_until ? '('+sub.valid_until.split('T')[0]+')' : ''}\`;
                 
                 const box = (l,v) => \`<div style="background:rgba(255,255,255,0.05); padding:10px; border-radius:8px; text-align:center;"><div style="font-size:24px; font-weight:bold;">\${v}</div><div style="font-size:11px; color:#888;">\${l}</div></div>\`;
                 $("summary").innerHTML = \`<div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:8px; width:100%;">\${box(t("vc_joins"), s.joins)} \${box(t("leaves"), s.leaves)} \${box(t("timeouts"), s.timeouts)} \${box(t("ng_detect"), s.ngDetected)}</div>\`;
                 let rows = ""; (res.stats.topNgUsers || []).forEach(u => { 
                      const av = u.avatar_url ? '<img src="' + u.avatar_url + '" style="width:24px; height:24px; border-radius:50%; vertical-align:middle; margin-right:8px;">' : '';
                      rows += \`<tr><td>\${av}\${escapeHTML(u.display_name || 'Unknown')}</td><td style="text-align:right">\${u.cnt}</td></tr>\`; });
                 $("topNg").innerHTML = rows || '<tr><td colspan="2" class="muted" style="text-align:center; padding:10px;">None</td></tr>';
              } else { $("summary").innerText = "Error: " + res.error; }
           } catch (e) {
              console.error("Reload Error:", e);
              $("summary").innerHTML = '<span style="color:red;">Reload Failed: ' + e.message + '</span>';
           }
        };
        $("guild").onchange = reload; $("month").onchange = reload; $("reload").onclick = reload; reload();
     } catch (e) {
        console.error("Init Error:", e);
        alert("Dashboard initialization failed: " + e.message);
     }
  }

  async function initSettings() {
     if(!await loadGuilds()) return;
     
     const lang = document.documentElement.lang || 'ja';
     const selLog = $("logCh");
     const selNgLog = $("ngLogCh");
     const selGuild = $("guild");

     const loadMasters = async (gid) => {
        try {
            const [ch, rl] = await Promise.all([api("/api/channels?guild=" + gid), api("/api/roles?guild=" + gid)]);
            
            // Debug info
            console.log("Channels API:", ch);
            
            const channels = (ch.ok && ch.channels) ? ch.channels : [];
            const errorMsg = !ch.ok ? (ch.error || "API Error") : (channels.length === 0 ? "No Text Channels" : null);

            // 1. Log Channel
            const elLog = document.getElementById("logCh");
            if(elLog) {
                if(errorMsg) {
                    elLog.innerHTML = '<option value="">(Error: ' + errorMsg + ')</option>';
                } else {
                    elLog.innerHTML = '<option value="">(None / Disable)</option>';
                    channels.forEach(c => {
                        const o = document.createElement("option");
                        o.value = c.id;
                        o.textContent = "#" + c.name;
                        elLog.appendChild(o);
                    });
                }
            }

            // 2. NG Log Channel
            const elNgLog = document.getElementById("ngLogCh");
                if(elNgLog) {
                     if(errorMsg) {
                        elNgLog.innerHTML = '<option value="">(Error: ' + errorMsg + ')</option>';
                    } else {
                        elNgLog.innerHTML = '<option value="">(None / Same as VC Log)</option>';
                        channels.forEach(c => {
                            const o = document.createElement("option");
                            o.value = c.id;
                            o.textContent = "#" + c.name;
                            elNgLog.appendChild(o);
                        });
                    }
                }

                // 3. VC Report Channel
                const elVcrLog = document.getElementById("vcReportCh");
                if(elVcrLog) {
                    if(errorMsg) {
                        elVcrLog.innerHTML = '<option value="">(Error: ' + errorMsg + ')</option>';
                    } else {
                        elVcrLog.innerHTML = '<option value="">(Select Channel)</option>';
                        channels.forEach(c => {
                            const o = document.createElement("option");
                            o.value = c.id;
                            o.textContent = "#" + c.name;
                            elVcrLog.appendChild(o);
                        });
                    }
                }

                // 4. Populate Role Dropdowns for Rules
                window._serverRoles = (rl.ok && rl.roles) ? rl.roles : [];
        } catch(e) {
            console.error("loadMasters Error:", e);
            alert("Error loading channels: " + e.message);
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
                const noneText = t("ng_none");
                list.innerHTML = '<div class="muted" style="padding:10px; text-align:center;">' + noneText + '</div>';
            } else {
                list.innerHTML = words.map(w => {
                    const escW = escapeHTML(w.word);
                    return '<div style="display:flex; justify-content:space-between; align-items:center; background:#192734; padding:8px 12px; border-radius:4px; border:1px solid #38444d;">' +
                           '<span style="font-family:monospace;">' + escW + '</span>' +
                           '<button onclick="removeNg(\'' + escW + '\')" class="btn" style="width:24px; height:24px; padding:0; line-height:22px; color:#f4212e; border-color:#38444d; display:flex; align-items:center; justify-content:center;">×</button>' +
                           '</div>';
                }).join("");
            }
            if($("ngCount")) $("ngCount").textContent = words.length + " " + t("words");
        }
        if(st.ok && st.settings) {
            if(selLog) selLog.value = st.settings.log_channel_id || "";
            if($("ngLogCh")) $("ngLogCh").value = st.settings.ng_log_channel_id || "";

            if($("threshold")) $("threshold").value = st.settings.ng_threshold ?? 3;
            if($("timeout")) $("timeout").value = st.settings.timeout_minutes ?? 10;

            if($("vcReportEnabled")) $("vcReportEnabled").checked = st.settings.vc_report_enabled || false;
            if($("vcReportCh")) $("vcReportCh").value = st.settings.vc_report_channel_id || "";
            if($("vcReportInterval")) $("vcReportInterval").value = st.settings.vc_report_interval || "weekly";

            // Render Role Rules
            const list = $("roleRulesList");
            list.innerHTML = "";
            const rules = st.settings.vc_role_rules || [];
            rules.forEach((r, idx) => addRoleRule(r.hours, r.role_id));

            // Milestone logic
            if (st.subscription) {
                const m = st.subscription.milestone || 1;
                $("milestoneCard").style.display = "block";
                $("milestoneLabel").textContent = "M" + m;
                $("milestoneProgress").style.width = (m * 20) + "%";
                $("unlockNext").style.display = (m >= 5) ? "none" : "inline-block";
                $("autoUnlockEnabled").checked = st.subscription.auto_unlock || false;
                
                // Highlight "Coming Soon" sections
                applyGatingUI(m);
            }
        }
     };

     const applyGatingUI = (m) => {
         const config = [
             { milestone: 2, id: "card-raid", name: "M2: 警備 (Security)" },
             { milestone: 4, id: "card-vc", name: "M4: 統治 (Engagement)" }
         ];
         
         config.forEach(c => {
             const el = document.getElementById(c.id);
             if (!el) return;
             
             // Remove existing overlay
             const old = el.querySelector(".locked-overlay");
             if (old) old.remove();
             el.style.position = m < c.milestone ? "relative" : "";
             el.style.opacity = m < c.milestone ? "0.6" : "1";
             el.style.pointerEvents = m < c.milestone ? "none" : "";

             if (m < c.milestone) {
                 const overlay = document.createElement("div");
                 overlay.className = "locked-overlay";
                 overlay.style = "position:absolute; inset:0; background:rgba(0,0,0,0.4); backdrop-filter:blur(2px); display:flex; align-items:center; justify-content:center; border-radius:inherit; z-index:10;";
                 overlay.innerHTML = '<div style="background:var(--accent-color); color:white; padding:8px 16px; border-radius:40px; font-weight:bold; box-shadow:0 4px 15px rgba(0,0,0,0.5);">Coming Soon... (' + c.name + ')</div>';
                 el.appendChild(overlay);
             }
         });
     };

     $("unlockNext").onclick = async () => {
         if (!confirm("次のフェーズの機能を解放しますか？")) return;
         const res = await api("/api/milestone/unlock", { guild: selGuild.value });
         if (res.ok) {
             alert("M" + res.milestone + " 解放完了！");
             reload();
         }
     };

     $("autoUnlockEnabled").onchange = async (e) => {
         await api("/api/milestone/auto_unlock", { guild: selGuild.value, enabled: e.target.checked });
     };

     $("broadcastUpdate").onclick = async () => {
         if (!confirm("UPDATE_LOG.mdの最新情報を全サーバーに配信しますか？")) return;
         const res = await api("/api/milestone/broadcast", { guild: selGuild.value });
         if (res.ok) alert("配信を開始しました。");
     };

     window.addRoleRule = (hours = 10, roleId = "") => {
         const list = $("roleRulesList");
         const div = document.createElement("div");
         div.className = "role-rule-item";
         div.style = "display:flex; gap:8px; align-items:center; background:rgba(255,255,255,0.03); padding:8px; border-radius:6px; border:1px solid #38444d;";
         
         const roleOptions = (window._serverRoles || []).map(r => '<' + 'option value="' + r.id + '"' + (r.id === roleId ? ' selected' : '') + '>' + escapeHTML(r.name) + '</' + 'option>').join("");
         
         div.innerHTML = '<' + 'input type="number" step="0.5" value="' + hours + '" style="width:60px; padding:6px; font-size:12px;" class="rule-hours">' +
            '<span style="font-size:12px;">時間以上で</span>' +
            '<' + 'select style="flex:1; padding:6px; font-size:12px; background:#15202b; color:white; border:1px solid #38444d;" class="rule-role">' +
                '<' + 'option value="">(ロールを選択)</' + 'option>' +
                roleOptions +
            '</' + 'select>' +
            '<' + 'button type="button" onclick="this.parentElement.remove()" class="btn" style="padding:4px 8px; color:var(--danger-color); border-color:#38444d;">×</' + 'button>';
         list.appendChild(div);
     };

     window.removeNg = async (w) => { await api("/api/ngwords/remove", {guild: selGuild.value, word: w }); reload(); };
     $("addNg").onclick = async () => { const w = $("newNg").value; if(!w)return; await api("/api/ngwords/add", {guild: selGuild.value, word: w }); $("newNg").value=""; reload(); };
     $("btn_clear").onclick = async () => { if(!confirm("Clear all?"))return; await api("/api/ngwords/clear", {guild: selGuild.value }); reload(); };
     
     $("save").onclick = async () => {
        const body = {
            guild: selGuild.value,
            log_channel_id: selLog.value,
            ng_log_channel_id: $("ngLogCh")?.value || "",
            audit_role_id: "",
            intro_channel_id: "",
            ng_threshold: parseInt($("threshold").value),
            timeout_minutes: parseInt($("timeout").value),
            vc_report_enabled: $("vcReportEnabled").checked,
            vc_report_channel_id: $("vcReportCh").value,
            vc_report_interval: $("vcReportInterval").value,
            vc_role_rules: Array.from(document.querySelectorAll(".role-rule-item")).map(el => ({
                hours: parseFloat(el.querySelector(".rule-hours").value),
                role_id: el.querySelector(".rule-role").value
            })).filter(r => r.role_id)
        };
        const res = await api("/api/settings/update", body);
        const stat = $("saveStatus");
        if(res.ok) {
            stat.textContent = "保存 " + t("save_success");
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

         
      
      let currentData = [];
      const renderRows = (data) => {
          const rows = document.getElementById("act-rows");
          let html = "";
          data.forEach(r => {
             const av = r.avatar_url || "";
             const roleTxt = r.has_role ? '<span style="color:#1da1f2;">OK</span>' : '<span style="color:var(--danger-color);">NG</span>';
             const introTxt = r.has_intro ? '<span style="color:#1da1f2;">OK</span>' : '<span style="color:var(--danger-color);">NG</span>';
             const statusStyle = r.status === "OK" ? 'color:#1da1f2; font-weight:bold;' : 'color:var(--danger-color); font-weight:bold;';
             const detailedStatus = r.status === "OK" ? "OK" : (!r.has_role ? "No Role" : (!r.has_intro ? "No Intro" : "No VC Activity"));
             
             const releaseBtn = r.status !== "OK" ? ('<button onclick="releaseTimeout(\'' + r.id + '\')" class="btn" style="padding:2px 8px; font-size:10px; background:var(--danger-color); color:white; border:none; margin-left:8px;">Release</button>') : "";

             html += '<tr>' +
                 '<td>' + (r.joined_at || '-') + '</td>' +
                 '<td><div style="display:flex; align-items:center; gap:8px;"><img src="' + av + '" style="width:24px; height:24px; border-radius:50%;" /> <span>' + escapeHTML(r.display_name) + '</span></div></td>' +
                 '<td style="text-align:center;">' + roleTxt + '</td>' +
                 '<td style="text-align:center;">' + introTxt + '</td>' +
                 '<td style="text-align:center;">' + r.last_vc + '</td>' +
                 '<td style="text-align:center; ' + statusStyle + '">' + detailedStatus + releaseBtn + '</td>' +
             '</tr>';
          });
          rows.innerHTML = html || '<tr><td colspan="6" class="muted" style="text-align:center;">' + t("ng_none") + '</td></tr>';
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

       window.releaseTimeout = async (uid) => {
           const gid = selGuild.value;
           if(!confirm("Release timeout for this user?")) return;
           const res = await api("/api/timeout/release", { guild: gid, user_id: uid });
           if(res.ok) {
               alert("Timeout released!");
               runScan();
           } else {
               alert("Error: " + res.error);
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
      const runScan = async () => {
         const gid = selGuild.value;
         const ar = $("auditRole").value;
         const ic = $("introCh").value;
         const vw = $("vcWeeks").value;
         if(!gid) return;
 
         rows.innerHTML = ""; 
         loading.style.display = "block";
         const res = await api("/api/activity?guild=" + gid + "&audit_role_id=" + ar + "&intro_channel_id=" + ic + "&vc_weeks=" + vw + "&refresh=1");
         loading.style.display = "none";
         
         if(!res.ok) { 
             const errorMsg = res.error.includes("Upgrade") ? "⚠️ " + res.error + ' <a href="/admin/dashboard" style="margin-left:8px;">Check Plans</a>' : res.error;
             rows.innerHTML = '<tr><td colspan="6" style="color:red; text-align:center;">' + errorMsg + '</td></tr>'; 
             return; 
         }
         
         currentData = res.data || [];
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
    (req.headers?.cookie || "").split(";").forEach((c) => {
        const [k, v] = c.trim().split("=");
        if (k && v) cookies[k] = decodeURIComponent(v);
    });
    // Prioritize Japanese unless explicitly English in cookies
    if (cookies.lang === "en") return "en";
    return "ja";
}

function renderLayout({ title, content, user, activeTab, oauth = false, scripts = "" }, lang = 'ja') {
    const navItem = (lbl, href, act) => `<a href="${href}" class="nav-item ${act ? 'active' : ''}">${lbl}</a>`;
    const langBtn = lang === 'ja'
        ? `<span class="lang-switch" onclick="setLang('en')">English</span>`
        : `<span class="lang-switch" onclick="setLang('ja')">日本語</span>`;

    return `<!DOCTYPE html>
<html lang="${lang}">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${title} | ☾</title><style>${COMMON_CSS}</style></head>
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
    <script>
        window.onerror = function(msg, url, line, col, error) {
            alert("System Error: " + msg + "\\nLine: " + line);
            return false;
        };
        window.lang = "${lang}";
        window.DICTIONARY = ${JSON.stringify(DICTIONARY)};
        window.t = (key, params = {}) => {
            const dict = window.DICTIONARY[window.lang] || window.DICTIONARY['ja'];
            let text = dict[key] || key;
            Object.keys(params).forEach(p => { text = text.replace('{'+p+'}', params[p]); });
            return text;
        };
    </script>
    <script src="/js/dashboard.js"></script>
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
    const content = `
    <!-- Compact Header & Summary -->
    <div class="card" style="padding: 10px; margin-bottom: 15px; max-width: 1000px;">
        <div style="display:flex; gap:10px; align-items:center; flex-wrap:nowrap; font-size:12px;">
            <select id="guild" style="padding:4px 8px; font-size:12px; min-width:140px;"></select>
            <input id="month" type="month" style="padding:4px; font-size:12px; width:115px;" />
            
            <div id="summary" style="display:flex; gap:12px; background:rgba(255,255,255,0.03); padding:4px 12px; border-radius:6px; border:1px solid var(--border-color); flex:1; justify-content:center; white-space:nowrap; color:var(--text-secondary);">
                ${t("dashboard_loading", lang) || "Loading Statistics..."}
            </div>

            <div style="white-space:nowrap; font-size:11px;">
                <span class="muted">${t("plan_label", lang)}:</span> <span id="plan-info" style="color:var(--accent-color); font-weight:bold;">...</span>
            </div>
            
            <button id="reload" class="btn btn-primary" style="padding:4px 12px; font-size:12px; min-width:70px;">Reload</button>
        </div>
    </div>

    <!-- Compact Charts Row -->
    <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(350px, 1fr)); gap:15px; margin-bottom:15px; max-width: 1000px; margin-left: auto; margin-right: auto;">
        <div class="card" style="padding:10px; margin-bottom:0; min-height:180px;">
            <h4 style="margin:0 0 8px 0; font-size:13px; font-weight:bold; color:var(--accent-color);">📈 ${t("growth_trend", lang) || "メンバー推移"}</h4>
            <div style="height:140px;"><canvas id="growthChart"></canvas></div>
        </div>
        <div class="card" style="padding:10px; margin-bottom:0; min-height:180px;">
            <h4 style="margin:0 0 8px 0; font-size:13px; font-weight:bold; color:var(--accent-color);">🔥 ${t("heatmap", lang) || "VCアクティビティ"}</h4>
            <div style="height:140px;"><canvas id="heatmapChart"></canvas></div>
        </div>
    </div>

    <div id="card-raid" class="card" style="padding:12px; max-width: 1000px;">
        <h4 style="margin:0 0 10px 0; font-size:13px; display:flex; align-items:center; gap:6px;">🛡️ Anti-Raid & Security</h4>
        <table class="data-table" style="font-size:12px;"><thead><tr><th style="text-align:left">${t("header_user", lang)}</th><th style="text-align:right">${t("header_count", lang)}</th><th style="text-align:right">Action</th></tr></thead>
        <tbody id="topNg"></tbody></table>
    </div>`;
    const scripts = `
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <script>initDashboard();</script>
    `;
    return renderLayout({ title: t("dashboard", lang), content, user, activeTab: "dashboard", oauth: true, scripts }, lang);
}

export function renderAdminSettingsHTML({ user, req }) {
    const lang = getLang(req);
    const content = `<div class="card"><div class="row" style="margin-bottom:16px;"><select id="guild" style="width:100%; max-width:300px; padding:10px;"></select> <button id="reload" class="btn">Reload</button></div></div>
    
    <div style="max-width: 900px; margin: 0 auto;">
        <!-- NG Words Accordion -->
        <div class="accordion-item" id="accordion-ng">
            <div class="accordion-header" onclick="toggleAccordion('accordion-ng')">
                <span><i class="icon">🚫</i> ${t("ng_words", lang)}</span>
                <span class="accordion-arrow">▼</span>
            </div>
            <div class="accordion-content">
                <div style="background:rgba(0,0,0,0.3); padding:15px; border-radius:8px; border:1px solid #38444d;">
                    <div style="margin-bottom:15px;">
                        <label style="display:block; margin-bottom:5px; font-size:12px; font-weight:bold; color:#8899a6;">${t("ng_add_label", lang)}</label>
                        <div style="display:flex; gap:10px;">
                            <textarea id="newNg" rows="1" placeholder="${t("ng_msg_placeholder", lang)}" style="flex:1; padding:10px; border:1px solid #38444d; background:#192734; color:white; border-radius:4px; resize:vertical; font-family:inherit;"></textarea>
                            <button id="addNg" class="btn" style="width:40px; font-size:20px; padding:0; display:flex; align-items:center; justify-content:center;">+</button>
                        </div>
                    </div>
                    
                    <label style="display:block; margin-bottom:5px; font-size:12px; font-weight:bold; color:#8899a6;">${t("ng_delete_label", lang)}</label>
                    <div id="ngList" style="display:flex; flex-direction:column; gap:8px; max-height:300px; overflow-y:auto; padding:5px;"></div>
                    
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-top:15px; border-top:1px solid #38444d; padding-top:10px;">
                        <span id="ngCount" class="muted">0 ${t("words", lang)}</span>
                        <button id="btn_clear" class="btn" style="color:#f4212e; border-color:#f4212e; padding:4px 12px; font-size:12px;">${t("ng_clear_all", lang)}</button>
                    </div>
                </div>
            </div>
        </div>

        <!-- General Config Accordion -->
        <div class="accordion-item active" id="accordion-general">
            <div class="accordion-header" onclick="toggleAccordion('accordion-general')">
                <span><i class="icon">⚙️</i> ${t("config_general", lang)}</span>
                <span class="accordion-arrow">▼</span>
            </div>
            <div class="accordion-content">
                <!-- Section 1: Logging -->
                <div class="setting-section">
                    <div class="setting-title">
                        通知・ログ構成
                        <span class="help-icon" data-help="Botが検知したイベントやVCのログをどこに送信するか設定します。">?</span>
                    </div>
                    <div class="row" style="margin-bottom:15px;">
                        <label style="display:block; margin-bottom:5px; font-weight:bold;">${t("log_channel", lang)} <span class="muted" style="font-weight:normal; font-size:0.9em;">(VC入退室)</span></label>
                        <select id="logCh" style="width:100%; padding:10px; background:#192734; border:1px solid #555; color:white;"></select>
                    </div>
                    <div class="row">
                        <label style="display:block; margin-bottom:5px; font-weight:bold;">${t("ng_log_channel", lang)} <span class="muted" style="font-weight:normal; font-size:0.9em;">(NG検知・管理ログ)</span></label>
                        <select id="ngLogCh" style="width:100%; padding:10px; background:#192734; border:1px solid #555; color:white;"></select>
                    </div>
                </div>

                <!-- Section 2: Punishments -->
                <div class="setting-section">
                    <div class="setting-title">
                        処罰しきい値設定
                        <span class="help-icon" data-help="一定時間内にNGワードを何回発言したら自動的にタイムアウトさせるかを設定します。">?</span>
                    </div>
                    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:15px;">
                        <div>
                            <label style="display:block; margin-bottom:8px;">${t("threshold_label", lang)}</label>
                            <input id="threshold" type="number" min="1" max="100" style="width:100%; padding:10px;">
                        </div>
                        <div>
                            <label style="display:block; margin-bottom:8px;">${t("timeout_label", lang)}</label>
                            <select id="timeout" style="width:100%; padding:10px; background:#192734; border:1px solid #555; color:white;">
                                <option value="1">1分(60秒)</option>
                                <option value="5">5分</option>
                                <option value="10">10分</option>
                                <option value="60">1時間</option>
                                <option value="1440">1日</option>
                                <option value="10080">1週間</option>
                            </select>
                        </div>
                    </div>
                </div>

                <!-- Section 3: Advanced Moderation -->
                <div class="setting-section">
                    <div class="setting-title">
                        🛡️ 高度なモデレーション
                        <span class="help-icon" data-help="短時間に大量のユーザーが参加する『レイド』を検知し、管理者に通知したりサーバーを保護したりします。">?</span>
                    </div>
                    <div style="margin-bottom:15px;">
                        <label class="switch-label">
                            <input type="checkbox" id="antiraidEnabled" />
                            <span>アンチ・レイドを有効化</span>
                        </label>
                    </div>
                    <div style="margin-bottom:10px;">
                        <label style="display:block; font-size:11px; margin-bottom:4px; font-weight:bold;">検知しきい値 (参加数/分)</label>
                        <input type="number" id="antiraidThreshold" style="width:100%; padding:10px; border-radius:6px; background:#15202b; border:1px solid #38444d; color:white;" />
                    </div>
                </div>

                <!-- Section 4: Self-Intro Gate -->
                <div class="setting-section">
                    <div class="setting-title">
                        🚪 自己紹介ゲート
                        <span class="help-icon" data-help="新規メンバーが指定されたチャンネルで自己紹介を書くまで、特定のロール（権限）を付与しないように制限します。">?</span>
                    </div>
                    <div style="margin-bottom:15px;">
                        <label class="switch-label">
                            <input type="checkbox" id="introGateEnabled" />
                            <span>自動自己紹介ゲートを有効化</span>
                        </label>
                    </div>
                    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:15px;">
                        <div>
                            <label style="display:block; font-size:11px; margin-bottom:4px; font-weight:bold;">付与するロール</label>
                            <select id="introRole" style="width:100%; padding:10px; border-radius:6px; background:#15202b; border:1px solid #38444d; color:white;"></select>
                        </div>
                        <div>
                            <label style="display:block; font-size:11px; margin-bottom:4px; font-weight:bold;">最低必要文字数</label>
                            <input type="number" id="introMinLen" style="width:100%; padding:10px; border-radius:6px; background:#15202b; border:1px solid #38444d; color:white;" />
                        </div>
                    </div>
                </div>

                <!-- Section 5: VC Engagement -->
                <div class="setting-section">
                    <div class="setting-title">
                        📊 VCエンゲージメント
                        <span class="help-icon" data-help="ボイスチャンネルの活動履歴を元に、定期的なレポートを投稿したり、滞在時間に応じた役職を自動付与したりします。">?</span>
                    </div>
                    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:20px;">
                        <div>
                            <h4 style="margin-top:0; color:var(--text-secondary); font-size:12px; text-transform:uppercase;">定期ランキングレポート</h4>
                            <div style="margin-bottom:12px;">
                                <label class="switch-label">
                                    <input type="checkbox" id="vcReportEnabled" />
                                    <span>自動レポートを有効化</span>
                                </label>
                            </div>
                            <div style="margin-bottom:12px;">
                                <label style="display:block; font-size:11px; margin-bottom:4px; font-weight:bold;">投稿先チャンネル</label>
                                <select id="vcReportCh" style="width:100%; padding:10px; border-radius:6px; background:#15202b; border:1px solid #38444d; color:white;"></select>
                            </div>
                            <div>
                                <label style="display:block; font-size:11px; margin-bottom:4px; font-weight:bold;">投稿頻度</label>
                                <select id="vcReportInterval" style="width:100%; padding:10px; border-radius:6px; background:#15202b; border:1px solid #38444d; color:white;">
                                    <option value="daily">毎日</option>
                                    <option value="weekly">毎週</option>
                                    <option value="monthly">毎月</option>
                                </select>
                            </div>
                        </div>
                        <div>
                            <h4 style="margin-top:0; color:var(--text-secondary); font-size:12px; text-transform:uppercase;">VC時間報酬（自動ロール）</h4>
                            <div id="roleRulesList" style="display:flex; flex-direction:column; gap:8px; margin-bottom:12px;">
                                <!-- Rules added here by JS -->
                            </div>
                            <button type="button" onclick="addRoleRule()" class="btn" style="width:100%; padding:8px; font-size:12px; border-style:dashed; border-color:#555;">+ ルールを追加</button>
                            <p class="muted" style="margin-top:10px; font-size:10px;">※ルールは毎時チェックされ、条件を満たさなくなるとロールは剥奪されます。</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <div style="margin-top:30px; text-align:center; margin-bottom: 50px;">
            <button id="save" class="btn btn-primary" style="padding:12px 60px; font-size:18px;">${t("save", lang)}</button>
            <div id="saveStatus" style="margin-top:15px; min-height:24px; font-weight:bold;"></div>
        </div>
    </div>`;
    const scripts = `<script>initSettings();</script>`;
    return renderLayout({ title: t("settings", lang), content, user, activeTab: "settings", oauth: true, scripts }, lang);
}

export function renderAdminActivityHTML({ user, req }) {
    const lang = getLang(req);
    const content = `<div class="card">
        <div style="display:flex; flex-wrap:wrap; gap:10px; align-items:flex-end;">
            <div style="flex:1; min-width:100px;">
                <label style="display:block; font-size:11px; margin-bottom:4px; font-weight:bold; white-space:nowrap;">${t("label_guild", lang)}</label>
                <select id="guild" style="width:100%; padding:8px; font-size:13px; border-radius:6px; background:#15202b; border:1px solid #38444d; color:white;"></select>
            </div>
            <div style="flex:1; min-width:100px;">
                <label style="display:block; font-size:11px; margin-bottom:4px; font-weight:bold; white-space:nowrap;">${t("audit_role", lang)}</label>
                <select id="auditRole" style="width:100%; padding:8px; font-size:13px; border-radius:6px; background:#15202b; border:1px solid #38444d; color:white;"></select>
            </div>
            <div style="flex:1; min-width:100px;">
                <label style="display:block; font-size:11px; margin-bottom:4px; font-weight:bold; white-space:nowrap;">${t("intro_channel", lang)}</label>
                <select id="introCh" style="width:100%; padding:8px; font-size:13px; border-radius:6px; background:#15202b; border:1px solid #38444d; color:white;"></select>
            </div>
            <div style="flex:0.8; min-width:80px;">
                <label style="display:block; font-size:11px; margin-bottom:4px; font-weight:bold; white-space:nowrap;">VC未利用(週)</label>
                <select id="vcWeeks" style="width:100%; padding:8px; font-size:13px; border-radius:6px; background:#15202b; border:1px solid #38444d; color:white;">
                    <option value="0">None</option>
                    <option value="1">1週間以上</option>
                    <option value="2">2週間以上</option>
                    <option value="4">4週間以上</option>
                </select>
            </div>
            <div style="display:flex; gap:5px; margin-left: auto; align-items:flex-end;">
                <div style="text-align:left;">
                    <label style="display:block; font-size:9px; margin-bottom:2px; font-weight:bold; color:var(--text-secondary);">CSV Scope</label>
                    <select id="csvFilter" style="padding:6px; font-size:12px; border-radius:6px; background:#15202b; border:1px solid #38444d; color:white;">
                        <option value="ng">NG Only</option>
                        <option value="all">All Users</option>
                    </select>
                </div>
                <button id="scan" class="btn btn-primary" style="padding:6px 12px; font-size:13px; white-space:nowrap;">🔍 ${t("scan_btn", lang)}</button>
                <button id="csvExport" class="btn" style="padding:6px 12px; font-size:13px; border-color: #ffd700; color: #ffd700; white-space:nowrap;">📥 CSV</button>
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
        <div id="act-loading" style="display:none; text-align:center; padding:20px;">${t("msg_scanning", lang)}</div>
    </div>`;
    const scripts = `<script>
        initActivity();
        document.getElementById("csvExport").onclick = () => {
            const gid = $("guild").value;
            const ar = $("auditRole").value;
            const ic = $("introCh").value;
            const vw = $("vcWeeks").value;
            const cf = $("csvFilter").value || "ng";
            if(!gid) return;
            window.location.href = \`/api/activity/export?guild=\${gid}&audit_role_id=\${ar}&intro_channel_id=\${ic}&vc_weeks=\${vw}&filter=\${cf}\`;
        };
    </script>`;
    return renderLayout({ title: t("activity", lang), content, user, activeTab: "activity", oauth: true, scripts }, lang);
}

export function renderLandingHTML(req) {
    const lang = getLang(req);
    const content = `
    <div style="text-align:center; padding: 100px 20px;">
        <h1 style="font-size: 56px; margin-bottom: 20px;">☾ ${t("title", lang)}</h1>
        <p style="font-size: 20px; color: #fff; font-weight:bold; margin-bottom: 20px; max-width: 800px; margin-left: auto; margin-right: auto;">${t("subtitle", lang)}</p>
        <p style="font-size: 16px; color: #8899a6; margin-bottom: 50px; max-width: 600px; margin-left: auto; margin-right: auto; line-height: 1.8;">${t("app_desc", lang)}</p>
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
        .feature-grid { display: grid; grid-template-columns: 1fr; gap: 15px; margin-top: 25px; max-width: 600px; margin-left: auto; margin-right: auto; }
        .plan-card { background: rgba(25, 39, 52, 0.5); border: 1px solid var(--border-color); border-radius: 20px; padding: 40px 20px; text-align: center; max-width: 600px; margin: 0 auto; transition: all 0.3s; }
        .plan-price { font-size: 36px; font-weight: 900; margin: 10px 0; color: var(--primary-color); }
        .plan-badge { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 11px; background: rgba(29, 161, 242, 0.1); color: var(--primary-color); margin-bottom: 10px; text-transform: uppercase; letter-spacing: 1px; font-weight: bold; }
        .feature-list { text-align: left; margin: 25px auto; max-width: 400px; line-height: 2; color: #fff; font-size: 15px; }
        .feature-list i { color: var(--success-color); margin-right: 10px; font-style: normal; font-weight: bold; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
        .recommend-container { display:grid; grid-template-columns: repeat(2, 1fr); gap:15px; max-width:600px; margin:0 auto; }
        .recommend-card { background:rgba(25, 39, 52, 0.5); padding:20px; border-radius:12px; border:1px solid var(--border-color); font-weight:bold; color:var(--text-primary); text-align:left; display:flex; align-items:center; gap:10px; }
        .faq-container { max-width:800px; margin:0 auto; text-align:left; }
        .faq-item { margin-bottom:25px; border-bottom:1px solid var(--border-color); padding-bottom:20px; }
        .faq-q { font-weight:bold; font-size:18px; margin-bottom:10px; color:var(--text-primary); display:flex; gap:10px; }
        .faq-a { color:#8899a6; line-height:1.7; padding-left:30px; }
        .notice-container { margin-top:60px; padding:30px; background:rgba(0,0,0,0.3); border-radius:12px; border:1px solid var(--border-color); text-align:left; font-size:14px; color:#8899a6; max-width:900px; margin-left:auto; margin-right:auto; }
        .notice-header { color:var(--text-primary); font-weight:bold; margin-bottom:8px; border-bottom:1px solid var(--border-color); padding-bottom:5px; display:inline-block; }
    </style>

    <div style="text-align:center; padding: 60px 20px 20px;">
        <h1 style="font-size: 48px; margin-bottom: 10px; letter-spacing: -1px;">${t("features_title", lang)}</h1>
        <p style="font-size: 18px; color: #8899a6; margin-bottom: 40px; max-width: 600px; margin-left: auto; margin-right: auto;">${t("features_subtitle", lang)}</p>
    </div>

    <div class="feature-tabs">
        <button class="tab-btn active" onclick="switchTab('free')">${t("plan_free", lang)}</button>
        <button class="tab-btn" onclick="switchTab('pro')">${t("plan_pro", lang)}</button>
        <button class="tab-btn" onclick="switchTab('pro-plus')">${t("plan_pro_plus", lang)}</button>
    </div>

    <div id="tab-free" class="tab-content active">
        <div class="plan-card">
            <span class="plan-badge">${t("plan_badge_std", lang)}</span>
            <h2 style="font-size: 32px; margin-bottom: 5px;">${t("plan_free", lang)}</h2>
            <div class="plan-price">¥0 <span style="font-size:14px; color:#8899a6; font-weight:normal;">${t("period_forever", lang)}</span></div>
            <p style="color:#8899a6; margin-bottom:10px;">${t("plan_free_desc", lang)}</p>
            <div class="feature-list">
                ${t("feat_list_free", lang).split('<br/>').map(f => `<div><i>✓</i> ${f.replace('・', '')}</div>`).join('')}
            </div>
        </div>
    </div>

    <div id="tab-pro" class="tab-content">
        <div class="plan-card" style="border: 3px solid var(--primary-color); background: rgba(29, 161, 242, 0.05); box-shadow: 0 10px 30px rgba(29, 161, 242, 0.15);">
            <span class="plan-badge" style="background:var(--primary-color); color:white;">${t("plan_badge_rec", lang)}</span>
            <h2 style="font-size: 32px; margin-bottom: 5px;">${t("plan_pro", lang)}</h2>
            <div class="plan-price">¥680 <span style="font-size:14px; color:#8899a6; font-weight:normal;">${t("period_month", lang)}</span></div>
            <p style="color:#8899a6; margin-bottom:10px;">${t("plan_pro_desc", lang)}</p>
            <div class="feature-list">
                ${t("feat_list_pro", lang).split('<br/>').map(f => `<div><i>✓</i> ${f.replace('・', '')}</div>`).join('')}
            </div>
        </div>
    </div>

    <div id="tab-pro-plus" class="tab-content">
        <div class="plan-card" style="border: 2px solid #ffd700; background: rgba(255, 215, 0, 0.03); box-shadow: 0 10px 30px rgba(255, 215, 0, 0.1);">
            <span class="plan-badge" style="background:#ffd700; color:black;">${t("plan_badge_prm", lang)}</span>
            <h2 style="font-size: 32px; margin-bottom: 5px;">${t("plan_pro_plus", lang)}</h2>
            <div class="plan-price">¥1,800 <span style="font-size:14px; color:#8899a6; font-weight:normal;">${t("period_month", lang)}</span></div>
            <p style="color:#8899a6; margin-bottom:10px;">${t("plan_pro_plus_desc", lang)}</p>
            <div class="feature-list">
                ${t("feat_list_pro_plus", lang).split('<br/>').map(f => `<div><i>✓</i> ${f.replace('・', '')}</div>`).join('')}
            </div>
        </div>
    </div>

    <div class="card" style="margin-top: 60px; padding: 40px; border-color: rgba(255,255,255,0.1);">
        <h3 style="text-align:center; margin-bottom:30px; font-size: 24px;">${t("quick_comparison", lang)}</h3>
        <style>
            .compare-table { width: 100%; border-collapse: separate; border-spacing: 0; border-radius: 12px; overflow: hidden; border: 1px solid #38444d; }
            .compare-table thead th { background: #192734; padding: 20px 12px; text-align: center; font-weight: bold; border-bottom: 1px solid #38444d; border-right: 1px solid #38444d; }
            .compare-table thead th:last-child { border-right: none; }
            .compare-table tbody td { padding: 18px 12px; border-bottom: 1px solid #38444d; border-right: 1px solid #38444d; text-align: center; }
            .compare-table tbody td:last-child { border-right: none; }
            .compare-table tbody tr:last-child td { border-bottom: none; }
            .compare-table tbody td:first-child { text-align: left; font-weight: bold; background: rgba(255,255,255,0.02); padding-left: 20px; }
            .compare-table tbody tr:hover { background: rgba(255,255,255,0.03); }
            .feature-check { color: #00ba7c; font-size: 22px; font-weight: bold; }
            .feature-cross { color: #f91880; font-size: 22px; font-weight: bold; }
            .feature-number { color: var(--accent-color); font-weight: bold; font-size: 18px; }
        </style>
        <table class="compare-table">
            <thead>
                <tr>
                    <th style="text-align:left; padding-left: 20px;">Features</th>
                    <th>${t("plan_free", lang)}</th>
                    <th style="background: rgba(29, 161, 242, 0.1); color: var(--accent-color);">${t("plan_pro", lang)}</th>
                    <th style="background: rgba(255, 215, 0, 0.05); color: #ffd700;">${t("plan_pro_plus", lang)}</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td>${t("feature_max_guilds", lang)}</td>
                    <td><span class="feature-number">1</span></td>
                    <td><span class="feature-number">1</span></td>
                    <td><span class="feature-number">3</span></td>
                </tr>
                <tr>
                    <td>${t("feature_ng_limit", lang)}</td>
                    <td><span class="feature-number">5</span></td>
                    <td><span class="feature-number">20</span></td>
                    <td><span class="feature-number">50</span></td>
                </tr>
                <tr>
                    <td>${t("feature_vclog", lang)}</td>
                    <td><span class="feature-check">✓</span></td>
                    <td><span class="feature-check">✓</span></td>
                    <td><span class="feature-check">✓</span></td>
                </tr>
                <tr>
                    <td>${t("feature_logs", lang)}</td>
                    <td><span class="feature-cross">×</span></td>
                    <td><span class="feature-check">✓</span></td>
                    <td><span class="feature-check">✓</span></td>
                </tr>
                <tr>
                    <td>${t("feature_spam", lang)}</td>
                    <td><span class="feature-cross">×</span></td>
                    <td><span class="feature-check">✓</span></td>
                    <td><span class="feature-check">✓</span></td>
                </tr>
                <tr>
                    <td>${t("feature_auto_release", lang)}</td>
                    <td><span class="feature-cross">×</span></td>
                    <td><span class="feature-check">✓</span></td>
                    <td><span class="feature-check">✓</span></td>
                </tr>
                <tr>
                    <td>${t("feature_dashboard", lang)}</td>
                    <td><span class="feature-cross">×</span></td>
                    <td><span class="feature-check">✓</span></td>
                    <td><span class="feature-check">✓</span></td>
                </tr>
                <tr>
                    <td>${t("feature_activity", lang)}</td>
                    <td><span class="feature-cross">×</span></td>
                    <td><span class="muted" style="font-size:11px;">(Soon)</span></td>
                    <td><span class="muted" style="font-size:11px;">(Soon)</span></td>
                </tr>
                <tr>
                    <td>${t("feature_antiraid", lang)}</td>
                    <td><span class="feature-cross">×</span></td>
                    <td><span class="muted" style="font-size:11px;">(Soon)</span></td>
                    <td><span class="muted" style="font-size:11px;">(Soon)</span></td>
                </tr>
                <tr>
                    <td>${t("feature_intro_gate", lang)}</td>
                    <td><span class="feature-cross">×</span></td>
                    <td><span class="feature-cross">×</span></td>
                    <td><span class="muted" style="font-size:11px;">(Soon)</span></td>
                </tr>
                <tr>
                    <td>${t("feature_csv", lang)}</td>
                    <td><span class="feature-cross">×</span></td>
                    <td><span class="feature-cross">×</span></td>
                    <td><span class="feature-check">✓</span></td>
                </tr>
            </tbody>
        </table>
    </div>

    <div style="margin-top: 80px; text-align: center;">
        <h2 style="font-size: 32px; margin-bottom: 30px;">${t("sec_recommend", lang)}</h2>
        <div class="recommend-container">
            <div class="recommend-card"><span style="color:var(--success-color);">✔</span> ${t("text_recommend_1", lang)}</div>
            <div class="recommend-card"><span style="color:var(--success-color);">✔</span> ${t("text_recommend_2", lang)}</div>
            <div class="recommend-card"><span style="color:var(--success-color);">✔</span> ${t("text_recommend_3", lang)}</div>
            <div class="recommend-card"><span style="color:var(--success-color);">✔</span> ${t("text_recommend_4", lang)}</div>
        </div>
    </div>

    <div style="margin-top: 80px;">
        <h2 style="font-size: 32px; margin-bottom: 40px; text-align: center;">${t("sec_faq", lang)}</h2>
        <div class="faq-container">
            <div class="faq-item"><div class="faq-q"><span style="color:var(--accent-color);">Q.</span> ${t("faq_q1", lang)}</div><div class="faq-a">${t("faq_a1", lang)}</div></div>
            <div class="faq-item"><div class="faq-q"><span style="color:var(--accent-color);">Q.</span> ${t("faq_q2", lang)}</div><div class="faq-a">${t("faq_a2", lang)}</div></div>
            <div class="faq-item"><div class="faq-q"><span style="color:var(--accent-color);">Q.</span> ${t("faq_q3", lang)}</div><div class="faq-a">${t("faq_a3", lang)}</div></div>
            <div class="faq-item"><div class="faq-q"><span style="color:var(--accent-color);">Q.</span> ${t("faq_q4", lang)}</div><div class="faq-a">${t("faq_a4", lang)}</div></div>
            <div class="faq-item"><div class="faq-q"><span style="color:var(--accent-color);">Q.</span> ${t("faq_q5", lang)}</div><div class="faq-a">${t("faq_a5", lang)}</div></div>
            <div class="faq-item"><div class="faq-q"><span style="color:var(--accent-color);">Q.</span> ${t("faq_q6", lang)}</div><div class="faq-a">${t("faq_a6", lang)}</div></div>
            <div class="faq-item"><div class="faq-q"><span style="color:var(--accent-color);">Q.</span> ${t("faq_q7", lang)}</div><div class="faq-a">${t("faq_a7", lang)}</div></div>
        </div>
    </div>

    <div style="margin-top: 80px; text-align: left; max-width: 800px; margin-left: auto; margin-right: auto;">
        <h2 style="font-size: 32px; margin-bottom: 20px; text-align: center;">🚀 ${t("roadmap_title", lang)}</h2>
        <p style="text-align: center; color: #8899a6; margin-bottom: 40px;">${t("roadmap_subtitle", lang)}</p>
        
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px;">
            <div class="card" style="margin: 0; padding: 25px;">
                <span class="plan-badge" style="background: rgba(255,255,255,0.05); color: #fff;">${t("roadmap_tag", lang)}</span>
                <h4 style="margin: 10px 0;">${t("roadmap_audit", lang)}</h4>
                <p class="muted" style="font-size: 13px;">${t("roadmap_audit_desc", lang)}</p>
            </div>
            <div class="card" style="margin: 0; padding: 25px;">
                <span class="plan-badge" style="background: rgba(255,255,255,0.05); color: #fff;">${t("roadmap_tag", lang)}</span>
                <h4 style="margin: 10px 0;">${t("roadmap_antiraid", lang)}</h4>
                <p class="muted" style="font-size: 13px;">${t("roadmap_antiraid_desc", lang)}</p>
            </div>
            <div class="card" style="margin: 0; padding: 25px;">
                <span class="plan-badge" style="background: rgba(255,255,255,0.05); color: #fff;">${t("roadmap_tag", lang)}</span>
                <h4 style="margin: 10px 0;">${t("roadmap_introgate", lang)}</h4>
                <p class="muted" style="font-size: 13px;">${t("roadmap_introgate_desc", lang)}</p>
            </div>
        </div>
    </div>

    <div style="text-align:center; padding: 80px 0;">
        <p style="font-size: 15px; color: #f4212e; margin-bottom: 20px; font-weight: bold;">${t("msg_admin_req", lang)}</p>
        <a href="https://discord.com/oauth2/authorize?client_id=1468816330999468122&permissions=8&integration_type=0&scope=bot" target="_blank" class="btn btn-primary" style="padding:20px 70px; font-size:22px; border-radius:50px; box-shadow: 0 10px 20px rgba(29, 155, 240, 0.3);">${t("get_started", lang)}</a>
    </div>

    <div class="notice-container">
        <div style="margin-bottom:25px;">
            <div class="notice-header">${t("sec_sales", lang)}</div>
            <p>${t("text_sales", lang)}</p>
        </div>
        <div style="margin-bottom:25px;">
            <div class="notice-header">${t("sec_support", lang)}</div>
            <p>${t("text_support", lang)}</p>
        </div>
        <div>
            <div class="notice-header">${t("sec_caution", lang)}</div>
            <p>${t("text_caution", lang)}</p>
        </div>
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
