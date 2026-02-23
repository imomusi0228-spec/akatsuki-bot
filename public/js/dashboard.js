// Utility functions ($ and escapeHTML) are provided by layout.ejs
function yyyymmNow() { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); }

const api = async (path, body) => {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 15000);

    // Get CSRF token from cookie (more robust parsing)
    const csrfToken = document.cookie.split(';').map(c => c.trim()).find(row => row.startsWith('csrf_token='))?.split('=')[1];


    try {
        const r = await fetch(path, {
            method: body ? "POST" : "GET",
            headers: {
                ...(body ? { "Content-Type": "application/json" } : {}),
                ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {})
            },
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
    const statusEl = $("guildStatus");
    if (statusEl) statusEl.innerHTML = '<span style="color:var(--danger-color)">' + escapeHTML(errMsg) + '</span>';
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
            { label: t("member_joins"), data: joinData, borderColor: "#1da1f2", tension: 0.3 },
            { label: t("member_leaves"), data: leaveData, borderColor: "#f4212e", tension: 0.3 }
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
    _guildsLoaded = false; // Reset so settings page always loads fresh guild list
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

            // 1. Log Channels (Text-based)
            const textSelects = [selLog, selNgLog, $("reportCh")];
            textSelects.forEach(s => {
                if (s) {
                    s.innerHTML = '<option value="">(None)</option>';
                    channels.filter(c => c.type === 0 || c.type === 5).forEach(c => {
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

            // 3. Voice Channels (Reports)
            const voiceSelects = [$("vcReportCh")];
            voiceSelects.forEach(s => {
                if (s) {
                    s.innerHTML = '<option value="">(None)</option>';
                    channels.filter(c => c.type === 2).forEach(c => {
                        const o = document.createElement("option"); o.value = c.id; o.textContent = "🔊 " + c.name; s.appendChild(o);
                    });
                }
            });

            // 4. Categories (Auto-VC Target)
            const catSelect = $("autoVcCategory");
            if (catSelect) {
                catSelect.innerHTML = '<option value="">(None)</option>';
                channels.filter(c => c.type === 4).forEach(c => {
                    const o = document.createElement("option"); o.value = c.id; o.textContent = "📁 " + c.name; catSelect.appendChild(o);
                });
            }

        } catch (e) {
            console.error("loadMasters Error:", e);
        }
    };

    const reload = async () => {
        saveGuildSelection(); const gid = selGuild.value; if (!gid) return;

        // Disable Save Button during reload to prevent race conditions
        const saveBtn = $("save");
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.textContent = t("loading") + "...";
            saveBtn.classList.add("btn-disabled"); // Optional styling
        }

        // Reset Error Status
        const stat = $("saveStatus");
        if (stat) stat.textContent = "";

        await loadMasters(gid);

        // Check if loadMasters failed (by checking if selects are still empty or if we can track it)
        // Ideally loadMasters should throw or return false.
        // Let's check a flag or simple heuristic: if selLog has no options other than (None), and we expect channels...
        // But some servers might genuinely have no channels? Rare for a bot dash.
        // Better: let's trust loadMasters processed correct API response.
        // If API error occurred in loadMasters, we should ideally block saving.
        // For now, let's proceed to load settings, but keep in mind.

        const [ng, st] = await Promise.all([api("/api/ngwords?guild=" + gid), api("/api/settings?guild=" + gid)]);

        // Enable Save Button ONLY if settings loaded successfully
        if (st.ok && st.settings) {
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.textContent = t("save_settings");
                saveBtn.classList.remove("btn-disabled");
            }

            const s = st.settings;
            if (selLog) selLog.value = s.log_channel_id || "";
            if (selNgLog) selNgLog.value = s.ng_log_channel_id || "";
            if ($("reportCh")) $("reportCh").value = s.report_channel_id || "";
            if ($("threshold")) $("threshold").value = s.ng_threshold ?? 3;
            if ($("timeout")) $("timeout").value = s.timeout_minutes ?? 10;

            if ($("antiraidEnabled")) $("antiraidEnabled").checked = s.antiraid_enabled;
            if ($("antiraidThreshold")) $("antiraidThreshold").value = s.antiraid_threshold ?? 10;
            if ($("introGateEnabled")) $("introGateEnabled").checked = s.self_intro_enabled;
            if ($("introRole")) $("introRole").value = s.self_intro_role_id || "";
            if ($("introMinLen")) $("introMinLen").value = s.self_intro_min_length ?? 10;
            if ($("aiAdviceDays")) $("aiAdviceDays").value = s.ai_advice_days ?? 14;
            if ($("aiAdviceCh")) $("aiAdviceCh").value = s.ai_advice_channel_id || "";
            if ($("aiInsightEnabled")) $("aiInsightEnabled").checked = s.ai_insight_enabled;
            if ($("aiInsightCh")) $("aiInsightCh").value = s.ai_insight_channel_id || "";

            // Insight Sections
            const sections = Array.isArray(s.insight_sections) ? s.insight_sections : ["growth", "toxicity", "vc"];
            if ($("insightGrowth")) $("insightGrowth").checked = sections.includes("growth");
            if ($("insightToxicity")) $("insightToxicity").checked = sections.includes("toxicity");
            if ($("insightVc")) $("insightVc").checked = sections.includes("vc");

            // Phase Escalation
            if ($("phase2Threshold")) $("phase2Threshold").value = s.phase2_threshold ?? 3;
            if ($("phase2Action")) $("phase2Action").value = s.phase2_action || 'timeout';
            if ($("phase3Threshold")) $("phase3Threshold").value = s.phase3_threshold ?? 6;
            if ($("phase3Action")) $("phase3Action").value = s.phase3_action || 'kick';
            if ($("phase4Threshold")) $("phase4Threshold").value = s.phase4_threshold ?? 10;
            if ($("phase4Action")) $("phase4Action").value = s.phase4_action || 'ban';
            if ($("ngWarningEnabled")) $("ngWarningEnabled").checked = s.ng_warning_enabled !== false;

            // Intro Reminder
            if ($("introReminderHours")) $("introReminderHours").value = s.intro_reminder_hours ?? 24;


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
            if ($("vcReportCh")) $("vcReportCh").value = s.vc_report_channel_id || "";
            if ($("vcReportInterval")) $("vcReportInterval").value = s.vc_report_interval || "weekly";
            if ($("autoVcCategory")) $("autoVcCategory").value = s.auto_vc_creator_id || "";

            // Load VC Role Rules
            const rulesList = $("roleRulesList");
            if (rulesList) {
                rulesList.innerHTML = "";
                const rules = s.vc_role_rules || [];
                rules.forEach(r => addRoleRule(r));
            }

            // Extended Settings: Ticket, Branding, AI Prediction
            if ($("ticketWelcomeMsg")) $("ticketWelcomeMsg").value = s.ticket_welcome_msg || "";
            if ($("colorNg")) $("colorNg").value = s.color_ng || "#f4212e";
            if ($("colorVcJoin")) $("colorVcJoin").value = s.color_vc_join || "#1da1f2";
            if ($("colorVcLeave")) $("colorVcLeave").value = s.color_vc_leave || "#8b9bb4";
            if ($("colorLevel")) $("colorLevel").value = s.color_level || "#FFD700";
            if ($("colorTicket")) $("colorTicket").value = s.color_ticket || "#2ECC71";
            if ($("colorDashboard")) {
                const dashColor = s.dashboard_theme_color || "#1d9bf0";
                $("colorDashboard").value = dashColor;
                applyThemeColor(dashColor);
            }
            if ($("brandingFooterText")) $("brandingFooterText").value = s.branding_footer_text || "";
            if ($("aiPredictionEnabled")) $("aiPredictionEnabled").checked = s.ai_prediction_enabled;
        } else {
            // Settings Load Failed
            if (saveBtn) {
                saveBtn.textContent = "Load Failed";
            }
            if (stat) {
                stat.textContent = "Error loading settings. Refresh page.";
                stat.style.color = "var(--danger-color)";
            }
        }

        if (ng.ok) {
            const list = $("ngList");
            const words = ng.words || [];
            if (words.length === 0) list.innerHTML = '<div class="muted" style="padding:10px; text-align:center;">' + t("ng_none") + '</div>';
            else list.innerHTML = words.map(w => '<div class="ng-item"><span>' + escapeHTML(w.word) + '</span><button onclick="removeNg(\'' + escapeHTML(w.word) + '\')">×</button></div>').join("");
            if ($("ngCount")) $("ngCount").textContent = words.length + " " + t("words");
        }
    };

    $("save").onclick = async () => {
        const body = {
            guild: selGuild.value,
            log_channel_id: selLog ? selLog.value : "",
            ng_log_channel_id: selNgLog ? selNgLog.value : "",
            report_channel_id: $("reportCh") ? $("reportCh").value : "",
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
                trigger: item.querySelector(".rule-trigger")?.value || 'vc_hours',
                aura_name: item.querySelector(".rule-name").value,
                hours: parseInt(item.querySelector(".rule-hours").value) || 0,
                messages: parseInt(item.querySelector(".rule-messages")?.value) || 0
            })),
            vc_report_enabled: $("vcReportEnabled")?.checked || false,
            vc_report_channel_id: $("vcReportCh") ? $("vcReportCh").value : "",
            vc_report_interval: $("vcReportInterval") ? $("vcReportInterval").value : "weekly",
            phase2_threshold: parseInt($("phase2Threshold")?.value || 3),
            phase2_action: $("phase2Action")?.value || 'timeout',
            phase3_threshold: parseInt($("phase3Threshold")?.value || 6),
            phase3_action: $("phase3Action")?.value || 'kick',
            phase4_threshold: parseInt($("phase4Threshold")?.value || 10),
            phase4_action: $("phase4Action")?.value || 'ban',
            ng_warning_enabled: $("ngWarningEnabled")?.checked || false,
            intro_reminder_hours: parseInt($("introReminderHours")?.value || 24),

            // Extended Fields
            ticket_welcome_msg: $("ticketWelcomeMsg")?.value || "",
            color_ng: $("colorNg")?.value || "#f4212e",
            color_vc_join: $("colorVcJoin")?.value || "#1da1f2",
            color_vc_leave: $("colorVcLeave")?.value || "#8b9bb4",
            color_level: $("colorLevel")?.value || "#FFD700",
            color_ticket: $("colorTicket")?.value || "#2ECC71",
            dashboard_theme_color: $("colorDashboard")?.value || "#1d9bf0",
            branding_footer_text: $("brandingFooterText")?.value || "",
            auto_vc_creator_id: $("autoVcCategory")?.value || null
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
    const selLog = document.getElementById("logCh");
    const selNgLog = document.getElementById("ngLogCh");
    const selReportCh = document.getElementById("reportCh");

    const reloadCriteria = async () => {
        const gid = selGuild.value;
        if (!gid) return;

        const [chRes, roleRes, setRes] = await Promise.all([
            api("/api/channels?guild=" + gid),
            api("/api/roles?guild=" + gid),
            api("/api/settings?guild=" + gid)
        ]);

        if (chRes.ok) {
            const chOpts = '<option value="">' + t("none") + '</option>' + chRes.channels.map(c => '<option value="' + c.id + '">#' + c.name + '</option>').join('');
            if (selLog) selLog.innerHTML = chOpts;
            if (selNgLog) selNgLog.innerHTML = chOpts;
            if (selReportCh) selReportCh.innerHTML = chOpts;
            selIntro.innerHTML = chOpts; // Original selIntro population
        }
        if (roleRes.ok) {
            selRole.innerHTML = '<option value="">None</option>' + roleRes.roles.map(r => '<option value="' + r.id + '">' + r.name + '</option>').join('');
        }
        if (setRes.ok && setRes.settings) {
            selRole.value = setRes.settings.audit_role_id || "";
            selIntro.value = setRes.settings.intro_channel_id || "";
            if (selLog) selLog.value = setRes.settings.log_channel_id || "";
            if (selNgLog) selNgLog.value = setRes.settings.ng_log_channel_id || "";
            if (selReportCh) selReportCh.value = setRes.settings.report_channel_id || "";
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


    document.getElementById("scan").onclick = runScan;
    reloadCriteria();

    // Auto-refresh: 60 seconds
    let countdown = 60;
    const countEl = document.createElement('div');
    countEl.id = 'autoRefreshCountdown';
    countEl.style = 'font-size:12px; color:#888; margin-top:8px; text-align:right;';
    document.getElementById("scan")?.parentElement?.appendChild(countEl);

    const tick = () => {
        countEl.textContent = `自動更新: ${countdown}秒後`;
        countdown--;
        if (countdown < 0) {
            countdown = 60;
            runScan();
        }
    };
    tick();
    setInterval(tick, 1000);
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

window.addRoleRule = (data = { role_id: "", hours: 1, trigger: 'vc_hours', messages: 0 }) => {
    const list = document.getElementById("roleRulesList");
    if (!list) return;
    const item = document.createElement("div");
    item.className = "role-rule-item";
    item.style = "display:flex; gap:8px; align-items:center; background:rgba(255,255,255,0.05); padding:8px; border-radius:6px; border:1px solid #38444d; flex-wrap:wrap;";

    let roleOptions = '<option value="">(Select Role)</option>';
    (window._serverRoles || []).forEach(r => {
        roleOptions += `<option value="${r.id}" ${r.id === data.role_id ? 'selected' : ''}>${escapeHTML(r.name)}</option>`;
    });

    const trigger = data.trigger || 'vc_hours';
    item.innerHTML = `
        <input type="text" class="rule-name" value="${escapeHTML(data.aura_name || '')}" placeholder="オーラ名..." style="flex:1; font-size:12px;" />
        <select class="rule-role" style="flex:1; font-size:12px;">${roleOptions}</select>
        <select class="rule-trigger" style="font-size:12px;" onchange="toggleRuleTrigger(this)">
            <option value="vc_hours" ${trigger === 'vc_hours' ? 'selected' : ''}>VC時間</option>
            <option value="messages" ${trigger === 'messages' ? 'selected' : ''}>メッセージ数</option>
        </select>
        <input type="number" class="rule-hours" value="${data.hours || 1}" min="1" style="width:50px; font-size:12px; ${trigger === 'messages' ? 'display:none;' : ''}" />
        <span class="rule-hours-label" style="font-size:11px; color:#888; ${trigger === 'messages' ? 'display:none;' : ''}">h</span>
        <input type="number" class="rule-messages" value="${data.messages || 0}" min="1" style="width:60px; font-size:12px; ${trigger !== 'messages' ? 'display:none;' : ''}" />
        <span class="rule-messages-label" style="font-size:11px; color:#888; ${trigger !== 'messages' ? 'display:none;' : ''}">通</span>
        <button type="button" onclick="this.parentElement.remove()" class="btn" style="padding:4px 8px; color:var(--danger-color); border-color:transparent;">×</button>
    `;

    list.appendChild(item);
};

window.toggleRuleTrigger = (sel) => {
    const item = sel.closest('.role-rule-item');
    const isMsg = sel.value === 'messages';
    item.querySelector('.rule-hours').style.display = isMsg ? 'none' : '';
    item.querySelector('.rule-hours-label').style.display = isMsg ? 'none' : '';
    item.querySelector('.rule-messages').style.display = isMsg ? '' : 'none';
    item.querySelector('.rule-messages-label').style.display = isMsg ? '' : 'none';
};

window.addNg = async () => {
    const input = $("newWord");
    const word = input.value;
    const gid = $("guild").value;
    if (!word || !gid) return;

    const res = await api("/api/ngwords/add", { guild: gid, word });
    if (res.ok) {
        if (res.message) alert(res.message);
        input.value = "";
        // Reload list: Trigger guild change event which calls reload()
        if ($("guild").onchange) $("guild").onchange();
    } else {
        alert("Error: " + res.error);
    }
};

// Tickets Page Logic
window.initTicketsPage = async () => {
    if (!await loadGuilds()) return;
    const selGuild = $("guild");
    const statusFilter = $("statusFilter");
    const welcomeInput = $("ticketWelcomeMsg");
    const saveBtn = $("saveTicketSettings");
    const stat = $("saveStatus");

    // Store original config to avoid partial overwrites if we use the generic update API
    let _currentConfig = {};

    const refresh = async () => {
        const gid = selGuild.value;
        const status = statusFilter.value;
        if (!gid) return;

        saveGuildSelection();

        // 1. Load Ticket List
        const list = $("ticketList");
        list.innerHTML = `<tr><td colspan="6" class="muted" style="text-align:center; padding:30px;">${t("loading")}...</td></tr>`;

        // 2. Load Settings for this guild
        const [ticketsRes, settingsRes] = await Promise.all([
            api(`/api/tickets?guild=${gid}&status=${status}`),
            api(`/api/settings?guild=${gid}`)
        ]);

        if (settingsRes.ok && settingsRes.settings) {
            _currentConfig = settingsRes.settings;
            if (welcomeInput) welcomeInput.value = _currentConfig.ticket_welcome_msg || "";
        }

        if (ticketsRes.ok) {
            if (ticketsRes.tickets.length === 0) {
                list.innerHTML = `<tr><td colspan="6" class="muted" style="text-align:center; padding:30px;">チケットは見つかりませんでした。</td></tr>`;
            } else {
                list.innerHTML = ticketsRes.tickets.map(t => `
                    <tr>
                        <td>#${t.id}</td>
                        <td>${escapeHTML(t.userName)}</td>
                        <td><span class="${t.assigned_to ? 'staff-assign' : 'unassigned'}">${escapeHTML(t.staffName)}</span></td>
                        <td><span class="status-badge status-${t.status}">${t.status === 'open' ? '進行中' : '解決済'}</span></td>
                        <td><span class="muted">${new Date(t.created_at).toLocaleString('ja-JP')}</span></td>
                        <td style="text-align:right;">
                            ${t.status === 'open' ? `<button class="btn" style="padding:2px 8px; font-size:11px; border-color:var(--danger-color); color:var(--danger-color);" onclick="closeWebTicket(${t.id})">解決</button>` : '-'}
                        </td>
                    </tr>
                `).join("");
            }
        } else {
            list.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--danger-color); padding:30px;">Error: ${ticketsRes.error}</td></tr>`;
        }
    };

    if (saveBtn) {
        saveBtn.onclick = async () => {
            const gid = selGuild.value;
            if (!gid) return;

            saveBtn.disabled = true;
            saveBtn.textContent = "保存中...";

            const body = {
                ..._currentConfig,
                guild: gid,
                ticket_welcome_msg: welcomeInput.value,
                log_channel_id: _currentConfig.log_channel_id || "",
                ng_log_channel_id: _currentConfig.ng_log_channel_id || "",
            };

            const res = await api("/api/settings/update", body);
            saveBtn.disabled = false;
            saveBtn.textContent = "設定を保存";

            if (res.ok) {
                stat.textContent = "✅ 保存完了";
                stat.style.color = "var(--success-color)";
                setTimeout(() => stat.textContent = "", 3000);
            } else {
                stat.textContent = "❌ エラー: " + res.error;
                stat.style.color = "var(--danger-color)";
            }
        };
    }

    selGuild.onchange = refresh;
    statusFilter.onchange = refresh;
    if ($("refreshTickets")) $("refreshTickets").onclick = refresh;
    if ($("reloadMasters")) $("reloadMasters").onclick = refresh;

    refresh();
};

window.closeWebTicket = async (id) => {
    if (!confirm("このチケットを解決済みとしてマークし、チャンネルを削除しますか？")) return;
    const res = await api("/api/tickets/close", { guild: $("guild").value, ticket_id: id });
    if (res.ok) {
        alert("チケットを解決しました。");
        const refreshBtn = $("refreshTickets");
        if (refreshBtn) refreshBtn.click();
    } else {
        alert("Error: " + res.error);
    }
};


window.removeNg = async (word) => {
    if (!confirm(t("confirm_delete") || "Delete?")) return;
    const gid = $("guild").value;
    const res = await api("/api/ngwords/remove", { guild: gid, word });
    if (res.ok) {
        if ($("guild").onchange) $("guild").onchange();
    } else {
        alert("Error: " + res.error);
    }
};

function applyThemeColor(color) {
    if (!color) return;

    document.documentElement.style.setProperty('--accent-color', color);
    document.documentElement.style.setProperty('--primary-color', color);

    // Hex to RGB for opacity control
    let r = 0, g = 0, b = 0;
    if (color.length === 7) {
        r = parseInt(color.substring(1, 3), 16);
        g = parseInt(color.substring(3, 5), 16);
        b = parseInt(color.substring(5, 7), 16);
    }
    document.documentElement.style.setProperty('--accent-rgb', `${r}, ${g}, ${b}`);
}

window.initBrandingPage = async () => {
    if (!await loadGuilds()) return;
    const selGuild = $("guild");
    const themeModeInput = $("dashboard_theme_mode");
    const themeColorInput = $("dashboard_theme_color");
    const footerInput = $("branding_footer_text");
    const saveBtn = $("saveBranding");
    const stat = $("saveStatus");

    // Color Inputs
    const colorLog = $("color_log");
    const colorNg = $("color_ng");
    const colorVcJoin = $("color_vc_join");
    const colorVcLeave = $("color_vc_leave");
    const colorLevel = $("color_level");
    const colorTicket = $("color_ticket");

    let _currentConfig = {};

    const refresh = async () => {
        const gid = selGuild.value;
        if (!gid) return;
        saveGuildSelection();

        const res = await api(`/api/settings?guild=${gid}`);
        if (res.ok && res.settings) {
            _currentConfig = res.settings;

            // Apply loaded settings
            const mode = _currentConfig.dashboard_theme_mode || 'midnight';
            const color = _currentConfig.dashboard_theme_color || '#1d9bf0';

            if (themeModeInput) themeModeInput.value = mode;
            if (themeColorInput) themeColorInput.value = color;
            if (footerInput) footerInput.value = _currentConfig.branding_footer_text || "";

            // Detailed Colors
            if (colorLog) colorLog.value = _currentConfig.color_log || '#5865F2';
            if (colorNg) colorNg.value = _currentConfig.color_ng || '#f4212e';
            if (colorVcJoin) colorVcJoin.value = _currentConfig.color_vc_join || '#1da1f2';
            if (colorVcLeave) colorVcLeave.value = _currentConfig.color_vc_leave || '#8b9bb4';
            if (colorLevel) colorLevel.value = _currentConfig.color_level || '#FFD700';
            if (colorTicket) colorTicket.value = _currentConfig.color_ticket || '#2ECC71';

            // Apply theme mode - selectThemeMode is defined in branding.ejs
            if (typeof window.selectThemeMode === 'function') {
                window.selectThemeMode(mode);
            } else {
                // Fallback: apply theme directly
                document.body.className = 'theme-' + mode;
                document.querySelectorAll('.theme-option').forEach(el => el.classList.remove('selected'));
                const themePick = document.getElementById('theme-' + mode);
                if (themePick) themePick.classList.add('selected');
            }
            applyThemeColor(color);
            if ($("currentColorHex")) $("currentColorHex").textContent = color;
        }
    };

    if (saveBtn) {
        saveBtn.onclick = async () => {
            const gid = selGuild.value;
            if (!gid) return;

            saveBtn.disabled = true;
            saveBtn.textContent = "魔力充填中...";

            const body = {
                ..._currentConfig,
                guild: gid,
                dashboard_theme_mode: themeModeInput.value,
                dashboard_theme_color: themeColorInput.value,
                branding_footer_text: footerInput.value,
                // Detailed Colors
                color_log: colorLog.value,
                color_ng: colorNg.value,
                color_vc_join: colorVcJoin.value,
                color_vc_leave: colorVcLeave.value,
                color_level: colorLevel.value,
                color_ticket: colorTicket.value
            };

            const res = await api("/api/settings/update", body);
            saveBtn.disabled = false;
            saveBtn.textContent = "変更を適用する";

            if (res.ok) {
                // Persist theme to localStorage for global page theme application
                try {
                    localStorage.setItem('dashboard_theme_mode', body.dashboard_theme_mode);
                    localStorage.setItem('dashboard_theme_color', body.dashboard_theme_color);
                } catch (e) { }
                stat.textContent = "✅ 美学が反映されました";
                stat.style.color = "var(--success-color)";
                setTimeout(() => stat.textContent = "", 3000);
            } else {
                stat.textContent = "❌ 儀式失敗: " + res.error;
                stat.style.color = "var(--danger-color)";
            }
        };
    }

    selGuild.onchange = refresh;
    if ($("reload")) $("reload").onclick = refresh;
    refresh();
};

// AI Analysis & Insights Page
window.initAiPage = async () => {
    if (!await loadGuilds()) return;
    const selGuild = $("guild");
    const saveBtn = $("saveAi");
    const stat = $("saveStatus");

    let _currentConfig = {};

    const refresh = async () => {
        const gid = selGuild.value;
        if (!gid) return;
        saveGuildSelection();

        const res = await api(`/api/settings?guild=${gid}`);
        if (res.ok && res.settings) {
            _currentConfig = res.settings;

            // AI Health Radar
            if ($("aiAdviceDays")) $("aiAdviceDays").value = _currentConfig.ai_advice_days || 14;
            if ($("aiAdviceCh")) await loadChannels("aiAdviceCh", gid, _currentConfig.ai_advice_channel_id);

            // Server Insight
            if ($("aiInsightEnabled")) $("aiInsightEnabled").checked = !!_currentConfig.ai_insight_enabled;
            if ($("aiInsightCh")) await loadChannels("aiInsightCh", gid, _currentConfig.ai_insight_channel_id);
            if ($("insightGrowth")) $("insightGrowth").checked = !!_currentConfig.insight_growth;
            if ($("insightToxicity")) $("insightToxicity").checked = !!_currentConfig.insight_toxicity;
            if ($("insightVc")) $("insightVc").checked = !!_currentConfig.insight_vc;

            // AI Prediction
            if ($("aiPredictionEnabled")) $("aiPredictionEnabled").checked = !!_currentConfig.ai_prediction_enabled;
            if ($("aiPredictCh")) await loadChannels("aiPredictCh", gid, _currentConfig.ai_predict_channel_id);
        }
    };

    if (saveBtn) {
        saveBtn.onclick = async () => {
            const gid = selGuild.value;
            if (!gid) return;

            saveBtn.disabled = true;
            saveBtn.textContent = "保存中...";

            const body = {
                ..._currentConfig,
                guild: gid,
                ai_advice_days: $("aiAdviceDays") ? parseInt($("aiAdviceDays").value) : 14,
                ai_advice_channel_id: $("aiAdviceCh") ? $("aiAdviceCh").value : "",
                ai_insight_enabled: $("aiInsightEnabled") ? $("aiInsightEnabled").checked : false,
                ai_insight_channel_id: $("aiInsightCh") ? $("aiInsightCh").value : "",
                insight_growth: $("insightGrowth") ? $("insightGrowth").checked : false,
                insight_toxicity: $("insightToxicity") ? $("insightToxicity").checked : false,
                insight_vc: $("insightVc") ? $("insightVc").checked : false,
                ai_prediction_enabled: $("aiPredictionEnabled") ? $("aiPredictionEnabled").checked : false,
                ai_predict_channel_id: $("aiPredictCh") ? $("aiPredictCh").value : "",
            };

            const res = await api("/api/settings/update", body);
            saveBtn.disabled = false;
            saveBtn.textContent = "設定を保存する";

            if (res.ok) {
                stat.textContent = "✅ 保存完了";
                stat.style.color = "var(--success-color)";
                setTimeout(() => stat.textContent = "", 3000);
            } else {
                stat.textContent = "❌ エラー: " + res.error;
                stat.style.color = "var(--danger-color)";
            }
        };
    }

    selGuild.onchange = refresh;
    if ($("reload")) $("reload").onclick = refresh;
    refresh();
};

// Global initializer: apply footer branding text
(async function () {
    try {
        const savedGid = localStorage.getItem("last_guild_id") || localStorage.getItem("selected_guild");
        if (savedGid) {
            const res = await fetch(`/api/settings?guild=${savedGid}`).then(r => r.json()).catch(() => null);
            if (res && res.ok && res.settings) {
                // Apply footer branding text
                const footerDisplay = document.getElementById("branding-footer-display");
                if (footerDisplay && res.settings.branding_footer_text) {
                    footerDisplay.textContent = res.settings.branding_footer_text;
                }
                // Also update localStorage theme if not set yet (first visit)
                if (!localStorage.getItem('dashboard_theme_mode') && res.settings.dashboard_theme_mode) {
                    localStorage.setItem('dashboard_theme_mode', res.settings.dashboard_theme_mode);
                    document.body.className = 'theme-' + res.settings.dashboard_theme_mode;
                }
                if (!localStorage.getItem('dashboard_theme_color') && res.settings.dashboard_theme_color) {
                    localStorage.setItem('dashboard_theme_color', res.settings.dashboard_theme_color);
                    applyThemeColor(res.settings.dashboard_theme_color);
                }
            }
        }
    } catch (e) { }
})();


