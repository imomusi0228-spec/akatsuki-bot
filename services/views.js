import { ENV } from "../config/env.js";
import { t, DICTIONARY } from "../core/i18n.js";
import { getTier } from "../core/subscription.js";
import { TIER_NAMES, TIER_COLORS } from "../core/tiers.js";

import path from "path";
import ejs from "ejs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VIEWS_DIR = path.join(__dirname, "../views");

export function escapeHTML(s = "") {
    return String(s)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function getLang(req = {}) {
    const cookies = {};
    (req.headers?.cookie || "").split(";").forEach((c) => {
        const [k, v] = c.trim().split("=");
        if (k && v) cookies[k] = decodeURIComponent(v);
    });
    return cookies.lang === "en" ? "en" : "ja";
}

async function renderView(viewName, data, lang, req) {
    // Determine the active guild to fetch its tier (v3.2.0)
    let tier = 0; // TIERS.FREE
    const cookies = {};
    (req.headers?.cookie || "").split(";").forEach((c) => {
        const [k, v] = c.trim().split("=");
        if (k && v) cookies[k] = decodeURIComponent(v);
    });
    // Priority: Query param > Cookie (last_guild_id)
    const url = new URL(req.url, `http://${req.headers.host}`);
    const guildId = url.searchParams.get("guild") || cookies.last_guild_id;

    if (guildId && guildId.length > 5) {
        tier = await getTier(guildId);
    }

    const subscription = {
        tier: tier,
        name: TIER_NAMES[tier] || "Free",
        color: TIER_COLORS[tier] || "#8b9bb4",
    };

    const content = await ejs.renderFile(path.join(VIEWS_DIR, `${viewName}.ejs`), {
        ...data,
        lang,
        subscription,
        t: (key, params) => t(key, lang, params),
    });

    return await ejs.renderFile(path.join(VIEWS_DIR, "layout.ejs"), {
        ...data,
        content,
        lang,
        subscription,
        dictionary: JSON.stringify(DICTIONARY),
        t: (key, params) => t(key, lang, params),
    });
}

export async function renderLoginHTML(req) {
    const lang = getLang(req);
    return await renderView(
        "login",
        {
            title: t("login", lang),
            user: null,
            oauth: false,
            activeTab: null,
            scripts: "",
        },
        lang,
        req
    );
}

export async function renderAdminDashboardHTML({ user, req }) {
    const lang = getLang(req);
    return await renderView(
        "dashboard",
        {
            title: t("dashboard", lang),
            user,
            oauth: true,
            activeTab: "dashboard",
            scripts: "",
        },
        lang,
        req
    );
}

export async function renderAdminSettingsHTML({ user, req }) {
    const lang = getLang(req);
    return await renderView(
        "settings",
        {
            title: t("settings", lang),
            user,
            oauth: true,
            activeTab: "settings",
            scripts: "",
        },
        lang,
        req
    );
}

export async function renderAdminActivityHTML({ user, req }) {
    const lang = getLang(req);
    return await renderView(
        "activity",
        {
            title: t("activity", lang),
            user,
            oauth: true,
            activeTab: "activity",
            scripts: "",
        },
        lang,
        req
    );
}
export async function renderLandingHTML(req) {
    const lang = getLang(req);
    return await renderView(
        "landing",
        {
            title: t("title", lang),
            user: null,
            oauth: false,
            activeTab: null,
            scripts: "",
            noScroll: true,
        },
        lang,
        req
    );
}

export async function renderFeaturesHTML(req) {
    const lang = getLang(req);
    return await renderView(
        "features",
        {
            title: t("features_title", lang),
            user: null,
            oauth: false,
            activeTab: null,
            scripts: "",
        },
        lang,
        req
    );
}

export async function renderAdminAntiraidHTML({ user, req }) {
    const lang = getLang(req);
    return await renderView(
        "antiraid",
        {
            title: t("nav_antiraid", lang),
            user,
            oauth: true,
            activeTab: "antiraid",
            scripts: "",
        },
        lang,
        req
    );
}

export async function renderAdminTicketsHTML({ user, req }) {
    const lang = getLang(req);
    return await renderView(
        "tickets",
        {
            title: t("ticket_mgmt", lang),
            user,
            oauth: true,
            activeTab: "tickets",
            scripts: "",
        },
        lang,
        req
    );
}

export async function renderAdminBrandingHTML({ user, req }) {
    const lang = getLang(req);
    return await renderView(
        "branding",
        {
            title: t("branding", lang),
            user,
            oauth: true,
            activeTab: "branding",
            scripts: "",
        },
        lang,
        req
    );
}

export async function renderAdminAiHTML({ user, req }) {
    const lang = getLang(req);
    return await renderView(
        "ai",
        {
            title: t("ai_insight_title", lang),
            user,
            oauth: true,
            activeTab: "ai",
            scripts: "",
        },
        lang,
        req
    );
}
