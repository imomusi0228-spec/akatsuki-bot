// Utility functions ($ and escapeHTML) are provided by layout.ejs
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
    sel.innerHTML = `<option>${t("loading")}...</option>`; sel.disabled = true;

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

    const o = document.createElement("option"); o.textContent = `(${t("no_guilds")})`; sel.appendChild(o);
    const errMsg = (d && d.error) ? d.error : "Check Bot Permissions/Invite";
    $("guildStatus").innerHTML = '<span style="color:var(--danger-color)">' + escapeHTML(errMsg) + '</span>';
    return false;
}

function saveGuildSelection() { const sel = $("guild"); if (sel && sel.value) localStorage.setItem("last_guild_id", sel.value); }

const charts = {};

function renderChart(id, type, labels, datasets, options = {}) {
    if (charts[id]) charts[id].destroy();
    const ctx = document.getElementById(id);
    if (!ctx) return;
    charts[id] = new Chart(ctx, {
        type,
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { labels: { color: "#8899a6" } } },
            scales: {
                x: { ticks: { color: "#8899a6" }, grid: { color: "rgba(255,255,255,0.1)" } },
                y: {
                    ticks: { color: "#8899a6" },
                    beginAtZero: true,
                    suggestedMax: 50
                }
            },
            ...options
        }
    });
}

