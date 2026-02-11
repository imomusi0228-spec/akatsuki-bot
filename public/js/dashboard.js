
const $ = (id) => document.getElementById(id);
const escapeHTML = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
function yyyymmNow() { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); }

const api = async (path, body) => {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 15000);
    try {
        const r = await fetch(path, {
            method: body ? "POST" : "GET",
            headers: body ? { "Content-Type": "application/json" } : {},
            body: body ? JSON.stringify(body) : null,
            signal: ctrl.signal
        });
        clearTimeout(tid);
        if (r.status === 401) { location.href = "/login"; return { ok: false }; }
        return await r.json();
    } catch (e) {
        clearTimeout(tid);
        return { ok: false, error: e.name === 'AbortError' ? 'Timeout' : e.message };
    }
};

function setLang(l) { document.cookie = "lang=" + l + ";path=/;max-age=31536000;SameSite=Lax"; location.reload(); }

let _guildsLoaded = false;
async function loadGuilds() {
    if (_guildsLoaded) return true;
    const sel = $("guild");
    if (!sel) return false;
    sel.innerHTML = "<option>Loading...</option>"; sel.disabled = true;

    const d = await api("/api/guilds");
    sel.innerHTML = "";

    if (d && d.ok && d.guilds && d.guilds.length) {
        const lastGid = localStorage.getItem("last_guild_id");
        let selectedIndex = 0;
        d.guilds.forEach((g, i) => {
            const o = document.createElement("option");
            o.value = g.id;
            o.textContent = g.name;
            sel.appendChild(o);
            if (lastGid && g.id === lastGid) selectedIndex = i;
        });
        sel.selectedIndex = selectedIndex;
        sel.disabled = false;
        _guildsLoaded = true;
        return true;
    }

    const o = document.createElement("option"); o.textContent = "(No Guilds)"; sel.appendChild(o);
    const errMsg = (d && d.error) ? d.error : "Check Bot Permissions/Invite";
    $("guildStatus").innerHTML = '<span style="color:var(--danger-color)">' + escapeHTML(errMsg) + '</span>';
    return false;
}

function saveGuildSelection() { const sel = $("guild"); if (sel && sel.value) localStorage.setItem("last_guild_id", sel.value); }

