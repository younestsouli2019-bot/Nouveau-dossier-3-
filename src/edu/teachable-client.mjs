import { eduFetch, getEnvOrThrow, getEnvBool } from "./base-client.mjs";

const DEFAULT_BASE = "https://api.teachable.com/v1";

export class TeachableClient {
	constructor({ apiKey, baseUrl = DEFAULT_BASE, fetchImpl = fetch } = {}) {
		this.apiKey =
			apiKey ?? (getEnvBool("TEACHABLE_ENABLED", false) ? getEnvOrThrow("TEACHABLE_API_KEY") : process.env.TEACHABLE_API_KEY);
		this.baseUrl = baseUrl ?? DEFAULT_BASE;
		this.fetchImpl = fetchImpl;
	}

	_headers() {
		return {
			apiKey: this.apiKey,
			"Content-Type": "application/json",
		};
	}

	async _req(path, { method = "GET", body } = {}) {
		if (!this.apiKey) {
			throw new Error("TeachableClient requires apiKey (TEACHABLE_API_KEY)");
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

	async createCourse({ name, description = "", priceCents = 500, isPublished = false } = {}) {
		const body = {
			name,
			description,
			...(priceCents != null ? { price_cents: priceCents } : {}),
			...(isPublished ? { is_published: true } : {}),
		};
		return this._req("/courses", { method: "POST", body });
	}

	async updateCourse(courseId, patch = {}) {
		return this._req(`/courses/${encodeURIComponent(courseId)}`, { method: "PATCH", body: patch });
	}

	async setCoursePrice(courseId, priceCents) {
		return this.updateCourse(courseId, { price_cents: priceCents });
	}

	async publishCourse(courseId) {
		return this.updateCourse(courseId, { is_published: true });
	}

	async listSections(courseId) {
		return this._req(`/courses/${encodeURIComponent(courseId)}/sections`);
	}

	async createSection(courseId, { name, position } = {}) {
		return this._req(`/courses/${encodeURIComponent(courseId)}/sections`, {
			method: "POST",
			body: { name, ...(position != null ? { position } : {}) },
		});
	}

	async createLecture(sectionId, { name, description = "" } = {}) {
		return this._req(`/sections/${encodeURIComponent(sectionId)}/lectures`, {
			method: "POST",
			body: { name, description },
		});
	}

	async registerWebhook({ eventName, url, secret } = {}) {
		const body = {
			event_name: eventName,
			url,
			...(secret ? { secret } : {}),
		};
		return this._req("/webhooks", { method: "POST", body });
	}

	async listSales({ page = 1, perPage = 50 } = {}) {
		return this._req(`/sales?page=${page}&per_page=${perPage}`);
	}

	async getSale(saleId) {
		return this._req(`/sales/${encodeURIComponent(saleId)}`);
	}
}

export default TeachableClient;
