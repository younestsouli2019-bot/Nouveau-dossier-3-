/**
 * Visual Intelligence for realworldcerts agents.
 *
 * Gives producers "eyes": after generating an image, the agent can
 * (1) caption it via AI Horde keyless CLIP interrogation to confirm
 *     the image actually depicts the intended subject,
 * (2) run an NSFW advisory check,
 * (3) attach the caption + QA verdict to the asset registry.
 *
 * Fail-open by design for the *verdict* (verification failures mark
 * the asset `unverified`, they never fabricate a pass), fail-closed
 * for authenticity: nothing here invents bytes or URLs.
 *
 * AI Horde interrogation API (verified keyless):
 *   POST https://aihorde.net/api/v2/interrogate/async   { forms:[{name:"caption"},{name:"nsfw"}], source_image: <public URL> }
 *   GET  https://aihorde.net/api/v2/interrogate/status/{id}
 */

import fs from "node:fs";
import path from "node:path";

const API = "https://aihorde.net/api/v2";
const HDR_BASE = () => ({
	apikey: process.env.AIHORDE_API_KEY || "0000000000",
	"Content-Type": "application/json",
	"Client-Agent": process.env.AIHORDE_CLIENT_AGENT || "rwc-visual-intel:1.0:email",
});

const DEFAULT_TIMEOUT_MS = (parseInt(process.env.VISUAL_INTEL_TIMEOUT_MS, 10) || 8) * 60 * 1000;

/**
 * Interrogate a public image URL on AI Horde.
 * Returns { caption, nsfw, raw } or throws.
 */
export async function interrogateImageUrl(sourceUrl, { forms = ["caption", "nsfw"], timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
	const HDR = HDR_BASE();
	const submit = await fetch(`${API}/interrogate/async`, {
		method: "POST",
		headers: HDR,
		body: JSON.stringify({
			forms: forms.map((name) => ({ name })),
			source_image: sourceUrl,
			slow_workers: true,
		}),
		signal: AbortSignal.timeout(30000),
	});
	if (!submit.ok) throw new Error(`interrogate submit ${submit.status}: ${(await submit.text()).slice(0, 160)}`);
	const job = await submit.json();
	if (!job.id) throw new Error(`interrogate rejected: ${JSON.stringify(job).slice(0, 160)}`);

	const started = Date.now();
	while (true) {
		if (Date.now() - started > timeoutMs) {
			// best-effort cancel, then fail
			fetch(`${API}/interrogate/status/${job.id}`, { method: "DELETE", headers: HDR }).catch(() => {});
			throw new Error(`interrogate ${job.id} timed out after ${Math.round(timeoutMs / 60000)}min`);
		}
		await new Promise((r) => setTimeout(r, 5000));
		const r = await fetch(`${API}/interrogate/status/${job.id}`, { headers: HDR, signal: AbortSignal.timeout(20000) });
		if (!r.ok) throw new Error(`interrogate status ${r.status}`);
		const st = await r.json();
		if (st.faulted) throw new Error(`interrogate ${job.id} faulted`);
		if (st.done || st.state === "done") {
			const caption = st.forms?.find((f) => f.form === "caption")?.result?.caption || null;
			const nsfw = st.forms?.find((f) => f.form === "nsfw")?.result?.nsfw ?? null;
			return { caption, nsfw, raw: st };
		}
	}
}

/**
 * Token-overlap relevance score in [0,1] between expected subject words
 * and the caption. Uses crude prefix-stem matching so "cyber" matches
 * "cybersecurity", "crypto" matches "cryptocurrency", etc.
 */
function captionRelevance(caption, expected) {
	if (!caption || !expected) return 0;
	const stop = new Set(["a", "an", "the", "of", "and", "or", "with", "on", "in", "for", "to", "at", "by", "is", "are", "as", "that", "this", "image", "picture", "photo", "illustration", "drawing", "background", "black", "white", "multiple", "colors", "word", "new"]);
	const toks = (s) => String(s).toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2 && !stop.has(t));
	const want = [...new Set(toks(expected))];
	if (!want.length) return 0;
	const have = toks(caption);
	const stemHit = (t) => have.some((h) => h === t || (t.length >= 4 && h.length >= 4 && (h.startsWith(t) || t.startsWith(h))));
	const hit = want.filter(stemHit).length;
	return hit / want.length;
}

