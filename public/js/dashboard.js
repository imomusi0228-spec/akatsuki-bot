// Utility functions ($ and escapeHTML) are provided by layout.ejs
function yyyymmNow() { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); }

const api = async (path, body, method = null) => {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 15000);

    // Get CSRF token from cookie (more robust parsing)
    const csrfToken = document.cookie.split(';').map(c => c.trim()).find(row => row.startsWith('csrf_token='))?.split('=')[1];

    try {
        const r = await fetch(path, {
            method: method || (body ? "POST" : "GET"),
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
    const sel = $("globalGuildSelect");
    if (!sel) return false;
    if (_guildsLoaded) {
        // Just re-bind the onchange and return
        sel.onchange = () => {
            saveGuildSelection();
            if (window.__pageReload) window.__pageReload();
        };
        const reloadBtn = $("globalReload");
        if (reloadBtn) reloadBtn.onclick = () => {
            if (window.__pageReload) window.__pageReload();
        };
        return true;
    }

    sel.innerHTML = `<option>${t("loading")}...</option>`;
    sel.disabled = true;

    try {
        const d = await api("/api/guilds");
        sel.innerHTML = "";
        sel.disabled = false;

        if (d && d.ok && d.guilds && d.guilds.length > 0) {
            let lastGid = localStorage.getItem("last_guild_id");
            let selectedIndex = 0;

            d.guilds.forEach((g, i) => {
                const o = document.createElement("option");
                o.value = g.id;
                o.textContent = g.name;
                sel.appendChild(o);
                if (lastGid && g.id === lastGid) selectedIndex = i;
            });

            sel.selectedIndex = selectedIndex;
            _guildsLoaded = true;

            // If it was the first time or selection changed, save it
            if (!lastGid || lastGid !== sel.value) {
                saveGuildSelection();
            }
        } else {
            const o = document.createElement("option");
            o.textContent = `(${t("no_guilds")})`;
            sel.appendChild(o);
            const errMsg = (d && d.error) ? d.error : "Server access denied or Bot missing permissions";
            const statusEl = $("guildStatus");
            if (statusEl) statusEl.innerHTML = '<span style="color:var(--danger-color)">⚠️ ' + escapeHTML(errMsg) + '</span>';
            return false;
        }

        // ALWAYS re-bind events even if _guildsLoaded was true
        // This ensures that when we switch tabs, the selector calls the new page's __pageReload
        sel.onchange = () => {
            saveGuildSelection();
            if (window.__pageReload) window.__pageReload();
        };

        const reloadBtn = $("globalReload");
        if (reloadBtn) reloadBtn.onclick = () => {
            if (window.__pageReload) window.__pageReload();
        };

        return true;
    } catch (e) {
        console.error("Guild Load Error:", e);
        sel.innerHTML = `<option>Error Loading</option>`;
        return false;
    }
}

function saveGuildSelection() {
    const sel = $("globalGuildSelect");
    if (sel && sel.value && sel.value.length > 5) {
        localStorage.setItem("last_guild_id", sel.value);
    }
}

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
    window.__pageReload = async () => {
        try {
            saveGuildSelection();
            const gid = $("globalGuildSelect")?.value;
            const mon = $("month")?.value || yyyymmNow();
            if (!gid) return;

            const summaryEl = $("summary");
            if (summaryEl) summaryEl.innerHTML = t("dashboard_loading");
            const res = await api(`/api/stats?guild=${gid}&month=${mon}`);
            if (res.ok) {
                const s = res.stats.summary;
                const sub = res.subscription;
                const validUntil = sub.valid_until ? '(' + sub.valid_until.split('T')[0] + ')' : '';
                const planInfo = $("plan-info");
                if (planInfo) {
                    planInfo.innerHTML = `${sub.name} <span class="muted" style="font-size:10px; font-weight:normal;">${validUntil}</span>`;
                    planInfo.style.color = sub.color;
                    planInfo.style.textShadow = `0 0 10px ${sub.color}44`; // 44 is approx 0.25 opacity
                }

                if ($("stat-joins")) $("stat-joins").textContent = s.joins;
                if ($("stat-leaves")) $("stat-leaves").textContent = s.leaves;
                if ($("stat-timeouts")) $("stat-timeouts").textContent = s.timeouts;
                if ($("stat-ng")) $("stat-ng").textContent = s.ngDetected;

                const topNgEl = $("topNg");
                if (topNgEl) {
                    let rows = "";
                    (res.stats.topNgUsers || []).forEach(u => {
                        const av = u.avatar_url ? '<img src="' + u.avatar_url + '" style="width:24px; height:24px; border-radius:50%; vertical-align:middle; margin-right:8px;">' : '';
                        const releaseBtn = u.is_timed_out ? '<button onclick="releaseNgTimeout(\'' + u.user_id + '\', \'' + gid + '\')" class="btn" style="padding:2px 8px; font-size:10px; background:var(--danger-color); color:white; border:none; margin-left:8px;">' + t("btn_release") + '</button>' : '';
                        rows += `<tr><td>${av}${escapeHTML(u.display_name || 'Unknown')}</td><td style="text-align:right">${u.cnt}</td><td style="text-align:right">${releaseBtn}</td></tr>`;
                    });
                    topNgEl.innerHTML = rows || `<tr><td colspan="3" class="muted" style="text-align:center; padding:10px;">${t("ng_none")}</td></tr>`;
                }

                await updateCharts(gid, sub.tier, mon);
            } else {
                if (summaryEl) summaryEl.innerText = "Error: " + res.error;
            }
        } catch (e) {
            console.error("Reload Error:", e);
        }
    };

    try {
        if (!await loadGuilds()) return;
        const monInput = $("month");
        if (monInput) {
            monInput.value = yyyymmNow();
            monInput.onchange = window.__pageReload;
        }
        window.__pageReload();
    } catch (e) {
        console.error("Init Error:", e);
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
    window.__pageReload = async () => {
        saveGuildSelection();
        const gid = $("globalGuildSelect")?.value;
        if (!gid) return;

        const saveBtn = $("save");
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.textContent = t("loading") + "...";
        }

        await loadMasters(gid);
        const [ng, st] = await Promise.all([api("/api/ngwords?guild=" + gid), api("/api/settings?guild=" + gid)]);

        if (st.ok && st.settings) {
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.textContent = t("save_settings");
            }
            const s = st.settings;
            if ($("logCh")) $("logCh").value = s.log_channel_id || "";
            if ($("ngLogCh")) $("ngLogCh").value = s.ng_log_channel_id || "";
            if ($("reportCh")) $("reportCh").value = s.report_channel_id || "";
            if ($("threshold")) $("threshold").value = s.ng_threshold ?? 3;
            if ($("timeout")) $("timeout").value = s.timeout_minutes ?? 10;
            if ($("introGateEnabled")) $("introGateEnabled").checked = s.self_intro_enabled;
            if ($("introRole")) $("introRole").value = s.self_intro_role_id || "";
            if ($("introMinLen")) $("introMinLen").value = s.self_intro_min_length ?? 10;
            if ($("aiAdviceDays")) $("aiAdviceDays").value = s.ai_advice_days ?? 14;
            if ($("aiAdviceCh")) $("aiAdviceCh").value = s.ai_advice_channel_id || "";
            if ($("aiInsightEnabled")) $("aiInsightEnabled").checked = s.ai_insight_enabled;
            if ($("aiInsightCh")) $("aiInsightCh").value = s.ai_insight_channel_id || "";
            if ($("introReminderHours")) $("introReminderHours").value = s.intro_reminder_hours ?? 24;
            if ($("vcReportCh")) $("vcReportCh").value = s.vc_report_channel_id || "";
            if ($("vcReportInterval")) $("vcReportInterval").value = s.vc_report_interval || "weekly";
            if ($("autoVcCategory")) $("autoVcCategory").value = s.auto_vc_creator_id || "";
            const rulesList = $("roleRulesList");
            if (rulesList) {
                rulesList.innerHTML = "";
                (s.vc_role_rules || []).forEach(r => addRoleRule(r));
            }
        }
        if (ng.ok) {
            const list = $("ngList");
            const words = ng.words || [];
            if (list) {
                if (words.length === 0) list.innerHTML = '<div class="muted" style="padding:10px; text-align:center;">' + t("ng_none") + '</div>';
                else list.innerHTML = words.map(w => `<div class="ng-item"><span>${escapeHTML(w.word)}</span><button onclick="removeNg('${escapeHTML(w.word)}')">×</button></div>`).join("");
            }
            if ($("ngCount")) $("ngCount").textContent = words.length + " " + t("words");
        }

        // v2.7.0 Reaction Roles
        const rrList = $("rr-list");
        const rrLoading = $("rr-loading");
        if (rrList) {
            rrList.innerHTML = "";
            rrLoading.style.display = "block";
            const rrRes = await api("/api/rr?guild=" + gid);
            rrLoading.style.display = "none";
            if (rrRes.ok && rrRes.reactionRoles) {
                if (rrRes.reactionRoles.length === 0) {
                    rrList.innerHTML = '<div class="muted" style="padding:10px; text-align:center;">設定されているリアクションロールはありません。</div>';
                } else {
                    rrList.innerHTML = rrRes.reactionRoles.map(r => `
                        <div class="color-item" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                            <div>
                                <div style="font-weight:600; font-size:13px;">Msg ID: ${r.message_id}</div>
                                <div class="muted" style="font-size:11px;">Emoji: ${escapeHTML(r.emoji)} | Role ID: ${r.role_id}</div>
                            </div>
                            <button onclick="removeRR('${r.id}')" class="btn btn-delete" style="padding:4px 10px; font-size:11px;">削除</button>
                        </div>
                    `).join("");
                }
            }
        }
    };

    window.removeRR = async (id) => {
        if (!confirm("このリアクションロール設定を削除しますか？")) return;
        const gid = $("globalGuildSelect")?.value;
        const res = await api("/api/rr", { guild: gid, id }, "DELETE");
        if (res.ok) {
            if (window.__pageReload) window.__pageReload();
        } else {
            alert("Error: " + res.error);
        }
    };

    if (!await loadGuilds()) return;
    window.__pageReload();

    if ($("save")) $("save").onclick = async () => {
        const gid = $("globalGuildSelect")?.value;
        if (!gid) return;
        const body = {
            guild: gid,
            log_channel_id: $("logCh")?.value || "",
            ng_log_channel_id: $("ngLogCh")?.value || "",
            report_channel_id: $("reportCh")?.value || "",
            ng_threshold: parseInt($("threshold")?.value || 3),
            timeout_minutes: parseInt($("timeout")?.value || 10),
            self_intro_enabled: $("introGateEnabled")?.checked || false,
            self_intro_role_id: $("introRole")?.value || "",
            self_intro_min_length: parseInt($("introMinLen")?.value || 10),
            vc_role_rules: Array.from(document.querySelectorAll(".role-rule-item")).map(item => ({
                role_id: item.querySelector(".rule-role").value,
                trigger: item.querySelector(".rule-trigger")?.value || 'vc_hours',
                aura_name: item.querySelector(".rule-name").value,
                hours: parseInt(item.querySelector(".rule-hours").value) || 0,
                messages: parseInt(item.querySelector(".rule-messages")?.value) || 0
            })),
            vc_report_channel_id: $("vcReportCh")?.value || "",
            vc_report_interval: $("vcReportInterval")?.value || "weekly",
            auto_vc_creator_id: $("autoVcCategory")?.value || null,
            intro_reminder_hours: parseInt($("introReminderHours")?.value || 24)
        };
        const res = await api("/api/settings/update", body);
        if (res.ok) alert(t("save_success")); else alert("Error: " + res.error);
    };
}

