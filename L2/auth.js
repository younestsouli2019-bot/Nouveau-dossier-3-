/**
 * API key authentication middleware.
 */

import { getConfig } from '../config.js';

export function apiKeyAuth(req, res, next) {
  const config = getConfig();

  if (!config.apiKey) {
    // No API key configured — skip auth
    return next();
  }

  const providedKey = req.headers['x-api-key'] || req.query.api_key;

  if (!providedKey || providedKey !== config.apiKey) {
    return res.status(401).json({ error: 'Invalid or missing API key' });
  }

  next();
}
