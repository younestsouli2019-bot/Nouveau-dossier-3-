import fs from "fs";

function load(p) {
  const out = {};
  const t = fs.readFileSync(p, "utf8");
  for (const line of t.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !line.trim().startsWith("#")) out[m[1]] = m[2];
  }
  return out;
}

const a = load(".env");
const b = load(".env2");
const c = load(".env.Legacy");

const keys = Array.from(new Set([...Object.keys(a), ...Object.keys(b), ...Object.keys(c)]));
const railKeys = keys.filter((k) =>
  /API_KEY|SECRET|TOKEN|PASSPHRASE|WISE|PAYPAL|BITGET|BINANCE|BYBIT|CRYPTO|PRIVATE_KEY|FUNDED/i.test(k)
);

const mask = (s) =>
  !s ? "(absent)" : s.length <= 4 ? "****" : s.slice(0, 3) + "..." + s.slice(-3) + `(${s.length})`;

console.log("rail var".padEnd(38), "| .env", "| .env2", "| .Legacy", "| derives");
for (const k of railKeys.sort()) {
  const av = a[k], bv = b[k], cv = c[k];
  let src = [];
  if (av && av !== "") src.push(".env");
  if (bv && bv !== "") src.push(".env2");
  if (cv && cv !== "") src.push(".Legacy");
  const deriv =
    av && bv && av !== bv ? "DIFFERS" :
    av && bv && av === bv ? "SAME" :
    (av && !bv) || (bv && !av) ? "ONE-ONLY" : "none";
  console.log(
    k.padEnd(38), "|", (mask(av)).padEnd(12), "|", (mask(bv)).padEnd(12), "|", (mask(cv) || "").padEnd(11), "|", deriv, src.join(",")
  );
}
