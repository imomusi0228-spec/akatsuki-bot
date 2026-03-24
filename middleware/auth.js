import { ENV } from "../config/env.js";

import { dbQuery } from "../core/db.js";

// Persistent session store (PostgreSQL)
// states Map can remain in-memory as they are short-lived (OAuth flow)
export const states = new Map();

export function setCookie(res, name, value, options = {}) {
    const isHttpOnly = options.httpOnly !== false;
    let isSecure = options.secure;
    if (isSecure === undefined) {
        // Force secure if PUBLIC_URL is https
        isSecure = ENV.PUBLIC_URL?.startsWith("https");
        // Or if we are explicitly told it's secure via options (handled above)
    }

    let cookie = `${name}=${encodeURIComponent(value)}; Path=/; SameSite=Lax`;
    if (isHttpOnly) cookie += "; HttpOnly";
    if (options.maxAge) cookie += `; Max-Age=${options.maxAge}`;
    if (isSecure) cookie += `; Secure`;

    let prev = res.getHeader("Set-Cookie");
    if (prev) {
        if (Array.isArray(prev)) {
            prev.push(cookie);
            res.setHeader("Set-Cookie", prev);
        } else {
            res.setHeader("Set-Cookie", [prev, cookie]);
        }
    } else {
        res.setHeader("Set-Cookie", cookie);
    }
}

export function delCookie(res, name) {
    const cookie = `${name}=; Path=/; HttpOnly; Max-Age=0`;
    let prev = res.getHeader("Set-Cookie");
    if (prev) {
        if (Array.isArray(prev)) {
            prev.push(cookie);
            res.setHeader("Set-Cookie", prev);
        } else {
            res.setHeader("Set-Cookie", [prev, cookie]);
        }
    } else {
        res.setHeader("Set-Cookie", cookie);
    }
}

/**
 * Get session from DB
 */
export async function getSession(req) {
    const cookies = {};
    (req.headers.cookie || "").split(";").forEach((c) => {
        const [k, v] = c.trim().split("=");
        if (k && v) cookies[k] = decodeURIComponent(v);
    });

    const sid = cookies.sid;
    if (!sid) return null;

    try {
        const res = await dbQuery(
            "SELECT data, expires_at FROM sessions WHERE sid = $1",
            [sid]
        );
        const sessionRow = res.rows[0];

        if (!sessionRow) return null;

        if (new Date(sessionRow.expires_at) < new Date()) {
            await dbQuery("DELETE FROM sessions WHERE sid = $1", [sid]);
            return null;
        }

        return { ...sessionRow.data, sid };
    } catch (e) {
        console.error("[AUTH ERROR] getSession failed:", e.message);
        return null;
    }
}

export async function discordApi(token, endpoint) {
    const res = await fetch(`https://discord.com/api/v10${endpoint}`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
        console.error(`[Discord API Error] ${endpoint}: ${res.status} ${res.statusText}`, data);
        return { error: true, status: res.status, ...data };
    }
    return data;
}
