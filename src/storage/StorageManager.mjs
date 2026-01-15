import fs from "node:fs";
import path from "node:path";

function ensure() {
  const dir = path.resolve("data");
  const file = path.join(dir, "storage.json");
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify({}), "utf8");
  return file;
}

function readStore() {
  const file = ensure();
  const txt = fs.readFileSync(file, "utf8");
  try {
    const j = JSON.parse(txt);
    return j && typeof j === "object" ? j : {};
  } catch {
    return {};
  }
}

function writeStore(obj) {
  const file = ensure();
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), "utf8");
}

export class StorageManager {
  load(collection, id) {
    const store = readStore();
    const bucket = store[collection] && typeof store[collection] === "object" ? store[collection] : {};
    return bucket[id] || null;
  }
  save(collection, id, record) {
    const store = readStore();
    if (!store[collection] || typeof store[collection] !== "object") store[collection] = {};
    store[collection][id] = record;
    writeStore(store);
    return record;
  }
}
