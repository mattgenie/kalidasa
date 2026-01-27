/**
 * Search Route
 * 
 * POST /api/search - Main search endpoint
 */

import { Router } from 'express';
import { searchHandler } from '../handlers/search-handler.js';
import { validateSearchRequest } from '../middleware/validation.js';

import type { Router as RouterType } from 'express';

export const searchRouter: RouterType = Router();

// POST /api/search
searchRouter.post('/search', validateSearchRequest, searchHandler);
