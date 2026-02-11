/**
 * Registry Handler
 * 
 * GET /api/registry — Serves the domain registry as JSON.
 * Consumers (e.g. Chat Agent) poll this to stay in sync without redeployment.
 * Uses ETag based on registry version for cache validation.
 */

import type { Request, Response } from 'express';
import { DOMAIN_REGISTRY, REGISTRY_VERSION } from '@kalidasa/domain-registry';

/**
 * Serve the complete domain registry.
 * Supports conditional requests via ETag / If-None-Match.
 */
export function registryHandler(req: Request, res: Response): void {
    const etag = `"registry-${REGISTRY_VERSION}"`;

    // Conditional request — return 304 if client already has this version
    if (req.headers['if-none-match'] === etag) {
        res.status(304).end();
        return;
    }

    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'public, max-age=60');  // Cache 1 min max
    res.json(DOMAIN_REGISTRY);
}
