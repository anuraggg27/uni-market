import { createServer } from 'node:http';
import { loadConfig } from './config.js';
import { createDatabase } from './db/client.js';
import { createApp } from './app.js';
import { ProductionGoogleVerifier } from './services/google.js';
import { attachSocket } from './socket.js';
import { EmailWorker } from './services/email.js';
import { logger } from './lib/logger.js';

const config = loadConfig();
const database = createDatabase(config);
const app = createApp({ db: database.db, config, googleVerifier: new ProductionGoogleVerifier(config) });
const server = createServer(app);
attachSocket(server, database.db, config);
const emailWorker = new EmailWorker(database.db, config); emailWorker.start();
server.listen(config.PORT, () => logger.info({ port: config.PORT, appEnv: config.APP_ENV, devMode: config.DEV_MODE }, 'Uni Market API listening'));

async function shutdown(signal: string) {
  logger.info({ signal }, 'shutting down'); emailWorker.stop(); server.close(); await database.close(); process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