/**
 * LLM semantic judge: does the CLIP caption plausibly depict the
 * expected subject? Uses OpenRouter when a key is present; returns
 * null when unavailable so the caller falls back to token matching.
 * Strict JSON contract, no fabrication on parse failure.
 */
async function llmJudgeCaption(caption, expectedSubject) {
	const key = process.env.OPENROUTER_API_KEY;
	if (!key || !caption) return null;
	try {
		const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${key}`,
				"Content-Type": "application/json",
				"HTTP-Referer": process.env.RWC_SITE_URL || "https://realworldcerts.com",
				"X-Title": "rwc visual intelligence",
			},
			body: JSON.stringify({
				model: process.env.VISUAL_INTEL_JUDGE_MODEL || "google/gemini-3.5-flash",
				messages: [
					{
						role: "system",
						content: "You judge whether an AI-generated image caption plausibly depicts the intended subject of a course asset. CLIP captions are short and concrete; the intent is abstract (e.g. 'cybersecurity course hero banner'). Answer strictly with JSON: {\"depicts\": true|false, \"confidence\": 0.0-1.0, \"reason\": \"<short>\"}. Be lenient about style/layout; judge subject-matter only.",
					},
					{ role: "user", content: `Intended subject: ${expectedSubject}\nCLIP caption: ${caption}` },
				],
				response_format: { type: "json_object" },
				max_tokens: 800,
			}),
			signal: AbortSignal.timeout(45000),
		});
		if (!res.ok) return null;
		const data = await res.json();
		const txt = data?.choices?.[0]?.message?.content;
		if (!txt) return null;
		const m = JSON.parse(txt);
		if (typeof m.depicts === "boolean") {
			return {
				depicts: m.depicts,
				confidence: typeof m.confidence === "number" ? m.confidence : 0.5,
				reason: String(m.reason || "").slice(0, 200),
				model: data.model || null,
			};
		}
		return null;
	} catch {
		return null;
	}
}

/**
 * Verify a generated image asset against the prompt it was built from.
 * `sourceUrl` must be publicly reachable (the Horde R2 URL right after
 * generation, or the published asset URL later).
 *
 * Returns a verification record; never throws for "cannot verify" —
 * the caller decides policy. Structure:
 *   { status: "verified"|"unverified"|"mismatch", caption, nsfw_advisory, relevance, checked_at }
 */
export async function verifyImageAsset({ sourceUrl, expectedSubject, minRelevance = parseFloat(process.env.VISUAL_INTEL_MIN_RELEVANCE || "0.15") }) {
	const rec = {
		status: "unverified",
		caption: null,
		nsfw_advisory: null,
		relevance: null,
		expected_subject: expectedSubject || null,
		source_url: sourceUrl,
		checked_at: new Date().toISOString(),
		error: null,
	};
	if (!sourceUrl) { rec.error = "no public source URL (interrogation requires a reachable image URL)"; return rec; }
	if (process.env.VISUAL_INTEL_ENABLED === "0") { rec.error = "visual intelligence disabled (VISUAL_INTEL_ENABLED=0)"; return rec; }
	try {
		const { caption, nsfw } = await interrogateImageUrl(sourceUrl);
		rec.caption = caption;
		rec.nsfw_advisory = nsfw; // advisory only: CLIP nsfw classifier is noisy (flags innocuous logos)
		rec.relevance = captionRelevance(caption, expectedSubject);
		// LLM semantic judge (best), token overlap (fallback): an image counts
		// as depicting the subject if either path says yes.
		const judge = await llmJudgeCaption(caption, expectedSubject);
		if (judge) rec.judge = judge;
		if (caption) {
			const tokenPass = rec.relevance >= minRelevance;
			const judgePass = judge ? judge.depicts : null;
			rec.status = (tokenPass || judgePass === true) ? "verified" : "mismatch";
		} else {
			rec.status = "unverified";
			rec.error = "interrogation returned no caption";
		}
	} catch (e) {
		rec.status = "unverified";
		rec.error = e.message;
	}
	return rec;
}
