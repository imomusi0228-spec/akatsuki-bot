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

    for (const file of files) {
        const filePath = path.join(eventsPath, file);
        const module = await importFile(filePath);
        // The file does "export default { ... }", so we need module.default
        const event = module.default;

        if (event && event.name) {
            // function might be named "default", "execute", "run"
            const handler = event.default || event.execute || event.run;
            if (typeof handler !== "function") {
                console.warn(`[WARNING] Skipped ${file} - missing handler function.`);
                continue;
            }

            if (event.once) {
                client.once(event.name, (...args) => handler(...args));
            } else {
                client.on(event.name, (...args) => handler(...args));
            }
            console.log(`✅ Loaded event: ${event.name}`);
        } else {
            console.warn(`[WARNING] Skipped ${file} - missing default export or name property.`);
        }
    }
}
