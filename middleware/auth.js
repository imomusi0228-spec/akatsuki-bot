import { ENV } from "../config/env.js";

// In-memory session store (Project restart clears sessions, acceptable for now)
export const sessions = new Map();
export const states = new Map(); // OAuth states

export function setCookie(res, name, value, options = {}) {
    let cookie = `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax`;
    if (options.maxAge) cookie += `; Max-Age=${options.maxAge}`;
    if (options.secure || ENV.PUBLIC_URL.includes("https")) cookie += `; Secure`;
    res.setHeader("Set-Cookie", cookie);
}

export function delCookie(res, name) {
    res.setHeader("Set-Cookie", `${name}=; Path=/; HttpOnly; Max-Age=0`);
}

export async function getSession(req) {
    const cookies = {};
    (req.headers.cookie || "").split(";").forEach((c) => {
        const [k, v] = c.trim().split("=");
        if (k && v) cookies[k] = decodeURIComponent(v);
    });

    const sid = cookies.sid;
    if (!sid || !sessions.has(sid)) return null;

    const session = sessions.get(sid);
    if (session.expiresAt < Date.now()) {
        sessions.delete(sid);
        return null;
    }
    return session;
}

export async function discordApi(token, endpoint) {
    const res = await fetch(`https://discord.com/api/v10${endpoint}`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    return await res.json();
}
