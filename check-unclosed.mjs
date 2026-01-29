// check-unclosed.mjs
import fs from "node:fs";

const file = process.argv[2] || "index.js";
const s = fs.readFileSync(file, "utf8");

let line = 1, col = 0;
const stack = [];
let inS = false, inD = false, inT = false;
let inLC = false, inBC = false;
let esc = false;

function push(ch) {
  stack.push({ ch, line, col });
}
function pop(expect) {
  const top = stack[stack.length - 1];
  if (!top || top.ch !== expect) {
    console.log(`❌ Mismatch closing "${expect}" at ${file}:${line}:${col}. Top=`, top);
    process.exit(1);
  }
  stack.pop();
}

for (let i = 0; i < s.length; i++) {
  const ch = s[i];
  const nxt = s[i + 1];

  if (ch === "\n") { line++; col = 0; inLC = false; continue; }
  col++;

  if (inLC) continue;

  if (inBC) {
    if (ch === "*" && nxt === "/") { inBC = false; i++; col++; }
    continue;
  }

  // strings
  if (inS) {
    if (!esc && ch === "'") inS = false;
    esc = !esc && ch === "\\";
    continue;
  }
  if (inD) {
    if (!esc && ch === '"') inD = false;
    esc = !esc && ch === "\\";
    continue;
  }
  if (inT) {
    if (!esc && ch === "`") inT = false;
    esc = !esc && ch === "\\";
    continue;
  }
  esc = false;

  // comment start
  if (ch === "/" && nxt === "/") { inLC = true; i++; col++; continue; }
  if (ch === "/" && nxt === "*") { inBC = true; i++; col++; continue; }

  // string start
  if (ch === "'") { inS = true; continue; }
  if (ch === '"') { inD = true; continue; }
  if (ch === "`") { inT = true; continue; }

  // brackets
  if (ch === "{") push("{");
  if (ch === "(") push("(");
  if (ch === "[") push("[");
  if (ch === "}") pop("{");
  if (ch === ")") pop("(");
  if (ch === "]") pop("[");
}

if (inS || inD || inT || inBC) {
  console.log("❌ Unclosed:", { inS, inD, inT, inBC, file, line, col });
  process.exit(1);
}

if (stack.length) {
  const top = stack[stack.length - 1];
  console.log(`❌ Unclosed "${top.ch}" opened at ${file}:${top.line}:${top.col}`);
  process.exit(1);
}

console.log("✅ No obvious unclosed quote/bracket/comment found.");
