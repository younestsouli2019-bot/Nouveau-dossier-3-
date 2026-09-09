import { renderSlideshow, resolveFfmpeg } from "./video-synthesis.mjs";
import fs from "node:fs";
import path from "node:path";

const dir = "data/generated/visual-intel-smoke-test";
const imgs = ["RWC-VIS-448-HERO.webp", "RWC-VIS-448-THUMB.webp", "RWC-VIS-448-MOD-01.webp", "RWC-VIS-448-MOD-02.webp", "RWC-VIS-448-MOD-03.webp", "RWC-VIS-448-DIAGRAM-01.webp", "RWC-VIS-448-DIAGRAM-02.webp", "RWC-VIS-448-CHEAT.webp"]
	.map((f) => path.join(dir, f))
	.filter((p) => fs.existsSync(p));
console.log("ffmpeg:", resolveFfmpeg());
console.log("images:", imgs.length);
const out = path.join(dir, "RWC-VIS-448-TRAILER.mp4");
const r = await renderSlideshow({ imagePaths: imgs, outPath: out, perImageMs: 3000, transitionMs: 600 });
console.log("RESULT:", JSON.stringify(r));
