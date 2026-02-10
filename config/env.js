import "dotenv/config";

export const ENV = {
    // Discord
    CLIENT_ID: process.env.DISCORD_CLIENT_ID || "",
    CLIENT_SECRET: process.env.DISCORD_CLIENT_SECRET || "",
    TOKEN: (process.env.DISCORD_TOKEN || "").trim(),

    // Database
    DATABASE_URL: (process.env.DATABASE_URL || "").trim(),

    // Web / OAuth
    ADMIN_TOKEN: process.env.ADMIN_TOKEN || "",
    PUBLIC_URL: (process.env.PUBLIC_URL || "").trim().replace(/\/+$/, ""),
    PORT: process.env.PORT || 3000,

    // Settings Defaults
    DEFAULT_NG_THRESHOLD: Number(process.env.NG_THRESHOLD || 3),
    DEFAULT_TIMEOUT_MIN: Number(process.env.NG_TIMEOUT_MIN || 10),
    TIMEZONE: "Asia/Tokyo",

    // Support Server (always gets Pro+)
    SUPPORT_SERVER_ID: process.env.SUPPORT_SERVER_ID || "",

    // Constants
    OAUTH_SCOPES: "identify guilds",
    REDIRECT_PATH: "/oauth/callback",
};

export const BASE_REDIRECT_URI = ENV.PUBLIC_URL ? `${ENV.PUBLIC_URL}${ENV.REDIRECT_PATH}` : "";
