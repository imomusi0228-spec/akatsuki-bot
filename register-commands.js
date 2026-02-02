
import "dotenv/config";
import pg from "pg";
const { Pool } = pg;
import { Client, GatewayIntentBits, Collection } from "discord.js";
import { syncGuildCommands } from "./service/commands.js";
import { getLicenseTierStrict } from "./service/license.js";

const DATABASE_URL = (process.env.DATABASE_URL || "").trim();
const TOKEN = process.env.DISCORD_TOKEN;

if (!TOKEN) {
    console.error("❌ DISCORD_TOKEN is missing");
    process.exit(1);
}

// Dummy client to fetch guilds
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

async function run() {
    console.log("⏳ Initializing registration...");

    let db = null;
    if (DATABASE_URL) {
        const pool = new Pool({
            connectionString: DATABASE_URL,
            ssl: { rejectUnauthorized: false },
        });
        db = {
            async get(sql, ...params) {
                const r = await pool.query(sql.replace(/\?/g, (_, i) => `$${i + 1}`), params.flat());
                return r.rows[0] ?? null;
            }
        };
    }

    try {
        const MAX_RETRIES = 5;
        let loggedIn = false;
        for (let i = 1; i <= MAX_RETRIES; i++) {
            try {
                console.log(`📡 Discord Login attempt ${i}/${MAX_RETRIES}...`);
                await client.login(TOKEN);
                loggedIn = true;
                break;
            } catch (err) {
                console.warn(`⚠️ Login attempt ${i} failed: ${err.message}`);
                if (i === MAX_RETRIES) throw err;
                await new Promise(r => setTimeout(r, 5000));
            }
        }

        console.log(`✅ Logged in as ${client.user.tag}`);

        const guilds = await client.guilds.fetch();
        console.log(`🏠 Found ${guilds.size} guilds.`);

        for (const [id, guildBase] of guilds) {
            const tier = await getLicenseTierStrict(id, db);
            await syncGuildCommands(id, tier);
        }

        console.log("✅ All commands registered.");
        process.exit(0);
    } catch (e) {
        console.error("❌ Registration failed:", e);
        process.exit(1);
    }
}

run();
