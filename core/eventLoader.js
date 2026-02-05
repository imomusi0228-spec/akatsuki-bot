import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { client } from "./client.js";

async function importFile(filePath) {
    return import(pathToFileURL(filePath).href);
}

export async function loadEvents() {
    const eventsPath = path.resolve("events");
    if (!fs.existsSync(eventsPath)) return;

    const files = fs.readdirSync(eventsPath).filter((f) => f.endsWith(".js"));
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
        }
    }
}
