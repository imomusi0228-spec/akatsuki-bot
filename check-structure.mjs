import fs from "node:fs";

const s = fs.readFileSync("./index.js", "utf8");

let line = 1, col = 0;
let inS = false, inD = false, inB = false; // ', ", `
let inLineC = false, inBlockC = false;
let esc = false;

const stack = [];
let errorMsg = null;

function push(ch) {
  stack.push({ ch, line, col });
}
function pop(expect) {
  const top = stack.pop();
  if (!top) {
    errorMsg = `Extra closing ${expect} at ${line}:${col}`;
    return { ok: false };
  }
  return { ok: true };
}

for (let i = 0; i < s.length; i++) {
  const ch = s[i];
  const next = s[i + 1];

  col++;
  if (ch === "\n") {
    line++;
    col = 0;
    inLineC = false;
    continue;
  }

  if (errorMsg) break;

  if (inLineC) continue;

  if (inBlockC) {
    if (ch === "*" && next === "/") {
      inBlockC = false;
      i++;
      col++;
    }
    continue;
  }

  if (!inS && !inD && !inB) {
    if (ch === "/" && next === "/") {
      inLineC = true;
      i++;
      col++;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockC = true;
      i++;
      col++;
      continue;
    }
  }

  if (esc) {
    esc = false;
    continue;
  }
  if (ch === "\\") {
    esc = true;
    continue;
  }

  if (!inD && !inB && ch === "'") {
    inS = !inS;
    continue;
  }
  if (!inS && !inB && ch === '"') {
    inD = !inD;
    continue;
  }
  if (!inS && !inD && ch === "`") {
    inB = !inB;
    continue;
  }

  // inside strings
  if (inS || inD || inB) {
    // track ${ ... } only inside template
    if (inB && ch === "$" && next === "{") {
      push("${");
      i++;
      col++;
      continue;
    }
    if (inB && ch === "}" && stack.length && stack[stack.length - 1].ch === "${") {
      stack.pop();
      continue;
    }
    continue;
  }

  if (ch === "{") push("{");
  else if (ch === "(") push("(");
  else if (ch === "[") push("[");
  else if (ch === "}") {
    const r = pop("}");
    if (!r.ok) break;
  } else if (ch === ")") {
    const r = pop(")");
    if (!r.ok) break;
  } else if (ch === "]") {
    const r = pop("]");
    if (!r.ok) break;
  }
}

if (errorMsg) {
  console.log(errorMsg);
  process.exit(1);
}

if (inBlockC) {
  console.log("Unclosed block comment /* */");
  process.exit(1);
}
if (inB) {
  console.log("Unclosed template literal ` `");
  process.exit(1);
}
if (inS) {
  console.log("Unclosed single quote ' '");
  process.exit(1);
}
if (inD) {
  console.log('Unclosed double quote " "');
  process.exit(1);
}
if (stack.length) {
  const last = stack[stack.length - 1];
  console.log("Unclosed opener:", last.ch, "opened at", `${last.line}:${last.col}`);
  process.exit(1);
}

console.log("Structure looks balanced (parser error might be elsewhere).");
