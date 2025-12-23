import test from "node:test";
import assert from "node:assert/strict";

function mask(value, { keepStart = 0, keepEnd = 4 } = {}) {
  const s = String(value ?? "");
  if (!s) return "";
  const start = s.slice(0, keepStart);
  const end = s.slice(Math.max(keepStart, s.length - keepEnd));
  const maskedLen = Math.max(0, s.length - start.length - end.length);
  return `${start}${"*".repeat(maskedLen)}${end}`;
}

function sanitizeDestination(dest) {
  const bank = dest?.bank ? String(dest.bank).trim() : "";
  const swift = dest?.swift ? String(dest.swift).trim() : "";
  const account = dest?.account ? String(dest.account).trim() : "";
  const beneficiary = dest?.beneficiary ? String(dest.beneficiary).trim() : "";

  return {
    bank,
    swift,
    accountMasked: account ? mask(account, { keepStart: 0, keepEnd: 4 }) : "",
    beneficiaryMasked: beneficiary ? mask(beneficiary, { keepStart: 1, keepEnd: 0 }) : ""
  };
}

function normalizePayoutRoute(value, fallback = "bank_wire") {
  const v = String(value ?? "").trim().toLowerCase();
  if (!v) return fallback;

  const aliases = {
    bank: "bank_wire",
    wire: "bank_wire",
    bank_wire: "bank_wire",
    swift: "bank_wire",
    paypal: "paypal_payouts_api",
    paypal_payouts: "paypal_payouts_api",
    paypal_payouts_api: "paypal_payouts_api",
    paypal_manual: "paypal_manual_withdrawal",
    paypal_manual_withdrawal: "paypal_manual_withdrawal",
    wise: "wise_transfer",
    wise_transfer: "wise_transfer",
    payoneer: "payoneer",
    stripe_connect: "stripe_connect",
    stripe: "stripe_connect"
  };

  return aliases[v] ?? fallback;
}

function buildPayoutPlan({
  countryCode,
  requestedRoute,
  hasBankDetails,
  ppp2Approved,
  ppp2EnableSend
}) {
  const reasons = [];
  const requested = normalizePayoutRoute(requestedRoute, "bank_wire");

  let selected = requested;

  if (hasBankDetails && requested === "bank_wire") {
    reasons.push("Bank details present; using bank wire route");
  }

  if (selected === "paypal_payouts_api") {
    if (countryCode === "MA") {
      reasons.push("Morocco accounts often require PPP2 case-by-case approval");
      if (!(ppp2Approved && ppp2EnableSend)) {
        selected = "bank_wire";
        reasons.push("PPP2 send not explicitly approved/enabled; falling back to bank wire");
      }
    } else if (!(ppp2Approved && ppp2EnableSend)) {
      selected = "bank_wire";
      reasons.push("PPP2 send not explicitly approved/enabled; falling back to bank wire");
    }
  }

  if (selected === "bank_wire" && !hasBankDetails) {
    reasons.push("Missing bank details; bank wire requires account/RIB/IBAN + SWIFT");
  }

  return {
    country: countryCode || null,
    requestedRoute: requested,
    selectedRoute: selected,
    reasons
  };
}

test("mask keeps last 4 by default", () => {
  assert.equal(mask("1234567890"), "******7890");
});

test("sanitizeDestination never outputs raw account number", () => {
  const out = sanitizeDestination({
    bank: "X",
    swift: "Y",
    account: "1234567890123456",
    beneficiary: "John Doe"
  });
  assert.equal(out.accountMasked.endsWith("3456"), true);
  assert.equal(out.accountMasked.includes("1234"), false);
  assert.equal(out.beneficiaryMasked.startsWith("J"), true);
});

test("destination JSON can be parsed when quotes are backslash-escaped", () => {
  const raw = "{\\\"bank\\\":\\\"ExampleBank\\\",\\\"swift\\\":\\\"EXAMPLEX1\\\",\\\"account\\\":\\\"1234567890123456\\\",\\\"beneficiary\\\":\\\"Jane Doe\\\"}";
  const parsed = JSON.parse(raw.replace(/\\"/g, '"'));
  const out = sanitizeDestination(parsed);
  assert.equal(out.bank, "ExampleBank");
  assert.equal(out.swift, "EXAMPLEX1");
  assert.equal(out.accountMasked.endsWith("3456"), true);
});

test("PPP2 route falls back to bank wire for Morocco without approval", () => {
  const plan = buildPayoutPlan({
    countryCode: "MA",
    requestedRoute: "paypal_payouts_api",
    hasBankDetails: true,
    ppp2Approved: false,
    ppp2EnableSend: false
  });
  assert.equal(plan.selectedRoute, "bank_wire");
  assert.equal(plan.reasons.some((r) => r.toLowerCase().includes("morocco")), true);
});

test("PPP2 route stays enabled when explicitly approved and enabled", () => {
  const plan = buildPayoutPlan({
    countryCode: "MA",
    requestedRoute: "paypal_payouts_api",
    hasBankDetails: true,
    ppp2Approved: true,
    ppp2EnableSend: true
  });
  assert.equal(plan.selectedRoute, "paypal_payouts_api");
});
