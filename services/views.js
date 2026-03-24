import { ENV } from "../config/env.js";
import { t, DICTIONARY } from "../core/i18n.js";
import { TIERS, TIER_NAMES, TIER_COLORS } from "../core/tiers.js";

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

function getLang(req = {}, url) {
    // 1. Priority: URL Query Parameter
    if (url && url.searchParams && url.searchParams.get("lang")) {
        const l = url.searchParams.get("lang");
        if (l === "en" || l === "ja") return l;
    }

    // 2. Secondary: Cookie
    const cookies = {};
    (req.headers?.cookie || "").split(";").forEach((c) => {
        const [k, v] = c.trim().split("=");
        if (k && v) cookies[k] = decodeURIComponent(v);
    });
    return cookies.lang === "en" ? "en" : "ja";
}

async function renderView(viewName, data, lang) {
    const content = await ejs.renderFile(path.join(VIEWS_DIR, `${viewName}.ejs`), {
        ...data,
        lang,
        TIERS,
        userTier: data.userTier ?? TIERS.FREE,
        t: (key, params) => t(key, lang, params),
    });

    return await ejs.renderFile(path.join(VIEWS_DIR, "layout.ejs"), {
        ...data,
        content,
        lang,
        TIERS,
        TIER_NAMES,
        TIER_COLORS,
        userTier: data.userTier ?? TIERS.FREE,
        dictionary: JSON.stringify(DICTIONARY),
        t: (key, params) => t(key, lang, params),
    });
}

export async function renderLoginHTML(req, url) {
    const lang = getLang(req, url);
    return await renderView(
        "login",
        {
            title: t("login", lang),
            user: null,
            oauth: false,
            activeTab: null,
            scripts: "",
            userTier: TIERS.FREE
        },
        lang
    );
}

export async function renderAdminDashboardHTML({ user, req, url, userTier }) {
    const lang = getLang(req, url);
    return await renderView(
        "dashboard",
        {
            title: t("dashboard", lang),
            user,
            userTier: userTier ?? TIERS.FREE,
            oauth: true,
            activeTab: "dashboard",
            scripts: "",
        },
        lang
    );
}

export async function renderAdminSettingsHTML({ user, req, url, userTier }) {
    const lang = getLang(req, url);
    return await renderView(
        "settings",
        {
            title: t("settings", lang),
            user,
            userTier: userTier ?? TIERS.FREE,
            oauth: true,
            activeTab: "settings",
            scripts: "",
        },
        lang
    );
}

export async function renderAdminActivityHTML({ user, req, url, userTier }) {
    const lang = getLang(req, url);
    return await renderView(
        "activity",
        {
            title: t("activity", lang),
            user,
            userTier: userTier ?? TIERS.FREE,
            oauth: true,
            activeTab: "activity",
            scripts: "",
        },
        lang
    );
}

export async function renderLandingHTML(req, url) {
    const lang = getLang(req, url);
    return await renderView(
        "landing",
        {
            title: t("title", lang),
            user: null,
            oauth: false,
            activeTab: null,
            scripts: "",
            noScroll: true,
            userTier: TIERS.FREE
        },
        lang
    );
}

export async function renderFeaturesHTML(req, url) {
    const lang = getLang(req, url);
    return await renderView(
        "features",
        {
            title: t("features_title", lang),
            user: null,
            oauth: false,
            activeTab: null,
            scripts: "",
            userTier: TIERS.FREE
        },
        lang
    );
}

export async function renderAdminAntiraidHTML({ user, req, url, userTier }) {
    const lang = getLang(req, url);
    return await renderView(
        "antiraid",
        {
            title: t("nav_antiraid", lang),
            user,
            userTier: userTier ?? TIERS.FREE,
            oauth: true,
            activeTab: "antiraid",
            scripts: "",
        },
        lang
    );
}

export async function renderAdminTicketsHTML({ user, req, url, userTier }) {
    const lang = getLang(req, url);
    return await renderView(
        "tickets",
        {
            title: t("ticket_mgmt", lang),
            user,
            userTier: userTier ?? TIERS.FREE,
            oauth: true,
            activeTab: "tickets",
            scripts: "",
        },
        lang
    );
}

export async function renderAdminBrandingHTML({ user, req, url, userTier }) {
    const lang = getLang(req, url);
    return await renderView(
        "branding",
        {
            title: t("branding", lang),
            user,
            userTier: userTier ?? TIERS.FREE,
            oauth: true,
            activeTab: "branding",
            scripts: "",
        },
        lang
    );
}

export async function renderAdminAiHTML({ user, req, url, userTier }) {
    const lang = getLang(req, url);
    return await renderView(
        "ai",
        {
            title: t("ai_insight_title", lang),
            user,
            userTier: userTier ?? TIERS.FREE,
            oauth: true,
            activeTab: "ai",
            scripts: "",
        },
        lang
    );
}
