import fs from 'fs';

const path = 'services/views.js';
let content = fs.readFileSync(path, 'utf8');

const fixes = [
    // Header & Logo
    { from: /暁月/g, to: '☾' },
    { from: /暁/g, to: '☾' },

    // Buttons & Icons
    { from: /繝ｻ繝ｻ\/button>/g, to: '＋</button>' },
    { from: /﨟槫翁/g, to: '🔍' },
    { from: /﨟樊兜/g, to: '📥' },

    // Time units
    { from: /1陋ｻ繝ｻ\(60驕倥・/g, to: '1分 (60秒)' },
    { from: /5陋ｻ繝ｻ/g, to: '5分' },
    { from: /10陋ｻ繝ｻ/g, to: '10分' },
    { from: /1隴弱ｋ菫｣/g, to: '1時間' },
    { from: /1隴鯉ｽ･/g, to: '1日' },
    { from: /1鬨ｾ・ｱ鬮｢繝ｻ/g, to: '1週間' },

    // Prices & Features
    { from: /・ゑｽ･/g, to: '¥' },
    { from: /NG郢晢ｽｯ郢晢ｽｼ郢晉甥螳幃ｫｯ繝ｻ/g, to: 'NGワード登録数' },

    // Residuals
    { from: /随ｨ繝ｻ/g, to: '✅' },
    { from: /隨ｨ繝ｻ/g, to: '✅' },
    { from: /随・ｽｼ/g, to: '▼' },
    { from: /隨・ｽｼ/g, to: '▼' }
];

let fixed = content;
fixes.forEach(f => {
    fixed = fixed.replace(f.from, f.to);
});

fs.writeFileSync(path, fixed, 'utf8');
console.log('Surgically repaired views.js');

// Also fix i18n.js
const ipath = 'core/i18n.js';
let icontent = fs.readFileSync(ipath, 'utf8');
let ifixed = icontent.replace(/暁月/g, '☾').replace(/暁/g, '☾');
fs.writeFileSync(ipath, ifixed, 'utf8');
console.log('Repaired i18n.js');
