'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { useTempData } = require('./helpers');
useTempData();

const passwords = require('../src/auth/passwords');
const secretBox = require('../src/auth/secretBox');
const sessions = require('../src/auth/sessions');
const db = require('../src/database/db');

test('senha: hash scrypt, verificacao correta e incorreta', async () => {
  const hash = await passwords.hashPassword('SenhaForte123');
  assert.ok(hash.startsWith('scrypt$'));
  assert.ok(!hash.includes('SenhaForte123'));
  assert.strictEqual(await passwords.verifyPassword('SenhaForte123', hash), true);
  assert.strictEqual(await passwords.verifyPassword('senhaforte123', hash), false);
  assert.strictEqual(await passwords.verifyPassword('x', 'lixo'), false);
  const hash2 = await passwords.hashPassword('SenhaForte123');
  assert.notStrictEqual(hash, hash2, 'cada hash deve ter um sal diferente');
});

test('cofre: criptografa, descriptografa e detecta adulteracao', () => {
  const secret = 'token-super-secreto-1234567890';
  const enc = secretBox.encrypt(secret);
  assert.ok(!enc.includes(secret));
  assert.strictEqual(secretBox.decrypt(enc), secret);
  const parts = enc.split('.');
  const tampered = parts[0] + '.' + parts[1] + '.' + parts[2] + '.' + Buffer.from('outro-conteudo').toString('base64');
  assert.throws(() => secretBox.decrypt(tampered));
  assert.throws(() => secretBox.decrypt('lixo'));
});

test('banco: cria usuario, sessao, valida expiracao e logout', () => {
  const r = db.run('INSERT INTO users (name, email, password_hash, plan, created_at) VALUES (?, ?, ?, ?, ?)', ['Ana', 'ana@x.com', 'h', 'free', Date.now()]);
  const userId = Number(r.lastInsertRowid);
  assert.throws(() => db.run('INSERT INTO users (name, email, password_hash, plan, created_at) VALUES (?, ?, ?, ?, ?)', ['Ana2', 'ana@x.com', 'h', 'free', Date.now()]), /UNIQUE/);

  const s = sessions.createSession(userId, 'teste');
  const row = db.get('SELECT token_hash FROM sessions WHERE user_id = ?', [userId]);
  assert.notStrictEqual(row.token_hash, s.token, 'o banco guarda so o hash do token');
  assert.strictEqual(sessions.findSession(s.token).email, 'ana@x.com');
  assert.strictEqual(sessions.findSession('token-invalido'), null);

  db.run('UPDATE sessions SET expires_at = ? WHERE user_id = ?', [Date.now() - 1000, userId]);
  assert.strictEqual(sessions.findSession(s.token), null, 'sessao expirada deve ser recusada');

  const s2 = sessions.createSession(userId, 'teste');
  sessions.destroySession(s2.token);
  assert.strictEqual(sessions.findSession(s2.token), null);
});

test('cookies: leitura e atributos de seguranca', () => {
  assert.deepStrictEqual(sessions.parseCookies('a=1; bn_session=abc%20d; x'), { a: '1', bn_session: 'abc d' });
  const headers = [];
  sessions.setSessionCookie({ append: (k, v) => headers.push(v) }, 'tok');
  assert.ok(/HttpOnly/.test(headers[0]) && /SameSite=Lax/.test(headers[0]));
});

test('consulta SQL do login (a mesma que falhou antes) executa sem erro', () => {
  db.run('INSERT INTO users (name, email, password_hash, plan, created_at) VALUES (?, ?, ?, ?, ?)', ['Bia', 'bia@x.com', 'h', 'free', Date.now()]);
  const user = db.get('SELECT id, name, email, password_hash, plan FROM users WHERE email = ?', ['bia@x.com']);
  assert.strictEqual(user.name, 'Bia');
  assert.strictEqual(db.get('SELECT id FROM users WHERE email = ?', ["' OR 1=1 --"]), undefined);
});
