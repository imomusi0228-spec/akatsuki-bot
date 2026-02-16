import { ENV } from "../config/env.js";
import { t, DICTIONARY } from "../core/i18n.js";

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

async function renderView(viewName, data, lang) {
    const content = await ejs.renderFile(path.join(VIEWS_DIR, `${viewName}.ejs`), {
        ...data,
        lang,
        t: (key, params) => t(key, lang, params),
    });

    return await ejs.renderFile(path.join(VIEWS_DIR, "layout.ejs"), {
        ...data,
        content,
        lang,
        dictionary: JSON.stringify(DICTIONARY),
        t: (key, params) => t(key, lang, params),
    });
}

export async function renderLoginHTML(req) {
    const lang = getLang(req);
    return await renderView("login", {
        title: t("login", lang),
        user: null,
        oauth: false,
        activeTab: null,
        scripts: ""
    }, lang);
}

export async function renderAdminDashboardHTML({ user, req }) {
    const lang = getLang(req);
    return await renderView("dashboard", {
        title: t("dashboard", lang),
        user,
        oauth: true,
        activeTab: "dashboard",
        scripts: ""
    }, lang);
}

export async function renderAdminSettingsHTML({ user, req }) {
    const lang = getLang(req);
    return await renderView("settings", {
        title: t("settings", lang),
        user,
        oauth: true,
        activeTab: "settings",
        scripts: ""
    }, lang);
}

export async function renderAdminActivityHTML({ user, req }) {
    const lang = getLang(req);
    return await renderView("activity", {
        title: t("activity", lang),
        user,
        oauth: true,
        activeTab: "activity",
        scripts: ""
    }, lang);
}
export async function renderLandingHTML(req) {
    const lang = getLang(req);
    return await renderView("landing", {
        title: t("title", lang),
        user: null,
        oauth: false,
        activeTab: null,
        scripts: ""
    }, lang);
}

export async function renderFeaturesHTML(req) {
    const lang = getLang(req);
    return await renderView("features", {
        title: t("features_title", lang),
        user: null,
        oauth: false,
        activeTab: null,
        scripts: ""
    }, lang);
}

export async function renderAdminAntiraidHTML({ user, req }) {
    const lang = getLang(req);
    return await renderView("antiraid", {
        title: t("nav_antiraid", lang),
        user,
        oauth: true,
        activeTab: "antiraid",
        scripts: ""
    }, lang);
}