async function initDashboard() {
    try {
        if (!await loadGuilds()) return;
        const monInput = $("month");
        if (monInput) monInput.value = yyyymmNow();

        const reload = async () => {
            try {
                saveGuildSelection();
                const gid = $("guild").value;
                const mon = $("month").value;
                if (!gid) return;

                $("summary").innerHTML = "Loading...";
                const res = await api(`/api/stats?guild=${gid}&month=${mon}`);
                if (res.ok) {
                    const s = res.stats.summary;
                    const sub = res.subscription;
                    const validUntil = sub.valid_until ? '(' + sub.valid_until.split('T')[0] + ')' : '';
                    $("plan-info").innerHTML = `<span style="color:var(--accent-color); font-weight:bold;">${sub.name}</span> ${validUntil}`;

                    const box = (l, v) => `<div style="background:rgba(255,255,255,0.05); padding:10px; border-radius:8px; text-align:center;"><div style="font-size:24px; font-weight:bold;">${v}</div><div style="font-size:11px; color:#888;">${l}</div></div>`;
                    $("summary").innerHTML = `<div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:8px; width:100%;">${box(t("vc_joins"), s.joins)} ${box(t("leaves"), s.leaves)} ${box(t("timeouts"), s.timeouts)} ${box(t("ng_detect"), s.ngDetected)}</div>`;

                    let rows = "";
                    (res.stats.topNgUsers || []).forEach(u => {
                        const av = u.avatar_url ? '<img src="' + u.avatar_url + '" style="width:24px; height:24px; border-radius:50%; vertical-align:middle; margin-right:8px;">' : '';
                        rows += `<tr><td>${av}${escapeHTML(u.display_name || 'Unknown')}</td><td style="text-align:right">${u.cnt}</td></tr>`;
                    });
                    $("topNg").innerHTML = rows || '<tr><td colspan="2" class="muted" style="text-align:center; padding:10px;">None</td></tr>';
                } else {
                    $("summary").innerText = "Error: " + res.error;
                }
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
    if (!await loadGuilds()) return;

    // const lang = document.documentElement.lang || 'ja'; // Not really needed if we use window.t
    const selLog = $("logCh");
    const selGuild = $("guild");

    const loadMasters = async (gid) => {
        const [ch, rl] = await Promise.all([api(`/api/channels?guild=${gid}`), api(`/api/roles?guild=${gid}`)]);
        if (selLog) {
            selLog.innerHTML = '<option value="">(None / No Log)</option>';
            if (ch.ok) ch.channels.forEach(c => { const o = document.createElement("option"); o.value = c.id; o.textContent = "#" + c.name; selLog.appendChild(o); });
        }
        if ($("auditRole")) {
            $("auditRole").innerHTML = '<option value="">(None / No Audit)</option>';
            if (rl.ok) rl.roles.forEach(r => { const o = document.createElement("option"); o.value = r.id; o.textContent = r.name; $("auditRole").appendChild(o); });
        }
        if ($("introCh")) {
            $("introCh").innerHTML = '<option value="">(None / No Intro Check)</option>';
            if (ch.ok) ch.channels.forEach(c => { const o = document.createElement("option"); o.value = c.id; o.textContent = "#" + c.name; $("introCh").appendChild(o); });
        }
    };

    const reload = async () => {
        saveGuildSelection(); const gid = selGuild.value; if (!gid) return;

        await loadMasters(gid);
        const [ng, st] = await Promise.all([api(`/api/ngwords?guild=${gid}`), api(`/api/settings?guild=${gid}`)]);

        if (ng.ok) {
            const list = $("ngList");
            const words = ng.words || [];
            if (words.length === 0) {
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
            if ($("ngCount")) $("ngCount").textContent = words.length + " " + t("words");
        }
        if (st.ok && st.settings) {
            if (selLog) selLog.value = st.settings.log_channel_id || "";
            if ($("auditRole")) $("auditRole").value = st.settings.audit_role_id || "";
            if ($("introCh")) $("introCh").value = st.settings.intro_channel_id || "";
            if ($("threshold")) $("threshold").value = st.settings.ng_threshold ?? 3;
            if ($("timeout")) $("timeout").value = st.settings.timeout_minutes ?? 10;
        }
    };

    window.removeNg = async (w) => { await api("/api/ngwords/remove", { guild: selGuild.value, word: w }); reload(); };
    $("addNg").onclick = async () => { const w = $("newNg").value; if (!w) return; await api("/api/ngwords/add", { guild: selGuild.value, word: w }); $("newNg").value = ""; reload(); };
    $("btn_clear").onclick = async () => { if (!confirm("Clear all?")) return; await api("/api/ngwords/clear", { guild: selGuild.value }); reload(); };

    $("save").onclick = async () => {
        const body = {
            guild: selGuild.value,
            log_channel_id: selLog.value,
            audit_role_id: $("auditRole")?.value || "",
            intro_channel_id: $("introCh")?.value || "",
            ng_threshold: parseInt($("threshold").value),
            timeout_minutes: parseInt($("timeout").value)
        };
        const res = await api("/api/settings/update", body);
        const stat = $("saveStatus");
        if (res.ok) {
            stat.textContent = "保存 " + t("save_success");
            stat.style.color = "var(--success-color)";
            setTimeout(() => stat.textContent = "", 3000);
        } else {
            stat.textContent = "Error: " + res.error;
            stat.style.color = "var(--danger-color)";
        }
    };

    selGuild.onchange = reload; $("reload").onclick = reload; reload();
}

async function initActivity() {
    if (!await loadGuilds()) return;
    const selGuild = document.getElementById("guild");
    const selRole = document.getElementById("auditRole");
    const selIntro = document.getElementById("introCh");

    const reloadCriteria = async () => {
        const gid = selGuild.value;
        if (!gid) return;

        const [chRes, roleRes, setRes] = await Promise.all([
            api("/api/channels?guild=" + gid),
            api("/api/roles?guild=" + gid),
            api("/api/settings?guild=" + gid)
        ]);

        if (chRes.ok) {
            selIntro.innerHTML = '<option value="">None</option>' + chRes.channels.map(c => '<option value="' + c.id + '">#' + c.name + '</option>').join('');
        }
        if (roleRes.ok) {
            selRole.innerHTML = '<option value="">None</option>' + roleRes.roles.map(r => '<option value="' + r.id + '">' + r.name + '</option>').join('');
        }
        if (setRes.ok && setRes.settings) {
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
            const detailedStatus = r.status === "OK" ? t("status_ok") : (!r.has_role ? t("status_no_role") : (!r.has_intro ? t("status_no_intro") : t("status_no_vc")));

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
        if (!currentData.length) return;
        currentData.sort((a, b) => {
            const valA = a[key] || "";
            const valB = b[key] || "";
            return valA.localeCompare(valB);
        });
        renderRows(currentData);
    };

    window.releaseTimeout = async (uid) => {
        const gid = selGuild.value;
        if (!confirm("Release timeout for this user?")) return;
        const res = await api("/api/timeout/release", { guild: gid, user_id: uid });
        if (res.ok) {
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
        const res = await api("/api/activity?guild=" + gid + "&audit_role_id=" + ar + "&intro_channel_id=" + ic + "&refresh=1");
        loading.style.display = "none";

        if (!res.ok) {
            const errorMsg = res.error.includes("Upgrade") ? "⚠️ " + res.error + ' <a href="/admin/dashboard" style="margin-left:8px;">Check Plans</a>' : res.error;
            rows.innerHTML = '<tr><td colspan="6" style="color:red; text-align:center;">' + errorMsg + '</td></tr>';
            return;
        }

        currentData = res.data || [];
        renderRows(currentData);
    };

    selGuild.onchange = () => { reloadCriteria(); document.getElementById("act-rows").innerHTML = ""; };
    const btnReload = document.getElementById("reload");
    if (btnReload) btnReload.onclick = runScan;
    document.getElementById("scan").onclick = runScan;

    reloadCriteria();
}
