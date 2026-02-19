/**
 * Search Routes
 * 
 * POST /api/search - Main search endpoint (batch)
 * POST /api/search/stream - Streaming SSE endpoint
 * GET  /api/search/stream - Streaming mode (for EventSource, validated)
 * GET  /api/registry - Domain registry (for consumer sync)
 */

import { Router } from 'express';
import { searchHandler } from '../handlers/search-handler.js';
import { streamingSearchHandler } from '../handlers/streaming-handler.js';
import { registryHandler } from '../handlers/registry-handler.js';
import { validateSearchRequest } from '../middleware/validation.js';

import type { Router as RouterType, Request, Response, NextFunction } from 'express';

export const searchRouter: RouterType = Router();

// ── GET stream: parse query string into body so Zod validation can run ──
function parseGetStreamRequest(req: Request, _res: Response, next: NextFunction): void {
    try {
        req.body = JSON.parse(req.query.request as string);
    } catch {
        // Fall through — validateSearchRequest will catch the invalid/missing body
    }
    next();
}

// POST /api/search - Batch mode
searchRouter.post('/search', validateSearchRequest, searchHandler);

// POST /api/search/stream - Streaming mode (SSE)
searchRouter.post('/search/stream', validateSearchRequest, streamingSearchHandler);

// GET /api/search/stream - Streaming mode (for EventSource) — now validated
searchRouter.get('/search/stream', parseGetStreamRequest, validateSearchRequest, streamingSearchHandler);

// GET /api/registry - Domain registry for consumer sync (Chat Agent, etc.)
searchRouter.get('/registry', registryHandler);

