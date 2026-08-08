import { getEnvOrThrow, getEnvBool, getEnvNumber, eduFetch } from "../edu/base-client.mjs";

export const MODELS = {
	"hermes-4-70b": { provider: "openrouter", model: "nousresearch/hermes-4-70b", label: "Hermes 4 (70B)" },
	"hermes-4-405b": { provider: "openrouter", model: "nousresearch/hermes-4-405b", label: "Hermes 4 (405B)" },
	"kimi-k3": { provider: "moonshot", model: "kimi-k3", label: "Kimi K3" },
	"kimi-k3-openrouter": { provider: "openrouter", model: "moonshotai/kimi-k3", label: "Kimi K3 (OpenRouter)" },
};

export function resolveModel(preference = process.env.WEBSITE_AGENT_MODEL || "auto") {
	const models = ["kimi-k3", "hermes-4-405b", "hermes-4-70b"];
	if (preference !== "auto") {
		const key = preference.toLowerCase().replace(/[-_.]/g, "-");
		if (MODELS[key]) return MODELS[key];
		const byLabel = Object.values(MODELS).find((m) => m.label.toLowerCase() === key);
		if (byLabel) return byLabel;
		throw new Error(`Unknown model preference: ${preference}. Choose from: auto, ${Object.keys(MODELS).join(", ")}`);
	}
	for (const name of models) {
		const m = MODELS[name];
		if (isConfigured(m)) return m;
	}
	throw new Error("No LLM provider configured. Set OPENROUTER_API_KEY or MOONSHOT_API_KEY.");
}

export function isConfigured(model = MODELS["kimi-k3"]) {
	if (model.provider === "openrouter") return Boolean(process.env.OPENROUTER_API_KEY);
	return Boolean(process.env.MOONSHOT_API_KEY);
}

function openRouterKey() {
	return getEnvOrThrow("OPENROUTER_API_KEY");
}

function moonshotKey() {
	return getEnvOrThrow("MOONSHOT_API_KEY");
}

export async function chatCompletion({ model, messages, temperature = 0.4, maxTokens = 4096, jsonMode = false, timeoutMs, fetchImpl }) {
	const modelDef = typeof model === "string" ? MODELS[model] || resolveModel(model) : model;
	if (modelDef.provider === "openrouter") {
		return chatOpenRouter({ modelDef, messages, temperature, maxTokens, jsonMode, timeoutMs, fetchImpl });
	}
	return chatMoonshot({ modelDef, messages, temperature, maxTokens, jsonMode, timeoutMs, fetchImpl });
}

async function chatOpenRouter({ modelDef, messages, temperature, maxTokens, jsonMode, timeoutMs, fetchImpl }) {
	const body = {
		model: modelDef.model,
		messages,
		temperature,
		max_tokens: maxTokens,
		...(jsonMode ? { response_format: { type: "json_object" } } : {}),
	};
	const data = await eduFetch({
		url: "https://openrouter.ai/api/v1/chat/completions",
		method: "POST",
		headers: {
			Authorization: `Bearer ${openRouterKey()}`,
			"Content-Type": "application/json",
		},
		body,
		timeoutMs,
		fetchImpl,
	});
	return parseChat(data, modelDef);
}

async function chatMoonshot({ modelDef, messages, temperature, maxTokens, jsonMode, timeoutMs, fetchImpl }) {
	const body = {
		model: modelDef.model,
		messages,
		temperature,
		max_tokens: maxTokens,
		...(jsonMode ? { response_format: { type: "json_object" } } : {}),
	};
	const data = await eduFetch({
		url: "https://api.moonshot.ai/v1/chat/completions",
		method: "POST",
		headers: {
			Authorization: `Bearer ${moonshotKey()}`,
			"Content-Type": "application/json",
		},
		body,
		timeoutMs,
		fetchImpl,
	});
	return parseChat(data, modelDef);
}

function parseChat(data, modelDef) {
	const choice = data?.choices?.[0];
	const content = choice?.message?.content ?? "";
	return {
		provider: modelDef.provider,
		model: modelDef.model,
		label: modelDef.label,
		content,
		usage: data?.usage ?? null,
		finishReason: choice?.finish_reason ?? null,
	};
}

export function parseJsonReply(content, { fallback = {} } = {}) {
	if (!content) return fallback;
	const trimmed = content.trim();
	if (trimmed.startsWith("{")) {
		try {
			return JSON.parse(trimmed);
		} catch {
			/* fall through to extraction */
		}
	}
	const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
	const candidate = fenced ? fenced[1].trim() : trimmed;
	try {
		return JSON.parse(candidate);
	} catch {
		const objMatch = candidate.match(/\{[\s\S]*\}/);
		if (objMatch) {
			try {
				return JSON.parse(objMatch[0]);
			} catch {
				/* last resort below */
			}
		}
	}
	return fallback;
}

export const PROVIDER_HEALTH = () => ({
	openrouter: isConfigured(MODELS["hermes-4-70b"]) ? "configured" : "unconfigured",
	moonshot: isConfigured(MODELS["kimi-k3"]) ? "configured" : "unconfigured",
});

export function autoModelHint() {
	try {
		const pref = resolveModel("auto");
		return `${pref.label} (${pref.provider}:${pref.model})`;
	} catch {
		return "none (set OPENROUTER_API_KEY or MOONSHOT_API_KEY)";
	}
}

export { getEnvBool, getEnvNumber };