async function updateCharts(gid, tier, mon) {
    // 1. Heatmap (Pro)
    const heatmapRes = await api(`/api/stats/heatmap?guild=${gid}&month=${mon}`);
    if (heatmapRes.ok) {
        const hasData = heatmapRes.heatmap.some(v => v > 0);
        if (!hasData) {
            // If no data, we could show a message or just a flat chart. 
            // Let's show a flat chart but maybe adjust label
        }
        renderChart("heatmapChart", "bar",
            Array.from({ length: 24 }, (_, i) => i + "h"),
            [{
                label: t("vc_activity_mins"),
                data: heatmapRes.heatmap,
                backgroundColor: "rgba(29, 161, 242, 0.5)",
                borderColor: "rgb(29, 161, 242)",
                borderWidth: 1
            }]
        );
    }

    // 2. Growth (Pro+)
    const growthRes = await api(`/api/stats/growth?guild=${gid}&month=${mon}`);
    if (growthRes.ok) {
        const labels = [...new Set(growthRes.events.map(e => e.date.split("T")[0]))];
        const joinData = labels.map(d => growthRes.events.find(e => e.date.split("T")[0] === d && e.event_type === 'join')?.count || 0);
        const leaveData = labels.map(d => growthRes.events.find(e => e.date.split("T")[0] === d && e.event_type === 'leave')?.count || 0);

        renderChart("growthChart", "line", labels, [
            { label: t("vc_joins"), data: joinData, borderColor: "#1da1f2", tension: 0.3 },
            { label: t("leaves"), data: leaveData, borderColor: "#f4212e", tension: 0.3 }
        ]);
    }
}

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

                $("summary").innerHTML = t("dashboard_loading");
                const res = await api(`/api/stats?guild=${gid}&month=${mon}`);
                if (res.ok) {
                    const s = res.stats.summary;
                    const sub = res.subscription;
                    const validUntil = sub.valid_until ? '(' + sub.valid_until.split('T')[0] + ')' : '';
                    $("plan-info").innerHTML = `${sub.name} ${validUntil}`;

                    const item = (l, v) => `<span style="font-weight:bold; color:var(--accent-color); font-size:14px;">${v}</span> <span style="font-size:12px; margin-right:8px;">${l}</span>`;
                    $("summary").innerHTML = `${item(t("vc_joins"), s.joins)} | ${item(t("leaves"), s.leaves)} | ${item(t("timeouts"), s.timeouts)} | ${item(t("ng_detect"), s.ngDetected)}`;

                    let rows = "";
                    (res.stats.topNgUsers || []).forEach(u => {
                        const av = u.avatar_url ? '<img src="' + u.avatar_url + '" style="width:24px; height:24px; border-radius:50%; vertical-align:middle; margin-right:8px;">' : '';
                        const releaseBtn = u.is_timed_out ? '<button onclick="releaseNgTimeout(\'' + u.user_id + '\', \'' + $("guild").value + '\')" class="btn" style="padding:2px 8px; font-size:10px; background:var(--danger-color); color:white; border:none; margin-left:8px;">' + t("btn_release") + '</button>' : '';
                        rows += `<tr><td>${av}${escapeHTML(u.display_name || 'Unknown')}</td><td style="text-align:right">${u.cnt}</td><td style="text-align:right">${releaseBtn}</td></tr>`;
                    });
                    $("topNg").innerHTML = rows || `<tr><td colspan="3" class="muted" style="text-align:center; padding:10px;">${t("ng_none")}</td></tr>`;

                    // Update Charts
                    await updateCharts(gid, sub.tier, mon);
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

window.releaseNgTimeout = async (uid, gid) => {
    if (!confirm(t("confirm_release"))) return;
    const res = await api("/api/timeout/release", { guild: gid, user_id: uid });
    if (res.ok) {
        alert(t("release_success"));
        $("reload").click(); // ダッシュボードをリロード
    } else {
        alert("Error: " + res.error);
    }
};

async function initSettings() {
    if (!await loadGuilds()) return;

    const selLog = $("logCh");
    const selNgLog = $("ngLogCh");
    const selGuild = $("guild");

    const loadMasters = async (gid) => {
        try {
            const [ch, rl] = await Promise.all([api("/api/channels?guild=" + gid), api("/api/roles?guild=" + gid)]);

            const channels = (ch.ok && ch.channels) ? ch.channels : [];
            const roles = (rl.ok && rl.roles) ? rl.roles : [];
            window._serverRoles = roles; // Store for addRoleRule
            const errorMsg = !ch.ok ? (ch.error || "API Error") : (channels.length === 0 ? "No Text Channels" : null);

            // 1. Log Channels
            [selLog, selNgLog].forEach(s => {
                if (s) {
                    s.innerHTML = '<option value="">(None)</option>';
                    channels.forEach(c => {
                        const o = document.createElement("option"); o.value = c.id; o.textContent = "#" + c.name; s.appendChild(o);
                    });
                }
            });

            // 2. Roles (Self Intro)
            const selIntroRole = $("introRole");
            if (selIntroRole) {
                selIntroRole.innerHTML = '<option value="">(None)</option>';
                roles.forEach(r => {
                    const o = document.createElement("option"); o.value = r.id; o.textContent = r.name; selIntroRole.appendChild(o);
                });
            }

            // 3. Channels (VC Report)
            const selVcReport = $("vcReportCh");
            if (selVcReport) {
                selVcReport.innerHTML = '<option value="">(None)</option>';
                channels.forEach(c => {
                    const o = document.createElement("option"); o.value = c.id; o.textContent = "#" + (c.name || "channel"); selVcReport.appendChild(o);
                });
            }
        } catch (e) {
            console.error("loadMasters Error:", e);
        }
    };

    const reload = async () => {
        saveGuildSelection(); const gid = selGuild.value; if (!gid) return;

        await loadMasters(gid);
        const [ng, st] = await Promise.all([api("/api/ngwords?guild=" + gid), api("/api/settings?guild=" + gid)]);

        if (ng.ok) {
            const list = $("ngList");
            const words = ng.words || [];
            if (words.length === 0) list.innerHTML = '<div class="muted" style="padding:10px; text-align:center;">' + t("ng_none") + '</div>';
            else list.innerHTML = words.map(w => '<div class="ng-item"><span>' + escapeHTML(w.word) + '</span><button onclick="removeNg(\'' + escapeHTML(w.word) + '\')">×</button></div>').join("");
            if ($("ngCount")) $("ngCount").textContent = words.length + " " + t("words");
        }

        if (st.ok && st.settings) {
            const s = st.settings;
            if (selLog) selLog.value = s.log_channel_id || "";
            if (selNgLog) selNgLog.value = s.ng_log_channel_id || "";
            if ($("threshold")) $("threshold").value = s.ng_threshold ?? 3;
            if ($("timeout")) $("timeout").value = s.timeout_minutes ?? 10;

            if ($("antiraidEnabled")) $("antiraidEnabled").checked = s.antiraid_enabled;
            if ($("antiraidThreshold")) $("antiraidThreshold").value = s.antiraid_threshold ?? 10;
            if ($("introGateEnabled")) $("introGateEnabled").checked = s.self_intro_enabled;
            if ($("introRole")) $("introRole").value = s.self_intro_role_id || "";
            if ($("introMinLen")) $("introMinLen").value = s.self_intro_min_length ?? 10;

            // Alpha Features Logic - Ojou says "Open everything!"
            const toggleAlphaSection = (id, enabled) => {
                const el = $(id);
                const section = el ? el.closest(".accordion-item") : null;
                if (!section) return;
                const inputs = section.querySelectorAll("input, select, button");
                inputs.forEach(i => {
                    i.disabled = false;
                    i.style.opacity = "1";
                });
                section.style.background = "rgba(255, 255, 255, 0.02)";
                section.style.borderStyle = "solid";
            };

            // Force enable all sections based on the new accordion structure
            ["antiraidEnabled", "introGateEnabled"].forEach(id => toggleAlphaSection(id, true));

            // VC Report Fields
            if ($("vcReportEnabled")) $("vcReportEnabled").checked = s.vc_report_enabled;
            if ($("vcReportCh")) $("vcReportCh").value = s.vc_report_channel_id || "";
            if ($("vcReportInterval")) $("vcReportInterval").value = s.vc_report_interval || "weekly";

            // Load VC Role Rules
            const rulesList = $("roleRulesList");
            if (rulesList) {
                rulesList.innerHTML = "";
                const rules = s.vc_role_rules || [];
                rules.forEach(r => addRoleRule(r));
            }
        }
    };

    $("save").onclick = async () => {
        const body = {
            guild: selGuild.value,
            log_channel_id: selLog ? selLog.value : "",
            ng_log_channel_id: selNgLog ? selNgLog.value : "",
            ng_threshold: parseInt($("threshold")?.value || 3),
            timeout_minutes: parseInt($("timeout")?.value || 10),

            antiraid_enabled: $("antiraidEnabled")?.checked || false,
            antiraid_threshold: parseInt($("antiraidThreshold")?.value || 10),
            self_intro_enabled: $("introGateEnabled")?.checked || false,
            self_intro_role_id: $("introRole")?.value || "",
            self_intro_min_length: parseInt($("introMinLen")?.value || 10),

            // VC Role Rules
            vc_role_rules: Array.from(document.querySelectorAll(".role-rule-item")).map(item => ({
                role_id: item.querySelector(".rule-role").value,
                hours: parseInt(item.querySelector(".rule-hours").value)
            })),
            vc_report_enabled: $("vcReportEnabled")?.checked || false,
            vc_report_channel_id: $("vcReportCh") ? $("vcReportCh").value : "",
            vc_report_interval: $("vcReportInterval") ? $("vcReportInterval").value : "weekly"
        };
        const res = await api("/api/settings/update", body);
        const stat = $("saveStatus");
        if (res.ok) {
            alert(t("save_success"));
            stat.textContent = t("save_success");
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


            html += '<tr>' +
                '<td>' + (r.joined_at || '-') + '</td>' +
                '<td><div style="display:flex; align-items:center; gap:8px;"><img src="' + av + '" style="width:24px; height:24px; border-radius:50%;" /> <span>' + escapeHTML(r.display_name) + '</span></div></td>' +
                '<td style="text-align:center;">' + roleTxt + '</td>' +
                '<td style="text-align:center;">' + introTxt + '</td>' +
                '<td style="text-align:center;">' + r.last_vc + '</td>' +
                '<td style="text-align:center; ' + statusStyle + '">' + detailedStatus + '</td>' +
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
        if (!confirm(t("confirm_release"))) return;
        const res = await api("/api/timeout/release", { guild: gid, user_id: uid });
        if (res.ok) {
            alert(t("release_success"));
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

window.toggleAccordion = (id) => {
    const item = document.getElementById(id);
    if (!item) return;
    const isActive = item.classList.contains("active");
    // Option: Close others? (Ojou didn't specify, but often better)
    // document.querySelectorAll(".accordion-item").forEach(el => el.classList.remove("active"));
    if (isActive) item.classList.remove("active");
    else item.classList.add("active");
};

window.addRoleRule = (data = { role_id: "", hours: 1 }) => {
    const list = document.getElementById("roleRulesList");
    if (!list) return;
    const item = document.createElement("div");
    item.className = "role-rule-item";
    item.style = "display:flex; gap:8px; align-items:center; background:rgba(255,255,255,0.05); padding:8px; border-radius:6px; border:1px solid #38444d;";

    let roleOptions = '<option value="">(Select Role)</option>';
    (window._serverRoles || []).forEach(r => {
        roleOptions += `<option value="${r.id}" ${r.id === data.role_id ? 'selected' : ''}>${escapeHTML(r.name)}</option>`;
    });

    item.innerHTML = `
        <select class="rule-role" style="flex:1; font-size:12px;">${roleOptions}</select>
        <input type="number" class="rule-hours" value="${data.hours}" min="1" style="width:60px; font-size:12px;" />
        <span style="font-size:11px; color:#888;">時間</span>
        <button type="button" onclick="this.parentElement.remove()" class="btn" style="padding:4px 8px; color:var(--danger-color); border-color:transparent;">×</button>
    `;
    list.appendChild(item);
};
