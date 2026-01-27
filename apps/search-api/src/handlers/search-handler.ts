/**
 * Search Handler
 * 
 * Orchestrates the full search pipeline:
 * 1. CAO Generation (Gemini with grounding)
 * 2. Parallel Enrichment
 * 3. Merging & Formatting
 */

import type { Request, Response } from 'express';
import type { KalidasaSearchRequest, KalidasaSearchResponse } from '@kalidasa/types';
import { CAOGenerator } from '@kalidasa/cao-generator';
import { EnrichmentExecutor, createHookRegistry } from '@kalidasa/enrichment';
import { Merger } from '@kalidasa/merger';

// Initialize services (singleton pattern)
let caoGenerator: CAOGenerator | null = null;
let enrichmentExecutor: EnrichmentExecutor | null = null;
let merger: Merger | null = null;

function getServices() {
    if (!caoGenerator) {
        caoGenerator = new CAOGenerator();
    }
    if (!enrichmentExecutor) {
        const registry = createHookRegistry();
        enrichmentExecutor = new EnrichmentExecutor(registry);
    }
    if (!merger) {
        merger = new Merger();
    }
    return { caoGenerator, enrichmentExecutor, merger };
}

export async function searchHandler(req: Request, res: Response): Promise<void> {
    const startTime = Date.now();
    const requestId = `req-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    const searchRequest: KalidasaSearchRequest = req.body;

    console.log(`[${requestId}] 🔍 Search request: "${searchRequest.query.text}" (domain: ${searchRequest.query.domain})`);

    try {
        const { caoGenerator, enrichmentExecutor, merger } = getServices();

        // Stage 1: CAO Generation
        console.log(`[${requestId}] Stage 1: Generating CAO with Gemini...`);
        const caoResult = await caoGenerator!.generate(searchRequest);
        console.log(`[${requestId}] ✓ CAO generated: ${caoResult.cao.candidates.length} candidates (${caoResult.latencyMs}ms)`);

        // Stage 2: Parallel Enrichment
        console.log(`[${requestId}] Stage 2: Enriching candidates...`);
        const enrichmentTimeout = searchRequest.options?.enrichmentTimeout || 2000;
        const enrichmentResult = await enrichmentExecutor!.execute(caoResult.cao.candidates, {
            timeout: enrichmentTimeout,
            requestId,
            searchLocation: searchRequest.logistics.searchLocation,
        });
        console.log(`[${requestId}] ✓ Enrichment complete: ${enrichmentResult.stats.candidatesVerified}/${enrichmentResult.stats.candidatesProcessed} verified (${enrichmentResult.stats.totalTimeMs}ms)`);

        // Stage 3: Merge & Format
        console.log(`[${requestId}] Stage 3: Merging results...`);
        const maxResults = searchRequest.options?.maxResults || 12;
        const mergeResult = merger!.merge(caoResult.cao, enrichmentResult.enriched, {
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
                    totalMs: Date.now() - startTime,
                    caoGenerationMs: caoResult.latencyMs,
                    enrichmentMs: enrichmentResult.stats.totalTimeMs,
                },
                enrichment: {
                    candidatesGenerated: enrichmentResult.stats.candidatesProcessed,
                    candidatesVerified: enrichmentResult.stats.candidatesVerified,
                    hookSuccessRates: enrichmentResult.stats.hookSuccessRates,
                },
                groundingSources: caoResult.groundingSources,
            };
        }

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
