import test from "node:test";
import assert from "node:assert/strict";

function parseCsvLine(line) {
  const out = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (inQuotes) {
      if (ch === '"') {
        const next = line[i + 1];
        if (next === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === ",") {
      out.push(field);
      field = "";
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }

    field += ch;
  }

  out.push(field);
  return out;
}

test("parseCsvLine handles quoted commas and escaped quotes", () => {
  const line = '"a,1","b""2",c';
  assert.deepEqual(parseCsvLine(line), ["a,1", 'b"2', "c"]);
});

test("Mission_export CSV header parses as expected", () => {
  const headerLine = "id,title,revenue_generated,assigned_agent_ids,created_date,updated_date";
  const header = parseCsvLine(headerLine);
  assert.ok(header.includes("revenue_generated"));
  assert.ok(header.includes("id"));
});
