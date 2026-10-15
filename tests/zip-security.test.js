'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { useTempData, buildZip } = require('./helpers');
const dataDir = useTempData();

const store = require('../src/services/projectStore');
const config = require('../src/config');

let nextId = 1;
const install = (entries, opts) => store.installZip(nextId++, buildZip(entries), opts || { diskMb: 50 });
const rejects = (entries, pattern, opts) => assert.throws(() => install(entries, opts), pattern);
const GOOD = { name: 'index.js', data: 'console.log("oi");' };

test('ZIP valido: extrai, acha o arquivo principal e valida package.json', () => {
  const id = nextId;
  const r = install([GOOD, { name: 'package.json', data: JSON.stringify({ name: 'b', main: 'index.js', dependencies: { 'discord.js': '^14.16.0' }, scripts: { postinstall: 'rm -rf /' } }) }, { name: 'src/util.js', data: 'module.exports=1' }]);
  assert.strictEqual(r.entryFile, 'index.js');
  assert.strictEqual(r.fileCount, 3);
  assert.strictEqual(r.needsInstall, true);
  const saved = JSON.parse(fs.readFileSync(path.join(store.projectDir(id), 'package.json'), 'utf8'));
  assert.strictEqual(saved.scripts, undefined, 'scripts do package.json devem ser removidos');
  assert.ok(saved.dependencies['discord.js']);
});

test('ZIP com tudo dentro de uma pasta: remove a pasta externa', () => {
  const id = nextId;
  const r = install([{ name: 'MeuBot/', dir: true }, { name: 'MeuBot/index.js', data: 'x' }, { name: 'MeuBot/lib/a.js', data: 'y' }]);
  assert.strictEqual(r.entryFile, 'index.js');
  assert.ok(fs.existsSync(path.join(store.projectDir(id), 'lib', 'a.js')));
});

test('ZIP: caminhos com .. sao recusados e nada e gravado fora', () => {
  rejects([GOOD, { name: '../fora.txt', data: 'x' }], /\.\./);
  rejects([GOOD, { name: 'a/../../fora.txt', data: 'x' }], /\.\./);
  rejects([GOOD, { name: '..\\fora.txt', data: 'x' }], /\.\./);
  assert.ok(!fs.existsSync(path.join(dataDir, 'fora.txt')));
  assert.ok(!fs.existsSync(path.join(dataDir, '..', 'fora.txt')));
});

test('ZIP: caminho absoluto, letra de unidade e byte nulo sao recusados', () => {
  rejects([GOOD, { name: '/etc/cron.d/x', data: 'x' }], /absolutos/);
  rejects([GOOD, { name: 'C:/Windows/x.js', data: 'x' }], /absolutos/);
  rejects([GOOD, { name: 'a\0b.js', data: 'x' }], /invalido/);
});

test('ZIP: link simbolico e recusado', () => {
  rejects([GOOD, { name: 'link', data: '/etc/passwd', method: 0, unixMode: 0o120777 }], /simbolicos/);
});

test('ZIP: executaveis bloqueados e duplicados recusados', () => {
  rejects([GOOD, { name: 'virus.exe', data: 'MZ' }], /bloqueado/);
  rejects([GOOD, { name: 'setup.BAT', data: 'x' }], /bloqueado/);
  rejects([GOOD, { name: 'a.js', data: '1' }, { name: 'A.js', data: '2' }], /duplicados/);
});

test('ZIP: limites de tamanho e de quantidade de arquivos', () => {
  rejects([GOOD, { name: 'grande.bin', data: Buffer.alloc(2 * 1048576) }], /limite/, { diskMb: 1 });
  const many = [GOOD];
  for (let i = 0; i < config.extractMaxFiles + 1; i++) many.push({ name: 'f' + i + '.txt', data: '', method: 0 });
  rejects(many, /arquivos demais/);
});

test('ZIP: bomba de descompressao (tamanho declarado menor que o real) e recusada', () => {
  rejects([GOOD, { name: 'bomba.txt', data: Buffer.alloc(5 * 1048576, 65), declaredSize: 10 }], /descompactar|inconsistente/);
});

test('ZIP: CRC errado e arquivo corrompido sao recusados', () => {
  rejects([GOOD, { name: 'x.js', data: 'abc', crc: 123 }], /integridade/);
  assert.throws(() => store.installZip(nextId++, Buffer.from('isto nao e um zip de verdade, so texto'), { diskMb: 50 }), /ZIP valido/);
  assert.throws(() => store.installZip(nextId++, Buffer.alloc(10), { diskMb: 50 }), /ZIP valido/);
});

test('package.json: dependencias git, file, url e atalhos github sao recusadas', () => {
  const bad = ['git+https://github.com/x/y.git', 'file:../../etc', 'http://evil.com/x.tgz', 'github:user/repo', 'user/repo', 'npm:outro@1', '../x'];
  for (const spec of bad) {
    rejects([GOOD, { name: 'package.json', data: JSON.stringify({ dependencies: { pacote: spec } }) }], /nao e permitida|invalido/, undefined);
  }
  rejects([GOOD, { name: 'package.json', data: '{ quebrado' }], /JSON/);
});

test('lockfiles e .npmrc da raiz sao descartados', () => {
  const id = nextId;
  install([GOOD, { name: 'package-lock.json', data: '{}' }, { name: '.npmrc', data: 'ignore-scripts=false' }, { name: 'package.json', data: '{"dependencies":{}}' }]);
  assert.ok(!fs.existsSync(path.join(store.projectDir(id), 'package-lock.json')));
  assert.ok(!fs.existsSync(path.join(store.projectDir(id), '.npmrc')));
});

test('sem arquivo principal: recusa; reenvio mantem a pasta storage', () => {
  rejects([{ name: 'leiame.txt', data: 'oi' }], /arquivo principal/);
  const id = nextId++;
  store.installZip(id, buildZip([GOOD]), { diskMb: 50 });
  fs.mkdirSync(path.join(store.projectDir(id), 'storage'));
  fs.writeFileSync(path.join(store.projectDir(id), 'storage', 'dados.json'), '{"a":1}');
  store.installZip(id, buildZip([{ name: 'index.js', data: 'v2' }]), { diskMb: 50 });
  assert.strictEqual(fs.readFileSync(path.join(store.projectDir(id), 'storage', 'dados.json'), 'utf8'), '{"a":1}');
  assert.strictEqual(fs.readFileSync(path.join(store.projectDir(id), 'index.js'), 'utf8'), 'v2');
});

test('envio recusado nao apaga o projeto que ja estava instalado', () => {
  const id = nextId++;
  store.installZip(id, buildZip([GOOD]), { diskMb: 50 });
  assert.throws(() => store.installZip(id, buildZip([GOOD, { name: '../x', data: '1' }]), { diskMb: 50 }));
  assert.ok(fs.existsSync(path.join(store.projectDir(id), 'index.js')));
  const leftovers = fs.readdirSync(config.tmpDir);
  assert.deepStrictEqual(leftovers, [], 'nenhuma pasta temporaria deve sobrar');
});
