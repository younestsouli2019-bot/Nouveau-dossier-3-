import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

const CHAIN_SALT_HEX = crypto
  .createHash("sha256")
  .update("AUTHORITATIVE_CHAIN_V1")
  .digest("hex");

export const AUTHORITATIVE_LEDGER_PATH = path.resolve(
  "data/out/authoritative-ledger.ndjson",
);

export type AuthoritativeEventType =
  | "sales.order.created"
  | "sales.payment.verified"
  | "sales.delivery.completed"
  | "sales.refund.issued"
  | "sales.order.abandoned"
  | "payout.initiated"
  | "payout.pending_provider"
  | "payout.completed"
  | "payout.failed"
  | "payout.needs_manual_proof"
  | "reconciliation.discrepancy.opened"
  | "reconciliation.discrepancy.resolved"
  | "system.ledger.bootstrapped"
  | "system.ledger.checksum_mismatch";

const TYPE_REGEX = /^[a-z]+\.[a-z_]+\.[a-z_]+$/;

export interface AuthoritativeLedgerEventV1 {
  schema: "authoritative-ledger-event-v1";
  id: string;
  type: AuthoritativeEventType;
  ts: string;
  payload: Record<string, unknown>;
}

export interface AuthoritativeLedgerLine {
  event: AuthoritativeLedgerEventV1;
  prevHash: string;
  hash: string;
  sig: string;
}

function hmacSha256(key: Buffer, data: string): string {
  return crypto.createHmac("sha256", key).update(data).digest("hex");
}

function sha256Hex(data: string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function sortedReplacer(_key: string, value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(obj).sort()) sorted[k] = obj[k];
    return sorted;
  }
  if (Array.isArray(value)) {
    return value.map((v, i) => sortedReplacer(String(i), v));
  }
  return value;
}

function sortedJsonStringify(obj: unknown): string {
  return JSON.stringify(sortedReplacer("", obj));
}

function chainKeyStatic(): Buffer {
  return crypto
    .createHash("sha256")
    .update("HKDF|authoritative-ledger|" + CHAIN_SALT_HEX)
    .digest();
}

