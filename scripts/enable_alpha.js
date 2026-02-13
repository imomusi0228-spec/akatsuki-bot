import { dbQuery, pool } from "../core/db.js";

const guildId = "1467338822051430572";
const features = ["antiraid", "introgate"];

async function run() {
    try {
        console.log(`🚀 Enabling alpha features for guild: ${guildId}`);

        // Ensure settings exist
        const check = await dbQuery("SELECT guild_id FROM settings WHERE guild_id = $1", [guildId]);
        if (check.rows.length === 0) {
            await dbQuery("INSERT INTO settings (guild_id, alpha_features) VALUES ($1, $2)", [guildId, JSON.stringify(features)]);
            console.log("✅ Created new settings with alpha features.");
        } else {
            await dbQuery("UPDATE settings SET alpha_features = $1 WHERE guild_id = $2", [JSON.stringify(features), guildId]);
            console.log("✅ Updated existing settings with alpha features.");
        }

        process.exit(0);
    } catch (e) {
        console.error("❌ Failed to enable alpha features:", e.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

run();
