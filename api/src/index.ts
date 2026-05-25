import { createServer } from 'http';
import { config } from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables (.env.local takes precedence)
config({ path: join(__dirname, '../.env.local') });
config({ path: join(__dirname, '../.env') });

async function main() {
  // Load secrets from SSM in production (before importing app)
  if (process.env.NODE_ENV === 'production') {
    const { loadProductionSecrets } = await import('./config/ssm.js');
    await loadProductionSecrets();
  }

  // Now import app after secrets are loaded
  const { createApp } = await import('./app.js');
  const { setupCollaboration } = await import('./collaboration/index.js');

  const PORT = process.env.PORT || 3000;
  const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173';

  // Accept both localhost and 127.0.0.1 variants so the web app works from either address in local dev
  const corsOrigins: string[] = [CORS_ORIGIN];
  if (CORS_ORIGIN.includes('localhost:')) {
    corsOrigins.push(CORS_ORIGIN.replace('localhost', '127.0.0.1'));
  } else if (CORS_ORIGIN.includes('127.0.0.1:')) {
    corsOrigins.push(CORS_ORIGIN.replace('127.0.0.1', 'localhost'));
  }

  const app = createApp(corsOrigins);
  const server = createServer(app);

  // DDoS protection: Set server-wide timeouts to prevent slow-read attacks (Slowloris)
  server.timeout = 60000; // 60 seconds max request duration
  server.keepAliveTimeout = 65000; // 65 seconds (slightly longer than timeout)
  server.headersTimeout = 66000; // 66 seconds (slightly longer than keepAlive)

  // Setup WebSocket collaboration server
  setupCollaboration(server);

  // Start server
  server.listen(PORT, () => {
    console.log(`API server running on http://localhost:${PORT}`);
    console.log(`CORS origins: ${corsOrigins.join(', ')}`);
  });
}

process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
