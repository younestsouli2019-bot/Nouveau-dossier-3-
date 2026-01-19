import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Utility to read JSON safely
async function readJson(filePath) {
    try {
        const data = await fs.readFile(filePath, 'utf8');
        return JSON.parse(data);
    } catch {
        return null;
    }
}

async function renderDashboard() {
    console.clear();
    console.log("╔══════════════════════════════════════════════════════════════╗");
    console.log("║               SWARM MISSION CONTROL CENTER                   ║");
    console.log("╚══════════════════════════════════════════════════════════════╝");
    console.log(`\nGenerated: ${new Date().toISOString()}\n`);

    // 1. Load Scout Memory (The Brain)
    const scoutMemory = await readJson(path.resolve('data/swarm/scout-memory.json'));
    console.log("🧠  STRATEGIC SCOUT STATUS");
    console.log("────────────────────────────────────────────────────────────────");
    if (!scoutMemory || !scoutMemory.history || scoutMemory.history.length === 0) {
        console.log("   (No strategic history yet)");
    } else {
        const recent = scoutMemory.history.slice(-5).reverse();
        for (const h of recent) {
            const age = Math.round((Date.now() - h.timestamp) / 60000);
            console.log(`   • [${age}m ago] Proposed: ${h.type} (ID: ${h.id})`);
        }
    }
    console.log("");

    // 2. Load Mission Ledger (The Execution)
    const ledger = await readJson(path.resolve('data/swarm/mission-ledger.json'));
    console.log("🚀  ACTIVE MISSIONS & ORCHESTRATION");
    console.log("────────────────────────────────────────────────────────────────");
    
    if (!ledger || !ledger.missions || ledger.missions.length === 0) {
        console.log("   (No missions executed yet)");
    } else {
        const active = ledger.missions.filter(m => m.status === 'in_progress');
        const completed = ledger.missions.filter(m => m.status === 'completed');
        const failed = ledger.missions.filter(m => m.status === 'failed');

        console.log(`   Summary: ${active.length} Active | ${completed.length} Completed | ${failed.length} Failed\n`);

        if (active.length > 0) {
            console.log("   [ACTIVE MISSIONS]");
            for (const m of active) {
                console.log(`   ► ${m.missionId}: ${m.status.toUpperCase()}`);
                for (const t of m.tasks) {
                    const icon = t.status === 'completed' ? '✅' : t.status === 'failed' ? '❌' : '⏳';
                    console.log(`      ${icon} ${t.action}`);
                }
            }
        } else {
            console.log("   (No active missions currently running)");
        }

        if (completed.length > 0) {
            console.log("\n   [RECENTLY COMPLETED]");
            const recentDone = completed.slice(-3).reverse();
            for (const m of recentDone) {
                console.log(`   ✓ ${m.missionId} (${m.completed_at})`);
            }
        }
    }
    console.log("");

    // 3. System Health (The Body)
    // We can peek at the daemon state if available
    const daemonState = await readJson(path.resolve('.autonomous-state.json'));
    console.log("❤️   SYSTEM VITALS");
    console.log("────────────────────────────────────────────────────────────────");
    if (daemonState) {
        console.log(`   Last Deadman Check: ${new Date(daemonState.lastDeadmanAt).toISOString()}`);
        console.log(`   Consecutive Failures: ${daemonState.consecutiveFailures}`);
        console.log(`   Freeze Active: ${daemonState.freeze?.active ? 'YES ❄️' : 'NO'}`);
        if (daemonState.freeze?.active) {
            console.log(`   ⚠️ FREEZE REASON: ${JSON.stringify(daemonState.freeze.violations)}`);
        }
    } else {
        console.log("   (Daemon state not found)");
    }
    
    console.log("\nPress Ctrl+C to exit.");
}

// Run once if called directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    renderDashboard();
}
