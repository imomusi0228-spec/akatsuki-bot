
function isKatakanaOnly(s = "") {
    return /^[\u30A0-\u30FF\u30FC\u30FB]+$/u.test(String(s));
}

function findNgPartition(text, words, memo = new Map()) {
    if (text === "") return [];
    if (memo.has(text)) return memo.get(text);
    const sortedWords = [...words].sort((a, b) => b.length - a.length);
    for (const w of sortedWords) {
        if (text.startsWith(w)) {
            const sub = findNgPartition(text.slice(w.length), words, memo);
            if (sub !== null) {
                const res = [w, ...sub];
                memo.set(text, res);
                return res;
            }
        }
    }
    memo.set(text, null);
    return null;
}

function matchNg(content, ngList) {
    const text = String(content ?? "");
    const hits = [];
    for (const w of ngList) {
        if (w.kind === "regex") {
            try {
                const re = new RegExp(w.word, (w.flags || "i").includes("g") ? w.flags : (w.flags || "i") + "g");
                let m;
                while ((m = re.exec(text)) !== null) {
                    hits.push(`/${w.word}/${w.flags || "i"}`);
                    if (re.lastIndex === m.index) re.lastIndex++;
                }
            } catch { }
        }
    }
    const katakanaNg = ngList
        .filter(w => w.kind !== "regex" && isKatakanaOnly(w.word))
        .map(w => w.word.toLowerCase());
    const otherNg = ngList.filter(w => w.kind !== "regex" && !isKatakanaOnly(w.word));
    const katakanaBlocks = text.match(/[\u30A0-\u30FF\u30FC\u30FB]+/g) || [];
    for (const block of katakanaBlocks) {
        const blockLower = block.toLowerCase();
        const partition = findNgPartition(blockLower, katakanaNg);
        if (partition) {
            partition.forEach(w => {
                const found = ngList.find(x => x.kind !== "regex" && x.word.toLowerCase() === w.toLowerCase());
                hits.push(found ? found.word : w);
            });
        }
    }
    const textLower = text.toLowerCase();
    for (const w of otherNg) {
        const needle = String(w.word ?? "").toLowerCase();
        if (needle) {
            let pos = textLower.indexOf(needle);
            while (pos !== -1) {
                hits.push(w.word);
                pos = textLower.indexOf(needle, pos + needle.length);
            }
        }
    }
    return hits;
}

const ngList = [
    { kind: "literal", word: "バカ" },
    { kind: "literal", word: "bad" },
    { kind: "regex", word: "f.ck", flags: "i" }
];

const testCases = [
    { input: "バカはバカでもバカンスに行くようなバカとは相容れないよね", expected: ["バカ", "バカ", "バカ"] },
    { input: "バカンス", expected: [] },
    { input: "bad bad girl", expected: ["bad", "bad"] },
    { input: "fuck and f0ck", expected: ["/f.ck/i", "/f.ck/i"] },
    { input: "バカバカしい", expected: ["バカ", "バカ"] }
];

testCases.forEach((tc, i) => {
    const result = matchNg(tc.input, ngList);
    const ok = JSON.stringify(result.sort()) === JSON.stringify(tc.expected.sort());
    console.log(`Test ${i + 1}: ${ok ? "PASS" : "FAIL"}`);
    if (!ok) {
        console.log(`  Input: ${tc.input}`);
        console.log(`  Expected: ${JSON.stringify(tc.expected)}`);
        console.log(`  Got:      ${JSON.stringify(result)}`);
    }
});
