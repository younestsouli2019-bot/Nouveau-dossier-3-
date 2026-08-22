import { eduFetch, getEnvOrThrow, getEnvBool } from "./base-client.mjs";

const DEFAULT_BASE = "https://rest.learnworlds.com/v1";
const DEFAULT_SCHOOL_BASE = "https://school.learnworlds.com";

export class LearnWorldsClient {
	constructor({
		apiKey,
		clientId,
		clientSecret,
		email,
		schoolDomain,
		baseUrl = DEFAULT_BASE,
		fetchImpl = fetch,
	} = {}) {
		this.apiKey =
			apiKey ?? (getEnvBool("LEARNWORLDS_ENABLED", false) ? getEnvOrThrow("LEARNWORLDS_API_KEY") : process.env.LEARNWORLDS_API_KEY);
		this.clientId = clientId ?? process.env.LEARNWORLDS_CLIENT_ID;
		this.clientSecret = clientSecret ?? process.env.LEARNWORLDS_CLIENT_SECRET;
		this.email = email ?? process.env.LEARNWORLDS_EMAIL;
		this.schoolDomain = schoolDomain ?? process.env.LEARNWORLDS_SCHOOL_DOMAIN;
		this.baseUrl = baseUrl ?? DEFAULT_BASE;
		this.schoolBase = this.schoolDomain
			? this.schoolDomain.startsWith("http")
				? this.schoolDomain
				: `https://${this.schoolDomain}`
			: DEFAULT_SCHOOL_BASE;
		this.fetchImpl = fetchImpl;
		this.token = null;
	}

	_headers() {
		const headers = {
			"Content-Type": "application/json",
		};
		if (this.token) {
			headers.Authorization = `Bearer ${this.token}`;
		} else if (this.apiKey) {
			headers.Authorization = `Bearer ${this.apiKey}`;
		} else if (this.clientId && this.email) {
			headers.Authorization = `Basic ${Buffer.from(`${this.email}:${this.clientId}`).toString("base64")}`;
		}
		return headers;
	}

	async _getAccessToken() {
		if (!this.clientId || !this.clientSecret) {
			throw new Error("LearnWorlds OAuth2 requires clientId + clientSecret (LEARNWORLDS_CLIENT_ID / LEARNWORLDS_CLIENT_SECRET)");
		}
		const tokenUrl = `${this.schoolBase}/api/v2/oauth2/token`;
		const res = await this.fetchImpl(tokenUrl, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				grant_type: "client_credentials",
				client_id: this.clientId,
				client_secret: this.clientSecret,
			}),
		});
		if (!res.ok) {
			const text = await res.text().catch(() => "");
			throw new Error(`LearnWorlds OAuth2 token failed (${res.status}): ${text.slice(0, 300)}`);
		}
		const json = await res.json();
		if (!json?.access_token) throw new Error("LearnWorlds OAuth2 response missing access_token");
		this.token = json.access_token;
		return this.token;
	}

	async _req(path, { method = "GET", body } = {}) {
		if (this.token) {
			/* already authed */
		} else if (this.clientId && this.clientSecret) {
			await this._getAccessToken();
		} else if (!this.apiKey && !(this.clientId && this.email)) {
			throw new Error(
				"LearnWorldsClient requires apiKey (LEARNWORLDS_API_KEY) or OAuth2 clientId+clientSecret or clientId+email",
			);
		}
		return eduFetch({
			url: `${this.baseUrl}${path}`,
			method,
			headers: this._headers(),
			body,
			fetchImpl: this.fetchImpl,
		});
	}

	async listCourses() {
		return this._req("/courses");
	}

	async getCourse(courseId) {
		return this._req(`/courses/${encodeURIComponent(courseId)}`);
	}

	async createCourse({ title, description = "", priceCents = 500, status = "draft", instructor = null } = {}) {
		const body = {
			title,
			description,
			...(priceCents != null ? { price: priceCents / 100 } : {}),
			status,
		};
		if (instructor?.name) {
			body.instructor = {
				name: instructor.name,
				...(instructor.title ? { title: instructor.title } : {}),
			};
			if (instructor.bio) {
				body.about = instructor.bio;
			}
		}
		return this._req("/courses", { method: "POST", body });
	}

	async updateCourse(courseId, patch = {}) {
		return this._req(`/courses/${encodeURIComponent(courseId)}`, { method: "PATCH", body: patch });
	}

	async setCoursePrice(courseId, priceCents) {
		return this.updateCourse(courseId, { price: priceCents / 100 });
	}

	async publishCourse(courseId) {
		return this.updateCourse(courseId, { status: "published" });
	}

	async createSection(courseId, { title, position } = {}) {
		const body = { title, ...(position != null ? { position } : {}) };
		return this._req(`/courses/${encodeURIComponent(courseId)}/sections`, {
			method: "POST",
			body,
		});
	}

	async addVideoUnit(courseId, sectionId, { title, videoId, accessType = "paid" } = {}) {
		const body = {
			title,
			type: "video",
			access_type: accessType,
			content: {
				video_provider: "learnworlds",
				video_id: videoId,
			},
		};
		return this._req(
			`/courses/${encodeURIComponent(courseId)}/sections/${encodeURIComponent(sectionId)}/units`,
			{ method: "POST", body },
		);
	}

	async addQuizUnit(courseId, sectionId, { title, questions = [] } = {}) {
		const body = {
			title,
			type: "quiz",
			access_type: "paid",
			content: { questions },
		};
		return this._req(
			`/courses/${encodeURIComponent(courseId)}/sections/${encodeURIComponent(sectionId)}/units`,
			{ method: "POST", body },
		);
	}

	async addInteractivePointer(courseId, sectionId, { timestamp, text } = {}) {
		const body = {
			title: `Pointer @ ${timestamp}`,
			type: "interactive",
			access_type: "paid",
			content: {
				overlay_type: "text",
				text,
				timestamp,
			},
		};
		return this._req(
			`/courses/${encodeURIComponent(courseId)}/sections/${encodeURIComponent(sectionId)}/units`,
			{ method: "POST", body },
		);
	}

	async addLearningUnit(courseId, { title, contentType = "file", content = "" } = {}) {
		const body = {
			title,
			contentType,
			...(content ? { content } : {}),
		};
		return this._req(`/courses/${encodeURIComponent(courseId)}/learningunits`, {
			method: "POST",
			body,
		});
	}

	async registerWebhook({ event, url } = {}) {
		const body = { event, url };
		return this._req("/webhooks", { method: "POST", body });
	}

	async listOrders({ page = 1, limit = 50 } = {}) {
		return this._req(`/orders?page=${page}&limit=${limit}`);
	}

	async getOrder(orderId) {
		return this._req(`/orders/${encodeURIComponent(orderId)}`);
	}
}

export default LearnWorldsClient;