async function initActivity() {
    window.__pageReload = async () => {
        saveGuildSelection();
        const gid = $("globalGuildSelect")?.value;
        if (!gid) return;

        const [chRes, roleRes, setRes] = await Promise.all([
            api("/api/channels?guild=" + gid),
            api("/api/roles?guild=" + gid),
            api("/api/settings?guild=" + gid)
        ]);

        if (chRes.ok) {
            const chOpts = '<option value="">' + t("none") + '</option>' + chRes.channels.map(c => '<option value="' + c.id + '">#' + c.name + '</option>').join('');
            if ($("logCh")) $("logCh").innerHTML = chOpts;
            if ($("ngLogCh")) $("ngLogCh").innerHTML = chOpts;
            if ($("reportCh")) $("reportCh").innerHTML = chOpts;
            if ($("introCh")) $("introCh").innerHTML = chOpts;
        }
        if (roleRes.ok && $("auditRole")) {
            $("auditRole").innerHTML = '<option value="">None</option>' + roleRes.roles.map(r => '<option value="' + r.id + '">' + r.name + '</option>').join('');
        }
        if (setRes.ok && setRes.settings) {
            const s = setRes.settings;
            if ($("auditRole")) $("auditRole").value = s.audit_role_id || "";
            if ($("introCh")) $("introCh").value = s.intro_channel_id || "";
            if ($("logCh")) $("logCh").value = s.log_channel_id || "";
            if ($("ngLogCh")) $("ngLogCh").value = s.ng_log_channel_id || "";
            if ($("reportCh")) $("reportCh").value = s.report_channel_id || "";
        }

        // Auto-run scan on tab load
        await runScan();
    };

    let currentData = [];
    const renderRows = (data) => {
        const rows = $("act-rows");
        if (rows) rows.innerHTML = (data || []).map(r => {
            const av = r.avatar_url || "";
            const roleTxt = r.has_role ? '<span style="color:#1da1f2;">OK</span>' : '<span style="color:var(--danger-color);">NG</span>';
            const introTxt = r.has_intro ? '<span style="color:#1da1f2;">OK</span>' : '<span style="color:var(--danger-color);">NG</span>';
            const statusStyle = r.status === "OK" ? 'color:#1da1f2; font-weight:bold;' : 'color:var(--danger-color); font-weight:bold;';
            const detailedStatus = r.status === "OK" ? t("status_ok") : (!r.has_role ? t("status_no_role") : (!r.has_intro ? t("status_no_intro") : t("status_no_vc")));
            const actionBtn = `<button onclick="openWarnModal('${r.user_id}', '${escapeHTML(r.display_name)}')" class="btn" style="padding:4px 10px; font-size:11px; background:rgba(var(--accent-rgb), 0.1); color:var(--accent-color); border:1px solid var(--accent-color);">⚠️ 警告</button>`;

            return `<tr><td>${r.joined_at || '-'}</td><td><div style="display:flex; align-items:center; gap:8px;"><img src="${av}" style="width:24px; height:24px; border-radius:50%;" /> <span>${escapeHTML(r.display_name)}</span></div></td><td style="text-align:center;">${roleTxt}</td><td style="text-align:center;">${introTxt}</td><td style="text-align:center;">${r.last_vc}</td><td style="text-align:center; ${statusStyle}">${detailedStatus}</td><td style="text-align:center;">${actionBtn}</td></tr>`;
        }).join("") || `<tr><td colspan="7" class="muted" style="text-align:center;">${t("ng_none")}</td></tr>`;
    };

    // v2.7.0 Warning management
    window.openWarnModal = async (userId, displayName) => {
        const gid = $("globalGuildSelect")?.value;
        if (!gid) return;

        $("warnUserTitle").textContent = `⚠️ ${escapeHTML(displayName)} の警告管理`;
        $("warnHistory").innerHTML = '<div class="muted" style="text-align:center; padding:20px;">履歴を読み込み中...</div>';
        $("warnReason").value = "";
        $("warnModal").style.display = 'flex';

        const res = await api(`/api/warnings?guild=${gid}&user=${userId}`);
        if (res.ok) {
            if (res.warnings.length === 0) {
                $("warnHistory").innerHTML = '<div class="muted" style="text-align:center; padding:20px;">履歴はありません。</div>';
            } else {
                $("warnHistory").innerHTML = res.warnings.map(w => `
                    <div style="margin-bottom:10px; padding:8px; background:rgba(255,255,255,0.03); border-radius:4px; border-left:3px solid #ffaa00;">
                        <div style="font-weight:600; font-size:12px;">${escapeHTML(w.reason)}</div>
                        <div class="muted" style="font-size:10px;">発行者: ${escapeHTML(w.issued_by)} | ${new Date(w.created_at).toLocaleString('ja-JP')}</div>
                    </div>
                `).join("");
            }
        }

        $("submitWarnBtn").onclick = async () => {
            const reason = $("warnReason").value;
            if (!reason) return alert("理由を入力してください。");
            const btn = $("submitWarnBtn");
            btn.disabled = true;
            const issueRes = await api("/api/warnings", { guild: gid, user_id: userId, reason });
            btn.disabled = false;
            if (issueRes.ok) {
                alert(`警告を発行しました。（累計: ${issueRes.totalWarnings}回）`);
                openWarnModal(userId, displayName); // Refresh
            } else {
                alert("Error: " + issueRes.error);
            }
        };

        $("clearWarnBtn").onclick = async () => {
            if (!confirm("このユーザーのすべての警告履歴をリセットしますか？")) return;
            const clearRes = await api("/api/warnings", { guild: gid, user_id: userId }, "DELETE");
            if (clearRes.ok) {
                alert("警告履歴をリセットしました。");
                openWarnModal(userId, displayName); // Refresh
            } else {
                alert("Error: " + clearRes.error);
            }
        };
    };

    window.sortActivity = (key) => {
        if (!currentData.length) return;
        currentData.sort((a, b) => (a[key] || "").localeCompare(b[key] || ""));
        renderRows(currentData);
    };

    window.releaseTimeout = async (uid) => {
        const gid = $("globalGuildSelect")?.value;
        if (!gid || !confirm(t("confirm_release"))) return;
        const res = await api("/api/timeout/release", { guild: gid, user_id: uid });
        if (res.ok) { alert(t("release_success")); runScan(); } else alert("Error: " + res.error);
    };

    const runScan = async () => {
        const gid = $("globalGuildSelect")?.value;
        const ar = $("auditRole")?.value || "";
        const ic = $("introCh")?.value || "";
        if (!gid) return;

        const rows = $("act-rows");
        const loading = $("act-loading");
        if (rows) rows.innerHTML = "";
        if (loading) loading.style.display = "block";

        const res = await api(`/api/activity?guild=${gid}&audit_role_id=${ar}&intro_channel_id=${ic}&refresh=1`);
        if (loading) loading.style.display = "none";

        if (!res.ok) {
            const errorMsg = res.error?.includes("Upgrade") ? `⚠️ ${res.error} <a href="/admin/dashboard" style="margin-left:8px;">Check Plans</a>` : res.error;
            if (rows) rows.innerHTML = `<tr><td colspan="6" style="color:red; text-align:center;">${errorMsg}</td></tr>`;
            return;
        }

        currentData = res.data || [];
        renderRows(currentData);
    };

    if ($("scan")) $("scan").onclick = runScan;

    // Auto-refresh: 60 seconds
    let countdown = 60;
    const countEl = document.createElement('div');
    countEl.style = 'font-size:12px; color:#888; margin-top:8px; text-align:right;';
    $("scan")?.parentElement?.appendChild(countEl);
    setInterval(() => {
        countEl.textContent = `自動更新: ${countdown}秒後`;
        if (countdown-- <= 0) { countdown = 60; runScan(); }
    }, 1000);

    if (!await loadGuilds()) return;
    window.__pageReload();
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
    const gid = $("globalGuildSelect")?.value;
    if (!word || !gid) return;

    const res = await api("/api/ngwords/add", { guild: gid, word });
    if (res.ok) {
        if (res.message) alert(res.message);
        input.value = "";
        if (window.__pageReload) window.__pageReload();
    } else {
        alert("Error: " + res.error);
    }
};

