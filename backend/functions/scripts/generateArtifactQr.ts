/**
 * Offline QR manifest generator for the 15 real artifacts (+ decoys) in seed-data.
 * Writes CSV, JSON, and printable PNGs under seed-output/ without touching Firestore.
 *
 *   npm run generate:qr
 *   npm run generate:qr -- --data ./scripts/seed-data.example.json
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import QRCode from "qrcode";
import { csvField, seedDataSchema } from "./seedGame.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const { values: args } = parseArgs({
  options: {
    data: { type: "string", default: path.join(here, "seed-data.example.json") },
    out: { type: "string" },
  },
});

const dataPath = path.resolve(args.data!);
const data = seedDataSchema.parse(JSON.parse(readFileSync(dataPath, "utf8")));
const outDir = args.out ? path.resolve(args.out) : path.join(here, "..", "seed-output", "artifacts");
mkdirSync(outDir, { recursive: true });

/** Stable QR per artifact key so re-runs produce the same printable codes. */
function qrForKey(key: string): string {
  const fixed = data.artifacts.find((a) => a.key === key)?.qrCode;
  if (fixed) return fixed;
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return `OV-seed-${key}-${hash.toString(36).slice(0, 8)}`;
}

const rows = data.artifacts.map((a) => ({
  key: a.key,
  name: a.name,
  qrType: a.qrType,
  puzzleId: a.puzzleId ?? null,
  areaId: a.areaId ?? null,
  qrCode: qrForKey(a.key),
}));

const csv = [
  "key,name,qrType,puzzleId,qrCode",
  ...rows.map((r) => [r.key, r.name, r.qrType, r.puzzleId ?? "", r.qrCode].map(csvField).join(",")),
];
writeFileSync(path.join(outDir, "artifact-qr-codes.csv"), csv.join("\n") + "\n");
writeFileSync(path.join(outDir, "artifact-qr-codes.json"), JSON.stringify(rows, null, 2) + "\n");

const pngDir = path.join(outDir, "png");
mkdirSync(pngDir, { recursive: true });

for (const row of rows) {
  if (row.qrType !== "correct") continue;
  const pngPath = path.join(pngDir, `${row.key}-${row.qrCode}.png`);
  await QRCode.toFile(pngPath, row.qrCode, {
    width: 512,
    margin: 2,
    errorCorrectionLevel: "M",
  });
}

console.log(`Wrote ${rows.length} artifact QR entries to ${outDir}`);
console.log(`  CSV:  artifact-qr-codes.csv`);
console.log(`  JSON: artifact-qr-codes.json`);
console.log(`  PNGs: png/ (${rows.filter((r) => r.qrType === "correct").length} correct artifacts)`);
console.log("\nScan payload = qrCode column (e.g. OV-seed-a01-...). Run seed against production to register these in Firestore.");
