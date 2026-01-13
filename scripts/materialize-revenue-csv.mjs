import fs from "node:fs";
import path from "node:path";

function parseCsvLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result.map(v => v.trim());
}

function serializeCsvLine(values) {
  return values
    .map(v => {
      const needsQuotes = /[",\r\n]/.test(v);
      const escaped = v.replace(/"/g, '""');
      return needsQuotes ? `"${escaped}"` : escaped;
    })
    .join(",");
}

function readCsv(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split(/\r?\n/).filter(l => l.length > 0);
  const headers = parseCsvLine(lines[0]);
  const rows = lines.slice(1).map(parseCsvLine);
  return { headers, rows };
}

function writeCsv(filePath, headers, rows) {
  const headerLine = serializeCsvLine(headers);
  const body = rows.map(serializeCsvLine).join("\n");
  const output = `${headerLine}\n${body}\n`;
  fs.writeFileSync(filePath, output, "utf8");
}

function materializeProjectedToEarned(headers, rows) {
  const statusIndex = headers.findIndex(
    h => h.toLowerCase() === "status"
  );
  if (statusIndex === -1) {
    return { headers, rows, updatedCount: 0 };
  }
  let updated = 0;
  const newRows = rows.map(cols => {
    const v = cols[statusIndex] ?? "";
    if (v === "projected") {
      const next = [...cols];
      next[statusIndex] = "earned";
      updated++;
      return next;
    }
    return cols;
  });
  return { headers, rows: newRows, updatedCount: updated };
}

function resolveInputOutput(args) {
  const cwd = process.cwd();
  const arg = (name, def) => {
    const ix = args.indexOf(name);
    if (ix !== -1 && args[ix + 1]) return args[ix + 1];
    return def;
  };
  const input = arg(
    "--in",
    path.join(cwd, "RevenueEvent_export (1).csv")
  );
  const output = arg(
    "--out",
    path.join(cwd, "RevenueEvent_export (1).materialized.csv")
  );
  const overwrite = args.includes("--overwrite");
  return { input, output, overwrite };
}

function main() {
  const { input, output, overwrite } = resolveInputOutput(process.argv.slice(2));
  if (!fs.existsSync(input)) {
    console.error(`Input CSV not found: ${input}`);
    process.exit(2);
  }
  const { headers, rows } = readCsv(input);
  const { rows: updatedRows, updatedCount } = materializeProjectedToEarned(headers, rows);
  if (updatedCount === 0) {
    console.log("No rows with status=projected found");
  } else {
    console.log(`Updated rows: ${updatedCount}`);
  }
  if (overwrite && output === input) {
    const backup = `${input}.bak`;
    fs.copyFileSync(input, backup);
    console.log(`Backup written: ${backup}`);
  }
  writeCsv(output, headers, updatedRows);
  console.log(`Output written: ${output}`);
}

main();

