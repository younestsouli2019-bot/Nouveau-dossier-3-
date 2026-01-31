import fs from "node:fs/promises";
import path from "node:path";

export class SelfHealer {
	constructor() {
		this.logPath = path.resolve("logs/self-healing.jsonl");
		this.strategies = [
			{
				name: "create_missing_module",
				pattern: /Cannot find module '(.+?)'/,
				action: async (match) => {
					const missingPath = match[1];
					// Safety check: only create files within scripts/ or src/
					if (!missingPath.includes("scripts") && !missingPath.includes("src"))
						return false;

					console.log(
						`[SelfHealer] Detected missing module: ${missingPath}. Attempting stub creation...`,
					);

					// Create a valid stub based on extension
					const content = missingPath.endsWith(".mjs")
						? 'console.log("Stub auto-created by SelfHealer"); export default {};'
						: "";

					try {
						await fs.mkdir(path.dirname(missingPath), { recursive: true });
						await fs.writeFile(missingPath, content);
						return true;
					} catch (e) {
						console.error(`[SelfHealer] Failed to create stub: ${e.message}`);
						return false;
					}
				},
			},
			{
				name: "fix_undefined_method",
				pattern: /TypeError: (?:.*)\.(\w+) is not a function/,
				action: async (match) => {
					// This is harder to fix safely without context, but we can log a structured repair request
					const methodName = match[1];
					console.warn(
						`[SelfHealer] CRITICAL: Method '${methodName}' is missing. Manual intervention or advanced codegen required.`,
					);
					return false; // Cannot safe-fix automatically yet
				},
			},
		];
	}

	async attemptHeal(errorText) {
		for (const strategy of this.strategies) {
			const match = errorText.match(strategy.pattern);
			if (match) {
				const success = await strategy.action(match);
				await this.logHealAttempt(strategy.name, match[0], success);
				if (success) return true;
			}
		}
		return false;
	}

	async logHealAttempt(strategy, error, success) {
		const entry = {
			at: new Date().toISOString(),
			strategy,
			error,
			success,
		};
		try {
			await fs.mkdir(path.dirname(this.logPath), { recursive: true });
			await fs.appendFile(this.logPath, JSON.stringify(entry) + "\n");
		} catch {}
	}
}
