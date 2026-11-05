import { describe, expect, it, vi } from "vitest";
import { backoffMs, classifyFailure, fetchResilient } from "./http-resilience.mjs";

const res = (status, headers = {}) => ({ status, headers: { get: (k) => headers[k] } });
const noSleep = { sleep: () => Promise.resolve() };

describe("classifyFailure", () => {
  it("treats Binance -2015 (key/IP/permissions) as terminal", () => {
    expect(classifyFailure({ status: 401, code: -2015 })).toBe("terminal");
  });
  it("treats 404 as terminal and 429/503 as retryable", () => {
    expect(classifyFailure({ status: 404 })).toBe("terminal");
    expect(classifyFailure({ status: 429 })).toBe("retryable");
    expect(classifyFailure({ status: 503 })).toBe("retryable");
    expect(classifyFailure({})).toBe("retryable");
  });
});

describe("backoffMs", () => {
  it("honours Retry-After, capped", () => {
    expect(backoffMs(1, "3")).toBe(3000);
    expect(backoffMs(1, "999")).toBe(10000);
  });
});

describe("fetchResilient", () => {
  it("retries idempotent GET on 429 then succeeds", async () => {
    const f = vi.fn().mockResolvedValueOnce(res(429)).mockResolvedValueOnce(res(200));
    const r = await fetchResilient("u", {}, { fetchFn: f, ...noSleep });
    expect(r.status).toBe(200);
    expect(f).toHaveBeenCalledTimes(2);
  });
  it("never retries a non-idempotent POST (prevents double payment)", async () => {
    const f = vi.fn().mockResolvedValue(res(503));
    const r = await fetchResilient("u", { method: "POST" }, { fetchFn: f, ...noSleep });
    expect(r.status).toBe(503);
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("retries a POST that carries an idempotency key, bounded", async () => {
    const f = vi.fn().mockResolvedValue(res(503));
    await fetchResilient("u", { method: "POST" }, { fetchFn: f, idempotent: true, retries: 2, ...noSleep });
    expect(f).toHaveBeenCalledTimes(3);
  });
  it("does not retry terminal 4xx", async () => {
    const f = vi.fn().mockResolvedValue(res(400));
    await fetchResilient("u", {}, { fetchFn: f, ...noSleep });
    expect(f).toHaveBeenCalledTimes(1);
  });
});
