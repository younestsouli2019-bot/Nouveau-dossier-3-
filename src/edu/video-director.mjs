import { getEnvBool, getEnvNumber, liveModeGate } from "./base-client.mjs";

const VIDEO_STYLES = ["documentary", "explainer", "storytelling", "tutorial", "case-study"];

const SCENE_TEMPLATES = {
	hook: { duration: 8, visual: "Cinematic establishing shot, slow camera movement", overlay: "OPENING CLAIM", sound: "Low tension bed" },
	context: { duration: 12, visual: "Archival stills and headlines, cross-fade", overlay: "CONTEXT", sound: "Narration under music" },
	conflict: { duration: 15, visual: "Tension cut between contrasting imagery", overlay: "THE TURNING POINT", sound: "Rising tension" },
	escalation: { duration: 12, visual: "Fast cuts, closer framing", overlay: "ESCALATION", sound: "Driving beat" },
	payoff: { duration: 15, visual: "Wide resolving shot, slow pull-back", overlay: "THE RESULT", sound: "Resolved, warm" },
	cta: { duration: 8, visual: "Branded end-card, subscribe callout", overlay: "WHAT TO WATCH NEXT", sound: "Outro music" },
};

function buildTimeline(script) {
	const scenes = [];
	const hooks = Object.keys(SCENE_TEMPLATES);
	const order = hooks;
	let running = 0;
	for (const key of order) {
		const t = SCENE_TEMPLATES[key];
		const start = running;
		running += t.duration;
		scenes.push({
			id: key,
			start: `00:00:${String(start).padStart(2, "0")}`,
			duration: t.duration,
			visual: t.visual,
			overlay: t.overlay,
			sound: t.sound,
			narration: extractNarration(script, key),
		});
	}
	return scenes;
}

function extractNarration(script, key) {
	const text = String(script ?? "").trim();
	const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
	const pick = lines.find((l) => l.length > 20) ?? `A ${key} beat that carries the story forward.`;
	return pick.slice(0, 120);
}

export class VideoDirector {
	constructor({ style = "documentary", live = false, width = 1920, height = 1080 } = {}) {
		this.style = VIDEO_STYLES.includes(style) ? style : "documentary";
		this.live = live;
		this.width = width;
		this.height = height;
	}

	plan({ title, script = "", hooks = [] } = {}) {
		if (!title) throw new Error("VideoDirector.plan requires a title");
		const timeline = buildTimeline(script);
		return {
			title,
			style: this.style,
			format: `${this.width}x${this.height}`,
			durationSeconds: timeline.reduce((a, s) => a + s.duration, 0),
			hooks: hooks.length > 0 ? hooks : ["How did it get this far?", "The move nobody saw coming", "What happened next changed everything"],
			timeline,
			renderer: {
				preferred: "ffmpeg",
				fallback: "remotion",
				available: getEnvBool("FFMPEG_AVAILABLE", false),
			},
		};
	}

	async run({ title, script, hooks, dryRun = true } = {}) {
		if (!dryRun && !this.live) {
			liveModeGate("VideoDirector.run requires SWARM_LIVE=true for live mode");
		}
		const plan = this.plan({ title, script, hooks });
		return {
			status: dryRun ? "plan_preview" : "render_queued",
			plan,
		};
	}
}

export { buildTimeline, VIDEO_STYLES };
export default VideoDirector;
