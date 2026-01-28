// tools/ephemeral_to_flags.mjs
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const COMMANDS_DIR = path.join(ROOT, "commands");

function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(p));
    else if (ent.isFile() && p.endsWith(".js")) out.push(p);
  }
  return out;
}

function ensureMessageFlagsImportESM(code) {
  // ESM: import { ... } from "discord.js";
  const re = /import\s*\{\s*([^}]+)\s*\}\s*from\s*["']discord\.js["']\s*;?/m;
  const m = code.match(re);
  if (!m) return code;

  const list = m[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!list.includes("MessageFlags")) {
    list.push("MessageFlags");
    const replaced = `import { ${list.join(", ")} } from "discord.js";`;
    code = code.replace(re, replaced);
  }
  return code;
}

function ensureMessageFlagsRequireCJS(code) {
  // CJS: const { ... } = require("discord.js");
  const re = /const\s*\{\s*([^}]+)\s*\}\s*=\s*require\(\s*["']discord\.js["']\s*\)\s*;?/m;
  const m = code.match(re);
  if (!m) return code;

  const list = m[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!list.includes("MessageFlags")) {
    list.push("MessageFlags");
    const replaced = `const { ${list.join(", ")} } = require("discord.js");`;
    code = code.replace(re, replaced);
  }
  return code;
}

function replaceEphemeralToFlags(code) {
  // 1) すでに flags があるケースは壊しやすいので「ephemeral: true」を消すだけにする（安全寄り）
  //    ※ flags を OR して足す自動処理は、文法崩れのリスクがあるためやらない
  // 2) flags が無いオブジェクトなら ephemeral: true を flags: MessageFlags.Ephemeral に置換
  //
  // 対象:
  // - interaction.reply({ ... ephemeral: true ... })
  // - interaction.deferReply({ ... ephemeral: true ... })
  // - interaction.followUp({ ... ephemeral: true ... })

  // a) flags が既にあるオブジェクト：ephemeral: true を削除（カンマ周りも雑に調整）
  code = code.replace(
    /(\bflags\s*:\s*[^,}]+,?\s*)(\bephemeral\s*:\s*true\s*,?\s*)/g,
    (_, flagsPart) => flagsPart
  );
  code = code.replace(
    /(\bephemeral\s*:\s*true\s*,?\s*)(\bflags\s*:\s*[^,}]+,?\s*)/g,
    (_, __, flagsPart) => flagsPart
  );

  // b) flags が無いオブジェクト：ephemeral: true → flags: MessageFlags.Ephemeral
  //   可能な限り `,` を保持
  code = code.replace(
    /\bephemeral\s*:\s*true\b/g,
    "flags: MessageFlags.Ephemeral"
  );

  return code;
}

function looksLikeESM(code) {
  return /\bimport\s+.*from\s+["']discord\.js["']/.test(code);
}

function main() {
  if (!fs.existsSync(COMMANDS_DIR)) {
    console.error(`❌ commands フォルダが見つかりません: ${COMMANDS_DIR}`);
    process.exit(1);
  }

  const files = walk(COMMANDS_DIR);
  if (!files.length) {
    console.log("⚠️ commands 配下に .js が見つかりませんでした");
    return;
  }

  let changed = 0;

  for (const file of files) {
    const before = fs.readFileSync(file, "utf8");
    if (!before.includes("ephemeral: true")) continue;

    let after = before;

    // 置換
    after = replaceEphemeralToFlags(after);

    // MessageFlags の import/require 追加
    if (looksLikeESM(after)) after = ensureMessageFlagsImportESM(after);
    else after = ensureMessageFlagsRequireCJS(after);

    if (after !== before) {
      // バックアップ作成
      const bak = `${file}.bak_ephemeral`;
      if (!fs.existsSync(bak)) fs.writeFileSync(bak, before, "utf8");

      fs.writeFileSync(file, after, "utf8");
      changed++;
      console.log(`✅ updated: ${path.relative(ROOT, file)}`);
      console.log(`   ↳ backup: ${path.relative(ROOT, bak)}`);
    }
  }

  console.log(`\n🎉 Done. changed files: ${changed}`);
  console.log(`（戻すなら *.bak_ephemeral を元に上書きしてください）`);
}

main();
