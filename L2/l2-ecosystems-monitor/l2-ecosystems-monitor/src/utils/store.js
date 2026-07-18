/**
 * Simple JSON file-based data store for persistence.
 * Stores scan state, transaction records, and daily summaries.
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../../data');

/**
 * Ensure the data directory exists.
 */
async function ensureDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

/**
 * Read a JSON file, returning defaultValue if not found.
 */
export async function readJson(filename, defaultValue = null) {
  await ensureDir();
  const filepath = path.join(DATA_DIR, filename);
  try {
    const raw = await fs.readFile(filepath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return defaultValue;
  }
}

/**
 * Write a JSON file atomically.
 */
export async function writeJson(filename, data) {
  await ensureDir();
  const filepath = path.join(DATA_DIR, filename);
  const tmpPath = filepath + '.tmp';
  await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
  await fs.rename(tmpPath, filepath);
}

/**
 * Get the last scanned block for a given network.
 */
export async function getLastScannedBlock(networkKey) {
  const state = await readJson('scan_state.json', {});
  return state[networkKey]?.lastBlock || 0;
}

/**
 * Update the last scanned block for a network.
 */
export async function setLastScannedBlock(networkKey, blockNumber) {
  const state = await readJson('scan_state.json', {});
  if (!state[networkKey]) {
    state[networkKey] = {};
  }
  state[networkKey].lastBlock = blockNumber;
  state[networkKey].updatedAt = new Date().toISOString();
  await writeJson('scan_state.json', state);
}

/**
 * Save transactions for a network + date.
 */
export async function saveTransactions(networkKey, date, transactions) {
  const filename = `txs_${networkKey}_${date}.json`;
  await writeJson(filename, {
    network: networkKey,
    date,
    count: transactions.length,
    transactions,
    savedAt: new Date().toISOString(),
  });
}

/**
 * Load transactions for a network + date.
 */
export async function loadTransactions(networkKey, date) {
  const filename = `txs_${networkKey}_${date}.json`;
  return await readJson(filename, { transactions: [], count: 0 });
}

/**
 * Save daily summary.
 */
export async function saveDailySummary(date, summary) {
  const filename = `summary_${date}.json`;
  await writeJson(filename, {
    date,
    networks: summary,
    generatedAt: new Date().toISOString(),
  });
}

/**
 * Load daily summary.
 */
export async function loadDailySummary(date) {
  const filename = `summary_${date}.json`;
  return await readJson(filename, null);
}

/**
 * List all available transaction files.
 */
export async function listTransactionFiles() {
  await ensureDir();
  const files = await fs.readdir(DATA_DIR);
  return files.filter(f => f.startsWith('txs_') && f.endsWith('.json')).sort();
}

/**
 * List all available summary files.
 */
export async function listSummaryFiles() {
  await ensureDir();
  const files = await fs.readdir(DATA_DIR);
  return files.filter(f => f.startsWith('summary_') && f.endsWith('.json')).sort();
}
