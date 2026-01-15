
import { ElizaBridge, loadCharacter } from '../src/swarm/eliza-bridge.mjs';

console.log("Testing Eliza Character Loading...");

const orchestrator = loadCharacter('orchestrator.character.json');
if (orchestrator) {
    console.log(`✅ Loaded ${orchestrator.name}`);
    console.log(`   Bio: ${orchestrator.bio[0]}`);
} else {
    console.error("❌ Failed to load Orchestrator");
}

const scout = loadCharacter('scout.character.json');
if (scout) {
    console.log(`✅ Loaded ${scout.name}`);
    console.log(`   Bio: ${scout.bio[0]}`);
} else {
    console.error("❌ Failed to load Scout");
}

const bridge = new ElizaBridge('orchestrator');
console.log("\nSystem Prompt Preview:");
console.log(bridge.getSystemPrompt().slice(0, 200) + "...");
