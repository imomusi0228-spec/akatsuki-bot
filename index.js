import http from "node:http";
import crypto from "node:crypto";
import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} from "discord.js";

import sqlite3 from "sqlite3";
import { open } from "sqlite";

/* =========================
   ENV
========================= */
const TOKEN = process.env.DISCORD_TOKEN;

const CLIENT_ID = process.env.DISCORD_CLIENT_ID || "";
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || "";
const PUBLIC_URL = process.env.PUBLIC_URL || ""; // 例: https://akatsuki-bot-wix4.onrender.com

const REDIRECT_PATH = "/oauth/callback";
const OAUTH_SCOPES = "identify guilds";

/* =========================
   Path
========================= */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* =========================
   DB（失敗しても落とさない）
========================= */
let db = null;
try {
  db = await open({
    filename: path.join(__dirname, "data.db"),
    driver: sqlite3.Database,
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      guild_id TEXT PRIMARY KEY,
      log_channel_id TEXT,
      ng_threshold INTEGER DEFAULT 3,
      timeout_minutes INTEGER DEFAULT 10
    );
  `);

  console.log("✅ DB ready");
} catch (e) {
  console.error("⚠️ DB init failed (continue without DB):", e?.message ?? e);
  db = null;
}

/* =========================
   Discord Client
========================= */
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

client.once("clientReady", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

/* =========================
   /admin コマンド（管理者だけにボタン）
========================= */
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName !== "admin") return;

  const ok =
    interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator) ||
    interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild);

  if (!ok) {
    return interaction.reply({
      content: "このコマンドは管理者のみ使用できます。",
      flags: MessageFlags.Ephemeral,
    });
  }

  if (!PUBLIC_URL) {
    return interaction.reply({
      content: "PUBLIC_URL が未設定です（RenderのEnvironmentに設定してください）",
      flags: MessageFlags.Ephemeral,
    });
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setLabel("🛠 管理画面を開く")
      .setURL(`${PUBLIC_URL}/admin`)
  );

  return interaction.reply({
    content: "管理画面はこちら：",
    components: [row],
    flags: MessageFlags.Ephemeral,
  });
});

/* =========================
   Web Server + OAuth
========================= */
const sessions = new Map(); // sid -> { accessToken, user, guilds }

function baseUrl(req) {
  const proto = req.headers["x-forwarded-proto"] || "http";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`;
}

function parseCookies(req) {
  const raw = req.headers.cookie || "";
  const out = {};
  raw.split(";").forEach((c) => {
    const [k, v] = c.trim().split("=");
    if (k && v) out[k] = decodeURIComponent(v);
  });
  return out;
}

function setCookie(res, name, value) {
  res.setHeader(
    "Set-Cookie",
    `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Secure`
  );
}
function delCookie(res, name) {
  res.setHeader(
    "Set-Cookie",
    `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure`
  );
}

async function discordApi(token, apiPath) {
  const r = await fetch(`https://discord.com/api/v10${apiPath}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`Discord API ${apiPath} failed: ${r.status}`);
  return r.json();
}

function hasAdminPerm(permStr) {
  try {
    const p = BigInt(permStr || "0");
    const ADMIN = 1n << 3n; // 0x8
    const MANAGE = 1n << 5n; // 0x20
    return (p & ADMIN) !== 0n || (p & MANAGE) !== 0n;
  } catch {
    return false;
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, baseUrl(req));
    const pathname = url.pathname;

    const cookies = parseCookies(req);
    const sid = cookies.sid;
    const session = sid ? sessions.get(sid) : null;

    // --- health ---
    if (pathname === "/health") {
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("ok");
    }

    // --- login ---
    if (pathname === "/login") {
      if (!CLIENT_ID || !CLIENT_SECRET || !PUBLIC_URL) {
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        return res.end("OAuth not configured. Set DISCORD_CLIENT_ID/SECRET and PUBLIC_URL.");
      }

      const redirect = `${PUBLIC_URL}${REDIRECT_PATH}`;
      const u = new URL("https://discord.com/oauth2/authorize");
      u.searchParams.set("client_id", CLIENT_ID);
      u.searchParams.set("response_type", "code");
      u.searchParams.set("redirect_uri", redirect);
      u.searchParams.set("scope", OAUTH_SCOPES);

      res.writeHead(302, { Location: u.toString() });
      return res.end();
    }

    // --- callback ---
    if (pathname === REDIRECT_PATH) {
      const code = url.searchParams.get("code");
      if (!code) {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        return res.end("OAuth error: missing code");
      }

      const redirect = `${PUBLIC_URL}${REDIRECT_PATH}`;

      const body = new URLSearchParams();
      body.set("client_id", CLIENT_ID);
      body.set("client_secret", CLIENT_SECRET);
      body.set("grant_type", "authorization_code");
      body.set("code", code);
      body.set("redirect_uri", redirect);

      const tr = await fetch("https://discord.com/api/v10/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });

      if (!tr.ok) {
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        return res.end(`Token exchange failed: ${tr.status}`);
      }

      const tok = await tr.json();
      const accessToken = tok.access_token;

      const user = await discordApi(accessToken, "/users/@me");
      const guilds = await discordApi(accessToken, "/users/@me/guilds");

      const newSid = crypto.randomBytes(24).toString("hex");
      sessions.set(newSid, { accessToken, user, guilds });

      setCookie(res, "sid", newSid);
      res.writeHead(302, { Location: "/admin" });
      return res.end();
    }

    // --- logout ---
    if (pathname === "/logout") {
      if (sid) sessions.delete(sid);
      delCookie(res, "sid");
      res.writeHead(302, { Location: "/" });
      return res.end();
    }

    // --- admin ---
    if (pathname === "/admin") {
      if (!session) {
        res.writeHead(302, { Location: "/login" });
        return res.end();
      }

      const botGuildIds = new Set(client.guilds.cache.map((g) => g.id));
      const allowed = (session.guilds || []).filter(
        (g) => botGuildIds.has(g.id) && hasAdminPerm(g.permissions)
      );

      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(`
<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><title>Admin</title></head>
<body>
<h2>管理可能なサーバー（あなたが管理権限あり＆Bot導入済み）</h2>
<ul>
  ${allowed.map((g) => `<li>${g.name} (${g.id})</li>`).join("") || "<li>(なし)</li>"}
</ul>
<p><a href="/logout">ログアウト</a></p>
</body></html>`);
    }

    // --- root ---
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Akatsuki Bot is running.");
  } catch (e) {
    console.error("web error:", e?.message ?? e);
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("error");
  }
});

/* =========================
   Start
========================= */
const PORT = Number(process.env.PORT || 3000);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`🌐 Listening on ${PORT}`);
});

if (!TOKEN) {
  console.error("❌ DISCORD_TOKEN 未設定（Botはログインできません）");
} else {
  client.login(TOKEN).catch((e) => console.error("❌ login failed:", e?.message ?? e));
}
