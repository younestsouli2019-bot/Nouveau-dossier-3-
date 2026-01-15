import fs from "node:fs/promises";
import path from "node:path";

async function main() {
  const offlinePath = ".base44-offline-store.json";
  const outputPath = "RevenueEvent_offline_flush.csv";
  
  try {
    const raw = await fs.readFile(offlinePath, "utf8");
    const data = JSON.parse(raw);
    const events = data.entities?.RevenueEvent?.records || [];
    
    if (events.length === 0) {
      console.log("No offline revenue events found.");
      return;
    }

    console.log(`Found ${events.length} offline revenue events.`);

    const headers = [
      "event_id", "event_hash", "source", "source_id", "amount", "currency", 
      "status", "confirmation_date", "reconciliation_key", "payout_batch_id", 
      "notes", "metadata", "id", "created_date", "updated_date", 
      "created_by_id", "created_by", "is_sample"
    ];

    const rows = events.map(evt => {
      // Map offline event fields to CSV columns
      return [
        evt.event_id || "",
        evt.event_hash || "",
        evt.source || "",
        evt.source_id || "",
        evt.amount || "",
        evt.currency || "USD",
        "earned", // Force status to earned for flushing
        evt.confirmation_date || "",
        evt.reconciliation_key || "",
        evt.payout_batch_id || "",
        evt.notes || "",
        typeof evt.metadata === 'object' ? JSON.stringify(evt.metadata).replace(/"/g, '""') : "", // Escape quotes for CSV
        evt.id || "",
        evt.created_date || new Date().toISOString(),
        evt.updated_date || new Date().toISOString(),
        evt.created_by_id || "offline_sync",
        evt.created_by || "offline_sync",
        evt.is_sample || "false"
      ].map(v => `"${v}"`).join(","); // Quote all fields
    });

    const csvContent = headers.join(",") + "\n" + rows.join("\n");
    await fs.writeFile(outputPath, csvContent, "utf8");
    console.log(`Exported offline events to ${outputPath}`);
    console.log("You can now run materialize-revenue-csv.mjs on this file if needed, or ingest it directly.");

  } catch (err) {
    console.error("Error flushing offline store:", err);
  }
}

main();