// Tickets Page Logic
window.initTicketsPage = async () => {
    window.__pageReload = async () => {
        saveGuildSelection();
        const gid = $("globalGuildSelect")?.value;
        const status = $("statusFilter")?.value || 'open';
        if (!gid) return;

        const list = $("ticketList");
        if (list) list.innerHTML = `<tr><td colspan="6" class="muted" style="text-align:center; padding:30px;">${t("loading")}...</td></tr>`;

        const [ticketsRes, settingsRes, rolesRes, channelsRes] = await Promise.all([
            api(`/api/tickets?guild=${gid}&status=${status}`),
            api(`/api/settings?guild=${gid}`),
            api(`/api/roles?guild=${gid}`),
            api(`/api/channels?guild=${gid}`)
        ]);

        // Populate Roles
        const roleSel = $("ticketStaffRole");
        if (roleSel && rolesRes.ok) {
            roleSel.innerHTML = '<option value="">--- ロールを選択してください ---</option>' +
                rolesRes.roles.map(r => `<option value="${r.id}">${escapeHTML(r.name)}</option>`).join("");
            if (settingsRes.ok && settingsRes.settings) {
                roleSel.value = settingsRes.settings.ticket_staff_role_id || "";
            }
        }

        // Populate Log Channels
        const logChSel = $("ticketLogCh");
        if (logChSel && channelsRes.ok) {
            logChSel.innerHTML = '<option value="">--- チャンネルを選択してください ---</option>' +
                channelsRes.channels.filter(c => c.type === 0).map(c => `<option value="${c.id}">#${escapeHTML(c.name)}</option>`).join("");
            if (settingsRes.ok && settingsRes.settings) {
                logChSel.value = settingsRes.settings.ticket_log_channel_id || "";
            }
        }

        if (settingsRes.ok && settingsRes.settings) {
            if ($("ticketWelcomeMsg")) $("ticketWelcomeMsg").value = settingsRes.settings.ticket_welcome_msg || "";
        }

        if (ticketsRes.ok && list) {
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
                            ${t.status === 'open' ? `
                                <button class="staff-assign-btn" onclick="openAssignModal('${t.id}')">担当依頼</button>
                                <button class="btn" style="padding:2px 8px; font-size:11px; border-color:var(--danger-color); color:var(--danger-color);" onclick="closeWebTicket('${t.id}')">解決</button>
                            ` : `
                                ${t.transcript_id ? `<a href="/transcripts/${t.transcript_id}.html" target="_blank" class="btn" style="padding:2px 8px; font-size:11px; text-decoration:none; margin-right:5px;">ログ</a>` : ''}
                                <button class="btn btn-delete" onclick="deleteTicket('${t.id}')">破棄</button>
                            `}
                        </td>
                    </tr>
                `).join("");
            }
        }
    };

    if (!await loadGuilds()) return;
    if ($("statusFilter")) $("statusFilter").onchange = window.__pageReload;
    if ($("refreshTickets")) $("refreshTickets").onclick = window.__pageReload;
    window.__pageReload();

    if ($("saveTicketSettings")) $("saveTicketSettings").onclick = async () => {
        const gid = $("globalGuildSelect")?.value;
        if (!gid) return;
        const body = {
            guild: gid,
            ticket_welcome_msg: $("ticketWelcomeMsg")?.value || "",
            ticket_staff_role_id: $("ticketStaffRole")?.value || null,
            ticket_log_channel_id: $("ticketLogCh")?.value || null
        };
        const res = await api("/api/settings/update", body);
        if (res.ok) alert(t("save_success")); else alert("Error: " + res.error);
    };
};

window.openAssignModal = async (ticketId) => {
    const gid = $("globalGuildSelect")?.value;
    const roleId = $("ticketStaffRole")?.value;
    if (!gid || !roleId) return alert("先にモデレーターロールを設定して保存してください。");

    const modal = $("assignModal");
    const mList = $("memberList");
    modal.style.display = 'flex';
    mList.innerHTML = `<div class="muted" style="padding:20px; text-align:center;">メンバーを読み込み中...</div>`;

    const res = await api(`/api/roles/members?guild=${gid}&role_id=${roleId}`);
    if (res.ok) {
        if (res.members.length === 0) {
            mList.innerHTML = `<div class="muted" style="padding:20px; text-align:center;">このロールを持つメンバーは見つかりませんでした。</div>`;
        } else {
            mList.innerHTML = res.members.map(m => `
                <div class="member-item" onclick="assignStaff('${ticketId}', '${m.id}')">
                    <img src="${m.avatar || 'https://cdn.discordapp.com/embed/avatars/0.png'}" />
                    <div>
                        <div style="font-weight:600; font-size:13px;">${escapeHTML(m.name)}</div>
                        <div class="muted" style="font-size:11px;">ID: ${m.id}</div>
                    </div>
                </div>
            `).join("");
        }
    } else {
        mList.innerHTML = `<div class="muted" style="padding:20px; text-align:center; color:var(--danger-color);">エラー: ${res.error}</div>`;
    }
};

window.assignStaff = async (ticketId, userId) => {
    const gid = $("globalGuildSelect")?.value;
    if (!gid) return;
    if (!confirm("このメンバーに担当を依頼しますか？")) return;
    const res = await api("/api/tickets/assign", { guild: gid, ticket_id: ticketId, user_id: userId });
    if (res.ok) {
        $("assignModal").style.display = 'none';
        if (window.__pageReload) window.__pageReload();
    } else {
        alert("Error: " + res.error);
    }
};

window.closeWebTicket = async (id) => {
    if (!confirm("このチケットを解決済みとしてマークし、チャンネルを削除しますか？")) return;
    const gid = $("globalGuildSelect")?.value;
    if (!gid) return;
    const res = await api("/api/tickets/close", { guild: gid, ticket_id: id });
    if (res.ok) {
        alert("チケットを解決しました。");
        if (window.__pageReload) window.__pageReload();
    } else {
        alert("Error: " + res.error);
    }
};

window.deleteTicket = async (id) => {
    if (!confirm("このチケットデータと保存されたログを完全に破棄しますか？\n(この操作は取り消せません)")) return;
    const gid = $("globalGuildSelect")?.value;
    if (!gid) return;
    const res = await api("/api/tickets/delete", { guild: gid, ticket_id: id });
    if (res.ok) {
        alert("チケットを完全に削除しました。");
        if (window.__pageReload) window.__pageReload();
    } else {
        alert("Error: " + res.error);
    }
};


window.removeNg = async (word) => {
    if (!confirm(t("confirm_delete") || "Delete?")) return;
    const gid = $("globalGuildSelect")?.value;
    const res = await api("/api/ngwords/remove", { guild: gid, word });
    if (res.ok) {
        if (window.__pageReload) window.__pageReload();
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

async function initBrandingPage() {
    window.__pageReload = async () => {
        saveGuildSelection();
        const gid = $("globalGuildSelect")?.value;
        if (!gid) return;

        const res = await api(`/api/settings?guild=${gid}`);
        if (res.ok && res.settings) {
            const s = res.settings;
            if ($("dashboard_theme_mode")) $("dashboard_theme_mode").value = s.dashboard_theme_mode || 'midnight';
            if ($("dashboard_theme_color")) $("dashboard_theme_color").value = s.dashboard_theme_color || '#1d9bf0';
            if ($("color_log")) $("color_log").value = s.color_log || '#5865F2';
            if ($("color_ng")) $("color_ng").value = s.color_ng || '#f4212e';
            if ($("color_vc_join")) $("color_vc_join").value = s.color_vc_join || '#1da1f2';
            if ($("color_vc_leave")) $("color_vc_leave").value = s.color_vc_leave || '#8b9bb4';
            if ($("color_level")) $("color_level").value = s.color_level || '#FFD700';
            if ($("color_ticket")) $("color_ticket").value = s.color_ticket || '#2ECC71';

            // Update UI Selection ONLY (Dont overwrite localStorage during init)
            const mode = s.dashboard_theme_mode || 'midnight';
            document.querySelectorAll('.theme-option').forEach(el => el.classList.remove('selected'));
            const modeEl = document.getElementById('theme-' + mode);
            if (modeEl) modeEl.classList.add('selected');
            document.body.className = 'theme-' + mode;

            applyThemeColor(s.dashboard_theme_color || '#1d9bf0');
        }
    };
    if (!await loadGuilds()) return;
    window.__pageReload();

    if ($("saveBranding")) $("saveBranding").onclick = async () => {
        const gid = $("globalGuildSelect")?.value;
        if (!gid) return;
        const body = {
            guild: gid,
            dashboard_theme_mode: $("dashboard_theme_mode")?.value || 'midnight',
            dashboard_theme_color: $("dashboard_theme_color")?.value || '#1d9bf0',
            color_log: $("color_log")?.value || '#5865F2',
            color_ng: $("color_ng")?.value || '#f4212e',
            color_vc_join: $("color_vc_join")?.value || '#1da1f2',
            color_vc_leave: $("color_vc_leave")?.value || '#8b9bb4',
            color_level: $("color_level")?.value || '#FFD700',
            color_ticket: $("color_ticket")?.value || '#2ECC71'
        };
        const res = await api("/api/settings/update", body);
        if (res.ok) {
            localStorage.setItem('dashboard_theme_mode', body.dashboard_theme_mode);
            localStorage.setItem('dashboard_theme_color', body.dashboard_theme_color);
            alert(t("save_success"));
        } else alert("Error: " + res.error);
    };
}

// AI Analysis & Insights Page
async function initAiPage() {
    window.__pageReload = async () => {
        saveGuildSelection();
        const gid = $("globalGuildSelect")?.value;
        if (!gid) return;
        const res = await api(`/api/settings?guild=${gid}`);
        if (res.ok && res.settings) {
            const s = res.settings;
            if ($("aiAdviceDays")) $("aiAdviceDays").value = s.ai_advice_days || 14;
            if ($("aiAdviceCh")) await loadChannels("aiAdviceCh", gid, s.ai_advice_channel_id);
            if ($("aiInsightEnabled")) $("aiInsightEnabled").checked = !!s.ai_insight_enabled;
            if ($("aiInsightCh")) await loadChannels("aiInsightCh", gid, s.ai_insight_channel_id);
            if ($("insightGrowth")) $("insightGrowth").checked = !!s.insight_growth;
            if ($("insightToxicity")) $("insightToxicity").checked = !!s.insight_toxicity;
            if ($("insightVc")) $("insightVc").checked = !!s.insight_vc;
            if ($("aiPredictionEnabled")) $("aiPredictionEnabled").checked = !!s.ai_prediction_enabled;
            if ($("aiPredictCh")) await loadChannels("aiPredictCh", gid, s.ai_predict_channel_id);
        }
    };
    if (!await loadGuilds()) return;
    window.__pageReload();

    if ($("saveAi")) $("saveAi").onclick = async () => {
        const gid = $("globalGuildSelect")?.value;
        if (!gid) return;
        const body = {
            guild: gid,
            ai_advice_days: parseInt($("aiAdviceDays")?.value || 14),
            ai_advice_channel_id: $("aiAdviceCh")?.value || "",
            ai_insight_enabled: $("aiInsightEnabled")?.checked || false,
            ai_insight_channel_id: $("aiInsightCh")?.value || "",
            insight_growth: $("insightGrowth")?.checked || false,
            insight_toxicity: $("insightToxicity")?.checked || false,
            insight_vc: $("insightVc")?.checked || false,
            ai_prediction_enabled: $("aiPredictionEnabled")?.checked || false,
            ai_predict_channel_id: $("aiPredictCh")?.value || ""
        };
        const res = await api("/api/settings/update", body);
        if (res.ok) alert(t("save_success")); else alert("Error: " + res.error);
    };
}

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


