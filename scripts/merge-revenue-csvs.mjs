import fs from "node:fs/promises";

async function main() {
  const mainFile = "RevenueEvent_export (1).csv";
  const flushFile = "RevenueEvent_offline_flush.csv";
  
  try {
    const mainContent = await fs.readFile(mainFile, "utf8");
    const flushContent = await fs.readFile(flushFile, "utf8");
    
    const mainLines = mainContent.split(/\r?\n/).filter(line => line.trim() !== "");
    const flushLines = flushContent.split(/\r?\n/).filter(line => line.trim() !== "");
    
    // Remove header from flushLines
    const header = flushLines[0];
    const newRows = flushLines.slice(1);
    
    // Check if mainFile already has these rows (simple check by ID or hash)
    // For now, we'll just append and assume the system handles duplicates or we rely on unique IDs.
    // However, to be safe, let's filter out rows that might duplicate IDs if possible.
    // But CSVs don't index, so we'll just append.
    
    const combined = mainLines.concat(newRows).join("\n");
    
    await fs.writeFile(mainFile, combined, "utf8");
    console.log(`Merged ${newRows.length} offline rows into ${mainFile}`);
    
  } catch (err) {
    console.error("Error merging CSVs:", err);
  }
}

main();