function acquireLockSync(lockDir: string): () => void {
  try {
    fs.mkdirSync(lockDir, { recursive: true });
  } catch {
    // already exists — another process may hold it, we still try
  }
  const lockFile = path.join(lockDir, "ledger.lock");
  let acquired = false;
  for (let attempt = 0; attempt < 10 && !acquired; attempt++) {
    try {
      const fd = fs.openSync(lockFile, "wx");
      fs.writeSync(
        fd,
        JSON.stringify({
          pid: process.pid,
          ts: new Date().toISOString(),
        }),
      );
      fs.closeSync(fd);
      acquired = true;
    } catch {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
  }
  if (!acquired) {
    throw new Error(
      "AUTHORITATIVE_LEDGER_LOCK_TIMEOUT could not acquire ledger lock after 10 attempts",
    );
  }
  return () => {
    try {
      fs.unlinkSync(lockFile);
    } catch {
      // best effort
    }
  };
}

function ensureDirFor(file: string): void {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export class AuthoritativeLedger {
  private readonly filePath: string;
  private readonly chainKey: Buffer;

  constructor(opts?: { filePath?: string; chainKey?: Buffer }) {
    this.filePath = opts?.filePath ?? AUTHORITATIVE_LEDGER_PATH;
    this.chainKey = opts?.chainKey ?? chainKeyStatic();
    ensureDirFor(this.filePath);
    if (!fs.existsSync(this.filePath)) {
      fs.writeFileSync(this.filePath, "");
    }
  }

  private readLastLine(): AuthoritativeLedgerLine | null {
    const content = fs.readFileSync(this.filePath, "utf8").trim();
    if (!content) return null;
    const lines = content.split(/\r?\n/);
    for (let i = lines.length - 1; i >= 0; i--) {
      const raw = lines[i].trim();
      if (!raw) continue;
      try {
        return JSON.parse(raw) as AuthoritativeLedgerLine;
      } catch {
        continue;
      }
    }
    return null;
  }

  private appendLine(line: AuthoritativeLedgerLine): void {
    const str = JSON.stringify(line);
    const current = fs.readFileSync(this.filePath, "utf8");
    const sep = current.length > 0 && !current.endsWith("\n") ? "\n" : "";
    fs.appendFileSync(this.filePath, sep + str + "\n");
    try {
      const fd = fs.openSync(this.filePath, "r+");
      fs.fsyncSync(fd);
      fs.closeSync(fd);
    } catch {
      // best effort fsync
    }
  }

  validateEventType(type: string): asserts type is AuthoritativeEventType {
    if (!TYPE_REGEX.test(type)) {
      throw new Error(
        `AUTHORITATIVE_INVALID_SCHEMA type ${type} does not match ^[a-z]+\\.[a-z_]+\\.[a-z_]+$`,
      );
    }
  }

  bootstrap(force = false): AuthoritativeLedgerLine {
    const lockDir = path.join(path.dirname(this.filePath), ".ledger-lock");
    const release = acquireLockSync(lockDir);
    try {
      const last = this.readLastLine();
      if (last && !force) {
        return last;
      }
      const event: AuthoritativeLedgerEventV1 = {
        schema: "authoritative-ledger-event-v1",
        id: crypto.randomBytes(16).toString("hex"),
        type: "system.ledger.bootstrapped",
        ts: new Date().toISOString(),
        payload: { bootstrapped_at: new Date().toISOString(), force: !!force },
      };
      const prevHash =
        last?.hash ?? sha256Hex("authoritative-ledger-genesis-v1|" + CHAIN_SALT_HEX);
      const eventStr = sortedJsonStringify(event);
      const hash = sha256Hex(prevHash + "|" + eventStr);
      const sig = hmacSha256(this.chainKey, hash);
      const line: AuthoritativeLedgerLine = { event, prevHash, hash, sig };
      this.appendLine(line);
      return line;
    } finally {
      release();
    }
  }

  append(
    type: AuthoritativeEventType,
    payload: Record<string, unknown>,
    opts?: { id?: string; ts?: string },
  ): AuthoritativeLedgerLine {
    this.validateEventType(type);
    const lockDir = path.join(path.dirname(this.filePath), ".ledger-lock");
    const release = acquireLockSync(lockDir);
    try {
      let last = this.readLastLine();
      if (!last) {
        last = this.bootstrap(false);
      }
      const event: AuthoritativeLedgerEventV1 = {
        schema: "authoritative-ledger-event-v1",
        id: opts?.id ?? crypto.randomBytes(16).toString("hex"),
        type,
        ts: opts?.ts ?? new Date().toISOString(),
        payload,
      };
      const prevHash = last.hash;
      const eventStr = sortedJsonStringify(event);
      const hash = sha256Hex(prevHash + "|" + eventStr);
      const sig = hmacSha256(this.chainKey, hash);
      const line: AuthoritativeLedgerLine = { event, prevHash, hash, sig };
      this.appendLine(line);
      return line;
    } finally {
      release();
    }
  }

  verify(): {
    valid: boolean;
    lineCount: number;
    badLine?: number;
    reason?: string;
  } {
    const content = fs.readFileSync(this.filePath, "utf8");
    if (!content.trim()) {
      return { valid: true, lineCount: 0 };
    }
    const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
    let prevHash: string | null = null;
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      let parsed: AuthoritativeLedgerLine;
      try {
        parsed = JSON.parse(raw) as AuthoritativeLedgerLine;
      } catch (e) {
        return {
          valid: false,
          lineCount: i,
          badLine: i + 1,
          reason: `Line ${i + 1} is not valid JSON: ${(e as Error).message}`,
        };
      }
      const { event, prevHash: linePrevHash, hash, sig } = parsed;
      if (i === 0) {
        const expectedGenesis = sha256Hex(
          "authoritative-ledger-genesis-v1|" + CHAIN_SALT_HEX,
        );
        if (event.type !== "system.ledger.bootstrapped") {
          return {
            valid: false,
            lineCount: i + 1,
            badLine: i + 1,
            reason: `Line 1 must be system.ledger.bootstrapped, got ${event.type}`,
          };
        }
        if (linePrevHash !== expectedGenesis) {
          return {
            valid: false,
            lineCount: i + 1,
            badLine: i + 1,
            reason: "Line 1 prevHash does not match genesis anchor",
          };
        }
      } else {
        if (prevHash !== linePrevHash) {
          return {
            valid: false,
            lineCount: i + 1,
            badLine: i + 1,
            reason: `Chain broken at line ${i + 1}: prevHash mismatch`,
          };
        }
      }
      try {
        this.validateEventType(event.type);
      } catch (e) {
        return {
          valid: false,
          lineCount: i + 1,
          badLine: i + 1,
          reason: (e as Error).message,
        };
      }
      const eventStr = sortedJsonStringify(event);
      const expectedHash = sha256Hex(linePrevHash + "|" + eventStr);
      if (expectedHash !== hash) {
        return {
          valid: false,
          lineCount: i + 1,
          badLine: i + 1,
          reason: `Hash mismatch at line ${i + 1}: computed ${expectedHash} != stored ${hash}`,
        };
      }
      const expectedSig = hmacSha256(this.chainKey, hash);
      if (expectedSig !== sig) {
        return {
          valid: false,
          lineCount: i + 1,
          badLine: i + 1,
          reason: `HMAC signature mismatch at line ${i + 1}`,
        };
      }
      prevHash = hash;
    }
    return { valid: true, lineCount: lines.length };
  }

  readAll(): AuthoritativeLedgerLine[] {
    const content = fs.readFileSync(this.filePath, "utf8").trim();
    if (!content) return [];
    return content
      .split(/\r?\n/)
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as AuthoritativeLedgerLine);
  }
}
