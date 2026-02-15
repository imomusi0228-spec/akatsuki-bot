import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOCALES_DIR = path.join(__dirname, '../locales');
export const DICTIONARY = {};

// Load all JSON files in locales directory
try {
    const files = fs.readdirSync(LOCALES_DIR);
    files.forEach(file => {
        if (file.endsWith('.json')) {
            const lang = path.basename(file, '.json');
            const content = fs.readFileSync(path.join(LOCALES_DIR, file), 'utf8');
            DICTIONARY[lang] = JSON.parse(content);
        }
    });
} catch (err) {
    console.error('[i18n] Failed to load dictionary:', err);
}

export function t(key, lang = 'ja', params = {}) {
    if (typeof lang === 'object' && !Array.isArray(lang)) {
        params = lang;
        lang = 'ja';
    }
    const dict = DICTIONARY[lang] || DICTIONARY['ja'] || {};
    let text = dict[key] || key;

    Object.keys(params).forEach(p => {
        text = text.replace(`{${p}}`, params[p]);
    });

    return text;
}
