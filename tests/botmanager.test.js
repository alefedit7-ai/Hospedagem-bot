'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { useTempData, buildZip } = require('./helpers');
const dataDir = useTempData();

const db = require('../src/database/db');
const store = require('../src/services/projectStore');
const secretBox = require('../src/auth/secretBox');
const manager = require('../src/services/botManager');

const TOKEN = ["MTIzNDU2Nzg5MDEyMzQ1Njc4OQ", "GabcDE", "abcdefghijklmnopqrstuvwxyz1"].join('.');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return true;
    await sleep(100);
  }
  return false;
}

function makeUser(email) {
  return Number(db.run('INSERT INTO users (name, email, password_hash, plan, created_at) VALUES (?, ?, ?, ?, ?)', ['T', email, 'h', 'free', Date.now()]).lastInsertRowid);
}
function makeBot(userId, script, withToken) {
  const now = Date.now();
  const id = Number(db.run("INSERT INTO bots (user_id, name, status, entry_file, token_enc, auto_restart, has_project, created_at, updated_at) VALUES (?, 'b', 'stopped', 'index.js', ?, 0, 1, ?, ?)",
    [userId, withToken === false ? null : secretBox.encrypt(TOKEN), now, now]).lastInsertRowid);
  store.installZip(id, buildZip([{ name: 'index.js', data: script }]), { diskMb: 50 });
  return id;
}
const logsText = (id) => manager.getLogs(id, 0).map((l) => l.m).join('\n');

const LONG_RUNNING = [
  "const fs = require('fs');",
  "console.log('token na env: ' + process.env.DISCORD_TOKEN);",
  "console.log('segredo do servidor visivel: ' + (process.env.BOTNEXUS_SECRET !== undefined));",
  "try { fs.readFileSync(process.env.SECRET_PATH); console.log('LEU_SEGREDO'); } catch (e) { console.log('leitura bloqueada: ' + e.code); }",
  "try { require('child_process').execSync('id'); console.log('EXECUTOU_COMANDO'); } catch (e) { console.log('comando bloqueado: ' + e.code); }",
  "try { fs.writeFileSync('storage-teste.txt', 'ok'); console.log('escrita na propria pasta ok'); } catch (e) { console.log('escrita falhou: ' + e.code); }",
  "setInterval(function () {}, 1000);"
].join('\n');

test('iniciar: status, logs sem token, ambiente limpo, sandbox de arquivos e comandos', async () => {
  const userId = makeUser('a@x.com');
  const id = makeBot(userId, LONG_RUNNING);
  // injeta o caminho do segredo como variavel do bot para provar que ele nao consegue ler
  const env = { SECRET_PATH: path.join(dataDir, 'secret.key') };
  fs.writeFileSync(path.join(dataDir, 'secret.key'), 'segredo-do-servidor');
  db.run('UPDATE bots SET env_enc = ? WHERE id = ?', [secretBox.encrypt(JSON.stringify(env)), id]);

  manager.startBot(id);
  assert.ok(['starting', 'running'].includes(manager.describe(id).status));
  assert.ok(await waitFor(() => logsText(id).includes('escrita na propria pasta'), 8000), 'bot deveria ter escrito logs: ' + logsText(id));

  const text = logsText(id);
  assert.ok(!text.includes(TOKEN) && !text.includes('GabcDE'), 'o token nao pode aparecer nos logs');
  assert.ok(text.includes('[oculto]'));
  assert.ok(text.includes('segredo do servidor visivel: false'), 'segredo do servidor nao pode chegar ao bot');
  assert.ok(!text.includes('LEU_SEGREDO'), 'bot nao pode ler arquivos fora da propria pasta');
  assert.ok(!text.includes('EXECUTOU_COMANDO'), 'bot nao pode abrir processos');
  assert.ok(text.includes('escrita na propria pasta ok'));

  assert.ok(await waitFor(() => manager.describe(id).status === 'running', 6000));
  await waitFor(() => manager.describe(id).memoryMb > 0, 9000);
  const d = manager.describe(id);
  assert.ok(d.memoryMb > 5, 'deve medir memoria, veio ' + d.memoryMb);
  assert.ok(d.uptimeSeconds >= 0);

  await manager.stopBot(id);
  assert.strictEqual(manager.describe(id).status, 'stopped');
  assert.strictEqual(db.get('SELECT status FROM bots WHERE id = ?', [id]).status, 'stopped');
});

test('bot que falha ao iniciar fica com status "crashed" e mostra o erro', async () => {
  const id = makeBot(makeUser('b@x.com'), "console.error('Erro: token invalido'); process.exit(3);");
  manager.startBot(id);
  assert.ok(await waitFor(() => manager.describe(id).status === 'crashed', 6000));
  const text = logsText(id);
  assert.ok(text.includes('Erro: token invalido'));
  assert.ok(text.includes('codigo 3'));
});

test('regras: sem token, sem projeto e limite de bots ligados do plano', async () => {
  const userId = makeUser('c@x.com');
  const semToken = makeBot(userId, LONG_RUNNING.split('\n').pop(), false);
  assert.throws(() => manager.startBot(semToken), /token/);

  const semProjeto = Number(db.run("INSERT INTO bots (user_id, name, status, entry_file, has_project, created_at, updated_at) VALUES (?, 'x', 'stopped', 'index.js', 0, 1, 1)", [userId]).lastInsertRowid);
  assert.throws(() => manager.startBot(semProjeto), /ZIP/);

  const a = makeBot(userId, 'setInterval(function () {}, 1000);');
  const b = makeBot(userId, 'setInterval(function () {}, 1000);');
  manager.startBot(a);
  assert.throws(() => manager.startBot(b), /plano permite/);
  assert.throws(() => manager.startBot(a), /ja esta em execucao/);
  await manager.stopBot(a);
});

test('restart e exclusao: para o processo e apaga os arquivos', async () => {
  const id = makeBot(makeUser('d@x.com'), 'setInterval(function () {}, 1000);');
  manager.startBot(id);
  await waitFor(() => manager.describe(id).status === 'running', 6000);
  await manager.restartBot(id);
  assert.ok(['starting', 'running'].includes(manager.describe(id).status));
  await manager.deleteBot(id);
  assert.ok(!fs.existsSync(store.botRoot(id)));
});

test('saida excessiva e limitada (protecao contra flood de logs)', async () => {
  const id = makeBot(makeUser('e@x.com'), "for (let i = 0; i < 5000; i++) console.log('linha ' + i); setInterval(function () {}, 1000);");
  manager.startBot(id);
  await waitFor(() => logsText(id).includes('linha'), 6000);
  await sleep(1500);
  assert.ok(manager.getLogs(id, 0).length < 700, 'buffer deve ser limitado');
  assert.ok(logsText(id).includes('descartadas') || manager.getLogs(id, 0).length <= 500);
  await manager.stopBot(id);
});

test.after(async () => {
  await manager.shutdownAll();
});
