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
import { sharedRegistry, bootTime } from './services.js';

import type { Express } from 'express';

const app: Express = express();
const PORT = process.env.PORT || 3200;

// Middleware
app.use(express.json({ limit: '1mb' }));
app.use(loggingMiddleware);

// Routes
app.use('/api', searchRouter);

// Health check — wired to actual HookHealthMonitor state
app.get('/health', async (_req, res) => {
  try {
    const hookResults = await sharedRegistry.healthCheck();
    const hookEntries = Object.entries(hookResults);
    const failures = hookEntries.filter(([, ok]) => !ok);

    const uptimeMs = Date.now() - bootTime;
    const uptimeMin = Math.round(uptimeMs / 60000);

    const status = failures.length === 0 ? 'ok' : 'degraded';

    res.json({
      status,
      timestamp: new Date().toISOString(),
      uptime: `${uptimeMin}m`,
      hooks: {
        total: hookEntries.length,
        healthy: hookEntries.length - failures.length,
        failed: failures.map(([name]) => name),
      },
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// Start server
app.listen(PORT, () => {
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

export default app;
