export function freezeSystem(reason: string) {
	console.error("🚨 OWNER POLICY VIOLATION – SYSTEM FROZEN");
	console.error(reason);
	process.exit(137);
}
