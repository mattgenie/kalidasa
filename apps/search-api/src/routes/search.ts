/**
 * Search Routes
 * 
 * POST /api/search - Main search endpoint (batch)
 * POST /api/search/stream - Streaming SSE endpoint
 */

import { Router } from 'express';
import { searchHandler } from '../handlers/search-handler.js';
import { streamingSearchHandler } from '../handlers/streaming-handler.js';
import { validateSearchRequest } from '../middleware/validation.js';

import type { Router as RouterType } from 'express';

export const searchRouter: RouterType = Router();

// POST /api/search - Batch mode
searchRouter.post('/search', validateSearchRequest, searchHandler);

// POST /api/search/stream - Streaming mode (SSE)
searchRouter.post('/search/stream', validateSearchRequest, streamingSearchHandler);

// GET /api/search/stream - Streaming mode (for EventSource)
searchRouter.get('/search/stream', streamingSearchHandler);

