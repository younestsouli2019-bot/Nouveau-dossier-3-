import fs from "fs";
import path from "path";

/**
 * Validates if a JSON object conforms to the Eliza Character Protocol.
 * @param {Object} char - The character object.
 * @returns {boolean}
 */
export function validateCharacter(char) {
	if (!char || typeof char !== "object") return false;
	if (typeof char.name !== "string") return false;
	// Basic structural checks
	const arrays = [
		"bio",
		"lore",
		"knowledge",
		"topics",
		"adjectives",
		"postExamples",
	];
	for (const key of arrays) {
		if (char[key] && !Array.isArray(char[key])) return false;
	}
	return true;
}

/**
 * Loads a character file from the data/characters directory.
 * @param {string} filename
 * @returns {Object|null}
 */
export function loadCharacter(filename) {
	const filePath = path.resolve(process.cwd(), "data/characters", filename);
	try {
		if (!fs.existsSync(filePath)) return null;
		const data = fs.readFileSync(filePath, "utf8");
		const char = JSON.parse(data);
		if (validateCharacter(char)) {
			return char;
		}
		console.error(`Invalid Eliza character format: ${filename}`);
		return null;
	} catch (err) {
		console.error(`Failed to load character ${filename}:`, err.message);
		return null;
	}
}

/**
 * Bridges Swarm actions to Eliza actions.
 */
export class ElizaBridge {
	constructor(agentName) {
		this.character = loadCharacter(`${agentName}.character.json`);
		this.context = {};
	}

	getSystemPrompt() {
		if (!this.character) return "";

		const { name, bio, lore } = this.character;
		return `
You are ${name}.
Bio:
${bio.map((b) => "- " + b).join("\n")}

Lore:
${lore.map((l) => "- " + l).join("\n")}
        `.trim();
	}
}
