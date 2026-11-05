// Shared HTTP resilience for payment/crypto endpoints.
// Lessons applied (from the bbc_v3 incident analysis):
//  - separate TERMINAL errors (bad credentials/IP/permissions, 4xx validation) from RETRYABLE ones
//    (429, 5xx, network); terminal errors must never be retried in a loop
//  - bounded retries with Retry-After + jittered exponential backoff
//  - money-moving (non-idempotent) requests are retried ONLY when an idempotency key is present,
//    because an unknown outcome plus a blind retry can double-pay
//  - every request has a timeout

export const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

// Binance / exchange codes that retrying cannot fix: auth, IP whitelist, permissions, bad params.
const TERMINAL_EXCHANGE_CODES = new Set([-2014, -2015, -1022, -1102, -1121, -4001]);

export function classifyFailure({ status, code } = {}) {
  if (code !== undefined && TERMINAL_EXCHANGE_CODES.has(Number(code))) return "terminal";
  if (status === undefined) return "retryable"; // transport error / timeout
  if (RETRYABLE_STATUS.has(status)) return "retryable";
  if (status >= 400) return "terminal";
  return "ok";
}

export function backoffMs(attempt, retryAfterHeader, { baseMs = 500, capMs = 10_000, rand = Math.random } = {}) {
  const retryAfter = Number(retryAfterHeader);
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(retryAfter * 1000, capMs);
  const exp = Math.min(baseMs * 2 ** (attempt - 1), capMs);
  return Math.round(exp / 2 + rand() * (exp / 2));
}

/**
 * fetch with timeout + bounded retry.
 * @param {object} o
 * @param {boolean} [o.idempotent] true for GET/HEAD or requests carrying an idempotency key
 */
export async function fetchResilient(url, init = {}, o = {}) {
  const {
    retries = 2,
    timeoutMs = 15_000,
    idempotent = ["GET", "HEAD"].includes((init.method ?? "GET").toUpperCase()),
    fetchFn = fetch,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  } = o;
  const maxRetries = idempotent ? retries : 0;

  for (let attempt = 1; ; attempt++) {
    let res;
    try {
      res = await fetchFn(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      if (attempt > maxRetries) throw e;
      await sleep(backoffMs(attempt));
      continue;
    }
    if (classifyFailure({ status: res.status }) === "retryable" && attempt <= maxRetries) {
      await sleep(backoffMs(attempt, res.headers?.get?.("Retry-After")));
      continue;
    }
    return res;
  }
}
