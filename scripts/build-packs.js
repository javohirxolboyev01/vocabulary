// data/ dagi to'plamlarni web/packs.js ga yig'adi, shunda ilova serversiz (file:// orqali) ham ochiladi.
// Ishga tushirish: node scripts/build-packs.js
const fs = require("node:fs");
const path = require("node:path");

const dataDir = path.join(__dirname, "..", "data");
const packs = JSON.parse(fs.readFileSync(path.join(dataDir, "packs.json"), "utf-8")).map(({ file, ...pack }) => ({
  ...pack,
  words: JSON.parse(fs.readFileSync(path.join(dataDir, file), "utf-8")),
}));

const out = path.join(__dirname, "..", "web", "packs.js");
fs.writeFileSync(out, `// Avtomatik yaratilgan: node scripts/build-packs.js\nwindow.PACKS = ${JSON.stringify(packs)};\n`);
console.log(`${packs.length} ta to'plam, ${packs.reduce((n, p) => n + p.words.length, 0)} ta so'z -> web/packs.js`);
