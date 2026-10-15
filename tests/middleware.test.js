'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { useTempData } = require('./helpers');
useTempData();

const security = require('../src/middleware/security');
const plans = require('../src/services/plans');

function req(method, headers) {
  const h = {};
  Object.keys(headers || {}).forEach((k) => (h[k.toLowerCase()] = headers[k]));
  return { method, ip: '1.2.3.4', get: (k) => h[k.toLowerCase()] };
}
const run = (mw, r) => new Promise((resolve) => {
  const res = { setHeader() {}, removeHeader() {} };
  mw(r, res, (err) => resolve(err || null));
});

test('CSRF: GET passa; POST exige cabecalho e origem igual ao host', async () => {
  assert.strictEqual(await run(security.csrfGuard, req('GET')), null);
  assert.strictEqual((await run(security.csrfGuard, req('POST', { host: 'a.com' }))).status, 403);
  assert.strictEqual((await run(security.csrfGuard, req('POST', { host: 'a.com', 'x-requested-with': 'BotNexus', origin: 'https://evil.com' }))).status, 403);
  assert.strictEqual((await run(security.csrfGuard, req('POST', { host: 'a.com', 'x-requested-with': 'BotNexus', origin: 'https://a.com' }))), null);
  assert.strictEqual((await run(security.csrfGuard, req('DELETE', { host: 'a.com', 'x-requested-with': 'BotNexus' }))), null);
});

test('limite de requisicoes: bloqueia depois do maximo e informa Retry-After', async () => {
  const limiter = security.createRateLimiter({ windowMs: 60000, max: 3, message: 'devagar' });
  for (let i = 0; i < 3; i++) assert.strictEqual(await run(limiter, req('GET')), null);
  const err = await run(limiter, req('GET'));
  assert.strictEqual(err.status, 429);
  assert.strictEqual(await run(limiter, { method: 'GET', ip: '9.9.9.9', get() {} }), null, 'outro IP nao e afetado');
});

test('bloqueio de login apos varias senhas erradas', () => {
  const email = 'alvo@x.com';
  assert.strictEqual(security.loginLocked(email), 0);
  for (let i = 0; i < 6; i++) security.registerLoginFailure(email);
  assert.ok(security.loginLocked(email) > 0);
  security.registerLoginSuccess(email);
  assert.strictEqual(security.loginLocked(email), 0);
});

test('cabecalhos de seguranca incluem CSP e anti-clickjacking', async () => {
  const set = {};
  await new Promise((resolve) => security.securityHeaders({}, { removeHeader() {}, setHeader: (k, v) => (set[k] = v) }, resolve));
  assert.ok(/script-src 'self'/.test(set['Content-Security-Policy']));
  assert.ok(/frame-ancestors 'none'/.test(set['Content-Security-Policy']));
  assert.strictEqual(set['X-Frame-Options'], 'DENY');
  assert.strictEqual(set['X-Content-Type-Options'], 'nosniff');
});

test('planos: plano desconhecido cai no gratuito', () => {
  assert.strictEqual(plans.getPlan('inexistente').id, 'free');
  assert.ok(plans.getPlan('free').maxBots >= 1);
});
