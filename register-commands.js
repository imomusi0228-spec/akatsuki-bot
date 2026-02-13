import { REST, Routes } from "discord.js";
import { ENV } from "./config/env.js";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const commands = [];
const commandsPath = path.resolve("commands");
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith(".js"));

export async function registerCommands() {
    for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        const command = await import(pathToFileURL(filePath).href);
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

        const data = await rest.put(
            Routes.applicationCommands(ENV.CLIENT_ID),
            { body: commands },
        );

        console.log(`Successfully reloaded ${data.length} application (/) commands.`);
    } catch (error) {
        console.error(error);
    }
}
