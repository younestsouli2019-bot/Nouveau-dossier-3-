import fs from "node:fs";
import path from "node:path";
function isPlaceholder(v) {
  if (v == null) return true;
  const s = String(v).trim();
  if (!s) return true;
  if (/^YOUR_[A-Z0-9_]+$/i.test(s)) return true;
  if (/^(REPLACE_ME|CHANGEME|TODO)$/i.test(s)) return true;
  return false;
}
function normEmail(v) {
  if (!v) return null;
  const s = String(v).trim();
  return s.includes("@") ? s.toLowerCase() : null;
}
export class OwnerSettlementEnforcer {
  static getPaymentConfiguration() {
    const priorityEnv = process.env.PAYMENT_ROUTING_PRIORITY || "bank_transfer,payoneer,crypto,paypal,googlepay";
    let settlement_priority = priorityEnv.split(",").map((r) => r.trim()).filter(Boolean);
    // Load JSON override if present
    let json = null;
    try {
      const p = path.resolve("data/owner/owner-routes.json");
      if (fs.existsSync(p)) {
        const txt = fs.readFileSync(p, "utf8");
        const j = JSON.parse(txt);
        if (j && typeof j === "object") {
          json = j;
          if (Array.isArray(j.priority) && j.priority.length) {
            settlement_priority = j.priority.map((r) => String(r).trim()).filter(Boolean);
          }
        }
      }
    } catch {}
    const creds = {
      paypal: {
        clientId: process.env.PAYPAL_CLIENT_ID,
        clientSecret: process.env.PAYPAL_CLIENT_SECRET,
        disabled: String(process.env.PAYPAL_DISABLED || "false").toLowerCase() === "true"
      },
      bank: {
        enabled: String(process.env.BANK_WIRE_ENABLE || "false").toLowerCase() === "true",
        provider: String(process.env.BANK_WIRE_PROVIDER || "").toUpperCase(),
        beneficiaryName: process.env.OWNER_BENEFICIARY_NAME,
        iban: process.env.OWNER_IBAN,
        swift: process.env.OWNER_SWIFT,
        allowlist: process.env.OWNER_BENEFICIARY_ALLOWLIST_JSON || "[]"
      },
      payoneer: {
        enabled: String(process.env.PAYONEER_ENABLE || "false").toLowerCase() === "true",
        base: process.env.PAYONEER_API_BASE,
        clientId: process.env.PAYONEER_CLIENT_ID,
        clientSecret: process.env.PAYONEER_CLIENT_SECRET
      },
      payoneer_standard: {
        enabled: String(process.env.PAYONEER_ENABLE_STANDARD || "false").toLowerCase() === "true",
        email: process.env.OWNER_PAYONEER_EMAIL || process.env.PAYONEER_EMAIL
      },
      crypto: {
        enabled: String(process.env.CRYPTO_WITHDRAW_ENABLE || "false").toLowerCase() === "true",
        address: process.env.TRUST_WALLET_ADDRESS || process.env.TRUST_WALLET_USDT_ERC20
      },
      cryptobox: {
        enabled: String(process.env.CRYPTOBOX_ENABLE || "false").toLowerCase() === "true",
        url: process.env.BINANCE_CRYPTOBOX_URL || "https://www.binance.com/en/my/wallet/account/payment/cryptobox"
      },
      googlepay: {
        enabled: String(process.env.GOOGLEPAY_ENABLE || "false").toLowerCase() === "true",
        email: process.env.OWNER_GOOGLEPAY_EMAIL || process.env.GOOGLEPAY_ACCOUNT_EMAIL
      },
      attijari_morocco: {
        enabled: String(process.env.ATTIJARI_ENABLE || "false").toLowerCase() === "true",
        rib: process.env.ATTIJARI_RIB
      },
      chimoney: {
        enabled: String(process.env.CHIMONEY_ENABLE || "false").toLowerCase() === "true",
        id: process.env.CHIMONEY_ID
      },
      xe: {
        enabled: String(process.env.XE_ENABLE || "false").toLowerCase() === "true",
        account: process.env.XE_ACCOUNT_ID
      },
      wise: {
        enabled: String(process.env.WISE_ENABLE || "false").toLowerCase() === "true",
        email: process.env.WISE_EMAIL
      },
      transfi: {
        enabled: String(process.env.TRANSFI_ENABLE || "false").toLowerCase() === "true",
        id: process.env.TRANSFI_ID
      }
    };
    // Merge JSON overrides if present
    if (json && typeof json === "object") {
      if (json.paypal && typeof json.paypal === "object") creds.paypal = { ...creds.paypal, ...json.paypal };
      if (json.bank && typeof json.bank === "object") creds.bank = { ...creds.bank, ...json.bank };
      if (json.payoneer && typeof json.payoneer === "object") creds.payoneer = { ...creds.payoneer, ...json.payoneer };
      if (json.payoneer_standard && typeof json.payoneer_standard === "object") creds.payoneer_standard = { ...creds.payoneer_standard, ...json.payoneer_standard };
      if (json.crypto && typeof json.crypto === "object") creds.crypto = { ...creds.crypto, ...json.crypto };
      if (json.cryptobox && typeof json.cryptobox === "object") creds.cryptobox = { ...creds.cryptobox, ...json.cryptobox };
      if (json.googlepay && typeof json.googlepay === "object") creds.googlepay = { ...creds.googlepay, ...json.googlepay };
      if (json.attijari_morocco && typeof json.attijari_morocco === "object") creds.attijari_morocco = { ...creds.attijari_morocco, ...json.attijari_morocco };
      if (json.chimoney && typeof json.chimoney === "object") creds.chimoney = { ...creds.chimoney, ...json.chimoney };
      if (json.xe && typeof json.xe === "object") creds.xe = { ...creds.xe, ...json.xe };
      if (json.wise && typeof json.wise === "object") creds.wise = { ...creds.wise, ...json.wise };
      if (json.transfi && typeof json.transfi === "object") creds.transfi = { ...creds.transfi, ...json.transfi };
    }
    return { settlement_priority, creds };
  }
  static missingCredentials(route, cfg) {
    const live = String(process.env.SWARM_LIVE || "false").toLowerCase() === "true";
    if (!live) return true;
    const r = String(route || "").toLowerCase();
    
    // ... existing checks ...
    
    if (r === "googlepay") {
        const c = cfg?.creds?.googlepay || {};
        return !c.enabled || !c.email || !String(c.email).includes("@");
    }
    if (r === "attijari_morocco") {
        const c = cfg?.creds?.attijari_morocco || {};
        return !c.enabled || !c.rib;
    }
    if (r === "chimoney") {
        const c = cfg?.creds?.chimoney || {};
        return !c.enabled || !c.id;
    }
    if (r === "xe") {
        const c = cfg?.creds?.xe || {};
        return !c.enabled || !c.account;
    }
    if (r === "wise") {
        const c = cfg?.creds?.wise || {};
        return !c.enabled || !c.email;
    }
    if (r === "transfi") {
        const c = cfg?.creds?.transfi || {};
        return !c.enabled || !c.id;
    }

    if (r === "paypal") {
      const c = cfg?.creds?.paypal || {};
      if (c.disabled) return true;
      if (isPlaceholder(c.clientId) || isPlaceholder(c.clientSecret)) return true;
      return false;
    }
    if (r === "bank_transfer") {
      const c = cfg?.creds?.bank || {};
      if (!c.enabled) return true;
      if (c.provider !== "LIVE") return true;
      if (!c.beneficiaryName || !c.iban || !c.swift) return true;
      try {
        const allow = JSON.parse(c.allowlist || "[]");
        if (!Array.isArray(allow) || allow.length === 0) return true;
      } catch {
        return true;
      }
      return false;
    }
    if (r === "payoneer") {
      const c = cfg?.creds?.payoneer || {};
      if (!c.enabled) return true;
      if (isPlaceholder(c.base) || isPlaceholder(c.clientId) || isPlaceholder(c.clientSecret)) return true;
      return false;
    }
    if (r === "payoneer_standard") {
      const c = cfg?.creds?.payoneer_standard || {};
      if (!c.enabled) return true;
      const email = String(c.email || "").trim();
      if (!email || !email.includes("@")) return true;
      return false;
    }
    if (r === "crypto") {
      const c = cfg?.creds?.crypto || {};
      if (!c.enabled) return true;
      if (!c.address) return true;
      return false;
    }
    if (r === "cryptobox") {
      const c = cfg?.creds?.cryptobox || {};
      if (!c.enabled) return true;
      return false;
    }
    return true;
  }
  static getOwnerAccountForType(type) {
    const t = String(type || "").toLowerCase();
    if (t === "paypal") return normEmail(process.env.OWNER_PAYPAL_EMAIL) || normEmail(process.env.PAYPAL_EMAIL);
    if (t === "payoneer" || t === "payoneer_standard") return normEmail(process.env.OWNER_PAYONEER_EMAIL) || normEmail(process.env.PAYONEER_EMAIL);
    if (t === "bank_transfer") {
      return process.env.OWNER_IBAN || process.env.MOROCCAN_BANK_RIB || process.env.BANK_IBAN || null;
    }
    if (t === "crypto") {
      return process.env.TRUST_WALLET_ADDRESS || process.env.TRUST_WALLET_USDT_ERC20 || null;
    }
    if (t === "cryptobox") {
      return process.env.BINANCE_CRYPTOBOX_URL || null;
    }
    if (t === "googlepay") {
      return normEmail(process.env.OWNER_GOOGLEPAY_EMAIL) || normEmail(process.env.GOOGLEPAY_ACCOUNT_EMAIL);
    }
    return null;
  }
}
