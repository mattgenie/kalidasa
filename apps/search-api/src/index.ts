/**
 * Kalidasa Search API
 * 
 * REST API server for LLM-first search.
 */

import 'dotenv/config';
import express from 'express';
import { searchRouter } from './routes/search.js';
import { loggingMiddleware } from './middleware/logging.js';

import type { Express } from 'express';

const app: Express = express();
const PORT = process.env.PORT || 3200;

// Middleware
app.use(express.json({ limit: '1mb' }));
app.use(loggingMiddleware);

// Routes
app.use('/api', searchRouter);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
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
