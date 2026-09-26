import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	resolveBestProvider,
	resolveProviderByName,
	listAvailableProviders,
} from "../src/edu/media/providers/index.mjs";

const HELP = `edu-ai-tts.mjs — Text-to-speech synthesis via the provider router.

USAGE:
  node scripts/edu-ai-tts.mjs --text "<phrase>" --out <path.mp3> [OPTIONS]
  node scripts/edu-ai-tts.mjs --input script.txt --out <path.mp3> [OPTIONS]

OPTIONS:
  --text <phrase>       Text to synthesize (required unless --input is used).
  --input <file>        Read text from file instead of --text.
  --out <path>          Output audio path (.mp3 / .wav / .m4a) (required).
  --voice <name>        Voice id or MS neural voice name.
                          VibeVoice/ElevenLabs: 21m00Tcm4TlvDq8ikWAM (Rachel), etc.
                          Edge-TTS: en-US-ChristopherNeural, en-GB-RyanNeural,
                                     fr-FR-HenriNeural, es-ES-AlvaroNeural,
                                     de-DE-ConradNeural, ar-XA-HammadNeural,
                                     zh-CN-YunxiNeural, ja-JP-KeitaNeural
  --language <tag>      BCP-47 language tag used for default voice pick (default: en-US).
  --rate <float>        Speaking rate multiplier (default 1.0; 0.75 slow, 1.25 fast).
  --model <name>        Override the provider TTS model.
  --provider <name>     Pick provider explicitly: VibeVoiceTts or FreeTtsFallback (EdgeTTS).
                        Default: resolveBestProvider("tts") picks VibeVoice when a key is set,
                        otherwise EdgeTTS keyless fallback.
  --list                List available TTS providers and exit.
  --help, -h            Show this help message and exit 0.

PROVIDERS:
  - VibeVoiceTts  (brand alias: ElevenLabs)  — VIBEVOICE_API_KEY / ELEVENLABS_API_KEY / TTS_API_KEY
  - FreeTtsFallback (brand: EdgeTTS)         — keyless via edge-tts python package (pip install edge-tts)

CACHE: sha256(text+voice+language+rate+model) → data/generated/cache/media/<xx>/<hash>.<ext>
SPEND: appended NDJSON → data/out/ai-media-spend.ndjson

EXAMPLES:
  node scripts/edu-ai-tts.mjs --text "Welcome to the course." --out ./narration.mp3
  node scripts/edu-ai-tts.mjs --input script.txt --out ./lesson01.mp3 --provider FreeTtsFallback --voice en-US-ChristopherNeural --rate 0.95
  node scripts/edu-ai-tts.mjs --list
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

async function main(argv) {
	const args = parseArgs(argv);
	if (args.help || args.h) {
		process.stdout.write(HELP);
		process.exit(0);
	}
	if (args.list) {
		const provs = listAvailableProviders("tts");
		process.stdout.write("Available TTS providers (priority order):\n");
		for (const p of provs) {
			process.stdout.write(`  - ${p.providerName} (brand=${p.brandName || "-"}, weight=${p.weight}, free=${p.isFree}, key=${p.hasKey()}, available=${p.isAvailable()})\n`);
		}
		process.exit(provs.length ? 0 : 1);
	}
	let text = "";
	if (args.input) {
		const inputPath = path.isAbsolute(args.input) ? args.input : path.resolve(process.cwd(), args.input);
		if (!fs.existsSync(inputPath)) {
			process.stderr.write(`error: --input file not found: ${inputPath}\n`);
			process.exit(2);
		}
		text = fs.readFileSync(inputPath, "utf8");
	} else if (args.text) {
		text = String(args.text);
	} else {
		process.stderr.write("error: --text or --input is required. Use --help.\n");
		process.exit(2);
	}
	if (!String(text).trim().length) {
		process.stderr.write("error: empty text to synthesize.\n");
		process.exit(2);
	}
	if (!args.out) {
		process.stderr.write("error: --out is required. Use --help.\n");
		process.exit(2);
	}
	const outPath = path.isAbsolute(args.out) ? args.out : path.resolve(process.cwd(), args.out);
	const language = String(args.language || "en-US");
	const rate = parseFloat(args.rate) || 1.0;
	const provider = args.provider ? resolveProviderByName("tts", args.provider) : resolveBestProvider("tts");
	const result = await provider.synthesize({
		text: text.trim(),
		outPath,
		voice: args.voice || null,
		language,
		rate,
		model: args.model || null,
	});
	process.stdout.write(JSON.stringify({
		ok: true,
		out: result.path,
		cached: Boolean(result.cached),
		provider: result.provider,
		brand: result.brand || null,
		size: fs.existsSync(result.path) ? fs.statSync(result.path).size : 0,
		chars: text.trim().length,
		language,
		voice: args.voice || null,
		rate,
	}, null, 2) + "\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main(process.argv).catch((e) => {
		process.stderr.write(`error: ${e?.message || String(e)}\n`);
		process.exit(1);
	});
}
