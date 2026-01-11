import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";
import { validateRequest, validateAuth, sanitizeInput, addSecurityHeaders } from "../src/security-middleware.mjs";

describe("Security Middleware", () => {
  describe("validateRequest", () => {
    it("should block requests with token in URL", () => {
      const badUrls = [
        "/api?token=abc",
        "/api?jwt=abc",
        "/api?access_token=abc",
        "/api?secret=abc"
      ];
      for (const url of badUrls) {
        const result = validateRequest({ url });
        assert.ok(result, `Should block ${url}`);
        assert.strictEqual(result.status, 400);
        assert.ok(result.error.includes("Sensitive data"));
      }
    });

    it("should allow safe URLs", () => {
      const result = validateRequest({ url: "/api/safe?q=hello" });
      assert.strictEqual(result, null);
    });

    it("should block unvalidated redirects", () => {
      const result = validateRequest({ url: "/login?redirect_to=http://evil.com" });
      assert.ok(result);
      assert.strictEqual(result.status, 400);
    });

    it("should allow localhost redirects", () => {
      const result = validateRequest({ url: "/login?redirect_to=http://localhost:3000/dash" });
      assert.strictEqual(result, null);
    });
  });

  describe("validateAuth", () => {
    const tokens = [crypto.randomBytes(20).toString('hex'), crypto.randomBytes(20).toString('hex')];

    it("should allow valid Bearer token", () => {
      const req = { headers: { authorization: `Bearer ${tokens[0]}` } };
      assert.strictEqual(validateAuth(req, tokens), true);
    });

    it("should allow valid X-API-KEY", () => {
      const req = { headers: { "x-api-key": tokens[1] } };
      assert.strictEqual(validateAuth(req, tokens), true);
    });

    it("should reject invalid token", () => {
      const req = { headers: { authorization: "Bearer bad" } };
      assert.strictEqual(validateAuth(req, tokens), false);
    });

    it("should reject missing token", () => {
      const req = { headers: {} };
      assert.strictEqual(validateAuth(req, tokens), false);
    });
  });

  describe("sanitizeInput", () => {
    it("should escape basic HTML chars", () => {
      const input = '<script>alert("xss")</script>';
      const expected = '&lt;script&gt;alert(&quot;xss&quot;)&lt;&#x2F;script&gt;';
      assert.strictEqual(sanitizeInput(input), expected);
    });

    it("should handle nested HTML and attributes", () => {
      const input = '<div onclick="alert(1)" onload="alert(2)"><a>Link</a></div>';
      const expected = '&lt;div onclick=&quot;alert(1)&quot; onload=&quot;alert(2)&quot;&gt;&lt;a&gt;Link&lt;&#x2F;a&gt;&lt;&#x2F;div&gt;';
      assert.strictEqual(sanitizeInput(input), expected);
    });

    it("should not alter safe text", () => {
      const input = "This is a safe sentence.";
      assert.strictEqual(sanitizeInput(input), input);
    });
  });
});
