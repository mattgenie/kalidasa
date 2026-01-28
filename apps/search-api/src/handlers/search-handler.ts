/**
 * Search Handler
 * 
 * Uses two-stage parallel generation for <10s latency:
 * - Stage 1a: Fast candidate names
 * - Stage 1b: Enrichment (parallel)
 * - Stage 1c: Personalization (parallel)
 */

import type { Request, Response } from 'express';
import type { KalidasaSearchRequest, KalidasaSearchResponse } from '@kalidasa/types';
import { TwoStageGenerator } from '@kalidasa/cao-generator';
import { EnrichmentExecutor, createHookRegistry } from '@kalidasa/enrichment';
import { Merger } from '@kalidasa/merger';
import { searchCache } from '../cache.js';

// Initialize services (singleton pattern)
let twoStageGenerator: TwoStageGenerator | null = null;
let enrichmentExecutor: EnrichmentExecutor | null = null;
let merger: Merger | null = null;

function getServices() {
    if (!twoStageGenerator) {
        twoStageGenerator = new TwoStageGenerator();
    }
    if (!enrichmentExecutor) {
        const registry = createHookRegistry();
        enrichmentExecutor = new EnrichmentExecutor(registry);
    }
    if (!merger) {
        merger = new Merger();
    }
    return { twoStageGenerator, enrichmentExecutor, merger };
}

export async function searchHandler(req: Request, res: Response): Promise<void> {
    const startTime = Date.now();
    const requestId = `req-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    const searchRequest: KalidasaSearchRequest = req.body;

    console.log(`[${requestId}] 🔍 Search request: "${searchRequest.query.text}" (domain: ${searchRequest.query.domain})`);

    try {
        const { twoStageGenerator, enrichmentExecutor, merger } = getServices();

        // Create enrichment function for two-stage generator
        const enrichFn = async (candidates: any, options: any) => {
            const result = await enrichmentExecutor!.execute(candidates, options);
            return { enriched: result.enriched };
        };

        // Two-stage parallel generation
        console.log(`[${requestId}] Starting two-stage generation...`);
        const result = await twoStageGenerator!.generate(searchRequest, enrichFn);

        console.log(`[${requestId}] ✓ Two-stage complete: ${result.cao.candidates.length} candidates`);
        console.log(`[${requestId}]   Stage 1a: ${result.stage1aMs}ms`);
        console.log(`[${requestId}]   Stage 1b+1c (parallel): ${result.enrichmentMs}ms`);
        console.log(`[${requestId}]   Temporality: ${result.temporality.type} (${result.temporality.useGrounding ? 'grounded' : 'ungrounded'})`);

        // Merge results
        console.log(`[${requestId}] Merging results...`);
        const maxResults = searchRequest.options?.maxResults || 12;
        const mergeResult = merger!.merge(result.cao, result.enriched, {
            domain: searchRequest.query.domain,
            maxResults,
        });

        // Build response
        const response: KalidasaSearchResponse = {
            results: mergeResult.results,
            renderHints: mergeResult.renderHints,
            answerBundle: mergeResult.answerBundle,
        };

        // Add debug info if requested
        if (searchRequest.options?.includeDebug) {
            response.debug = {
                timing: {
                    totalMs: result.latencyMs,
                    caoGenerationMs: result.stage1aMs,
                    enrichmentMs: result.enrichmentMs,
                },
                enrichment: {
                    candidatesGenerated: result.cao.candidates.length,
                    candidatesVerified: result.enriched.filter(e => e.verified).length,
                    hookSuccessRates: {},
                },
                temporality: result.temporality,
            };
        }

        // Cache results
        searchCache.set(
            requestId,
            searchRequest.query.text,
            searchRequest.query.domain,
            mergeResult.results,
            mergeResult.answerBundle,
            mergeResult.renderHints
        );

        const totalMs = Date.now() - startTime;
        console.log(`[${requestId}] ✅ Search complete: ${response.results.length} results (${totalMs}ms total)`);

        res.json(response);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error(`[${requestId}] ❌ Search failed:`, error);

        res.status(500).json({
            results: [],
            renderHints: {
                componentType: 'search_grid',
                domain: searchRequest.query.domain,
                itemRenderer: 'generic_card',
            },
            debug: searchRequest.options?.includeDebug
                ? {
                    timing: { totalMs: Date.now() - startTime, caoGenerationMs: 0, enrichmentMs: 0 },
                    enrichment: { candidatesGenerated: 0, candidatesVerified: 0, hookSuccessRates: {} },
                    error: errorMessage,
                }
                : undefined,
        });
    }
}
