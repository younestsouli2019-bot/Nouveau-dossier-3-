import { loadEnv } from "../load-env.mjs";
import fs from "fs/promises";
import path from "path";

/**
 * SUPREME PURPOSE ENGINE
 *
 * The Swarm does not exist solely for money. Money is fuel.
 * The Purpose is the Destination.
 *
 * This module holds the "Grand Strategy" and "Core Values"
 * that override simple short-term profit maximization.
 *
 * "Efficiency is doing things right; Effectiveness is doing the right things."
 */
export class SupremePurpose {
	constructor() {
		this.manifestoPath = path.resolve(process.cwd(), "docs/SWARM_PURPOSE.md");
		this.directives = [];
		this.isReady = false;
	}

	async load() {
		try {
			const content = await fs.readFile(this.manifestoPath, "utf8");
			this.parseManifesto(content);
			this.isReady = true;
		} catch (e) {
			console.log(
				"[Purpose] No Manifesto found. The Swarm awaits its True Calling.",
			);
			this.isReady = false;
		}
	}

	parseManifesto(content) {
		// Simple parser to extract directives from Markdown lists
		const lines = content.split("\n");
		this.directives = lines
			.filter(
				(line) =>
					line.trim().startsWith("- [ ]") || line.trim().startsWith("- [x]"),
			)
			.map((line) => line.replace(/- \[[x ]\]/, "").trim());

		if (this.directives.length > 0) {
			console.log(
				`[Purpose] Loaded ${this.directives.length} Supreme Directives.`,
			);
		}
	}

	/**
	 * Evaluates a potential action against the Supreme Purpose.
	 * @param {string} actionType - The type of action (e.g., "LAUNCH_CAMPAIGN")
	 * @param {object} context - Details about the action
	 * @returns {boolean} - True if aligned, False if it violates the Purpose
	 */
	evaluate(actionType, context) {
		if (!this.isReady) return true; // Default to "Survival Mode" if no Purpose is set

		// Future Logic: AI analysis of alignment
		// For now, we assume alignment unless explicitly blocked
		return true;
	}

	getMissionStatus() {
		if (!this.isReady) return "Awaiting Revelation";
		return "Active & Aligned";
	}
}

export const supremePurpose = new SupremePurpose();
