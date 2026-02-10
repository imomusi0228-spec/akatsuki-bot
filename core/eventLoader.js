import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { client } from "./client.js";

async function importFile(filePath) {
    return import(pathToFileURL(filePath).href);
}

export async function loadEvents() {
    const eventsPath = path.resolve("events");
    console.log(`[DEBUG] Loading events from: ${eventsPath}`);

    if (!fs.existsSync(eventsPath)) {
        console.error(`[ERROR] Events directory NOT found at: ${eventsPath}`);
        // Try checking contents of current directory to see structure
        console.log(`[DEBUG] CWD contents:`, fs.readdirSync("."));
        return;
    }

    const files = fs.readdirSync(eventsPath).filter((f) => f.endsWith(".js"));
    console.log(`[DEBUG] Found event files: ${files.join(", ")}`);

    for (const file of files) {
        const filePath = path.join(eventsPath, file);
        const event = await importFile(filePath);
        if (event.default && event.name) {
            if (event.once) {
                client.once(event.name, (...args) => event.default(...args));
            } else {
                client.on(event.name, (...args) => event.default(...args));
            }
            console.log(`✅ Loaded event: ${event.name}`);
        } else {
            console.warn(`[WARNING] Skipped ${file} - missing default export or name property.`);
        }
    }
}
