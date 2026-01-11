import { URL } from 'url';

/**
 * Adds standard security headers to the response.
 * @param {import('http').ServerResponse} res
 */
export function addSecurityHeaders(res) {
  res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; frame-ancestors 'none';");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  // Additional defense-in-depth
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-site");
}

/**
 * Validates authentication for protected endpoints.
 * @param {import('http').IncomingMessage} req
 * @param {string[]} validTokens
 * @returns {boolean} true if authorized
 */
export function validateAuth(req, validTokens) {
  if (!validTokens || validTokens.length === 0) return false;
  
  const authHeader = req.headers['authorization'];
  if (authHeader) {
    if (authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7).trim();
      if (validTokens.includes(token)) return true;
    }
  }

  const apiKey = req.headers['x-api-key'] || req.headers['x-swarm-secret'];
  if (apiKey && validTokens.includes(apiKey)) return true;

  return false;
}

/**
 * Validates the request for common security issues.
 * Returns an error object if invalid, or null if valid.
 * @param {import('http').IncomingMessage} req
 * @returns {{ status: number, error: string } | null}
 */
export function validateRequest(req) {
  const urlStr = req.url || "/";
  
  // 1. Check for JWT/Token in URL (Base44 Vulnerability #3)
  if (/[?&](token|jwt|access_token|secret)=/i.test(urlStr)) {
    return { status: 400, error: "Sensitive data in URL parameters prohibited" };
  }

  // 2. Check for Open Redirect attempts
  // Looks for redirect_to=... or similar
  const redirectMatch = /[?&]redirect(?:_to|_uri|_url)?=([^&]+)/i.exec(urlStr);
  if (redirectMatch) {
    const target = decodeURIComponent(redirectMatch[1]);
    try {
      const u = new URL(target, "http://localhost"); // base required for relative URLs
      const hostname = u.hostname;
      // Allow localhost and your own domain (if defined)
      // Strictly block external domains unless whitelisted
      const allowed = ["localhost", "127.0.0.1"];
      if (process.env.ALLOWED_REDIRECT_DOMAINS) {
        allowed.push(...process.env.ALLOWED_REDIRECT_DOMAINS.split(",").map(s => s.trim()));
      }
      
      const isAllowed = allowed.some(d => hostname === d || hostname.endsWith("." + d));
      if (!isAllowed) {
        return { status: 400, error: "Unvalidated redirect target" };
      }
    } catch {
      // If URL parsing fails but param exists, block it to be safe
      return { status: 400, error: "Invalid redirect target" };
    }
  }

  return null;
}

/**
 * Sanitizes input string to prevent XSS.
 * @param {string} str 
 * @returns {string}
 */
export function sanitizeInput(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}
