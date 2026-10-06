'use strict';

/*
 * A small fixed-window rate limiter, keyed by client IP.
 *
 * Why not a dependency: the one real edge case is reading the client's own IP
 * from behind Vercel's proxy, and that is `app.set('trust proxy', 1)` plus
 * `req.ip` — not something a library does better here.
 *
 * ponytail: in-memory, per-instance. On serverless the counters reset on a
 * cold start and are not shared across concurrent instances, so this bounds a
 * single hot instance rather than the whole deployment. Upgrade path if abuse
 * survives it: back `hits` with Vercel KV / Redis, same interface.
 */
function rateLimit({ windowMs, max, message }) {
  const hits = new Map(); // ip -> { count, resetAt }

  return function limiter(req, res, next) {
    const now = Date.now();
    const ip = req.ip || 'unknown';

    let entry = hits.get(ip);
    if (!entry || now >= entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(ip, entry);
    }
    entry.count += 1;

    // Bound memory: whenever the table grows past a few thousand keys, drop the
    // windows that have already expired. Cheap, and only ever runs when busy.
    if (hits.size > 5000) {
      for (const [key, value] of hits) {
        if (now >= value.resetAt) hits.delete(key);
      }
    }

    res.set('RateLimit-Limit', String(max));
    res.set('RateLimit-Remaining', String(Math.max(0, max - entry.count)));

    if (entry.count > max) {
      res.set('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      return res
        .status(429)
        .json({ success: false, code: 'RATE_LIMITED', message: message || 'คำขอถี่เกินไป กรุณาลองใหม่อีกครั้ง' });
    }
    next();
  };
}

module.exports = { rateLimit };
