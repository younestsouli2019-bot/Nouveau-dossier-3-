import fs from 'node:fs/promises';
import path from 'node:path';

export class StrategicScout {
    constructor(config = {}) {
        this.config = config;
        this.memoryPath = path.resolve('data/swarm/scout-memory.json');
    }

    async loadMemory() {
        try {
            const data = await fs.readFile(this.memoryPath, 'utf8');
            return JSON.parse(data);
        } catch {
            return { history: [], lastScan: 0 };
        }
    }

    async saveMemory(memory) {
        await fs.mkdir(path.dirname(this.memoryPath), { recursive: true });
        await fs.writeFile(this.memoryPath, JSON.stringify(memory, null, 2));
    }

    async scanSignals(base44Client) {
        // Real Implementation: Analyze Revenue Events
        const signals = [];
        
        try {
            // Read materialized revenue events (if available)
            // In a real production run, we might query Base44 or a local DB.
            // Here we check the local CSV for velocity signals.
            const csvPath = path.resolve('RevenueEvent_export (1).materialized.csv');
            const data = await fs.readFile(csvPath, 'utf8').catch(() => '');
            
            if (data) {
                const lines = data.split('\n');
                const count = lines.length - 1; // minus header
                
                // Signal: High Volume
                if (count > 50) {
                    signals.push({
                        type: 'VELOCITY_OPPORTUNITY',
                        confidence: 0.9,
                        data: {
                            reason: `High revenue event count detected (${count}). Optimization recommended.`,
                            action: "optimize_batch_frequency",
                            metric: count
                        }
                    });
                }

                // Signal: Recurring Pattern (Simplified simulation)
                if (count > 100) {
                     signals.push({
                        type: 'RECURRING_REVENUE_PATTERN',
                        confidence: 0.75,
                        data: {
                            reason: "Detected stable recurring revenue baseline.",
                            action: "propose_forecasting_model"
                        }
                    });
                }
            }
        } catch (e) {
            // fail silently, just no signals
        }

        return signals;
    }

    async generateProposals(signals, memory) {
        const proposals = [];
        const now = Date.now();

        for (const signal of signals) {
            // Dedup logic: Don't propose the same thing within 24h
            const recent = memory.history.find(h => 
                h.type === signal.type && (now - h.timestamp) < 24 * 60 * 60 * 1000
            );

            if (!recent) {
                proposals.push({
                    id: `prop_${now}_${Math.random().toString(36).substr(2, 5)}`,
                    type: signal.type,
                    title: `Strategic Move: ${signal.data.action}`,
                    description: signal.data.reason,
                    priority: signal.confidence > 0.8 ? 'high' : 'medium',
                    status: 'proposed',
                    created_at: new Date().toISOString()
                });
            }
        }
        return proposals;
    }

    async runCycle(base44Client) {
        const memory = await this.loadMemory();
        const signals = await this.scanSignals(base44Client);
        const proposals = await this.generateProposals(signals, memory);

        if (proposals.length > 0) {
            // Record in memory that we made these proposals
            for (const p of proposals) {
                memory.history.push({
                    id: p.id,
                    type: p.type,
                    timestamp: Date.now()
                });
            }
            // Keep memory small
            if (memory.history.length > 100) memory.history = memory.history.slice(-100);
            await this.saveMemory(memory);
        }

        return proposals;
    }
}
