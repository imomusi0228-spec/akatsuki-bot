import { Client, Collection, GatewayIntentBits, Events } from "discord.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

export const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
    ],
});

client.commands = new Collection();

// Error Handling
client.on(Events.Error, (err) => console.error("❌ Discord Client Error:", err));
client.on(Events.Warn, (msg) => console.warn("⚠️ Discord Client Warning:", msg));
client.on(Events.ShardError, (err) => console.error("❌ Discord Shard Error:", err));
client.on(Events.ShardDisconnect, (event) => console.warn("⚠️ Discord Shard Disconnected:", event));
client.on(Events.Invalidated, () => {
    console.error("❌ Discord Session Invalidated. Exiting to trigger restart.");
    process.exit(1);
});

async function importFile(filePath) {
    return import(pathToFileURL(filePath).href);
}

export async function loadCommands() {
    try {
        const commandsPath = path.join(ROOT_DIR, "commands");
        if (fs.existsSync(commandsPath)) {
            const files = fs.readdirSync(commandsPath).filter((f) => f.endsWith(".js"));
            for (const file of files) {
                const filePath = path.join(commandsPath, file);
                const mod = await importFile(filePath);

                if (mod?.data) {
                    if (Array.isArray(mod.data)) {
                        mod.data.forEach(cmd => {
                            if (cmd?.name && typeof mod.execute === "function") {
                                client.commands.set(cmd.name, mod);
                            }
                        });
                    } else if (mod.data.name && typeof mod.execute === "function") {
                        client.commands.set(mod.data.name, mod);
                    }
                }
            }
            console.log(`✅ Loaded ${client.commands.size} commands.`);
        }
    } catch (e) {
        console.error("❌ Command load failed:", e);
    }
}

/**
 * Initializes and logs into Discord.
 */
export async function startBot() {
    console.log("⏳ Logging into Discord...");

    client.ws.on("error", (err) => console.error("❌ [WS] Error:", err));
    client.ws.on("close", (code, reason) => console.warn(`⚠️ [WS] Closed: ${code} - ${reason}`));
    client.ws.on("reconnecting", () => console.log("🔄 [WS] Reconnecting..."));

    try {
        const { ENV } = await import("../config/env.js");
        if (!ENV.TOKEN) throw new Error("DISCORD_TOKEN is missing");

        await client.login(ENV.TOKEN);
        console.log("✅ Discord login OK");
    } catch (e) {
        console.error("❌ Discord login FAILED:", e);
        throw e;
    }
}
