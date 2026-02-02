import { REST, Routes } from "discord.js";
import { data as cmdActivity } from "../commands/activity.js";
import { data as cmdAdmin } from "../commands/admin.js";
import { data as cmdLicense } from "../commands/license.js";
import { data as cmdNgword } from "../commands/ngword.js";
import { data as cmdPing } from "../commands/ping.js";
import { data as cmdScan } from "../commands/scan.js";
import { data as cmdSetlog } from "../commands/setlog.js";
import { data as cmdVc } from "../commands/vc.js";
import { data as cmdDebug } from "../commands/debug_tier.js";
import { data as cmdUntimeout } from "../commands/untimeout.js";
import { isTierAtLeast } from "../utils/common.js";

// Command Definitions
const COMMANDS = {
    free: [
        cmdSetlog,
        cmdVc,
        cmdPing,
        cmdNgword,
        cmdAdmin // Freeでも表示させる
    ],
    pro: [
        cmdActivity,
        cmdUntimeout
    ],
    pro_plus: [
        cmdScan
    ]
};

// Remove undefined commands just in case
COMMANDS.free = COMMANDS.free.filter(c => !!c);
COMMANDS.pro = COMMANDS.pro.filter(c => !!c);
COMMANDS.pro_plus = COMMANDS.pro_plus.filter(c => !!c);

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;

if (!TOKEN || !CLIENT_ID) {
    console.error("❌ Missing DISCORD_TOKEN or DISCORD_CLIENT_ID for command sync.");
}

const rest = new REST({ version: "10" }).setToken(TOKEN);

/**
 * Get list of commands for a specific tier
 */
export function getCommandsForTier(tier = "free", guildId = "") {
    let cmds = [...COMMANDS.free];

    if (isTierAtLeast(tier, "pro")) {
        cmds.push(...COMMANDS.pro);
    }

    if (isTierAtLeast(tier, "pro_plus")) {
        cmds.push(...COMMANDS.pro_plus);
    }

    // Special Filter: License & Debug command only for specific server
    const VERIFICATION_GUILD_ID = "1467338822051430572";
    if (guildId !== VERIFICATION_GUILD_ID) {
        cmds = cmds.filter(c => c.name !== "license" && c.name !== "debug_tier");
    }

    return cmds.map(c => c.toJSON());
}

/**
 * Sync commands for a specific guild based on its tier
 * @param {string} guildId 
 * @param {string} tier 
 */
export async function syncGuildCommands(guildId, tier) {
    if (!guildId || !TOKEN || !CLIENT_ID) return;

    try {
        const body = getCommandsForTier(tier, guildId);
        console.log(`🔄 Syncing commands for guild ${guildId} (Tier: ${tier}, Count: ${body.length})`);

        await rest.put(
            Routes.applicationGuildCommands(CLIENT_ID, guildId),
            { body }
        );
        // console.log(`✅ Synced commands for ${guildId}`);
    } catch (e) {
        console.error(`❌ Failed to sync commands for ${guildId}:`, e.message);
    }
}

// Helper to remove global commands (run once)
export async function clearGlobalCommands() {
    if (!TOKEN || !CLIENT_ID) return;
    try {
        console.log("🧹 Clearing GLOBAL commands...");
        await rest.put(Routes.applicationCommands(CLIENT_ID), { body: [] });
        console.log("✅ Global commands cleared.");
    } catch (e) {
        console.error("❌ Failed to clear global commands:", e);
    }
}

// Temporary placeholder for cmdHelp since it wasn't imported above but referenced
// If you have a help command, import it. If not, ignore.
const cmdHelp = null;
