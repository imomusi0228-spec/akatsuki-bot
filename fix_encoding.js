import fs from 'fs';

const path = 'services/views.js';
let content = fs.readFileSync(path, 'utf8');

// Known garbled patterns and their fixes
const fixes = [
    { from: /隨假ｽｾ/g, to: '随時' },
    { from: /萵械・萵械・/g, to: '' }, // This was "暁・暁" or something? I'll remove it or fix it.
    { from: /萵械/g, to: '暁' },
    { from: /陇鯉ｽ･陇幢ｽｬ髫ｱ繝ｻ/g, to: '日本語' },
    { from: /﨟槭・﨟槭・/g, to: '' },
    { from: /隨假/g, to: '随時' },
    { from: /隨/g, to: '随' }
];

let fixed = content;
fixes.forEach(f => {
    fixed = fixed.replace(f.from, f.to);
});

// Also ensure specific lines are correct
fixed = fixed.replace(/<span class="lang-switch" onclick="setLang\('en'\)">.*? English<\/span>/g, `<span class="lang-switch" onclick="setLang('en')">English</span>`);
fixed = fixed.replace(/<span class="lang-switch" onclick="setLang\('ja'\)">.*?<\/span>/g, `<span class="lang-switch" onclick="setLang('ja')">日本語</span>`);

fs.writeFileSync(path, fixed, 'utf8');
console.log('Fixed services/views.js encoding and strings.');
