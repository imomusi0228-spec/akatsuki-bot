import { REST, Routes } from "discord.js";
import { ENV } from "./config/env.js";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const commands = [];
const commandsPath = path.resolve("commands");
const commandFiles = fs.readdirSync(commandsPath).filter((file) => file.endsWith(".js"));

export async function registerCommands() {
    for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        const command = await import(pathToFileURL(filePath).href);

        if ("data" in command && "execute" in command) {
            if (Array.isArray(command.data)) {
                command.data.forEach((d) => commands.push(d.toJSON()));
            } else {
                commands.push(command.data.toJSON());
            }
        } else {
            console.warn(`[WARNING] The command at ${filePath} is missing required properties.`);
        }
    }

    const rest = new REST().setToken(ENV.TOKEN);
    const isGlobal = !process.argv.includes("--dev"); // デフォルトでGlobal登録にする
    const isClear = process.argv.includes("--clear");

    try {
        if (isClear) {
            console.log(`[CLEAR] Clearing ALL application (/) commands...`);
            // Clear Global
            await rest.put(Routes.applicationCommands(ENV.CLIENT_ID), { body: [] });
            console.log(`[CLEAR] Global commands cleared.`);
            // Clear Guild
            if (ENV.SUPPORT_GUILD_ID) {
                await rest.put(
                    Routes.applicationGuildCommands(ENV.CLIENT_ID, ENV.SUPPORT_GUILD_ID),
                    { body: [] }
                );
                console.log(`[CLEAR] Guild commands cleared for ${ENV.SUPPORT_GUILD_ID}.`);
            }
            console.log(`[CLEAR] Successfully cleared all commands. Registration skipped.`);
            return;
        }

        console.log(`Started refreshing ${commands.length} application (/) commands.`);

        if (isGlobal) {
            // GLOBAL REGISTRATION (Production)
            if (ENV.SUPPORT_GUILD_ID) {
                try {
                    console.log(
                        `[Global Mode] Clearing Guild commands for ${ENV.SUPPORT_GUILD_ID} to avoid duplicates...`
                    );
                    await rest.put(
                        Routes.applicationGuildCommands(ENV.CLIENT_ID, ENV.SUPPORT_GUILD_ID),
                        { body: [] }
                    );
                    console.log(`[Global Mode] Cleared Guild commands.`);
                } catch (e) {
                    console.warn(`[WARN] Failed to clear guild commands: ${e.message}`);
                }
            }

            console.log(`[PROD] Registering ${commands.length} commands Globally...`);
            const data = await rest.put(Routes.applicationCommands(ENV.CLIENT_ID), {
                body: commands,
            });
            console.log(`Successfully reloaded ${data.length} application (/) commands (GLOBAL).`);
        } else if (ENV.SUPPORT_GUILD_ID) {
            // GUILD REGISTRATION (Development)
            console.log(
                `[DEV] Registering ${commands.length} commands to Guild (${ENV.SUPPORT_GUILD_ID})...`
            );
            console.log(
                `[NOTE] Guild commands update instantly. Global commands take up to 1 hour.`
            );

            const data = await rest.put(
                Routes.applicationGuildCommands(ENV.CLIENT_ID, ENV.SUPPORT_GUILD_ID),
                { body: commands }
            );
            console.log(`Successfully reloaded ${data.length} application (/) commands (GUILD).`);
        } else {
            // No Guild ID provided, fallback to Global but warn
            console.warn(
                `[WARN] No SUPPORT_GUILD_ID found in .env. Falling back to Global registration.`
            );
            console.log(`[PROD] Registering ${commands.length} commands Globally...`);
            const data = await rest.put(Routes.applicationCommands(ENV.CLIENT_ID), {
                body: commands,
            });
            console.log(`Successfully reloaded ${data.length} application (/) commands (GLOBAL).`);
        }
    } catch (error) {
        console.error(error);
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    registerCommands();
}
