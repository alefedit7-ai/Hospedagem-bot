'use strict';

// Teste de fumaca de ponta a ponta. Precisa do Express instalado (npm install).
// Uso: npm run smoke
// Sobe o servidor numa porta livre com dados temporarios e testa a API de verdade.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { buildZip } = require('./helpers');

const PORT = 3900 + Math.floor(Math.random() * 90);
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'botnexus-smoke-'));
let cookieA = '';
let cookieB = '';
let passed = 0;
let failed = 0;

function call(method, urlPath, body, cookie, raw) {
  return new Promise((resolve, reject) => {
    const payload = raw ? body : body === undefined ? null : Buffer.from(JSON.stringify(body));
    const headers = { 'X-Requested-With': 'BotNexus' };
    if (cookie) headers.Cookie = cookie;
    if (payload) {
      headers['Content-Type'] = raw ? 'application/zip' : 'application/json';
      headers['Content-Length'] = payload.length;
    }
    const req = http.request({ host: '127.0.0.1', port: PORT, path: urlPath, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch (e) { /* nao e JSON */ }
        resolve({ status: res.statusCode, json, text, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function check(name, condition, extra) {
  if (condition) { passed++; console.log('  ok   ' + name); }
  else { failed++; console.log('  FALHOU ' + name + (extra ? ' -> ' + extra : '')); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const server = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: Object.assign({}, process.env, { PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR: dataDir, BOTNEXUS_SECRET: 'smoke-test-secret-com-mais-de-32-caracteres' }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let serverLog = '';
  server.stdout.on('data', (d) => (serverLog += d));
  server.stderr.on('data', (d) => (serverLog += d));

  try {
    for (let i = 0; i < 50; i++) {
      try { if ((await call('GET', '/api/health')).status === 200) break; } catch (e) { await sleep(200); }
    }
    let r = await call('GET', '/api/health');
    check('servidor responde /api/health', r.status === 200);

    r = await call('GET', '/');
    check('painel (index.html) e servido', r.status === 200 && r.text.includes('BotNexus'));
    check('cabecalho CSP presente', !!r.headers['content-security-policy']);

    r = await call('GET', '/api/bots');
    check('API exige login (401)', r.status === 401);

    r = await call('POST', '/api/auth/register', { name: 'Ana', email: 'ana@teste.com', password: 'senhaboa123' });
    check('cadastro funciona', r.status === 201, r.text);
    cookieA = (r.headers['set-cookie'] || [''])[0].split(';')[0];
    check('cookie de sessao HttpOnly', /HttpOnly/.test((r.headers['set-cookie'] || [''])[0]));

    r = await call('POST', '/api/auth/register', { name: 'Ana', email: 'ana@teste.com', password: 'senhaboa123' });
    check('e-mail repetido e recusado (409)', r.status === 409);

    r = await call('POST', '/api/auth/register', { name: 'Beto', email: 'beto@teste.com', password: 'senhaboa123' });
    cookieB = (r.headers['set-cookie'] || [''])[0].split(';')[0];

    r = await call('POST', '/api/auth/login', { email: 'ana@teste.com', password: 'errada123' });
    check('senha errada (401)', r.status === 401);
    r = await call('POST', '/api/auth/login', { email: 'ana@teste.com', password: 'senhaboa123' });
    check('login correto', r.status === 200);

    r = await call('POST', '/api/bots', { name: 'Bot da Ana' }, cookieA);
    check('criar bot', r.status === 201 && r.json.bot.id > 0, r.text);
    const botId = r.json.bot.id;

    r = await call('GET', '/api/bots/' + botId, undefined, cookieB);
    check('outro usuario NAO acessa o bot (404)', r.status === 404);
    r = await call('POST', '/api/bots/' + botId + '/start', {}, cookieB);
    check('outro usuario NAO inicia o bot (404)', r.status === 404);
    r = await call('DELETE', '/api/bots/' + botId, undefined, cookieB);
    check('outro usuario NAO exclui o bot (404)', r.status === 404);

    r = await call('POST', '/api/bots/' + botId + '/start', {}, cookieA);
    check('iniciar sem ZIP da erro claro (400)', r.status === 400 && /ZIP/.test(r.json.error), r.text);

    r = await call('POST', '/api/bots/' + botId + '/upload', buildZip([{ name: '../x.js', data: '1' }]), cookieA, true);
    check('ZIP malicioso recusado (400)', r.status === 400, r.text);

    const script = "console.log('bot de teste no ar'); setInterval(function () {}, 1000);";
    r = await call('POST', '/api/bots/' + botId + '/upload', buildZip([{ name: 'index.js', data: script }]), cookieA, true);
    check('upload de ZIP valido', r.status === 200 && r.json.upload.entryFile === 'index.js', r.text);

    r = await call('POST', '/api/bots/' + botId + '/start', {}, cookieA);
    check('iniciar sem token da erro claro (400)', r.status === 400 && /token/.test(r.json.error), r.text);

    const token = ["MTIzNDU2Nzg5MDEyMzQ1Njc4OQ", "GabcDE", "abcdefghijklmnopqrstuvwxyz1"].join('.');
    r = await call('PATCH', '/api/bots/' + botId + '/settings', { token: token, autoRestart: true }, cookieA);
    check('salvar token', r.status === 200 && r.json.bot.hasToken === true, r.text);
    check('resposta NAO contem o token', !r.text.includes(token) && !r.text.includes('GabcDE'));

    r = await call('POST', '/api/bots/' + botId + '/start', {}, cookieA);
    check('iniciar bot', r.status === 200, r.text);
    await sleep(3500);
    r = await call('GET', '/api/bots/' + botId, undefined, cookieA);
    check('status "running" com memoria medida', r.json.bot.status === 'running' && r.json.bot.memoryMb >= 0, r.text);
    r = await call('GET', '/api/bots/' + botId + '/logs', undefined, cookieA);
    check('logs trazem a saida do bot', r.status === 200 && r.text.includes('bot de teste no ar'));
    check('logs NAO contem o token', !r.text.includes(token));

    r = await call('POST', '/api/bots/' + botId + '/restart', {}, cookieA);
    check('reiniciar bot', r.status === 200, r.text);
    r = await call('POST', '/api/bots/' + botId + '/stop', {}, cookieA);
    check('parar bot', r.status === 200 && r.json.bot.status === 'stopped', r.text);

    r = await call('POST', '/api/bots', { name: 'x' }, cookieA);
    check('nome curto e recusado (400)', r.status === 400);
    r = await call('POST', '/api/bots', { name: 'Segundo' }, cookieA);
    r = await call('POST', '/api/bots', { name: 'Terceiro' }, cookieA);
    check('limite de bots do plano (400)', r.status === 400 && /plano/i.test(r.json.error), r.text);

    r = await call('POST', '/api/auth/login', { email: 'ana@teste.com', password: 'senhaboa123' });
    r = await new Promise((resolve) => {
      const req = http.request({ host: '127.0.0.1', port: PORT, path: '/api/bots', method: 'POST', headers: { Cookie: cookieA, 'Content-Type': 'application/json' } }, (res) => resolve(res.statusCode));
      req.end('{"name":"sem cabecalho csrf"}');
    });
    check('POST sem X-Requested-With e bloqueado (403)', r === 403);

    r = await call('POST', '/api/auth/logout', {}, cookieA);
    r = await call('GET', '/api/bots', undefined, cookieA);
    check('sessao invalida apos logout (401)', r.status === 401);
  } catch (err) {
    failed++;
    console.log('  ERRO no teste: ' + err.message);
  } finally {
    server.kill('SIGTERM');
    await sleep(500);
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (e) { /* ignora */ }
  }
  console.log('\n' + passed + ' passaram, ' + failed + ' falharam.');
  if (failed) console.log('--- log do servidor ---\n' + serverLog);
  process.exit(failed ? 1 : 0);
}
main();
