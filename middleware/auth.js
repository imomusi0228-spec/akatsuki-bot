import { ENV } from "../config/env.js";

// In-memory session store (Project restart clears sessions, acceptable for now)
export const sessions = new Map();
export const states = new Map(); // OAuth states

export function setCookie(res, name, value, options = {}) {
    const isHttpOnly = options.httpOnly !== false;
    let cookie = `${name}=${encodeURIComponent(value)}; Path=/; SameSite=Lax`;
    if (isHttpOnly) cookie += "; HttpOnly";
    if (options.maxAge) cookie += `; Max-Age=${options.maxAge}`;
    if (options.secure || ENV.PUBLIC_URL?.includes("https")) cookie += `; Secure`;


    // console.log(`[AUTH DEBUG] setCookie: ${name}=${value} (Opts: ${JSON.stringify(options)}) -> ${cookie}`);

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

export async function getSession(req) {
    const cookies = {};
    (req.headers.cookie || "").split(";").forEach((c) => {
        const [k, v] = c.trim().split("=");
        if (k && v) cookies[k] = decodeURIComponent(v);
    });

    const sid = cookies.sid;
    // console.log(`[AUTH DEBUG] getSession: CookieSID=${sid}, SessionExists=${sessions.has(sid)}`);

    if (!sid || !sessions.has(sid)) {
        // console.log(`[AUTH DEBUG] getSession: No session found for SID=${sid}`);
        return null;
    }

    const session = sessions.get(sid);
    if (session.expiresAt < Date.now()) {
        // console.log(`[AUTH DEBUG] getSession: Session expired for SID=${sid}`);
        sessions.delete(sid);
        return null;
    }
    // console.log(`[AUTH DEBUG] getSession: Session OK for SID=${sid}, User=${session.user.username}`);
    return session;
}

export async function discordApi(token, endpoint) {
    const res = await fetch(`https://discord.com/api/v10${endpoint}`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
        const txt = await res.text(); // logging detail
        console.error(`[Discord API Error] ${endpoint}: ${res.status} ${res.statusText}`, txt);
        return null;
    }
    return await res.json();
}
