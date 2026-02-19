// ── Global error handlers — must be first ──
process.on('unhandledRejection', (reason, promise) => {
  console.error('⚠️ Unhandled Promise Rejection:', reason);
  console.error('  Promise:', promise);
  // Don't exit — Kalidasa is stateless HTTP; one rejected promise shouldn't kill all users.
  // App Runner handles restart on repeated failures.
});

process.on('uncaughtException', (error) => {
  console.error('💀 Uncaught Exception — process will exit');
  console.error('  Error:', error.message);
  console.error('  Stack:', error.stack);
  process.exit(1);
});

/**
 * Kalidasa Search API
 * 
 * REST API server for LLM-first search.
 */

// ── MUST be first import — validates env vars before anything reads process.env ──
import './validate-env.js';

import 'dotenv/config';
import express from 'express';
import { searchRouter } from './routes/search.js';
import { loggingMiddleware } from './middleware/logging.js';
import { sharedHealthMonitor, sharedRegistry, bootTime } from './services.js';

import type { Express } from 'express';

const app: Express = express();
const PORT = process.env.PORT || 3200;

// Middleware
app.use(express.json({ limit: '1mb' }));
app.use(loggingMiddleware);

// Routes
app.use('/api', searchRouter);

// Health check — reads cached results from background HookHealthMonitor.
// Core failures (Gemini) → HTTP 503 (App Runner restart).
// Domain circuit breaker failures → HTTP 200 + disabledDomains.
// Enhancement failures → HTTP 200 with degraded info.
app.get('/health', (_req, res) => {
  const { hooks, externals, checkedAt, hasCriticalFailure } = sharedHealthMonitor.getLastResults();

  const uptimeMs = Date.now() - bootTime;
  const uptimeMin = Math.round(uptimeMs / 60000);

  // Before first health check cycle completes, report "starting" with 200
  if (!checkedAt) {
    res.status(200).json({
      status: 'starting',
      uptime: `${uptimeMin}m`,
      timestamp: new Date().toISOString(),
      gitSha: process.env.GIT_SHA || null,
      message: 'Initial health check cycle not yet complete',
    });
    return;
  }

  // hooks is Record<string, HealthCheckResult> — extract healthy boolean
  const hookEntries = Object.entries(hooks);
  const extEntries = Object.entries(externals);
  const hookFailed = hookEntries.filter(([, r]) => !r.healthy).map(([n]) => n);
  const extFailed = extEntries.filter(([, ok]) => !ok).map(([n]) => n);

  // Domain gating status
  const disabledDomains = sharedRegistry.getDisabledDomains();
  const disabledCount = Object.keys(disabledDomains).length;

  const anyFailure = hookFailed.length > 0 || extFailed.length > 0 || disabledCount > 0;
  const status = hasCriticalFailure ? 'critical' : anyFailure ? 'degraded' : 'ok';
  const httpStatus = hasCriticalFailure ? 503 : 200;

  res.status(httpStatus).json({
    status,
    uptime: `${uptimeMin}m`,
    timestamp: new Date().toISOString(),
    gitSha: process.env.GIT_SHA || null,
    lastHealthCheck: checkedAt,
    hooks: {
      total: hookEntries.length,
      healthy: hookEntries.length - hookFailed.length,
      failed: hookFailed,
    },
    externals: {
      total: extEntries.length,
      healthy: extEntries.length - extFailed.length,
      failed: extFailed,
    },
    disabledDomains,
  });
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║                     🏛️  KALIDASA                          ║
║              LLM-First Search Service                     ║
║                                                           ║
║   Server running at http://localhost:${PORT}               ║
║   API endpoint: POST /api/search                          ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
  `);
});

// ── Graceful shutdown ──
function shutdown(signal: string) {
  console.log(`\n⏹️  ${signal} received — shutting down gracefully...`);
  sharedHealthMonitor.stop();
  server.close(() => {
    console.log('✅ Server closed. All in-flight requests completed.');
    process.exit(0);
  });
  // Force exit after 10s if connections don't drain
  setTimeout(() => {
    console.error('⚠️  Forced exit after 10s timeout');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export default app;
