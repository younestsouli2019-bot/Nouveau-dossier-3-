// src/lib/axiosClient.ts
// Lightweight Axios wrapper with token refresh, idempotency keys, and retry/backoff.
// - Do NOT store secrets here. Read them at runtime from a secrets manager (AWS Secrets Manager, Vault, etc.).
// - This file intentionally keeps token refresh logic pluggable: implement fetchAccessToken() to integrate with your KMS/Vault.

import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';

// Simple exponential backoff helper
function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface AxiosClientOptions {
  baseURL?: string;
  fetchAccessToken: () => Promise<string> | string;
  maxRetries?: number;
}

export class AxiosClient {
  private instance: AxiosInstance;
  private fetchAccessToken: () => Promise<string> | string;
  private maxRetries: number;

  constructor(opts: AxiosClientOptions) {
    this.fetchAccessToken = opts.fetchAccessToken;
    this.maxRetries = opts.maxRetries ?? 3;

    this.instance = axios.create({ baseURL: opts.baseURL, timeout: 30_000 });

    // Attach auth header on each request using fetchAccessToken
    this.instance.interceptors.request.use(async (config) => {
      try {
        const token = await this.fetchAccessToken();
        if (token) {
          config.headers = config.headers ?? axios.AxiosHeaders.from({});
          config.headers['Authorization'] = `Bearer ${token}`;
        }
      } catch (err) {
        // swallow here; the request will likely fail and be retried by calling code
      }
      return config;
    });
  }

  // Generate a stable idempotency key for a business transfer request.
  // Caller SHOULD provide a business transfer id when available.
  static idempotencyKey(businessId?: string) {
    if (businessId) return `biz-${businessId}`;
    return `idemp-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  }

  // Generic POST wrapper with idempotency and retry/backoff logic
  async post<T = any>(url: string, data?: any, config?: AxiosRequestConfig & { idempotencyKey?: string; retries?: number }): Promise<AxiosResponse<T>> {
    const idKey = config?.idempotencyKey ?? AxiosClient.idempotencyKey();
    const retries = config?.retries ?? this.maxRetries;

    let attempt = 0;
    let lastErr: any = null;

    while (attempt <= retries) {
      try {
        const mergedConfig: AxiosRequestConfig = {
          ...config,
          headers: {
            ...(config?.headers ?? {}),
            'Idempotency-Key': idKey,
            'Content-Type': 'application/json',
          },
        };
        return await this.instance.post<T>(url, data, mergedConfig);
      } catch (err: any) {
        lastErr = err;
        attempt += 1;

        // Non-retryable status codes
        const status = err?.response?.status;
        if (status && status < 500 && status !== 429) {
          // Client error, do not retry
          throw err;
        }

        // If we've exhausted retries, throw
        if (attempt > retries) break;

        // Backoff with jitter
        const backoff = Math.min(1000 * 2 ** (attempt - 1), 30_000);
        const jitter = Math.floor(Math.random() * 300);
        await wait(backoff + jitter);
      }
    }

    throw lastErr;
  }

  // Convenience GET wrapper with retry
  async get<T = any>(url: string, config?: AxiosRequestConfig & { retries?: number }): Promise<AxiosResponse<T>> {
    const retries = config?.retries ?? this.maxRetries;
    let attempt = 0;
    let lastErr: any = null;
    while (attempt <= retries) {
      try {
        return await this.instance.get<T>(url, config);
      } catch (err: any) {
        lastErr = err;
        attempt += 1;
        const status = err?.response?.status;
        if (status && status < 500 && status !== 429) throw err;
        if (attempt > retries) break;
        const backoff = Math.min(1000 * 2 ** (attempt - 1), 30_000);
        const jitter = Math.floor(Math.random() * 300);
        await wait(backoff + jitter);
      }
    }
    throw lastErr;
  }
}

// Example usage (fill fetchAccessToken with secure vault call):
/*
const client = new AxiosClient({
  baseURL: 'https://api.sandbox.transferwise.tech',
  fetchAccessToken: async () => {
    // Implement: fetch short-lived token from Vault / Secrets Manager
    return process.env.WISE_API_TOKEN || '';
  },
});

await client.post('/v1/quotes', { sourceCurrency: 'EUR', targetCurrency: 'MAD', sourceAmount: 100 }, { idempotencyKey: 'transfer-123' });
*/
