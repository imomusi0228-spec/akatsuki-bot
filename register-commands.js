import { REST, Routes } from "discord.js";
import { ENV } from "./config/env.js";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const commands = [];
const commandsPath = path.resolve("commands");
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith(".js"));

export async function registerCommands() {
    // console.log(`Debug: Found ${commandFiles.length} files in commands directory.`);
    for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        // console.log(`Debug: Loading ${file}...`);
        const command = await import(pathToFileURL(filePath).href);
        // console.log(`Debug: Loaded ${file}. Data: ${!!command.data}, Execute: ${!!command.execute}`);

        if (command.data && command.execute) {
            if (Array.isArray(command.data)) {
                command.data.forEach(d => commands.push(d.toJSON()));
            } else {
                commands.push(command.data.toJSON());
            }
        } else {
            console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
        }
    }

    const rest = new REST().setToken(ENV.TOKEN);

    try {
        console.log(`Started refreshing ${commands.length} application (/) commands.`);

        if (ENV.SUPPORT_GUILD_ID) {
            console.log(`[DEV] Registering commands to Guild: ${ENV.SUPPORT_GUILD_ID}`);

            // Clear Global commands to avoid duplicates
            await rest.put(Routes.applicationCommands(ENV.CLIENT_ID), { body: [] });
            console.log(`[DEV] Cleared Global commands.`);

            const data = await rest.put(
                Routes.applicationGuildCommands(ENV.CLIENT_ID, ENV.SUPPORT_GUILD_ID),
                { body: commands },
            );
            console.log(`Successfully reloaded ${data.length} application (/) commands (GUILD).`);
        } else {
            console.log(`[PROD] Registering commands Globablly...`);
            const data = await rest.put(
                Routes.applicationCommands(ENV.CLIENT_ID),
                { body: commands },
            );
            console.log(`Successfully reloaded ${data.length} application (/) commands (GLOBAL).`);
        }

    } catch (error) {
        console.error(error);
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    registerCommands();
}
