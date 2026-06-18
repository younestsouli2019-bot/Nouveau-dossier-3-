import { WebSearch } from '../../tools/web-search.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * The Strategic Scout agent is responsible for identifying breakthrough opportunities,
 * untapped revenue sources, and areas for innovation that provide societal value
 * and a unique, non-replicable advantage.
 */
export class StrategicScout {
  constructor(config = {}) {
    this.config = config;
    this.memoryPath = path.resolve('data/swarm/scout-memory.json');
    this.webSearch = new WebSearch();
    this.ethicalHeuristics = null;
    this.technicalHeuristics = null;
  }

  async loadHeuristics() {
    const ethicalPath = path.resolve(process.cwd(), 'src/agents/config/ethical-heuristics.json');
    const technicalPath = path.resolve(process.cwd(), 'src/agents/config/technical-heuristics.json');
    
    const ethicalData = await fs.readFile(ethicalPath, 'utf8');
    this.ethicalHeuristics = JSON.parse(ethicalData);

    const technicalData = await fs.readFile(technicalPath, 'utf8');
    this.technicalHeuristics = JSON.parse(technicalData);

    console.log("Strategic Scout: Ethical and technical heuristics loaded.");
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

  async scanForOpportunities() {
    console.log("Strategic Scout: Scanning for opportunities using web search...");
    const queries = [
        "breakthrough technologies 2025",
        "emerging business models with societal benefit",
        "decentralized systems for social good",
        "untapped markets for sustainable technology"
    ];
    let allSignals = [];
    for (const query of queries) {
        const results = await this.webSearch.search(query);
        const summaries = results.map(r => r.summary || r.title);
        allSignals = allSignals.concat(summaries);
    }
    return allSignals;
  }

  conductEthicalAnalysis(proposal) {
    const analysis = {
      summary: [],
      riskScore: 0, // 0-100
      passes: true
    };

    const proposalText = JSON.stringify(proposal).toLowerCase();
    const { negativeKeywords, uniquenessStrengthThreshold } = this.ethicalHeuristics;

    // 1. Non-Exploitation of Societal Needs (Critical Check)
    const foundNegative = negativeKeywords.find(kw => proposalText.includes(kw));
    if (foundNegative) {
      analysis.summary.push(`CRITICAL FAIL: Proposal may be perceived as '${foundNegative}'.`);
      analysis.riskScore += 80;
      analysis.passes = false;
    } else {
      analysis.summary.push("PASS: Proposal aims to serve a societal need without exploitation.");
    }

    // 2. Uniqueness and Non-Replicability (Strategic Check)
    if (!proposal.uniquenessStrategy || proposal.uniquenessStrategy.length < uniquenessStrengthThreshold) {
      analysis.summary.push("WARN: The 'uniqueness' strategy is weak, risking a race-to-the-bottom market if replicated.");
      analysis.riskScore += 30;
      // Note: We don't automatically fail here, allowing for nuanced exceptions if other factors are strong.
    } else {
      analysis.summary.push("PASS: A credible uniqueness strategy is present, ensuring long-term value.");
    }

    if (analysis.riskScore > 50) {
        analysis.passes = false;
    }

    return analysis;
  }

  conductTechnicalAnalysis(proposal) {
    const analysis = {
      summary: [],
      riskScore: 0, // 0-100
      passes: true
    };

    const proposalText = JSON.stringify(proposal).toLowerCase();
    const { promisingKeywords, riskyKeywords } = this.technicalHeuristics;

    const foundRisky = riskyKeywords.find(kw => proposalText.includes(kw));
    if (foundRisky) {
      analysis.summary.push(`FAIL: Proposal includes a risky technology or pattern: '${foundRisky}'.`);
      analysis.riskScore += 50;
    } else {
      analysis.summary.push("PASS: Proposal avoids known risky technologies.");
    }

    const foundPromising = promisingKeywords.some(kw => proposalText.includes(kw));
    if (!foundPromising) {
      analysis.summary.push("WARN: Proposal does not leverage any known promising technologies.");
      analysis.riskScore += 10;
    } else {
      analysis.summary.push("PASS: Proposal leverages promising technologies.");
    }
    
    if (analysis.riskScore > 40) {
        analysis.passes = false;
    }

    return analysis;
  }

  async analyzeAndPropose(signals) {
    console.log("Strategic Scout: Analyzing signals and formulating proposals...");

    const promisingSignal = signals.find(s => s.toLowerCase().includes("decentralized") && s.toLowerCase().includes("societal"));

    if (promisingSignal) {
      const proposal = {
        title: "Proposal: Decentralized Identity for Underserved Populations",
        summary: "Develop a decentralized identity solution using zero-knowledge proofs to provide verifiable credentials to individuals lacking traditional documentation, enabling access to financial and social services.",
        societalValue: "High. Empowers marginalized communities and promotes financial inclusion.",
        uniquenessStrategy: "Build on a novel, patent-pending cryptographic method and establish a non-profit foundation to govern the protocol, creating a strong ethical moat.",
        technicalStrategy: "The solution will be built using Rust and WASM, deployed as a serverless function on a global edge network.",
        nextSteps: [
          "Fund initial research into the proposed cryptographic method.",
          "Develop a proof-of-concept application.",
          "Engage with NGOs and governments for pilot programs."
        ]
      };

      const ethicalAnalysis = this.conductEthicalAnalysis(proposal);
      proposal.ethicalFramework = ethicalAnalysis;

      const technicalAnalysis = this.conductTechnicalAnalysis(proposal);
      proposal.technicalFramework = technicalAnalysis;
      
      if (ethicalAnalysis.passes && technicalAnalysis.passes) {
          console.log("Strategic Scout: A promising opportunity was identified and passed all reviews. Proposal generated.");
          proposal.status = "APPROVED";
          return proposal;
      } else if (ethicalAnalysis.riskScore < 80 && technicalAnalysis.riskScore < 60) {
          console.log(`Strategic Scout: Opportunity identified with warnings. Requires manual review. Ethical Risk: ${ethicalAnalysis.riskScore}, Technical Risk: ${technicalAnalysis.riskScore}`);
          proposal.status = "REVIEW_REQUIRED";
          proposal.reviewNotes = "Automated checks failed but risk is not critical. Evaluated as a potential high-value exception.";
          return proposal;
      } else {
           console.log(`Strategic Scout: Opportunity rejected due to high risk. Ethical Risk: ${ethicalAnalysis.riskScore}, Technical Risk: ${technicalAnalysis.riskScore}`);
           return null;
      }
    }

    console.log("Strategic Scout: No high-potential opportunities identified in this cycle.");
    return null;
  }

  async runCycle() {
    if (!this.ethicalHeuristics || !this.technicalHeuristics) {
      await this.loadHeuristics();
    }

    const signals = await this.scanForOpportunities();
    const proposal = await this.analyzeAndPropose(signals);

    if (proposal) {
      const memory = await this.loadMemory();
      memory.history.push({
          id: `prop_${Date.now()}`,
          type: proposal.title,
          timestamp: Date.now()
      });
      if (memory.history.length > 100) memory.history = memory.history.slice(-100);
      await this.saveMemory(memory);

      console.log("\n--- STRATEGIC PROPOSAL ---");
      console.log(JSON.stringify(proposal, null, 2));
      console.log("--------------------------\n");
    }
    
    return proposal;
  }
}
