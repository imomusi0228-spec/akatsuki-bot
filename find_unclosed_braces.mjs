import fs from "fs";

const s = fs.readFileSync("index.js", "utf8");

let line = 1, col = 0;

let inS=false,inD=false,inT=false,inLC=false,inBC=false,esc=false;
const BT = String.fromCharCode(96); // `

const stack = []; // { line, col }

for (let i=0; i<s.length; i++) {
  const ch = s[i];
  const nx = s[i+1] || "";

  if (ch === "\n") { line++; col=0; inLC=false; esc=false; continue; }
  col++;

  if (inLC) continue;

  if (inBC) {
    if (ch==="*" && nx==="/") { inBC=false; i++; col++; }
    continue;
  }

  if (inS) {
    if (esc) { esc=false; continue; }
    if (ch==="\\") { esc=true; continue; }
    if (ch=="'") inS=false;
    continue;
  }

  if (inD) {
    if (esc) { esc=false; continue; }
    if (ch==="\\") { esc=true; continue; }
    if (ch=='"') inD=false;
    continue;
  }

  if (inT) {
    if (esc) { esc=false; continue; }
    if (ch==="\\") { esc=true; continue; }
    if (ch===BT) inT=false;
    continue;
  }

  if (ch==="/" && nx==="*") { inBC=true; i++; col++; continue; }
  if (ch==="/" && nx==="/") { inLC=true; continue; }
  if (ch=="'") { inS=true; continue; }
  if (ch=='"') { inD=true; continue; }
  if (ch===BT) { inT=true; continue; }

  if (ch === "{") stack.push({ line, col });
  else if (ch === "}") stack.pop();
}

console.log("Unclosed { count =", stack.length);
console.log("Last unclosed { positions (most recent first):");
stack.slice(-20).reverse().forEach((p, idx) => {
  console.log(`${idx+1}. line ${p.line}, col ${p.col}`);
});
