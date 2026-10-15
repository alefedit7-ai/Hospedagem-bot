'use strict';

const express = require('express');
const http = require('http');
const path = require('path');

const config = require('./src/config');
const db = require('./src/database/db');
const logger = require('./src/utils/logger');
const sessions = require('./src/auth/sessions');
const manager = require('./src/services/botManager');
const security = require('./src/middleware/security');
const { notFoundApi, errorHandler } = require('./src/middleware/errorHandler');
const authRoutes = require('./src/routes/auth');
const botRoutes = require('./src/routes/bots');
const systemRoutes = require('./src/routes/system');

const app = express();
app.disable('x-powered-by');
if (config.trustProxy) app.set('trust proxy', 1);

app.use(security.securityHeaders);

// ---------- API ----------
app.use('/api', security.noStoreApi);
app.use('/api', security.apiLimiter);
app.use('/api', security.csrfGuard);
app.use('/api', express.json({ limit: '20kb' }));
app.use('/api/auth', authRoutes);
app.use('/api/bots', botRoutes);
app.use('/api', systemRoutes);
app.use('/api', notFoundApi);

// ---------- Painel (arquivos estaticos) ----------
app.use(express.static(config.publicDir, { index: 'index.html', maxAge: config.isProduction ? '1h' : 0 }));
app.get('*', (req, res) => {
  res.sendFile(path.join(config.publicDir, 'index.html'));
});

app.use(errorHandler);

const server = http.createServer(app);
server.requestTimeout = 5 * 60 * 1000;
server.headersTimeout = 30 * 1000;

manager.resetStatusesOnBoot();
sessions.purgeExpired();

server.listen(config.port, config.host, () => {
  const info = manager.runnerInfo();
  logger.info('BotNexus rodando em http://localhost:' + config.port);
  logger.info('Configuracao lida de: ' + (config.envFileUsed || 'nenhum arquivo (valores padrao)'));
  logger.info('Executor de bots: ' + info.runner + ' - ' + info.description);
  if (config.secretSource === 'gerada') {
    logger.warn('Chave de criptografia gerada em data/secret.key. FACA BACKUP: sem ela os tokens salvos nao podem ser lidos.');
  }
  if (!config.cookieSecure) {
    logger.warn('COOKIE_SECURE=false. Use true quando o painel estiver em HTTPS.');
  }
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('Recebido ' + signal + '. Parando bots e encerrando...');
  const force = setTimeout(() => process.exit(1), 20000);
  force.unref();
  try {
    await manager.shutdownAll();
  } catch (e) {
    logger.error('Erro ao parar bots:', e);
  }
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => {
    db.close();
    process.exit(0);
  }, 3000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => logger.error('Promessa rejeitada sem tratamento:', reason));
process.on('uncaughtException', (err) => logger.error('Excecao nao tratada:', err));
