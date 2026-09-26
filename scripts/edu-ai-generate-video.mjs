import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	resolveBestProvider,
	resolveProviderByName,
	listAvailableProviders,
} from "../src/edu/media/providers/index.mjs";

const HELP = `edu-ai-generate-video.mjs — Generate or synthesize a video via the provider router.

USAGE:
  node scripts/edu-ai-generate-video.mjs --prompt <text> --out <path> [--images img1.png,img2.png] [OPTIONS]

OPTIONS:
  --prompt <text>       Video prompt (used by AI providers; for ffmpeg slideshow it's metadata only).
  --out <path>          Output .mp4 path (required).
  --images <list>       Comma-separated list of image paths. Required for slideshow/FfmpegSlideshowProvider.
  --width <px>          Video width (default: 1280).
  --height <px>         Video height (default: 720).
  --duration <sec>      Target length in seconds (default: 10).
  --audio <path>        Optional narration / music audio file path; muxed as 128k AAC.
  --seed <num>          Optional deterministic seed for AI video providers.
  --model <name>        Override the provider model.
  --provider <name>     Pick specific provider by name (OmniVideoFactory, ArenaAiVideo, FfmpegSlideshowProvider).
                        Default: resolveBestProvider("video") picks the best available.
  --list                List available video providers and exit.
  --help, -h            Show this help message and exit 0.

PROVIDERS (weighted priority, fallback chain: Omni -> Arena -> Ffmpeg):
  - OmniVideoFactory      — OMNI_VIDEO_API_KEY / VIDEO_GEN_API_KEY / REPLICATE_API_TOKEN / GOOGLE_AI_STUDIO_KEY
                            Falls back to ffmpeg slideshow if key absent or API errors.
  - ArenaAiVideo          — ARENA_VIDEO_API_KEY / VIDEO_GEN_API_KEY / RUNWAY_API_KEY
  - FfmpegSlideshowProvider — keyless local ffmpeg (Ken-Burns + xfade). Requires --images.

CACHE: sha256(prompt+images+dims+audio+duration+model) → data/generated/cache/media/<xx>/<hash>.mp4
SPEND: appended NDJSON → data/out/ai-media-spend.ndjson

EXAMPLES:
  node scripts/edu-ai-generate-video.mjs --prompt "an intro" --out ./out.mp4 --images a.png,b.png,c.png
  node scripts/edu-ai-generate-video.mjs --provider FfmpegSlideshowProvider --prompt "-" --out ./deck.mp4 --images ./frames/01.png,./frames/02.png --audio ./narration.mp3 --duration 30
  node scripts/edu-ai-generate-video.mjs --list
`;

function parseArgs(argv) {
	const a = {};
	for (let i = 2; i < argv.length; i++) {
		const k = argv[i];
		if (!k.startsWith("--")) continue;
		const v = argv[i + 1];
		if (v && !v.startsWith("--")) { a[k.slice(2)] = v; i++; }
		else a[k.slice(2)] = true;
	}
	return a;
}

function splitCsv(s) {
	if (!s) return [];
	return String(s).split(",").map((p) => p.trim()).filter(Boolean);
}

async function main(argv) {
	const args = parseArgs(argv);
	if (args.help || args.h) {
		process.stdout.write(HELP);
		process.exit(0);
	}
	if (args.list) {
		const provs = listAvailableProviders("video");
		process.stdout.write("Available video providers (priority order):\n");
		for (const p of provs) {
			process.stdout.write(`  - ${p.providerName} (brand=${p.brandName || "-"}, weight=${p.weight}, free=${p.isFree}, key=${p.hasKey()}, available=${p.isAvailable()})\n`);
		}
		process.exit(provs.length ? 0 : 1);
	}
	if (!args.out) {
		process.stderr.write("error: --out is required. Use --help.\n");
		process.exit(2);
	}
	const outPath = path.isAbsolute(args.out) ? args.out : path.resolve(process.cwd(), args.out);
	const imagePaths = splitCsv(args.images).map((p) => path.isAbsolute(p) ? p : path.resolve(process.cwd(), p));
	const audioPath = args.audio ? (path.isAbsolute(args.audio) ? args.audio : path.resolve(process.cwd(), args.audio)) : null;
	const width = parseInt(args.width, 10) || 1280;
	const height = parseInt(args.height, 10) || 720;
	const durationSec = parseInt(args.duration, 10) || 10;
	const seed = args.seed != null ? parseInt(args.seed, 10) : null;
	if (args.provider && args.provider.toLowerCase().includes("ffmpeg") && !imagePaths.length) {
		process.stderr.write("error: FfmpegSlideshowProvider requires --images.\n");
		process.exit(2);
	}
	const provider = args.provider ? resolveProviderByName("video", args.provider) : resolveBestProvider("video");
	const result = await provider.generate({
		prompt: String(args.prompt || "(no prompt)"),
		imagePaths,
		outPath,
		width,
		height,
		audioPath,
		durationSec,
		seed,
		model: args.model || null,
	});
	process.stdout.write(JSON.stringify({
		ok: true,
		out: result.path,
		cached: Boolean(result.cached),
		provider: result.provider,
		brand: result.brand || null,
		size: fs.existsSync(result.path) ? fs.statSync(result.path).size : 0,
		fallback: result.fallback || null,
		fallbackReason: result.fallbackReason || null,
		audioMuxed: Boolean(audioPath),
	}, null, 2) + "\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main(process.argv).catch((e) => {
		process.stderr.write(`error: ${e?.message || String(e)}\n`);
		process.exit(1);
	});
}
