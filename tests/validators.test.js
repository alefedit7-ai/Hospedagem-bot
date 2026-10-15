'use strict';
const test = require('node:test');
const assert = require('node:assert');
const v = require('../src/utils/validators');
const { createRedactor } = require('../src/utils/redact');
const { parseEnv } = require('../src/utils/envLoader');

test('e-mail: normaliza e rejeita invalidos', () => {
  assert.strictEqual(v.validateEmail('  Alef@Exemplo.COM '), 'alef@exemplo.com');
  assert.throws(() => v.validateEmail('sem-arroba'), /e-mail/i);
  assert.throws(() => v.validateEmail('a@b'), /e-mail/i);
  assert.throws(() => v.validateEmail(undefined), /e-mail/i);
});

test('senha: exige tamanho, letra e numero', () => {
  assert.throws(() => v.validatePassword('curta1'), /8 caracteres/);
  assert.throws(() => v.validatePassword('somente-letras'), /letra e um numero/);
  assert.throws(() => v.validatePassword('12345678'), /letra e um numero/);
  assert.strictEqual(v.validatePassword('senhaboa123'), 'senhaboa123');
  assert.throws(() => v.validatePassword('a1'.repeat(70)), /128/);
});

test('arquivo principal: bloqueia caminhos perigosos', () => {
  assert.strictEqual(v.validateEntryFile('src/bot.js'), 'src/bot.js');
  for (const bad of ['../x.js', '/etc/passwd.js', 'index.sh', 'a//b.js', 'node -e x.js', '']) {
    assert.throws(() => v.validateEntryFile(bad), undefined, bad);
  }
});

test('variaveis de ambiente: bloqueia reservadas e formato invalido', () => {
  assert.deepStrictEqual(v.validateEnvVars({ PREFIXO: '!' }), { PREFIXO: '!' });
  assert.throws(() => v.validateEnvVars({ NODE_OPTIONS: '--require x' }), /reservada/);
  assert.throws(() => v.validateEnvVars({ PATH: '/x' }), /reservada/);
  assert.throws(() => v.validateEnvVars({ minusculo: '1' }), /invalido/);
  assert.throws(() => v.validateEnvVars({ A: 'x'.repeat(1001) }), /invalido/);
  assert.throws(() => v.validateEnvVars([1]), /formato/);
});

test('ids: so inteiros positivos', () => {
  assert.strictEqual(v.parseId('12'), 12);
  for (const bad of ['0', '-1', '1.5', 'abc', '1; DROP TABLE bots', '']) assert.throws(() => v.parseId(bad), undefined, bad);
});

test('redator: oculta token conhecido e padrao de token do Discord', () => {
  const token = ["MTIzNDU2Nzg5MDEyMzQ1Njc4OQ", "GabcDE", "abcdefghijklmnopqrstuvwxyz1"].join('.');
  const redact = createRedactor(['minha-chave-secreta-123']);
  assert.ok(!redact('login com ' + token).includes('GabcDE'));
  assert.ok(!redact('valor minha-chave-secreta-123 aqui').includes('secreta'));
  assert.strictEqual(redact('mensagem normal'), 'mensagem normal');
});

test('leitor de .env: comentarios, aspas e chaves invalidas', () => {
  const out = parseEnv('# c\nPORT=3000\nNOME="com espacos"\n  X = 1 \n1BAD=2\nsem-igual\n');
  assert.deepStrictEqual(out, { PORT: '3000', NOME: 'com espacos', X: '1' });
});
