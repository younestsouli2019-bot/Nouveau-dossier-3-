import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	resolveBestProvider,
	resolveProviderByName,
	listAvailableProviders,
} from "../src/edu/media/providers/index.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const HELP = `edu-ai-generate-image.mjs — Generate an image via the provider router.

USAGE:
  node scripts/edu-ai-generate-image.mjs --prompt <text> --out <path> [OPTIONS]

OPTIONS:
  --prompt <text>       Image generation prompt (required).
  --out <path>          Output image path (required).
  --width <px>          Width in pixels (default: 1024).
  --height <px>         Height in pixels (default: 1024).
  --seed <num>          Optional deterministic seed.
  --model <name>        Override the provider model.
  --provider <name>     Pick specific provider by name (e.g. PlaygroundImage, Together, OpenRouter, AiHorde, DeepAiDesignArena, Pollinations).
  --list                List available image providers and exit.
  --no-cache            Skip sha256 cache read/write for this run.
  --help, -h            Show this help message and exit 0.

PROVIDERS (weighted priority, free first when tied):
  - PlaygroundImage (alias Pollinations) — keyless free (image.pollinations.ai)
  - DeepAiDesignArena — DEEPAI_API_KEY / IMAGE_GEN_API_KEY
  - TogetherImageProvider — IMAGE_GEN_API_KEY
  - AiHorde — AIHORDE_ENABLED=1 keyless crowd GPU pool
  - OpenRouterImageProvider — OPENROUTER_API_KEY

CACHE: sha256(prompt+dimensions+seed+model) → data/generated/cache/media/<xx>/<hash>.<ext>
SPEND: appended NDJSON → data/out/ai-media-spend.ndjson

EXAMPLES:
  node scripts/edu-ai-generate-image.mjs --prompt "a clean diagram" --out ./diagram.png
  node scripts/edu-ai-generate-image.mjs --prompt "cinematic hero banner" --out ./hero.png --width 1536 --height 864
  node scripts/edu-ai-generate-image.mjs --list
`;

function parseArgs(argv) {
	const a = {};
	for (let i = 2; i < argv.length; i++) {
		const k = argv[i];
		if (!k.startsWith("--")) continue;
		const name = k.startsWith("--no-") ? k.slice(2) : k.slice(2);
		const v = argv[i + 1];
		if (k.startsWith("--no-")) { a[name.replace(/^no-/, "")] = false; i--; }
		else if (v && !v.startsWith("--")) { a[name] = v; i++; }
		else a[name] = true;
	}
	return a;
}

async function main(argv) {
	const args = parseArgs(argv);
	if (args.help || args.h) {
		process.stdout.write(HELP);
		process.exit(0);
	}
	if (args.list) {
		const provs = listAvailableProviders("image");
		process.stdout.write("Available image providers (priority order):\n");
		for (const p of provs) {
			process.stdout.write(`  - ${p.providerName} (brand=${p.brandName || "-"}, weight=${p.weight}, free=${p.isFree}, key=${p.hasKey()})\n`);
		}
		process.exit(provs.length ? 0 : 1);
	}
	if (!args.prompt) {
		process.stderr.write("error: --prompt is required. Use --help.\n");
		process.exit(2);
	}
	if (!args.out) {
		process.stderr.write("error: --out is required. Use --help.\n");
		process.exit(2);
	}
	const outPath = path.isAbsolute(args.out) ? args.out : path.resolve(process.cwd(), args.out);
	const width = parseInt(args.width, 10) || 1024;
	const height = parseInt(args.height, 10) || 1024;
	const seed = args.seed != null ? parseInt(args.seed, 10) : null;
	const provider = args.provider ? resolveProviderByName("image", args.provider) : resolveBestProvider("image");
	const useCache = args.cache !== false;
	if (!useCache) {
		const originalRead = provider.cacheRead.bind(provider);
		provider.cacheRead = () => null;
	}
	const result = await provider.generate({ prompt: String(args.prompt), outPath, width, height, seed, model: args.model || null });
	process.stdout.write(JSON.stringify({
		ok: true,
		out: result.path,
		cached: Boolean(result.cached),
		provider: result.provider,
		brand: result.brand || null,
		size: fs.existsSync(result.path) ? fs.statSync(result.path).size : 0,
		publicUrl: result.publicUrl || null,
		censored: result.censored || false,
	}, null, 2) + "\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main(process.argv).catch((e) => {
		process.stderr.write(`error: ${e?.message || String(e)}\n`);
		process.exit(1);
	});
}
