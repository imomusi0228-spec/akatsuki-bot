import crypto from "node:crypto";
import { ENV, BASE_REDIRECT_URI } from "../config/env.js";
import { sessions, states, setCookie, delCookie, discordApi } from "../middleware/auth.js";

function rand(n = 24) {
    return crypto.randomBytes(n).toString("hex");
}

export async function handleAuthRoute(req, res, pathname, url) {
    // Login
    if (pathname === "/login" || pathname === "/auth/discord") {
        if (!ENV.CLIENT_ID || !ENV.CLIENT_SECRET) {
            res.writeHead(500, { "Content-Type": "text/plain" });
            res.end("OAuth config missing (CLIENT_ID/SECRET)");
            return;
        }

        const state = rand();
        states.set(state, Date.now());
        console.log(`[AUTH DEBUG] /login: Generated state=${state}`);

        // Cleanup states
        if (states.size > 1000) {
            for (const [k, v] of states) {
                if (Date.now() - v > 600000) states.delete(k);
                if (states.size <= 500) break;
            }
        }

        setCookie(res, "oauth_state", state, { maxAge: 600 });

        const authUrl = new URL("https://discord.com/api/oauth2/authorize");
        authUrl.searchParams.set("client_id", ENV.CLIENT_ID);
        authUrl.searchParams.set("redirect_uri", BASE_REDIRECT_URI);
        authUrl.searchParams.set("response_type", "code");
        authUrl.searchParams.set("scope", ENV.OAUTH_SCOPES);
        authUrl.searchParams.set("state", state);

        res.writeHead(302, { Location: authUrl.toString() });
        res.end();
        return;
    }

    // Callback
    if (pathname === ENV.REDIRECT_PATH) {
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const error = url.searchParams.get("error");

        if (error) {
            res.writeHead(400, { "Content-Type": "text/plain" });
            res.end(`OAuth Error: ${error}`);
            return;
        }

        // State check
        const cookies = {};
        (req.headers.cookie || "").split(";").forEach((c) => {
            const [k, v] = c.trim().split("=");
            if (k && v) cookies[k] = decodeURIComponent(v);
        });

        const storedState = cookies.oauth_state;
        console.log(`[AUTH DEBUG] /callback: ReceivedState=${state}, StoredState=${storedState}, StatesHas=${states.has(state)}`);

        if (!state || !storedState || state !== storedState || !states.has(state)) {
            console.error(`[AUTH DEBUG] /callback: State mismatch or missing!`);
            res.writeHead(400, { "Content-Type": "text/plain" });
            res.end("Invalid State (CSRF check failed). Try /login again.");
            return;
        }
        states.delete(state);

        // Exchange token
        const tokenUrl = "https://discord.com/api/oauth2/token";
        const body = new URLSearchParams({
            client_id: ENV.CLIENT_ID,
            client_secret: ENV.CLIENT_SECRET,
            grant_type: "authorization_code",
            code,
            redirect_uri: BASE_REDIRECT_URI,
        });

        try {
            const tokenRes = await fetch(tokenUrl, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body,
            });

            if (!tokenRes.ok) {
                const text = await tokenRes.text();
                console.error(`❌ OAuth Token Error: ${tokenRes.status} ${tokenRes.statusText}`, text);
                throw new Error(`Token exchange failed: ${tokenRes.status} - ${text}`);
            }

            const tokenData = await tokenRes.json();
            const user = await discordApi(tokenData.access_token, "/users/@me");
            if (!user) throw new Error("Failed to fetch user");

            // Create session
            const sid = rand();
            const csrfSecret = rand(32); // Strong CSRF secret

            console.log(`[AUTH DEBUG] /callback: Creating session SID=${sid} for User=${user.username} (CSRF Secret: ${csrfSecret.substring(0, 8)}...)`);

            sessions.set(sid, {
                accessToken: tokenData.access_token,
                refreshToken: tokenData.refresh_token,
                expiresAt: Date.now() + (tokenData.expires_in * 1000),
                user,
                csrfSecret,
            });

            setCookie(res, "sid", sid, { maxAge: tokenData.expires_in, httpOnly: true, secure: true });

            // CSRF cookie is readable by JS so the client can send it in headers
            // We set it to expire with the session
            setCookie(res, "csrf_token", csrfSecret, { maxAge: tokenData.expires_in, secure: true, httpOnly: false, sameSite: 'Lax' });


            delCookie(res, "oauth_state");

            res.writeHead(302, { Location: "/admin/dashboard" });
            res.end();

        } catch (e) {
            console.error(e);
            res.writeHead(500, { "Content-Type": "text/plain" });
            res.end("OAuth Failed: " + e.message);
        }
        return;
    }

    // Logout
    if (pathname === "/logout") {
        const cookies = {};
        (req.headers.cookie || "").split(";").forEach((c) => {
            const [k, v] = c.trim().split("=");
            if (k && v) cookies[k] = decodeURIComponent(v);
        });
        const sid = cookies.sid;
        if (sid) sessions.delete(sid);

        delCookie(res, "sid");
        res.writeHead(302, { Location: "/" });
        res.end();
        return;
    }
}
