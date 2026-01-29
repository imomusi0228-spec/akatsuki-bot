import fs from "node:fs";

const file = process.argv[2] || "index.js";
const s = fs.readFileSync(file, "utf8");

let line = 1, col = 0;
let mode = "code"; // code | sq | dq | tpl | linec | blockc
let tplDepth = 0;

const stack = [];
let linecStart = null; // {line,col}

function push(ch) { stack.push({ ch, line, col }); }
function pop(expected) {
  const top = stack.pop();
  if (!top || top.ch !== expected) {
    console.log(`Mismatch at ${line}:${col}. expected close for ${expected}, got ${top?.ch ?? "none"}`);
    process.exit(1);
  }
}

for (let i = 0; i < s.length; i++) {
  const ch = s[i];
  const next = s[i + 1] || "";

  if (ch === "\n") {
    line++;
    col = 0;
    if (mode === "linec") mode = "code";
    continue;
  }
  col++;

  if (mode === "linec") continue;
  if (mode === "blockc") { if (ch === "*" && next === "/") { i++; col++; mode = "code"; } continue; }

  if (mode === "sq") { if (ch === "\\") { i++; col++; continue; } if (ch === "'") mode = "code"; continue; }
  if (mode === "dq") { if (ch === "\\") { i++; col++; continue; } if (ch === '"') mode = "code"; continue; }
  if (mode === "tpl") {
    if (ch === "\\") { i++; col++; continue; }
    if (ch === "`" && tplDepth === 0) { mode = "code"; continue; }
    if (ch === "$" && next === "{") { tplDepth++; push("{"); i++; col++; continue; }
    if (ch === "}" && tplDepth > 0) { tplDepth--; pop("{"); continue; }
    continue;
  }

  if (ch === "/" && next === "/") { mode = "linec"; linecStart = { line, col }; i++; col++; continue; }
  if (ch === "/" && next === "*") { mode = "blockc"; i++; col++; continue; }

  if (ch === "'") { mode = "sq"; continue; }
  if (ch === '"') { mode = "dq"; continue; }
  if (ch === "`") { mode = "tpl"; tplDepth = 0; continue; }

  if (ch === "{") push("{");
  else if (ch === "(") push("(");
  else if (ch === "[") push("[");
  else if (ch === "}") pop("{");
  else if (ch === ")") pop("(");
  else if (ch === "]") pop("[");
}

if (mode === "linec" && linecStart) {
  console.log(`❗ File ended while inside // line comment that started at ${linecStart.line}:${linecStart.col}`);
}

if (mode !== "code" && mode !== "linec") {
  console.log(`❗ File ended while inside mode=${mode} (string/comment/template not closed).`);
}

if (stack.length) {
  console.log("Unclosed opens (most recent first):");
  for (let i = stack.length - 1; i >= 0; i--) {
    const t = stack[i];
    console.log(`  ${t.ch} at ${t.line}:${t.col}`);
  }
  process.exit(2);
}

console.log("✅ No unclosed brackets/backticks detected (outside comments/strings).");
