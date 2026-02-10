import fs from 'fs';

const path = 'services/views.js';
let content = fs.readFileSync(path, 'utf8');

// The ultimate fix map
const fixes = [
    // Logo and Title
    { from: /随時 Akatsuki Bot/g, to: '暁 Akatsuki Bot' },
    { from: /随時/g, to: '暁' }, // General fallback for any remaining "随時"

    // Status icons (detected from user's screenshot and logic)
    // "随ｨ繝ｻ" appeared in the user's manual fix.
    // Original might have been ✅ or just a simple check.
    { from: /随ｨ繝ｻ/g, to: '✅' },
    { from: /隨ｨ繝ｻ/g, to: '✅' },

    // Sort icons
    { from: /随・ｽｼ/g, to: '▼' },
    { from: /隨・ｽｼ/g, to: '▼' },

    // Language names
    { from: /隴鯉ｽ･隴幢ｽｬ髫ｱ繝ｻ/g, to: '日本語' },
    { from: /﨟槭・﨟槭・/g, to: '' },

    // Fix the logo color span if it was broken
    { from: /<span style="color:#f91880; margin-right:10px;">暁<\/span>/g, to: '<span style="color:#f91880; margin-right:10px;">暁月</span>' }
];

let fixed = content;
fixes.forEach(f => {
    fixed = fixed.replace(f.from, f.to);
});

// Double check the langBtn area specifically
fixed = fixed.replace(/<span class="lang-switch" onclick="setLang\('en'\)">.*?English<\/span>/g, `<span class="lang-switch" onclick="setLang('en')">English</span>`);
fixed = fixed.replace(/<span class="lang-switch" onclick="setLang\('ja'\)">.*?<\/span>/g, `<span class="lang-switch" onclick="setLang('ja')">日本語</span>`);

// Ensure the title in renderLayout is clean
fixed = fixed.replace(/<title>\${title} \| Akatsuki<\/title>/g, `<title>\${title} | 暁月</title>`);

fs.writeFileSync(path, fixed, 'utf8');
console.log('Successfully restored Akatsuki dignity in views.js');
