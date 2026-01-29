const fs = require("fs");

const s = fs.readFileSync("index.js", "utf8");

let line = 1, col = 0;
let par = 0, bra = 0, brk = 0;

let inS = false, inD = false, inT = false;
let inLC = false, inBC = false;
let esc = false;

const BT = String.fromCharCode(96); // backtick

function snippet(i) {
  const from = Math.max(0, i - 80);
  const to = Math.min(s.length, i + 80);
  return s.slice(from, to).replace(/\r/g, "");
}

for (let i = 0; i < s.length; i++) {
  const ch = s[i];
  const nx = s[i + 1] || "";

  if (ch === "\n") {
    line++; col = 0;
    inLC = false;
    esc = false;
    continue;
  }
  col++;

  // line comment
  if (inLC) continue;

  // block comment
  if (inBC) {
    if (ch === "*" && nx === "/") { inBC = false; i++; col++; }
    continue;
  }

  // single-quote string
  if (inS) {
    if (esc) { esc = false; continue; }
    if (ch === "\\") { esc = true; continue; }
    if (ch === "'") { inS = false; }
    continue;
  }

  // double-quote string
  if (inD) {
    if (esc) { esc = false; continue; }
    if (ch === "\\") { esc = true; continue; }
    if (ch === '"') { inD = false; }
    continue;
  }

  // template string (simple: ignores ${} nesting; good enough to find early unmatched ')')
  if (inT) {
    if (esc) { esc = false; continue; }
    if (ch === "\\") { esc = true; continue; }
    if (ch === BT) { inT = false; }
    continue;
  }

  // enter comment/string states
  if (ch === "/" && nx === "*") { inBC = true; i++; col++; continue; }
  if (ch === "/" && nx === "/") { inLC = true; continue; }
  if (ch === "'") { inS = true; continue; }
  if (ch === '"') { inD = true; continue; }
  if (ch === BT) { inT = true; continue; }

  // count brackets
  if (ch === "(") par++;
  else if (ch === ")") {
    par--;
    if (par < 0) {
      console.log(`UNMATCHED ) at ${line}:${col}`);
      console.log(snippet(i));
      process.exit(0);
    }
  } else if (ch === "{") bra++;
  else if (ch === "}") bra--;
  else if (ch === "[") brk++;
  else if (ch === "]") brk--;
}

console.log("NO early unmatched ) found.");
console.log("END balances:", { par, bra, brk, inT, inS, inD, inBC });
