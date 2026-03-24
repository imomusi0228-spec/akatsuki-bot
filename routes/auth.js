import crypto from "node:crypto";
import { ENV, BASE_REDIRECT_URI } from "../config/env.js";
import { states, setCookie, delCookie, discordApi } from "../middleware/auth.js";
import { dbQuery } from "../core/db.js";

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

        // State check: More robust cookie parsing
        const cookieHeader = req.headers.cookie || "";
        const storedState = cookieHeader.match(/oauth_state=([^;]+)/)?.[1];
        const isStateValid = states.has(state);

        console.log(`[AUTH DEBUG] /callback: ReceivedState=${state}, StoredState=${storedState}, InMemoryValid=${isStateValid}`);

        // Resilience: Pass if either memory state or cookie state matches
        if (!state || (!isStateValid && state !== storedState)) {
            console.error(`[AUTH FATAL] CSRF check failed! Host: ${req.headers.host}, UA: ${req.headers["user-agent"]}`);
            res.writeHead(400, { "Content-Type": "text/plain" });
            res.end("Invalid State (CSRF check failed). Please ensure you are using the correct domain and try /login again.");
            return;
        }
        if (state) states.delete(state);

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
                console.error(
                    `❌ OAuth Token Error: ${tokenRes.status} ${tokenRes.statusText}`,
                    text
                );
                throw new Error(`Token exchange failed: ${tokenRes.status} - ${text}`);
            }

            const tokenData = await tokenRes.json();
            const user = await discordApi(tokenData.access_token, "/users/@me");
            if (!user) throw new Error("Failed to fetch user");

            // Create session
            const sid = rand();
            const csrfSecret = rand(32); // Strong CSRF secret

            console.log(
                `[AUTH DEBUG] /callback: Creating session SID=${sid} for User=${user.username} (CSRF Secret: ${csrfSecret.substring(0, 8)}...)`
            );

            const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000);
            const sessionData = {
                accessToken: tokenData.access_token,
                refreshToken: tokenData.refresh_token,
                user,
                csrfSecret,
            };

            await dbQuery(
                "INSERT INTO sessions (sid, data, expires_at) VALUES ($1, $2, $3)",
                [sid, JSON.stringify(sessionData), expiresAt]
            );

            const isSecure = ENV.PUBLIC_URL.startsWith("https");
            
            setCookie(res, "sid", sid, {
                maxAge: tokenData.expires_in,
                httpOnly: true,
                secure: isSecure,
            });

            // CSRF cookie is readable by JS so the client can send it in headers
            // We set it to expire with the session
            setCookie(res, "csrf_token", csrfSecret, {
                maxAge: tokenData.expires_in,
                secure: isSecure,
                httpOnly: false,
                sameSite: "Lax",
            });

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
        if (sid) {
            await dbQuery("DELETE FROM sessions WHERE sid = $1", [sid]);
        }

        delCookie(res, "sid");
        res.writeHead(302, { Location: "/" });
        res.end();
        return;
    }
}
