import fs from "node:fs";

const file = "index.js";
const src = fs.readFileSync(file, "utf8");

// 文字列/テンプレ/コメントをざっくり飛ばしつつ括弧だけ追跡する簡易パーサ
const stack = [];
let i = 0;

let mode = "code"; // code | s_quote | d_quote | template | line_comment | block_comment
let templateBraceDepth = 0;

function posToLineCol(pos) {
  const upTo = src.slice(0, pos);
  const lines = upTo.split("\n");
  const line = lines.length;
  const col = lines[lines.length - 1].length + 1;
  return { line, col };
}

while (i < src.length) {
  const ch = src[i];
  const next = src[i + 1];

  // ---- modes ----
  if (mode === "line_comment") {
    if (ch === "\n") mode = "code";
    i++;
    continue;
  }
  if (mode === "block_comment") {
    if (ch === "*" && next === "/") {
      mode = "code";
      i += 2;
      continue;
    }
    i++;
    continue;
  }
  if (mode === "s_quote") {
    if (ch === "\\" && next) {
      i += 2;
      continue;
    }
    if (ch === "'") mode = "code";
    i++;
    continue;
  }
  if (mode === "d_quote") {
    if (ch === "\\" && next) {
      i += 2;
      continue;
    }
    if (ch === '"') mode = "code";
    i++;
    continue;
  }
  if (mode === "template") {
    if (ch === "\\" && next) {
      i += 2;
      continue;
    }
    // ${ ... } の中は code と同じように括弧を追う
    if (ch === "$" && next === "{") {
      stack.push({ kind: "${", pos: i });
      templateBraceDepth++;
      i += 2;
      continue;
    }
    if (ch === "}" && templateBraceDepth > 0) {
      // ${ を閉じる
      const top = stack[stack.length - 1];
      if (top?.kind === "${") {
        stack.pop();
        templateBraceDepth--;
        i++;
        continue;
      }
    }
    if (ch === "`" && templateBraceDepth === 0) {
      mode = "code";
      i++;
      continue;
    }
    i++;
    continue;
  }

  // ---- code mode ----
  if (ch === "/" && next === "/") {
    mode = "line_comment";
    i += 2;
    continue;
  }
  if (ch === "/" && next === "*") {
    mode = "block_comment";
    i += 2;
    continue;
  }
  if (ch === "'") {
    mode = "s_quote";
    i++;
    continue;
  }
  if (ch === '"') {
    mode = "d_quote";
    i++;
    continue;
  }
  if (ch === "`") {
    mode = "template";
    i++;
    continue;
  }

  // push opens
  if (ch === "{" || ch === "(" || ch === "[") {
    stack.push({ kind: ch, pos: i });
    i++;
    continue;
  }

  // pop closes
  if (ch === "}" || ch === ")" || ch === "]") {
    const want = ch === "}" ? "{" : ch === ")" ? "(" : "[";
    const top = stack[stack.length - 1];

    // テンプレ ${ は '}' で閉じるのでここではスキップ（template modeで処理）
    if (top?.kind === "${") {
      // code modeで } が来て ${ を閉じることもある（テンプレ内の式の外に出たケース）
      stack.pop();
      templateBraceDepth = Math.max(0, templateBraceDepth - 1);
      i++;
      continue;
    }

    if (!top || top.kind !== want) {
      const { line, col } = posToLineCol(i);
      console.error(`❌ Unexpected closing "${ch}" at ${file}:${line}:${col}`);
      process.exit(1);
    }
    stack.pop();
    i++;
    continue;
  }

  i++;
}

// modeがcode以外で終わる = 文字列/コメントが閉じてない
if (mode !== "code") {
  console.error(`❌ File ended while still in mode: ${mode} (string/comment/template not closed)`);
  process.exit(1);
}

if (stack.length) {
  const last = stack[stack.length - 1];
  const { line, col } = posToLineCol(last.pos);
  console.error(`❌ Unclosed "${last.kind}" opened at ${file}:${line}:${col}`);
  console.error(`   → likely missing a closing bracket/backtick after this point`);
  process.exit(1);
}

console.log("✅ Looks balanced (no obvious unclosed bracket/string/template/comment).");
