'use strict';

const assert = require('assert');
const { rateLimit } = require('./src/rate-limit');

// A fake res that records what the limiter set, and a next() counter.
function run(limiter, ip) {
  let status = 200;
  let body = null;
  const res = {
    headers: {},
    set(k, v) { this.headers[k] = v; },
    status(s) { status = s; return this; },
    json(b) { body = b; return this; },
  };
  let nextCalled = false;
  limiter({ ip }, res, () => { nextCalled = true; });
  return { status, body, headers: res.headers, nextCalled };
}

// Blocks once count exceeds max within the window.
const limiter = rateLimit({ windowMs: 1000, max: 3, message: 'too many' });
for (let i = 0; i < 3; i++) assert.strictEqual(run(limiter, '1.1.1.1').nextCalled, true, `hit ${i} should pass`);
const blocked = run(limiter, '1.1.1.1');
assert.strictEqual(blocked.nextCalled, false, '4th hit blocked');
assert.strictEqual(blocked.status, 429);
assert.strictEqual(blocked.body.code, 'RATE_LIMITED');
assert.ok(blocked.headers['Retry-After'], 'sets Retry-After');

// A different IP has its own bucket.
assert.strictEqual(run(limiter, '2.2.2.2').nextCalled, true, 'other IP unaffected');

// Window resets after it elapses.
const fast = rateLimit({ windowMs: 10, max: 1 });
assert.strictEqual(run(fast, '3.3.3.3').nextCalled, true);
assert.strictEqual(run(fast, '3.3.3.3').nextCalled, false, 'second within window blocked');
setTimeout(() => {
  assert.strictEqual(run(fast, '3.3.3.3').nextCalled, true, 'passes after window resets');
  console.log('rate-limit ok');
}, 20);
